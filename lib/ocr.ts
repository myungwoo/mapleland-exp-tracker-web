import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";
import { cropDigitBoundingBox } from "./canvas";
import { parsePixelExpText, recognizePixelFontLine } from "./pixelOcr";

/**
 * OCR 진입점
 *
 * - **경험치(EXP)**: 비트맵(픽셀) 글꼴 템플릿 매칭. Tesseract를 쓰지 않습니다.
 *   메이플랜드 2.0의 EXP 텍스트는 5x7px 픽셀 글꼴로 고정이라, 글리프를 픽셀 단위로 맞춰보는 쪽이
 *   훨씬 정확하고 훨씬 쌉니다. 자세한 내용은 `lib/pixelOcr.ts` 참고.
 * - **레벨(LEVEL)**: 오렌지 타일 위 스프라이트 숫자라 픽셀 글꼴이 아니고, 기존 Tesseract 경로를 씁니다.
 */

let digitsWorkerPromise: Promise<TesseractWorker> | null = null;
let digitsWorker: TesseractWorker | null = null;

export async function initOcr() {
	await initOcrDigits();
}

async function initOcrDigits() {
	if (!digitsWorkerPromise) {
		digitsWorkerPromise = (async () => {
			// Tesseract v5: 언어가 미리 로드되어 있어 loadLanguage/initialize가 필요 없습니다.
			const worker: TesseractWorker = await createWorker("eng");
			await worker.setParameters({
				tessedit_char_whitelist: "0123456789",
				preserve_interword_spaces: "1",
				// 작은 스프라이트(컴팩트)에는 숫자 1단어(SINGLE_WORD) 설정이 가장 잘 맞습니다.
				tessedit_pageseg_mode: PSM.SINGLE_WORD,
				classify_bln_numeric_mode: "1",
				user_defined_dpi: "300",
				load_system_dawg: "0",
				load_freq_dawg: "0"
			});
			digitsWorker = worker;
			return worker;
		})();
	}
	return digitsWorkerPromise;
}

/**
 * 장시간 실행 시(수시간) tesseract.js 워커의 내부 메모리 누적/단편화를 완화하기 위해,
 * 워커를 종료하고 다음 OCR 호출에서 새로 생성되게 합니다.
 *
 * 주의:
 * - OCR 작업이 진행 중인 순간에 호출하면 인식이 실패할 수 있으니,
 *   호출자는 "샘플링 루프가 idle" 상태일 때 호출하는 것을 권장합니다.
 */
export async function resetOcrWorkers() {
	const w = digitsWorker;
	// 다음 호출에서 새로 생성되게 먼저 비웁니다.
	digitsWorker = null;
	digitsWorkerPromise = null;
	await Promise.allSettled([w ? w.terminate() : Promise.resolve()]);
}

export type ExpReadResult = {
	/** 인식된 원본 문자열. 미인식 글리프는 `?`(숫자 자리) / `_`(그 외)로 표시됩니다. */
	text: string;
	value: number | null;
	percent: number | null;
};

/**
 * EXP 영역 인식.
 *
 * `nativeRoiCanvas`는 **확대/이진화하지 않은 원본 배율 ROI**여야 합니다.
 * 값/퍼센트를 확신할 수 없으면 둘 다 null로 돌려줍니다. (틀린 값을 흘리는 것보다 낫습니다)
 */
export function recognizeExp(nativeRoiCanvas: HTMLCanvasElement): ExpReadResult {
	const line = recognizePixelFontLine(nativeRoiCanvas);
	if (!line) return { text: "", value: null, percent: null };
	const parsed = parsePixelExpText(line.text);
	return { text: line.text, value: parsed?.value ?? null, percent: parsed?.percent ?? null };
}

