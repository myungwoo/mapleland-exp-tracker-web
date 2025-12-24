import type { RoiRect } from "@/components/RoiOverlay";

/**
 * 이 파일은 OCR 전처리(ROI 캡처 → 스케일/이진화 → 노이즈 제거 → 타이트 크롭)를 담당합니다.
 *
 * - 레벨(LEVEL): 오렌지 타일 위 흰 글자 → "색 기반 마스킹"이 유리
 * - 경험치(EXP): 한 줄 텍스트(숫자 + [xx.xx%]) → "이진화(Otsu) + UI 보더 제거"가 유리
 *
 * 전처리 방식은 다르지만, 아래 단계들은 공통으로 재사용됩니다:
 * - ROI 캡처/스케일업
 * - 이진화(바이너리 이미지)
 * - 가장자리 보더/밴드 제거(크롭이 보더에 끌려가는 문제 방지)
 * - 타이트 크롭(bbox)
 * - (권장) 폴라리티 정규화: "검정 글자 / 흰 배경"으로 통일
 */

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
	options: { binarize?: boolean; invert?: boolean; scale?: number; mode?: "avg" | "otsu"; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	// ROI를 캔버스로 잘라내고(옵션으로) 이진화까지 수행하는 공통 유틸입니다.
	const scale = options.scale && options.scale > 0 ? options.scale : 1;
	const outW = Math.max(1, Math.round(roi.w * scale));
	const outH = Math.max(1, Math.round(roi.h * scale));
	const canvas = options.outCanvas ?? document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, outW, outH);
	if (options.binarize || options.invert) {
		const img = ctx.getImageData(0, 0, outW, outH);
		if (options.mode === "otsu") {
			binarizeOtsuInPlace(img.data, options.invert === true);
		} else {
			binarizeInPlace(img.data, options.invert === true);
		}
		ctx.putImageData(img, 0, 0);
	}
	return canvas;
}

function binarizeInPlace(data: Uint8ClampedArray, invert = false) {
	// 간단 평균 기반 이진화(디버그/간이용)
	let sum = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		const y = 0.299 * r + 0.587 * g + 0.114 * b;
		sum += y;
	}
	const avg = sum / (data.length / 4);
	const threshold = avg * 0.9; // slightly below average
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		const y = 0.299 * r + 0.587 * g + 0.114 * b;
		let v = y > threshold ? 255 : 0; // white for foreground by default
		if (invert) v = v === 255 ? 0 : 255; // make digits black on white if invert
		data[i] = data[i + 1] = data[i + 2] = v;
		// keep alpha
	}
}

function binarizeOtsuInPlace(data: Uint8ClampedArray, invert = false) {
	// Otsu 자동 임계값 기반 이진화(권장, 조명/배경 변화에 강함)
	const hist = new Array<number>(256).fill(0);
	const gray = new Uint8Array(data.length / 4);
	for (let i = 0, gi = 0; i < data.length; i += 4, gi++) {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		const y = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
		gray[gi] = y;
		hist[y]++;
	}
	// Otsu threshold
	let total = gray.length;
	let sum = 0;
	for (let t = 0; t < 256; t++) sum += t * hist[t];
	let sumB = 0;
	let wB = 0;
	let wF = 0;
	let varMax = 0;
	let threshold = 127;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		wF = total - wB;
		if (wF === 0) break;
		sumB += t * hist[t];
		const mB = sumB / wB;
		const mF = (sum - sumB) / wF;
		const between = wB * wF * (mB - mF) * (mB - mF);
		if (between > varMax) {
			varMax = between;
			threshold = t;
		}
	}
	// Apply threshold
	for (let i = 0, gi = 0; i < data.length; i += 4, gi++) {
		let v = gray[gi] > threshold ? 255 : 0;
		if (invert) v = v === 255 ? 0 : 255;
		data[i] = data[i + 1] = data[i + 2] = v;
	}
}

