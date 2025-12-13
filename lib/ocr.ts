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
			// Tesseract v5: language preloaded, no loadLanguage/initialize
			const worker: TesseractWorker = await createWorker("eng");
			await worker.setParameters({
				tessedit_char_whitelist: "0123456789.%[]",
				preserve_interword_spaces: "1",
				tessedit_pageseg_mode: PSM.SINGLE_LINE // treat as single line
			});
			return worker;
		})();
	}
	return expWorkerPromise;
}

async function initOcrDigits() {
	if (!digitsWorkerPromise) {
		digitsWorkerPromise = (async () => {
			// Tesseract v5: language preloaded, no loadLanguage/initialize
			const worker: TesseractWorker = await createWorker("eng");
			await worker.setParameters({
				tessedit_char_whitelist: "0123456789",
				preserve_interword_spaces: "1",
				// Single word of digits works best for compact sprites
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

	// Try to extract [YY.YY%] percent first
	let percent: number | null = null;
	const bracketPercent = text.match(/\[([0-9]{1,3}(?:\.[0-9]{1,2})?)%]/);
	if (bracketPercent) {
		percent = parseFloat(bracketPercent[1]);
	} else {
		// fallback: any percent pattern in the string
		const anyPercent = text.match(/([0-9]{1,3}(?:\.[0-9]{1,2})?)%/);
		if (anyPercent) percent = parseFloat(anyPercent[1]);
	}

	// Extract the integer before the bracket as "value" if present
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
	// Ensure we operate on a tightly-cropped digit to maximize signal
	const canvas = source instanceof HTMLCanvasElement ? source : await createCanvasFromSource(source);
	const cropped = cropDigitBoundingBox(canvas, { margin: 2, targetHeight: 72 });
	// Pass 1: SINGLE_WORD with high DPI
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
	// Pass 2: SINGLE_CHAR fallback (higher DPI)
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
		// Heuristic fallback for '1' using connected-component-like bounding box
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
		// ImageBitmap or HTMLImageElement
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
				// Our preprocess renders black digits on white background
				const v = data[i]; // red channel
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
		// Tall, slim, reasonable area coverage (loosened thresholds and slimness)
		const slim = (bw / Math.max(1, bh)) <= 0.28;
		return ar >= 3 && slim && areaFrac >= 0.003 && areaFrac <= 0.6;
	} catch {
		return false;
	}
}

function normalizeOcrText(input: string): string {
	// Normalize common OCR confusions and whitespace
	let s = input.replace(/[ \t\r\n]+/g, "");
	s = s.replace(/[ＯО]/g, "0"); // wide/other O -> 0
	s = s.replace(/[oO]/g, "0");
	s = s.replace(/[lI|]/g, "1");
	s = s.replace(/Ｓ/g, "5");
	s = s.replace(/Ｂ/g, "8");
	s = s.replace(/[％]/g, "%");
	s = s.replace(/[【\[]/g, "[");
	s = s.replace(/[】\]]/g, "]");
	// keep only relevant characters
	s = s.replace(/[^0-9\.\%\[\]]/g, "");
	return s;
}


