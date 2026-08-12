import type { RoiRect } from "@/components/RoiOverlay";

/**
 * 이 파일은 ROI 캡처와 레벨(LEVEL) OCR 전처리를 담당합니다.
 *
 * - 레벨(LEVEL): 오렌지 타일 위 흰 글자 → "색 기반 마스킹" 후 Tesseract로 읽습니다.
 * - 경험치(EXP): 2.0의 비트맵(픽셀) 글꼴이라 전처리 없이 원본 배율 그대로 `lib/pixelOcr.ts` 가 읽습니다.
 *   (픽셀 글꼴은 확대/이진화하는 순간 글리프가 뭉개져서 오히려 인식이 나빠집니다)
 */

/**
 * 픽셀을 되읽을 캔버스의 2D 컨텍스트를 얻습니다.
 *
 * 왜 여기서 `willReadFrequently`를 주는가:
 * 컨텍스트 속성은 **처음 getContext를 호출할 때만** 반영됩니다. 이후 호출은 다른 속성을 넘겨도
 * 이미 만들어진 컨텍스트를 그대로 돌려줍니다. 이 파일의 함수들이 캔버스를 먼저 만들기 때문에,
 * 여기서 플래그를 주지 않으면 나중에 `lib/pixelOcr.ts`가 `willReadFrequently: true`로 요청해도 무시됩니다.
 * 그러면 1초마다 도는 getImageData가 GPU→CPU readback 경로를 타서 느려집니다.
 */
export function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("2D 캔버스 컨텍스트를 만들 수 없습니다.");
	return ctx;
}

export function toVideoSpaceRect(video: HTMLVideoElement, rect: RoiRect): RoiRect {
	// 현재 ROI는 RoiOverlay에서 "비디오 픽셀 좌표"로 저장됩니다.
	// 이 함수는 과거 호환/안전성 목적(정수화)로만 유지합니다.
	// (주의) 만약 ROI를 CSS 픽셀로 저장하는 방식으로 바꾸면, 여기서 실제 변환 로직이 필요합니다.
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		w: Math.round(rect.w),
		h: Math.round(rect.h)
	};
}

export function drawRoiCanvas(
	video: HTMLVideoElement,
	roi: RoiRect,
	options: { scale?: number; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	// ROI를 캔버스로 잘라내는 공통 유틸입니다.
	// 픽셀 글꼴 인식은 원본 배율(scale=1)을 쓰고, 디버그 프리뷰만 확대해서 씁니다.
	const scale = options.scale && options.scale > 0 ? options.scale : 1;
	const outW = Math.max(1, Math.round(roi.w * scale));
	const outH = Math.max(1, Math.round(roi.h * scale));
	const canvas = options.outCanvas ?? document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = get2dContext(canvas);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, outW, outH);
	return canvas;
}

/**
 * 레벨(LEVEL) 영역 전처리
 *
 * 목표: "오렌지 타일 위 흰색 숫자"를 OCR이 잘 읽도록 "검정 글자 / 흰 배경"의 바이너리 이미지로 변환합니다.
 *
 * 처리 단계:
 * - (1) ROI 캡처 + 스케일업: 작은 폰트를 크게 만들어 OCR 신호를 키움
 * - (2) 색 기반 마스크: "밝고 채도가 낮은(=흰색에 가까운)" 픽셀만 글자로 간주
 * - (3) 간단 팽창(dilation): 얇은 획을 조금 두껍게 만들어 인식 안정화
 * - (4) 렌더링: 검정 글자(0) / 흰 배경(255)로 출력
 */
