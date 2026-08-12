import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/**
 * 의존성 없이 PNG를 RGBA 픽셀로 읽습니다.
 *
 * 이 도구들은 "게임 캡처 스크린샷 → 픽셀 글꼴 템플릿" 작업에만 쓰이므로
 * 8bit / non-interlaced PNG만 지원하면 충분합니다. (OS 스크린샷은 모두 여기에 해당)
 */
export function readPng(path) {
	const buf = readFileSync(path);
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 파일이 아닙니다: " + path);

	let pos = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let palette = null;
	const idat = [];

	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		pos += 12 + len;
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			if (data[12] !== 0) throw new Error("인터레이스 PNG는 지원하지 않습니다");
		} else if (type === "PLTE") palette = Buffer.from(data);
		else if (type === "IDAT") idat.push(Buffer.from(data));
		else if (type === "IEND") break;
	}
	if (bitDepth !== 8) throw new Error(`8bit PNG만 지원합니다 (bitDepth=${bitDepth})`);

	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new Error(`지원하지 않는 colorType=${colorType}`);

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const lines = Buffer.alloc(height * stride);
	let prev = Buffer.alloc(stride);
	let p = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[p++];
		const line = Buffer.from(raw.subarray(p, p + stride));
		p += stride;
		unfilter(filter, line, prev, channels);
		line.copy(lines, y * stride);
		prev = line;
	}

	// RGBA로 정규화
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * stride + x * channels;
			const o = (y * width + x) * 4;
			let r,
				g,
				b,
				a = 255;
			if (colorType === 0) r = g = b = lines[i];
			else if (colorType === 2) [r, g, b] = [lines[i], lines[i + 1], lines[i + 2]];
			else if (colorType === 3) {
				const idx = lines[i] * 3;
				[r, g, b] = [palette[idx], palette[idx + 1], palette[idx + 2]];
			} else if (colorType === 4) {
				r = g = b = lines[i];
				a = lines[i + 1];
			} else {
				[r, g, b, a] = [lines[i], lines[i + 1], lines[i + 2], lines[i + 3]];
			}
			out[o] = r;
			out[o + 1] = g;
			out[o + 2] = b;
			out[o + 3] = a;
		}
	}
	return { width, height, data: out };
}

function unfilter(filter, line, prev, bpp) {
	const n = line.length;
	if (filter === 0) return;
	if (filter === 1) {
		for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255;
	} else if (filter === 2) {
		for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255;
	} else if (filter === 3) {
		for (let i = 0; i < n; i++) {
			const a = i >= bpp ? line[i - bpp] : 0;
			line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
		}
	} else if (filter === 4) {
		for (let i = 0; i < n; i++) {
			const a = i >= bpp ? line[i - bpp] : 0;
			const b = prev[i];
			const c = i >= bpp ? prev[i - bpp] : 0;
			const pa = Math.abs(b - c);
			const pb = Math.abs(a - c);
			const pc = Math.abs(a + b - 2 * c);
			const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			line[i] = (line[i] + pr) & 255;
		}
	} else {
		throw new Error("알 수 없는 PNG 필터: " + filter);
	}
}

/** ROI를 잘라 RGBA 이미지로 돌려줍니다. */
export function cropRgba(img, x0, y0, w, h) {
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = ((y0 + y) * img.width + (x0 + x)) * 4;
			const di = (y * w + x) * 4;
			out[di] = img.data[si];
			out[di + 1] = img.data[si + 1];
			out[di + 2] = img.data[si + 2];
			out[di + 3] = img.data[si + 3];
		}
	}
	return { width: w, height: h, data: out };
}
