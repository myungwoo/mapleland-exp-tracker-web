import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";
import { cropDigitBoundingBox } from "./canvas";

let expWorkerPromise: Promise<TesseractWorker> | null = null;
let digitsWorkerPromise: Promise<TesseractWorker> | null = null;

export async function initOcr() {
	await Promise.all([initOcrExp(), initOcrDigits()]);
}

async function initOcrExp() {
	if (!expWorkerPromise) {
		expWorkerPromise = (async () => {
			// Tesseract v5: 언어가 미리 로드되어 있어 loadLanguage/initialize가 필요 없습니다.
			const worker: TesseractWorker = await createWorker("eng");
			await worker.setParameters({
				tessedit_char_whitelist: "0123456789.%[]",
				preserve_interword_spaces: "1",
				tessedit_pageseg_mode: PSM.SINGLE_LINE, // 단일 라인으로 처리
				// 스케일업 후 저해상도 입력에서는 DPI를 높이는 편이 도움이 됩니다.
				user_defined_dpi: "500"
			});
			return worker;
		})();
	}
	return expWorkerPromise;
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
			return worker;
		})();
	}
	return digitsWorkerPromise;
}

export async function recognizeExpBracketed(
	source: HTMLCanvasElement | ImageBitmap | HTMLImageElement
): Promise<{ value: number | null; percent: number | null }> {
	const worker = await initOcrExp();
	const result = await worker.recognize(source as any);
	const text = normalizeOcrText(result.data.text);

	// 먼저 [YY.YY%] 형태의 퍼센트를 추출합니다.
	let percent: number | null = null;
	const bracketPercent = text.match(/\[([0-9]{1,3}(?:\.[0-9]{1,2})?)%]/);
	if (bracketPercent) {
		percent = parseFloat(bracketPercent[1]);
	} else {
		// 대체 경로: 문자열 안의 어떤 % 패턴이든 찾습니다.
		const anyPercent = text.match(/([0-9]{1,3}(?:\.[0-9]{1,2})?)%/);
		if (anyPercent) percent = parseFloat(anyPercent[1]);
	}

	// 대괄호 앞의 정수가 있으면 value로 추출합니다.
	let value: number | null = null;
	const valueMatch = text.match(/(\d{2,})\s*\[/);
	if (valueMatch) {
		const n = parseInt(valueMatch[1], 10);
		if (!Number.isNaN(n)) value = n;
	}

	return { value, percent };
}

export async function recognizeLevelDigits(
	source: HTMLCanvasElement | ImageBitmap | HTMLImageElement
): Promise<number | null> {
	const worker = await initOcrDigits();
	const result = await worker.recognize(source as any);
	const text = normalizeOcrText(result.data.text);
	const m = text.match(/^(\d{1,4})$/) || text.match(/(\d{1,4})/);
	if (!m) return null;
	const n = parseInt(m[1], 10);
	return Number.isNaN(n) ? null : n;
}

export async function recognizeExpBracketedWithText(
	source: HTMLCanvasElement | ImageBitmap | HTMLImageElement
): Promise<{ text: string; value: number | null; percent: number | null }> {
	const worker = await initOcrExp();
	const result = await worker.recognize(source as any);
	const text = normalizeOcrText(result.data.text);
	let percent: number | null = null;
	const bracketPercent = text.match(/\[([0-9]{1,3}(?:\.[0-9]{1,2})?)%]/);
	if (bracketPercent) {
		percent = parseFloat(bracketPercent[1]);
	} else {
		const anyPercent = text.match(/([0-9]{1,3}(?:\.[0-9]{1,2})?)%/);
		if (anyPercent) percent = parseFloat(anyPercent[1]);
	}
	let value: number | null = null;
	const valueMatch = text.match(/(\d{2,})\s*\[/);
	if (valueMatch) {
		const n = parseInt(valueMatch[1], 10);
		if (!Number.isNaN(n)) value = n;
	}
	return { text, value, percent };
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
	// OCR에서 흔히 발생하는 혼동(문자 오인식)과 공백을 정규화합니다.
	let s = input.replace(/[ \t\r\n]+/g, "");
	s = s.replace(/[ＯО]/g, "0"); // 폭이 넓은/다른 형태의 O -> 0
	s = s.replace(/[oO]/g, "0");
	s = s.replace(/[lI|]/g, "1");
	s = s.replace(/Ｓ/g, "5");
	s = s.replace(/Ｂ/g, "8");
	s = s.replace(/[％]/g, "%");
	s = s.replace(/[【\[]/g, "[");
	s = s.replace(/[】\]]/g, "]");
	// 관련 문자만 남깁니다.
	s = s.replace(/[^0-9\.\%\[\]]/g, "");
	return s;
}