export function preprocessLevelCanvas(
	video: HTMLVideoElement,
	roi: RoiRect,
	options: { scale?: number; pad?: number; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	const scale = options.scale && options.scale > 0 ? options.scale : 4;
	const pad = Math.max(0, Math.round((options.pad ?? 2) * scale));
	const srcW = Math.max(1, Math.round(roi.w * scale));
	const srcH = Math.max(1, Math.round(roi.h * scale));
	const outW = srcW + pad * 2;
	const outH = srcH + pad * 2;
	const canvas = options.outCanvas ?? document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = get2dContext(canvas);
	ctx.imageSmoothingEnabled = false;
	// 가장자리 아티팩트를 줄이기 위해 흰 배경을 먼저 채웁니다.
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, outW, outH);
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, pad, pad, srcW, srcH);

	const img = ctx.getImageData(0, 0, outW, outH);
	const data = img.data;
	const w = outW, h = outH;
	const mask = new Uint8Array(w * h);

	// 1) 색 기반 마스크: "밝고(밝기 높음) 채도 낮은(거의 흰색)" 픽셀만 전경으로 간주
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		const maxc = Math.max(r, g, b);
		const minc = Math.min(r, g, b);
		const mean = (r + g + b) / 3;
		const chroma = maxc - minc;
		// 임계값(레벨 타일용):
		// - mean(밝기)을 높이고, chroma(색차)를 낮춰 "진짜 흰 글자"만 더 타이트하게 잡습니다.
		// - 목표: 배경/테두리의 미세 픽셀들이 전경으로 섞이는 것을 줄여 1px 스펙클을 방지
		if (chroma <= 80 && mean >= 130) {
			mask[p] = 1;
		}
	}

	// 2) 간단 dilation(3x3): 얇은 획을 조금 두껍게 해서 OCR 안정화
	const dil = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let on = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					if (mask[ny * w + nx]) { on = 1; break; }
				}
				if (on) break;
			}
			dil[y * w + x] = on;
		}
	}

	// 3) 스펙클 제거: "고립된 점(주변에 이웃이 거의 없는 전경 픽셀)"을 제거합니다.
	// - dilation만 적용하면 배경의 미세 오검출(1px)이 그대로 전경으로 남아 bbox 크롭을 방해할 수 있습니다.
	// - 숫자 획은 인접 픽셀들이 충분히 있어서 이 필터에서 대부분 보존됩니다.
	const clo = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const idx = y * w + x;
			if (!dil[idx]) continue;
			let neighbors = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dy === 0) continue;
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					if (dil[ny * w + nx]) neighbors++;
				}
			}
			// 1px 또는 얇은 잡점은 이웃이 거의 없으므로 제거 (neighbors>=1이면 유지)
			if (neighbors >= 1) clo[idx] = 1;
		}
	}

	// 4) 흰 배경(255) 위에 검정 글자(0)로 렌더링
	for (let y = 0, p = 0, i = 0; y < h; y++) {
		for (let x = 0; x < w; x++, p++, i += 4) {
			const digit = clo[p] === 1;
			data[i] = data[i + 1] = data[i + 2] = digit ? 0 : 255;
			// 알파는 항상 불투명으로 유지
			data[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/**
 * 캔버스를 최근접 이웃으로 정수배 확대합니다.
 *
 * 픽셀(비트맵) 글꼴 디버그 프리뷰용입니다. 원본 배율 ROI는 글자가 5x7px이라
 * 그대로 보여주면 눈으로 확인할 수 없어서, 픽셀 구조를 그대로 유지한 채 키웁니다.
 */
export function upscaleCanvasNearest(
	source: HTMLCanvasElement,
	factor: number,
	outCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
	const f = Math.max(1, Math.round(factor));
	const out = outCanvas ?? document.createElement("canvas");
	out.width = Math.max(1, source.width * f);
	out.height = Math.max(1, source.height * f);
	const ctx = get2dContext(out);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(source, 0, 0, out.width, out.height);
	return out;
}

export function cropDigitBoundingBox(
	source: HTMLCanvasElement,
	options: { margin?: number; targetHeight?: number; outPad?: number; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	// LEVEL처럼 "검정 글자 / 흰 배경" 바이너리 이미지에서 글자 bbox만 타이트하게 잘라내고,
	// OCR이 읽기 좋게 targetHeight로 리스케일한 뒤 흰 테두리를 추가합니다.
	const margin = options.margin ?? 1;
	const targetH = options.targetHeight ?? 64;
	const outPad = options.outPad ?? 4; // 잘라낸 숫자 주변에 흰 테두리 추가
	const w = source.width;
	const h = source.height;
	const ctx = get2dContext(source);
	const img = ctx.getImageData(0, 0, w, h);
	const data = img.data;
	let minX = w, minY = h, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			// 흰 배경 위 검정 글자
			const v = data[i];
			// 거의 흰색은 배경, 그보다 어두우면 글자로 간주
			if (v < 200) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < minX || maxY < minY) {
		// 글자(전경)를 못 찾으면 원본을 반환
		return source;
	}
	minX = Math.max(0, minX - margin);
	minY = Math.max(0, minY - margin);
	maxX = Math.min(w - 1, maxX + margin);
	maxY = Math.min(h - 1, maxY + margin);
	const bw = maxX - minX + 1;
	const bh = maxY - minY + 1;
	const scale = targetH / bh;
	const outW = Math.max(1, Math.round(bw * scale));
	const outH = Math.max(1, Math.round(bh * scale));
	const out = options.outCanvas ?? document.createElement("canvas");
	out.width = outW + outPad * 2;
	out.height = outH + outPad * 2;
	const octx = get2dContext(out);
	octx.imageSmoothingEnabled = false;
	// 흰색 패딩
	octx.fillStyle = "#ffffff";
	octx.fillRect(0, 0, out.width, out.height);
	octx.drawImage(source, minX, minY, bw, bh, outPad, outPad, outW, outH);
	return out;
}