function invertBinaryInPlace(data: Uint8ClampedArray) {
	// 이미 0/255로 이진화된 이미지를 반전합니다. (255 ↔ 0)
	for (let i = 0; i < data.length; i += 4) {
		const v = data[i];
		const out = v > 128 ? 0 : 255;
		data[i] = data[i + 1] = data[i + 2] = out;
		// alpha 유지
	}
}

function removeUniformEdgeLinesBinaryInPlace(
	data: Uint8ClampedArray,
	w: number,
	h: number,
	options: {
		/** foreground가 흰색(255)인지/검정(0)인지 */
		foreground: "white" | "black";
		/** 가장자리에서 검사할 영역 크기(픽셀) */
		edgeY: number;
		edgeX: number;
		/** 한 줄(행/열)이 보더로 판정되기 위한 foreground 비율 */
		thresholdFrac: number;
	} = { foreground: "white", edgeY: 16, edgeX: 16, thresholdFrac: 0.97 }
) {
	// OCR용 이진 이미지에서 UI 보더(얇은 직선)가 남아있으면 bbox가 보더까지 확장되는 문제가 큽니다.
	// 그래서 "가장자리 근처에서 foreground 픽셀이 지나치게 많은 행/열"을 보더로 보고 제거합니다.
	const fg = options.foreground;
	const isFg = (v: number) => (fg === "white" ? v > 200 : v < 80);
	const rowCount = new Uint16Array(h);
	const colCount = new Uint16Array(w);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isFg(data[i])) {
				rowCount[y]++;
				colCount[x]++;
			}
		}
	}
	const rowThresh = Math.floor(w * options.thresholdFrac);
	const colThresh = Math.floor(h * options.thresholdFrac);
	const clearRow = (y: number) => {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = fg === "white" ? 0 : 255;
		}
	};
	const clearCol = (x: number) => {
		for (let y = 0; y < h; y++) {
			const i = (y * w + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = fg === "white" ? 0 : 255;
		}
	};

	const edgeY = Math.max(1, Math.min(h, options.edgeY));
	const edgeX = Math.max(1, Math.min(w, options.edgeX));

	// Top/Bottom rows
	for (let y = 0; y < edgeY; y++) {
		if (rowCount[y] >= rowThresh) clearRow(y);
	}
	for (let y = h - edgeY; y < h; y++) {
		if (y >= 0 && rowCount[y] >= rowThresh) clearRow(y);
	}
	// Left/Right cols
	for (let x = 0; x < edgeX; x++) {
		if (colCount[x] >= colThresh) clearCol(x);
	}
	for (let x = w - edgeX; x < w; x++) {
		if (x >= 0 && colCount[x] >= colThresh) clearCol(x);
	}
}

function removeUniformTopBottomBandsBinaryInPlace(
	data: Uint8ClampedArray,
	w: number,
	h: number,
	options: {
		foreground: "white" | "black";
		/** 한 행에서 foreground 픽셀이 이 비율 이상이면 "거의 전부 foreground"로 간주 */
		uniformRowFrac: number;
		/** 위/아래에서 검사할 윈도우 높이(픽셀) */
		windowY: number;
	} = { foreground: "white", uniformRowFrac: 0.9, windowY: 64 }
) {
	// EXP 영역에는 종종 상단/하단 장식(띠)나 경계가 들어오는데,
	// 이게 글자와 분리되어 있어도 bbox를 늘려 OCR을 흔듭니다.
	const fg = options.foreground;
	const isFg = (v: number) => (fg === "white" ? v > 200 : v < 80);
	const rowThresh = Math.floor(w * options.uniformRowFrac);
	const rowIsUniform: boolean[] = new Array(h).fill(false);
	for (let y = 0; y < h; y++) {
		let cnt = 0;
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (isFg(data[i])) cnt++;
		}
		rowIsUniform[y] = cnt >= rowThresh;
	}

	const win = Math.max(1, Math.min(h, options.windowY));
	let top = 0;
	for (let y = 0; y < win; y++) {
		if (rowIsUniform[y]) top = y + 1;
	}
	let bottom = h - 1;
	for (let y = h - 1; y >= Math.max(0, h - win); y--) {
		if (rowIsUniform[y]) bottom = y - 1;
	}

	const bg = fg === "white" ? 0 : 255;
	for (let y = 0; y < top; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = bg;
		}
	}
	for (let y = bottom + 1; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = bg;
		}
	}
}

