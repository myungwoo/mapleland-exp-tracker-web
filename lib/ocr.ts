import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";

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