export async function recognizeLevelDigitsWithText(
	source: HTMLCanvasElement | ImageBitmap | HTMLImageElement
): Promise<{ text: string; value: number | null }> {
	const worker = await initOcrDigits();
	// 신호를 최대화하기 위해 가능한 한 타이트하게 크롭된 숫자를 대상으로 처리합니다.
	const canvas = source instanceof HTMLCanvasElement ? source : await createCanvasFromSource(source);
	const cropped = cropDigitBoundingBox(canvas, { margin: 2, targetHeight: 72 });
	// 1차 시도: SINGLE_WORD + 높은 DPI
	await worker.setParameters({
		tessedit_pageseg_mode: PSM.SINGLE_WORD,
		user_defined_dpi: "500"
	});
	let result = await worker.recognize(cropped as any);
	let raw = result.data.text;
	let text = normalizeOcrText(raw);
	let m = text.match(/^(\d{1,4})$/) || text.match(/(\d{1,4})/);
	let value = m ? (Number.isNaN(parseInt(m[1], 10)) ? null : parseInt(m[1], 10)) : null;
	if (value != null) return { text, value };
	// 2차 시도: SINGLE_CHAR 대체 경로(더 높은 DPI)
	await worker.setParameters({
		tessedit_pageseg_mode: PSM.SINGLE_CHAR,
		user_defined_dpi: "700"
	});
	result = await worker.recognize(cropped as any);
	raw = result.data.text;
	text = normalizeOcrText(raw);
	m = text.match(/^(\d)$/);
	value = m ? (Number.isNaN(parseInt(m[1], 10)) ? null : parseInt(m[1], 10)) : null;
	if (value == null) {
		// 휴리스틱 대체 경로: 연결요소 기반 bbox처럼 보이는 형태를 이용해 '1'을 추정
		const guess = guessDigitOneFromBinaryCanvas(cropped as HTMLCanvasElement);
		if (guess) value = 1;
	}
	return { text, value };
}

async function createCanvasFromSource(src: HTMLCanvasElement | ImageBitmap | HTMLImageElement): Promise<HTMLCanvasElement> {
	if (src instanceof HTMLCanvasElement) return src;
	const canvas = document.createElement("canvas");
	let w: number, h: number;
	if ("width" in src && "height" in src) {
		// ImageBitmap 또는 HTMLImageElement
		const sized = src as unknown as { width: number; height: number };
		w = sized.width;
		h = sized.height;
	} else {
		w = 1; h = 1;
	}
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(src as any, 0, 0);
	return canvas;
}

function guessDigitOneFromBinaryCanvas(source: HTMLCanvasElement): boolean {
	try {
		const ctx = source.getContext("2d");
		if (!ctx) return false;
		const { width: w, height: h } = source;
		const img = ctx.getImageData(0, 0, w, h);
		const data = img.data;
		let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				// 전처리 결과는 "흰 배경 위 검정 글자" 형태입니다.
				const v = data[i]; // R 채널
				if (v < 128) {
					count++;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (count === 0 || maxX < minX || maxY < minY) return false;
		const bw = maxX - minX + 1;
		const bh = maxY - minY + 1;
		const ar = bh / Math.max(1, bw);
		const areaFrac = count / (w * h);
		// 세로로 길고, 얇고, 면적 비율이 합리적인지(임계값은 다소 느슨하게)
		const slim = (bw / Math.max(1, bh)) <= 0.28;
		return ar >= 3 && slim && areaFrac >= 0.003 && areaFrac <= 0.6;
	} catch {
		return false;
	}
}

function normalizeOcrText(input: string): string {
	// 레벨 숫자에서 흔히 발생하는 문자 오인식과 공백을 정규화합니다.
	let s = input.replace(/[ \t\r\n]+/g, "");
	s = s.replace(/[ＯО]/g, "0"); // 폭이 넓은/다른 형태의 O -> 0
	s = s.replace(/[oO]/g, "0");
	s = s.replace(/[lI|]/g, "1");
	s = s.replace(/Ｓ/g, "5");
	s = s.replace(/Ｂ/g, "8");
	// 숫자만 남깁니다.
	s = s.replace(/[^0-9]/g, "");
	return s;
}
