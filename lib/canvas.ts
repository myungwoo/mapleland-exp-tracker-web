import type { RoiRect } from "@/components/RoiOverlay";
import { computeLevelRoiFingerprint, type LevelRoiFingerprint } from "./levelRoiFingerprint";

/**
 * 이 파일은 ROI 캡처를 담당합니다.
 *
 * 레벨(LEVEL)과 경험치(EXP) 둘 다 픽셀 글꼴 템플릿 매칭으로 읽으므로, **전처리가 없습니다.**
 * 원본 배율 ROI를 그대로 잘라서 `lib/levelPixelOcr.ts` / `lib/pixelOcr.ts` 에 넘기면 됩니다.
 * (픽셀 글꼴은 확대/이진화하는 순간 글리프가 뭉개져서 오히려 인식이 나빠집니다)
 *
 * 예전에는 레벨을 Tesseract로 읽느라 "4배 확대 → 색 마스킹 → 팽창 → 스펙클 제거 → bbox 크롭"
 * 전처리가 있었습니다. 그건 전부 OCR에 먹이기 위한 것이었고, 지금은 필요 없어서 지웠습니다.
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
 * 레벨 ROI(원본 배율 캔버스)의 변화 감지 지문을 읽습니다.
 *
 * 확대/이진화 이전의 **원본 배율** ROI를 넘겨야 합니다. 전처리(4배 확대 + 팽창 + 스펙클 제거)는
 * 최근접 확대라서 원본 마스크가 그대로 결정하므로, 지문은 원본 배율에서 잡는 것이 가장 쌉니다.
 * (전처리 캔버스에서 잡으면 아끼려던 전처리를 이미 다 해버린 뒤가 됩니다)
 */
export function readLevelRoiFingerprint(nativeRoiCanvas: HTMLCanvasElement): LevelRoiFingerprint | null {
	const ctx = get2dContext(nativeRoiCanvas);
	try {
		const img = ctx.getImageData(0, 0, nativeRoiCanvas.width, nativeRoiCanvas.height);
		return computeLevelRoiFingerprint(img);
	} catch {
		// 지문을 못 만들면 캐시를 쓰지 않고 매번 인식합니다. (안전한 쪽으로 실패)
		return null;
	}
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