function removeTopRightIslandsBinaryInPlace(
	data: Uint8ClampedArray,
	w: number,
	h: number,
	options: {
		foreground: "white" | "black";
		/**
		 * "섬"을 찾기 위해 스캔을 시작할 우측 영역 비율 (0~1).
		 * 예: 0.35면 전체 폭의 오른쪽 35%만 시작점으로 훑습니다.
		 */
		scanRightFrac: number;
		/**
		 * "섬"을 찾기 위해 스캔을 시작할 상단 영역 비율 (0~1).
		 * 예: 0.45면 전체 높이의 위쪽 45%만 시작점으로 훑습니다.
		 */
		scanTopFrac: number;
		/** 컴포넌트(연결요소) 면적이 전체 대비 이 비율 이하일 때만 제거 후보 */
		maxAreaFrac: number;
		/** bbox 가로/세로가 전체 대비 이 비율 이하일 때만 제거 후보 */
		maxWidthFrac: number;
		maxHeightFrac: number;
		/**
		 * (레거시) 우측 끝 판정용 마진(px).
		 * 현재 기본 판정은 "우측 상단 코너 영역 안에 완전히 들어온 작은 컴포넌트"이며,
		 * 이 값은 매우 근접한 경우 보조적으로만 사용됩니다.
		 */
		rightEdgeMarginPx: number;
		/** 4-연결 또는 8-연결 */
		connectivity: 4 | 8;
	} = {
		foreground: "white",
		scanRightFrac: 0.35,
		scanTopFrac: 0.45,
		maxAreaFrac: 0.01,
		maxWidthFrac: 0.28,
		maxHeightFrac: 0.55,
		rightEdgeMarginPx: 2,
		connectivity: 8
	}
) {
	// EXP ROI 우측 상단에 UI 잔상/아이콘/노이즈처럼 작은 "섬"이 생기면
	// bbox 크롭이 그쪽으로 끌려가 OCR이 흔들릴 수 있습니다.
	// 이 함수는 "우측 상단 영역에서 시작한 작은 연결요소"만 골라 배경으로 지웁니다.
	const fg = options.foreground;
	const isFg = (v: number) => (fg === "white" ? v > 200 : v < 80);
	const bg = fg === "white" ? 0 : 255;

	const scanX0 = Math.max(0, Math.floor(w * (1 - Math.max(0, Math.min(1, options.scanRightFrac)))));
	const scanY1 = Math.max(0, Math.floor(h * Math.max(0, Math.min(1, options.scanTopFrac))));
	if (w <= 1 || h <= 1 || scanX0 >= w || scanY1 <= 0) return;

	const maxArea = Math.max(1, Math.floor(w * h * options.maxAreaFrac));
	const maxW = Math.max(1, Math.floor(w * options.maxWidthFrac));
	const maxH = Math.max(1, Math.floor(h * options.maxHeightFrac));
	const rightMargin = Math.max(0, Math.floor(options.rightEdgeMarginPx));

	const visited = new Uint8Array(w * h);
	const stack: number[] = [];
	const pixels: number[] = [];

	const push = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= w || y >= h) return;
		const p = y * w + x;
		if (visited[p]) return;
		const i = p * 4;
		if (!isFg(data[i])) return;
		visited[p] = 1;
		stack.push(p);
	};

	for (let y = 0; y < scanY1; y++) {
		for (let x = scanX0; x < w; x++) {
			const p0 = y * w + x;
			if (visited[p0]) continue;
			const i0 = p0 * 4;
			if (!isFg(data[i0])) {
				// background는 방문 처리만 하고 넘어갑니다. (성능 최적화)
				visited[p0] = 1;
				continue;
			}

			// BFS/DFS for this component
			stack.length = 0;
			pixels.length = 0;
			visited[p0] = 1;
			stack.push(p0);

			let minX = x, maxX = x, minY = y, maxY = y;
			let area = 0;

			while (stack.length) {
				const p = stack.pop()!;
				pixels.push(p);
				area++;
				// Early bail: if it grows too big, treat it as not-an-island (e.g., real text)
				if (area > maxArea) break;
				const cy = Math.floor(p / w);
				const cx = p - cy * w;
				if (cx < minX) minX = cx;
				if (cx > maxX) maxX = cx;
				if (cy < minY) minY = cy;
				if (cy > maxY) maxY = cy;

				// neighbors
				push(cx - 1, cy);
				push(cx + 1, cy);
				push(cx, cy - 1);
				push(cx, cy + 1);
				if (options.connectivity === 8) {
					push(cx - 1, cy - 1);
					push(cx + 1, cy - 1);
					push(cx - 1, cy + 1);
					push(cx + 1, cy + 1);
				}
			}

			// If we bailed due to size, don't remove; but keep visited marks to avoid rework.
			if (area > maxArea) continue;

			const bw = maxX - minX + 1;
			const bh = maxY - minY + 1;

			// "섬"은 보통 텍스트 라인과 분리되어 코너에만 존재합니다.
			// 그래서 "코너 영역 안에 완전히 들어온 작은 컴포넌트"를 우선 제거 대상으로 봅니다.
			// (오른쪽 경계에 딱 붙지 않고 몇 px 떠 있는 케이스를 커버)
			const isContainedInCorner = minX >= scanX0 && maxY < scanY1;
			// 경계에 거의 붙은 경우를 좀 더 강하게 허용 (legacy)
			const isNearRightEdge = maxX >= (w - 1 - rightMargin);
			const isTopRight = isContainedInCorner || (isNearRightEdge && minX >= scanX0 && minY < scanY1);

			const isSmallEnough = bw <= maxW && bh <= maxH && area <= maxArea;

			if (isTopRight && isSmallEnough) {
				for (let k = 0; k < pixels.length; k++) {
					const pp = pixels[k];
					const ii = pp * 4;
					data[ii] = data[ii + 1] = data[ii + 2] = bg;
				}
			}
		}
	}
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
	const ctx = canvas.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	// fill white background to avoid edge artifacts
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, outW, outH);
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, pad, pad, srcW, srcH);

	const img = ctx.getImageData(0, 0, outW, outH);
	const data = img.data;
	const w = outW, h = outH;
	const mask = new Uint8Array(w * h);

	// 1) Color-based mask: near-white (low chroma) and bright
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

	// 4) Render black digits on white background
	for (let y = 0, p = 0, i = 0; y < h; y++) {
		for (let x = 0; x < w; x++, p++, i += 4) {
			const digit = clo[p] === 1;
			data[i] = data[i + 1] = data[i + 2] = digit ? 0 : 255;
			// keep alpha opaque
			data[i + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

export function cropDigitBoundingBox(
	source: HTMLCanvasElement,
	options: { margin?: number; targetHeight?: number; outPad?: number; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	// LEVEL처럼 "검정 글자 / 흰 배경" 바이너리 이미지에서 글자 bbox만 타이트하게 잘라내고,
	// OCR이 읽기 좋게 targetHeight로 리스케일한 뒤 흰 테두리를 추가합니다.
	const margin = options.margin ?? 1;
	const targetH = options.targetHeight ?? 64;
	const outPad = options.outPad ?? 4; // add white border around cropped digit
	const w = source.width;
	const h = source.height;
	const ctx = source.getContext("2d")!;
	const img = ctx.getImageData(0, 0, w, h);
	const data = img.data;
	let minX = w, minY = h, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			// black digits on white bg
			const v = data[i];
			// treat near-white as background, anything darker as digit
			if (v < 200) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < minX || maxY < minY) {
		// nothing found, return original
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
	const octx = out.getContext("2d")!;
	octx.imageSmoothingEnabled = false;
	// white padding
	octx.fillStyle = "#ffffff";
	octx.fillRect(0, 0, out.width, out.height);
	octx.drawImage(source, minX, minY, bw, bh, outPad, outPad, outW, outH);
	return out;
}

/**
 * 바이너리(전처리된) 캔버스를 "글자(전경)"의 bounding box로 타이트하게 크롭합니다.
 *
 * 왜 필요한가?
 * - ROI는 넉넉하게 잡는 편이 사용자 UX는 좋은데,
 *   ROI가 넓을수록 주변 UI/잡음이 OCR에 섞여 정확도가 떨어질 수 있습니다.
 * - 특히 EXP는 자리수가 줄어들면(10자리→6자리 등) 숫자 영역이 ROI 내에서 작아져
 *   잡음 비율이 커지기 때문에, "전경만 타이트 크롭"이 효과가 큽니다.
 *
 * 입력 가정:
 * - source는 이미 이진화되어 있음(0 또는 255에 가까움)
 * - foreground는
 *   - EXP 전처리: 흰 글자(255) / 검정 배경(0)
 *   - LEVEL 전처리: 검정 글자(0) / 흰 배경(255)
 *
 * 기본 동작:
 * - 결과는 OCR 안정성을 위해 "검정 글자 / 흰 배경"으로 정규화합니다.
 */
export function cropBinaryForegroundBoundingBox(
	source: HTMLCanvasElement,
	options: {
		foreground?: "white" | "black";
		/**
		 * OCR 성능을 위해 결과를 "검정 글자 / 흰 배경"으로 통일합니다.
		 * - foreground가 white(흰 글자 / 검정 배경)인 경우 자동 반전합니다.
		 */
		normalizeToBlackOnWhite?: boolean;
		margin?: number;
		targetHeight?: number;
		outPad?: number;
		/** Minimum foreground pixels in a column/row to be considered part of glyphs (filters speckle noise). */
		minColPx?: number;
		minRowPx?: number;
		outCanvas?: HTMLCanvasElement;
	} = {}
): HTMLCanvasElement {
	const fg = options.foreground ?? "white";
	const normalize = options.normalizeToBlackOnWhite !== false;
	const margin = options.margin ?? 2;
	const targetH = options.targetHeight ?? source.height;
	const outPad = options.outPad ?? 6;
	const w = source.width;
	const h = source.height;
	const ctx = source.getContext("2d");
	if (!ctx || w <= 0 || h <= 0) return source;

	const img = ctx.getImageData(0, 0, w, h);
	const data = img.data;
	const isForeground = (v: number) => (fg === "white" ? v > 200 : v < 80);

	const minColPx = options.minColPx ?? Math.max(2, Math.floor(h * 0.02));
	const minRowPx = options.minRowPx ?? Math.max(1, Math.floor(w * 0.01));

	const colCount = new Uint16Array(w);
	const rowCount = new Uint16Array(h);

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const v = data[i]; // red channel is enough after binarize
			if (isForeground(v)) {
				colCount[x]++;
				rowCount[y]++;
			}
		}
	}

	let minX = 0;
	while (minX < w && colCount[minX] < minColPx) minX++;
	let maxX = w - 1;
	while (maxX >= 0 && colCount[maxX] < minColPx) maxX--;
	let minY = 0;
	while (minY < h && rowCount[minY] < minRowPx) minY++;
	let maxY = h - 1;
	while (maxY >= 0 && rowCount[maxY] < minRowPx) maxY--;

	if (maxX < minX || maxY < minY) return source;

	minX = Math.max(0, minX - margin);
	minY = Math.max(0, minY - margin);
	maxX = Math.min(w - 1, maxX + margin);
	maxY = Math.min(h - 1, maxY + margin);

	const bw = maxX - minX + 1;
	const bh = maxY - minY + 1;
	const scale = targetH > 0 ? targetH / Math.max(1, bh) : 1;
	const outW = Math.max(1, Math.round(bw * scale));
	const outH = Math.max(1, Math.round(bh * scale));

	const out = options.outCanvas ?? document.createElement("canvas");
	out.width = outW + outPad * 2;
	out.height = outH + outPad * 2;
	const octx = out.getContext("2d")!;
	octx.imageSmoothingEnabled = false;

	// Fill background appropriately for OCR readability (white background is generally better).
	octx.fillStyle = "#ffffff";
	octx.fillRect(0, 0, out.width, out.height);

	octx.drawImage(source, minX, minY, bw, bh, outPad, outPad, outW, outH);

	// EXP처럼 "흰 글자 / 검정 배경" 입력은 결과를 "검정 글자 / 흰 배경"으로 반전해 OCR 안정성을 높입니다.
	if (normalize && fg === "white") {
		const outImg = octx.getImageData(0, 0, out.width, out.height);
		invertBinaryInPlace(outImg.data);
		// 알파는 항상 opaque로(브라우저/캔버스 상태 차이를 줄임)
		for (let i = 0; i < outImg.data.length; i += 4) outImg.data[i + 3] = 255;
		octx.putImageData(outImg, 0, 0);
	}
	return out;
}

/**
 * Preprocessor for EXP text like: "451519697 [42.59%]"
 * - Scales up to a minimum height for better OCR at low resolutions
 * - Binarizes using Otsu
 * - Optionally blacks out uniform white bands at the top/bottom that are not characters
 *   (keeps white glyphs on black background for preview parity)
 * - Optionally removes small "islands" near the top-right that can pull bbox cropping
 */
export function preprocessExpCanvas(
	video: HTMLVideoElement,
	roi: RoiRect,
	options: { scale?: number; minHeight?: number; removeWhiteBands?: boolean; removeTopRightIslands?: boolean; outCanvas?: HTMLCanvasElement } = {}
): HTMLCanvasElement {
	const minHeight = Math.max(24, Math.floor(options.minHeight ?? 64));
	const desiredScale = options.scale && options.scale > 0 ? options.scale : Math.max(2, Math.min(8, Math.ceil(minHeight / Math.max(1, roi.h))));
	const outW = Math.max(1, Math.round(roi.w * desiredScale));
	const outH = Math.max(1, Math.round(roi.h * desiredScale));
	const canvas = options.outCanvas ?? document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext("2d")!;
	// Preserve original pixel structure when scaling up from low-res
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, outW, outH);
	// Robust binarization; keep foreground (bright glyphs) white on black background
	const img = ctx.getImageData(0, 0, outW, outH);
	binarizeOtsuInPlace(img.data, false /* invert */);
	// (1) 가장자리 보더 제거: 상단 흰 줄 같은 UI 요소가 bbox를 오른쪽 끝까지 끌고 가는 문제를 방지
	removeUniformEdgeLinesBinaryInPlace(img.data, outW, outH, {
		foreground: "white",
		edgeY: Math.max(2, Math.min(48, Math.floor(outH * 0.2))),
		edgeX: Math.max(2, Math.min(48, Math.floor(outW * 0.15))),
		thresholdFrac: 0.97
	});

	// (2) 상/하 밴드 제거(옵션): 텍스트가 아닌 장식 영역을 제거해 OCR을 안정화
	if (options.removeWhiteBands !== false) {
		removeUniformTopBottomBandsBinaryInPlace(img.data, outW, outH, {
			foreground: "white",
			uniformRowFrac: 0.85,
			windowY: Math.max(2, Math.min(64, Math.floor(outH * 0.25)))
		});
	}

	// (3) 우측 상단 "섬" 제거(옵션): 작은 고립 덩어리가 bbox 크롭을 흔들 수 있어 제거합니다.
	if (options.removeTopRightIslands !== false) {
		removeTopRightIslandsBinaryInPlace(img.data, outW, outH, {
			foreground: "white",
			scanRightFrac: 0.35,
			// 상단 코너의 작은 노이즈만 제거하고, 텍스트(특히 % 기호)의 일부를 오탐하지 않도록 top 영역을 더 작게 잡습니다.
			scanTopFrac: 0.25,
			maxAreaFrac: 0.01,
			maxWidthFrac: 0.28,
			maxHeightFrac: 0.55,
			rightEdgeMarginPx: Math.max(1, Math.floor(outW * 0.01)),
			connectivity: 8
		});
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}


