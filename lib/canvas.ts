import type { RoiRect } from "@/components/RoiOverlay";

export function toVideoSpaceRect(video: HTMLVideoElement, rect: RoiRect): RoiRect {
	const container = video.getBoundingClientRect();
	const scaleX = video.videoWidth / container.width;
	const scaleY = video.videoHeight / container.height;
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
	options: { binarize?: boolean; invert?: boolean; scale?: number; mode?: "avg" | "otsu" } = {}
): HTMLCanvasElement {
	const scale = options.scale && options.scale > 0 ? options.scale : 1;
	const outW = Math.max(1, Math.round(roi.w * scale));
	const outH = Math.max(1, Math.round(roi.h * scale));
	const canvas = document.createElement("canvas");
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
	// Convert to grayscale and threshold
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
	// Build grayscale histogram
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

/**
 * Specialized preprocessor for level digits rendered as white glyphs on orange tiles.
 * - Scales up
 * - Extracts near-white pixels via RGB similarity and brightness
 * - Applies morphological closing to thicken strokes
 * - Outputs black digits on white background for OCR
 */
export function preprocessLevelCanvas(
	video: HTMLVideoElement,
	roi: RoiRect,
	options: { scale?: number; pad?: number } = {}
): HTMLCanvasElement {
	const scale = options.scale && options.scale > 0 ? options.scale : 4;
	const pad = Math.max(0, Math.round((options.pad ?? 2) * scale));
	const srcW = Math.max(1, Math.round(roi.w * scale));
	const srcH = Math.max(1, Math.round(roi.h * scale));
	const outW = srcW + pad * 2;
	const outH = srcH + pad * 2;
	const canvas = document.createElement("canvas");
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
		// Thresholds tuned for white digits with slight antialiasing (relaxed)
		if (chroma <= 90 && mean >= 120) {
			mask[p] = 1;
		}
	}

	// 2) Simple dilation to thicken slender strokes (single pass 3x3)
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
	const clo = dil; // use dilated mask directly

	// 3) Render black digits on white background
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
	options: { margin?: number; targetHeight?: number; outPad?: number } = {}
): HTMLCanvasElement {
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
	const out = document.createElement("canvas");
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
 * Preprocessor for EXP text like: "451519697 [42.59%]"
 * - Scales up to a minimum height for better OCR at low resolutions
 * - Binarizes using Otsu
 * - Optionally blacks out uniform white bands at the top/bottom that are not characters
 *   (keeps white glyphs on black background for preview parity)
 */
export function preprocessExpCanvas(
	video: HTMLVideoElement,
	roi: RoiRect,
	options: { scale?: number; minHeight?: number; removeWhiteBands?: boolean } = {}
): HTMLCanvasElement {
	const minHeight = Math.max(24, Math.floor(options.minHeight ?? 64));
	const desiredScale = options.scale && options.scale > 0 ? options.scale : Math.max(2, Math.min(8, Math.ceil(minHeight / Math.max(1, roi.h))));
	const outW = Math.max(1, Math.round(roi.w * desiredScale));
	const outH = Math.max(1, Math.round(roi.h * desiredScale));
	const canvas = document.createElement("canvas");
	canvas.width = outW;
	canvas.height = outH;
	const ctx = canvas.getContext("2d")!;
	// Preserve original pixel structure when scaling up from low-res
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, outW, outH);
	// Robust binarization; keep foreground (bright glyphs) white on black background
	const img = ctx.getImageData(0, 0, outW, outH);
	binarizeOtsuInPlace(img.data, false /* invert */);
	// Optionally black out uniform white bands at top/bottom (non-text areas)
	if (options.removeWhiteBands !== false) {
		const data = img.data;
		const w = outW, h = outH;
		const rowIsUniformWhite: boolean[] = new Array(h).fill(false);
		// A row is considered "uniform white" if >= 99% pixels are white (255)
		const whiteThreshold = Math.floor(w * 0.90);
		for (let y = 0; y < h; y++) {
			let whiteCount = 0;
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				if (data[i] === 255) whiteCount++;
			}
			rowIsUniformWhite[y] = whiteCount >= whiteThreshold;
		}
		// From top
		let top = 0;
		while (top < h && rowIsUniformWhite[top]) top++;
		// From bottom
		let bottom = h - 1;
		while (bottom >= 0 && rowIsUniformWhite[bottom]) bottom--;
		// Paint the bands black
		for (let y = 0; y < top; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				data[i] = data[i + 1] = data[i + 2] = 0;
			}
		}
		for (let y = bottom + 1; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				data[i] = data[i + 1] = data[i + 2] = 0;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}


