import { PIXEL_FONT_DIGIT_HEIGHT, PIXEL_FONT_MASKS, type PixelGlyphMask } from "./pixelFont";

/**
 * 비트맵(픽셀) 글꼴 전용 인식기
 *
 * 왜 일반 OCR이 아니라 템플릿 매칭인가?
 * - 메이플랜드 2.0의 EXP 텍스트는 안티에일리어싱이 없는 5x7px 픽셀 글꼴입니다.
 * - Tesseract 같은 LSTM OCR은 "안티에일리어싱된 벡터 글꼴"을 전제로 학습되어 있어서,
 *   획이 1px인 저해상도 비트맵 글꼴에서는 6/8/3/9 등을 심하게 혼동합니다.
 *   (업스케일을 해도 계단 모양 블록이 될 뿐이라 오히려 더 나빠집니다)
 * - 반대로 비트맵 글꼴은 글리프가 **고정된 픽셀 패턴**이므로, 픽셀 단위로 비교하면
 *   정확히 일치하거나 아예 일치하지 않거나 둘 중 하나입니다. 즉 오인식이 거의 없습니다.
 *
 * 처리 순서
 *  1) ROI를 원본 배율 그대로 읽어서 "밝은 픽셀 = 글자" 마스크를 만듭니다.
 *     (숫자는 흰색 #FFFFFF, 대괄호는 연두색 #99CC33 이라 밝기(최대 채널) 기준이 잘 맞습니다)
 *  2) 연결요소(CC)를 찾아 글리프 후보만 남기고, UI 게이지 바/테두리 같은 큰 덩어리를 버립니다.
 *  3) 남은 글리프들의 높이 최빈값으로 **캡처 배율(scale)** 과 **숫자 윗줄 위치**를 추정합니다.
 *     (디스플레이 배율 200%면 숫자 높이가 14px이 되므로 scale=2)
 *  4) 텍스트 밴드 안에서 빈 열 기준으로 글리프를 자릅니다.
 *     (이 글꼴은 글자 사이에 항상 1px 이상 여백이 있어 열 분리가 안전합니다)
 *  5) 각 글리프를 템플릿과 픽셀 비교해서 문자를 확정합니다.
 *
 * 글자를 찾지 못하거나 확신이 없으면 null을 돌려줍니다. (틀린 값을 흘리는 것보다 낫습니다)
 */

/**
 * 미인식 글리프 표기
 * - `UNKNOWN_DIGIT_SLOT`: 크기/기준선이 숫자와 똑같은데 어떤 템플릿과도 안 맞은 것.
 *   **숫자 한 자리가 통째로 빠졌다는 뜻**이므로, 이게 값에 붙어 있으면 그 샘플은 버려야 합니다.
 *   (예: `1214??91?3[83.18%` 를 그냥 파싱하면 value가 `3` 이 되어버립니다)
 * - `UNKNOWN_OTHER`: 크기부터 글리프가 아닌 것. ("EXP." 라벨, UI 테두리, 잘린 `]` 등)
 *   숫자 자리가 아니므로 값 파싱에 영향을 주면 안 됩니다.
 */
export const UNKNOWN_DIGIT_SLOT = "?";
export const UNKNOWN_OTHER = "_";

export type PixelLineResult = {
	/**
	 * 인식된 문자열.
	 * 미인식 글리프는 `?`(숫자 자리 크기) 또는 `_`(그 외)로 채웁니다.
	 */
	text: string;
	/** 잘라낸 글리프 수 */
	glyphCount: number;
	/** '?' 로 남은 글리프 수 */
	unknownCount: number;
	/** 추정한 캡처 배율 (원본 1px 이 화면에서 몇 px 인지) */
	scale: number;
	/** 숫자 글리프의 윗줄 y좌표 (글리프 좌표계의 y=0). 템플릿 추출 도구에서 사용합니다. */
	digitTop: number;
	/** `debug: true` 일 때만 채워집니다. (tools/pixel-font/verify.mjs 용) */
	debug?: SegmentDebug[];
};

export type SegmentDebug = {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	char: string | null;
	/** 후보별 점수 (높은 순 상위 3개) */
	top: { char: string; score: number }[];
	/** 세그먼트를 '#'/'.' 로 그린 것 */
	art: string[];
};

type Options = {
	/** 글리프 후보로 인정할 최소 개수 (EXP 문자열은 숫자만 해도 보통 6자 이상입니다) */
	minDigits?: number;
	/** 템플릿 일치율 하한 */
	minScore?: number;
	/** 1등과 2등의 최소 점수 차 */
	minMargin?: number;
	/** 세그먼트별 후보 점수를 결과에 담습니다. (디버깅용) */
	debug?: boolean;
};

/** 0/1 마스크와 그 크기 */
type Mask = { data: Uint8Array; w: number; h: number };

/** 캔버스 대신 ImageData를 직접 받을 수 있게 덕 타이핑으로 판별합니다. (Node 테스트에서도 그대로 쓰기 위함) */
type RgbaImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

function isRgbaImage(src: unknown): src is RgbaImage {
	if (!src || typeof src !== "object") return false;
	const s = src as Record<string, unknown>;
	return typeof s.width === "number" && typeof s.height === "number" && ArrayBuffer.isView(s.data as never);
}

export function recognizePixelFontLine(
	source: HTMLCanvasElement | ImageData | RgbaImage,
	options: Options = {}
): PixelLineResult | null {
	const img = isRgbaImage(source) ? source : getImageData(source as HTMLCanvasElement);
	if (!img || img.width < 8 || img.height < 5) return null;

	const rawMask = buildBrightMask(img);
	if (!rawMask) return null;

	const minDigits = options.minDigits ?? 3;

	// 1차 추정: 글리프 높이의 최빈값으로 캡처 배율을 잡습니다.
	const first = estimateLayout(rawMask, minDigits);
	if (!first) return null;

	// UI 버튼/게이지 바처럼 "속이 꽉 찬 덩어리"를 지웁니다.
	// 이 글꼴은 획이 1px(=scale px)이라, 2*scale 크기의 정사각형이 통째로 채워지는 일이 없습니다.
	// 그래서 모폴로지 열림(opening)으로 solid 영역만 정확히 골라낼 수 있습니다.
	// (이걸 안 하면 `%` 오른쪽에 UI가 1px 닿는 것만으로 `%`가 통째로 사라집니다)
	const kernel = Math.max(2, Math.round(2 * first.scale));
	const mask = removeSolidBlobs(rawMask, kernel);

	// 2차 추정: 정리된 마스크로 배율/기준선을 다시 잡습니다.
	const layout = estimateLayout(mask, minDigits) ?? first;
	const { scale, digitTop } = layout;

	// 이 글꼴에서 가장 위로 튀는 글리프는 `[`(-1), 가장 아래는 `.`(6..7) 입니다.
	const bandTop = Math.max(0, Math.floor(digitTop - 1.5 * scale));
	const bandBottom = Math.min(mask.h - 1, Math.ceil(digitTop + 8.5 * scale));
	if (bandBottom <= bandTop) return null;

	// 밴드 안의 "글리프 후보 픽셀"만 남긴 마스크를 새로 만듭니다.
	const maxGlyphSide = 9.6 * scale;
	const band: Mask = { data: new Uint8Array(mask.w * mask.h), w: mask.w, h: mask.h };
	let kept = 0;
	for (const c of findComponents(mask)) {
		if (c.w > maxGlyphSide || c.h > maxGlyphSide) continue;
		if (c.y1 < bandTop || c.y0 > bandBottom) continue;
		for (let i = 0; i < c.pixels.length; i++) band.data[c.pixels[i]] = 1;
		kept++;
	}
	if (kept < minDigits) return null;

	const segments = segmentColumns(band, bandTop, bandBottom);
	if (segments.length === 0) return null;

	let text = "";
	let unknown = 0;
	const debug: SegmentDebug[] = [];
	for (const seg of segments) {
		const scored = scoreSegment(band, seg, digitTop, scale);
		const ch = pickBest(scored, options);
		if (ch == null) {
			unknown++;
			// 숫자와 크기/기준선이 같은데 못 읽은 것인지, 애초에 글리프가 아닌 것인지를 구분해 둡니다.
			// 이 구분이 없으면 "EXP." 라벨 때문에 멀쩡한 판독을 버리거나,
			// 반대로 숫자 한 자리가 빠진 값을 그대로 채택하는 사고가 납니다.
			text += isDigitSlot(seg, digitTop, scale) ? UNKNOWN_DIGIT_SLOT : UNKNOWN_OTHER;
		} else {
			text += ch;
		}
		if (options.debug) {
			debug.push({ ...seg, char: ch, top: scored.slice(0, 3), art: renderSegment(band, seg) });
		}
	}

	return {
		text,
		glyphCount: segments.length,
		unknownCount: unknown,
		scale,
		digitTop,
		...(options.debug ? { debug } : {})
	};
}

/**
 * 글리프 높이 최빈값으로 캡처 배율과 "숫자 윗줄" 위치를 추정합니다.
 *
 * EXP 문자열은 숫자가 압도적으로 많아서(보통 10자리 + 퍼센트 4자리),
 * 높이 최빈값 = 숫자 높이(7 * 배율) 로 보는 것이 안전합니다.
 */
function estimateLayout(mask: Mask, minDigits: number): { scale: number; digitTop: number } | null {
	const comps = findComponents(mask);
	if (comps.length === 0) return null;
	// 이 단계에서는 배율을 모르므로 "ROI에 비해 과하게 큰 것"만 대충 쳐냅니다.
	// 그리고 **높이가 숫자보다 낮은 조각은 아예 제외**합니다.
	// (`.` `%` 의 조각들, UI 디더링 얼룩 같은 1~2px 짜리가 높이 최빈값을 뺏어가면
	//  배율 추정이 통째로 어긋나 인식이 실패합니다. 숫자는 항상 7*배율 이상입니다)
	const glyphish = comps.filter(
		(c) => c.w <= Math.max(4, mask.w * 0.35) && c.h < mask.h && c.h >= PIXEL_FONT_DIGIT_HEIGHT
	);
	if (glyphish.length === 0) return null;

	const digitHeight = modeOf(glyphish.map((c) => c.h));
	if (digitHeight == null || digitHeight < PIXEL_FONT_DIGIT_HEIGHT) return null;
	const scale = digitHeight / PIXEL_FONT_DIGIT_HEIGHT;
	if (scale < 0.99 || scale > 12) return null;

	const digitComps = glyphish.filter((c) => c.h === digitHeight);
	if (digitComps.length < minDigits) return null;
	const digitTop = modeOf(digitComps.map((c) => c.y0));
	if (digitTop == null) return null;
	return { scale, digitTop };
}

/**
 * k x k 정사각형이 통째로 전경인 영역(=속이 꽉 찬 UI 덩어리)을 제거합니다.
 * 모폴로지 열림(침식 후 팽창)을 적분 이미지로 계산합니다.
 */
function removeSolidBlobs(mask: Mask, k: number): Mask {
	const { w, h, data } = mask;
	if (k < 2 || w < k || h < k) return mask;

	// 적분 이미지 (w+1) x (h+1)
	const integral = new Int32Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let rowSum = 0;
		for (let x = 0; x < w; x++) {
			rowSum += data[y * w + x];
			integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
		}
	}
	const boxSum = (x0: number, y0: number, x1: number, y1: number) =>
		integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
		integral[y0 * (w + 1) + (x1 + 1)] -
		integral[(y1 + 1) * (w + 1) + x0] +
		integral[y0 * (w + 1) + x0];

	// 침식: k x k 가 모두 전경인 좌상단 위치
	const eroded = new Uint8Array(w * h);
	const area = k * k;
	for (let y = 0; y + k <= h; y++) {
		for (let x = 0; x + k <= w; x++) {
			if (boxSum(x, y, x + k - 1, y + k - 1) === area) eroded[y * w + x] = 1;
		}
	}

	// 팽창: 침식 결과의 적분 이미지로 "나를 덮는 k x k 블록이 하나라도 있는지" 판정
	const eInt = new Int32Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let rowSum = 0;
		for (let x = 0; x < w; x++) {
			rowSum += eroded[y * w + x];
			eInt[(y + 1) * (w + 1) + (x + 1)] = eInt[y * (w + 1) + (x + 1)] + rowSum;
		}
	}
	const eBox = (x0: number, y0: number, x1: number, y1: number) =>
		eInt[(y1 + 1) * (w + 1) + (x1 + 1)] -
		eInt[y0 * (w + 1) + (x1 + 1)] -
		eInt[(y1 + 1) * (w + 1) + x0] +
		eInt[y0 * (w + 1) + x0];

	const out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!data[y * w + x]) continue;
			const x0 = Math.max(0, x - k + 1);
			const y0 = Math.max(0, y - k + 1);
			if (eBox(x0, y0, x, y) === 0) out[y * w + x] = 1;
		}
	}
	return { data: out, w, h };
}

function getImageData(canvas: HTMLCanvasElement): ImageData | null {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	try {
		return ctx.getImageData(0, 0, canvas.width, canvas.height);
	} catch {
		return null;
	}
}

/**
 * "글자 색인 밝은 픽셀"만 남기는 마스크
 *
 * 두 가지를 동시에 봅니다.
 *
 * (1) 밝기는 **최대 채널값 max(r,g,b)** 로 잽니다.
 *     숫자는 흰색(255,255,255)이고 대괄호는 연두색(153,204,51)인데,
 *     휘도(0.299R+0.587G+0.114B)로 재면 연두색이 171까지 떨어져서 임계값에 따라 대괄호가 통째로
 *     날아갑니다. 대괄호가 사라지면 "값[퍼센트%]" 구조를 못 잡아 EXP 값 인식이 통째로 실패합니다.
 *
 * (2) 밝기만으로는 부족합니다. EXP 숫자가 길어지면 닫는 괄호가 **밝은 UI 패널 위**로 밀려나는데,
 *     그 패널이 (136,170,187) ~ (194,204,214) 정도라 밝기만으로는 글자와 안 갈라집니다.
 *     이때 패널이 전경으로 들어오면 바로 옆 `%` 와 붙어버려서 퍼센트를 통째로 놓칩니다.
 *     그래서 "글자 색"인지도 같이 봅니다.
 *       - 흰 글자: ROI 안 최고 밝기의 85% 이상
 *       - 연두 대괄호: 채도가 충분히 높음 (UI 패널은 파르스름하고 채도가 0.3 미만)
 *     이러면 패널은 빠지고, 패널 위에 놓인 연두색 `]` 는 오히려 살아납니다.
 */
function buildBrightMask(img: RgbaImage): Mask | null {
	const { width: w, height: h, data } = img;
	const n = w * h;
	const v = new Uint8Array(n);
	const sat = new Uint8Array(n); // 0~100
	const hist = new Uint32Array(256);
	for (let i = 0, p = 0; p < n; p++, i += 4) {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		const mx = Math.max(r, g, b);
		const mn = Math.min(r, g, b);
		v[p] = mx;
		sat[p] = mx === 0 ? 0 : Math.round(((mx - mn) * 100) / mx);
		hist[mx]++;
	}
	let t = otsuThreshold(hist, n);
	// 배경이 거의 균일한 ROI에서는 Otsu가 극단으로 튀므로 상식적인 범위로 묶습니다.
	t = Math.max(90, Math.min(210, t));

	// 최고 밝기는 상위 0.5% 지점으로 잡습니다. (핫픽셀 하나에 끌려가지 않도록)
	const brightCut = Math.max(1, Math.floor(n * 0.005));
	let acc = 0;
	let vMax = 255;
	for (let i = 255; i >= 0; i--) {
		acc += hist[i];
		if (acc >= brightCut) {
			vMax = i;
			break;
		}
	}
	const nearWhite = Math.round(vMax * 0.85);
	const minSat = 35;

	const out = new Uint8Array(n);
	let fg = 0;
	for (let p = 0; p < n; p++) {
		if (v[p] >= t && (v[p] >= nearWhite || sat[p] >= minSat)) {
			out[p] = 1;
			fg++;
		}
	}
	// 전경이 거의 없거나 화면 대부분이 전경이면 글자 영역이 아닙니다.
	if (fg < 8 || fg > n * 0.7) return null;
	return { data: out, w, h };
}

function otsuThreshold(hist: Uint32Array, total: number): number {
	let sum = 0;
	for (let i = 0; i < 256; i++) sum += i * hist[i];
	let sumB = 0;
	let wB = 0;
	let varMax = 0;
	let threshold = 127;
	for (let t = 0; t < 256; t++) {
		wB += hist[t];
		if (wB === 0) continue;
		const wF = total - wB;
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
	return threshold;
}

type Component = { x0: number; y0: number; x1: number; y1: number; w: number; h: number; area: number; pixels: Int32Array };

/** 8-연결 연결요소 라벨링 */
function findComponents(mask: Mask): Component[] {
	const { data, w, h } = mask;
	const visited = new Uint8Array(w * h);
	const out: Component[] = [];
	const stack: number[] = [];
	const buf: number[] = [];
	for (let p0 = 0; p0 < data.length; p0++) {
		if (!data[p0] || visited[p0]) continue;
		stack.length = 0;
		buf.length = 0;
		visited[p0] = 1;
		stack.push(p0);
		let x0 = w, y0 = h, x1 = -1, y1 = -1;
		while (stack.length) {
			const p = stack.pop()!;
			buf.push(p);
			const y = (p / w) | 0;
			const x = p - y * w;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy;
				if (ny < 0 || ny >= h) continue;
				for (let dx = -1; dx <= 1; dx++) {
					if (dx === 0 && dy === 0) continue;
					const nx = x + dx;
					if (nx < 0 || nx >= w) continue;
					const np = ny * w + nx;
					if (visited[np] || !data[np]) continue;
					visited[np] = 1;
					stack.push(np);
				}
			}
		}
		out.push({
			x0,
			y0,
			x1,
			y1,
			w: x1 - x0 + 1,
			h: y1 - y0 + 1,
			area: buf.length,
			pixels: Int32Array.from(buf)
		});
	}
	return out;
}

function modeOf(values: number[]): number | null {
	if (values.length === 0) return null;
	const count = new Map<number, number>();
	for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
	let best: number | null = null;
	let bestCount = 0;
	for (const [v, c] of count) {
		// 동률이면 더 큰 값을 선택합니다. ('.' 처럼 작은 글리프가 최빈값을 뺏지 않도록)
		if (c > bestCount || (c === bestCount && best != null && v > best)) {
			best = v;
			bestCount = c;
		}
	}
	return best;
}

type Segment = { x0: number; x1: number; y0: number; y1: number };

/**
 * 빈 열을 기준으로 글리프를 자릅니다.
 *
 * 이 글꼴은 숫자가 6px 간격에 잉크가 5px이라 글자 사이에 항상 1px 이상 여백이 있고,
 * `%` 는 내부에 빈 열이 없어서 한 덩어리로 잘립니다. (연결요소로 자르면 `%`가 3조각 납니다)
 */
function segmentColumns(band: Mask, bandTop: number, bandBottom: number): Segment[] {
	const { data, w } = band;
	const colHas = new Uint8Array(w);
	for (let y = bandTop; y <= bandBottom; y++) {
		const row = y * band.w;
		for (let x = 0; x < w; x++) {
			if (data[row + x]) colHas[x] = 1;
		}
	}
	const segs: Segment[] = [];
	let start = -1;
	for (let x = 0; x <= w; x++) {
		const on = x < w && colHas[x] === 1;
		if (on && start < 0) start = x;
		else if (!on && start >= 0) {
			// 세로 방향 타이트 bbox
			let y0 = bandBottom + 1;
			let y1 = bandTop - 1;
			for (let y = bandTop; y <= bandBottom; y++) {
				const row = y * band.w;
				for (let x2 = start; x2 < x; x2++) {
					if (data[row + x2]) {
						if (y < y0) y0 = y;
						if (y > y1) y1 = y;
						break;
					}
				}
			}
			if (y1 >= y0) segs.push({ x0: start, x1: x - 1, y0, y1 });
			start = -1;
		}
	}
	return segs;
}

/**
 * 세그먼트가 "숫자 한 자리 자리(slot)"인지 판정합니다.
 * 숫자는 전부 높이 7, 윗줄이 digitTop, 폭 2~5 로 고정이라 이 세 가지로 충분히 구분됩니다.
 */
function isDigitSlot(seg: Segment, digitTop: number, scale: number): boolean {
	const tol = Math.max(1, Math.round(scale * 0.7));
	const segH = seg.y1 - seg.y0 + 1;
	const segW = seg.x1 - seg.x0 + 1;
	if (Math.abs(segH - PIXEL_FONT_DIGIT_HEIGHT * scale) > tol) return false;
	if (Math.abs(seg.y0 - digitTop) > tol) return false;
	return segW >= 2 * scale - tol && segW <= 5 * scale + tol;
}

/** 세그먼트를 모든 템플릿과 비교해 점수 내림차순 목록을 돌려줍니다. */
function scoreSegment(band: Mask, seg: Segment, digitTop: number, scale: number): { char: string; score: number }[] {
	const segW = seg.x1 - seg.x0 + 1;
	const segH = seg.y1 - seg.y0 + 1;
	// 캡처가 정수배가 아니거나 1px 스케일링 오차가 있을 수 있어 여유를 둡니다.
	const tol = Math.max(1, Math.round(scale * 0.7));
	const out: { char: string; score: number }[] = [];
	for (const g of PIXEL_FONT_MASKS) {
		if (Math.abs(segW - g.width * scale) > tol) continue;
		if (Math.abs(segH - g.height * scale) > tol) continue;
		if (Math.abs(seg.y0 - (digitTop + g.top * scale)) > tol) continue;
		out.push({ char: g.char, score: compareToTemplate(band, seg, segW, segH, g) });
	}
	out.sort((a, b) => b.score - a.score);
	return out;
}

function pickBest(scored: { char: string; score: number }[], options: Options): string | null {
	const minScore = options.minScore ?? 0.92;
	const minMargin = options.minMargin ?? 0.05;
	if (scored.length === 0) return null;
	const best = scored[0];
	const second = scored[1]?.score ?? 0;
	if (best.score < minScore) return null;
	if (best.score - second < minMargin) return null;
	return best.char;
}

function renderSegment(band: Mask, seg: Segment): string[] {
	const rows: string[] = [];
	for (let y = seg.y0; y <= seg.y1; y++) {
		let s = "";
		for (let x = seg.x0; x <= seg.x1; x++) s += band.data[y * band.w + x] ? "#" : ".";
		rows.push(s);
	}
	return rows;
}

/**
 * 잘라낸 글리프와 템플릿을 픽셀 단위로 비교합니다.
 *
 * 템플릿을 세그먼트 크기로 최근접 확대해서 비교합니다.
 * (캡처가 정수배로 확대된 경우 게임이 그린 픽셀과 정확히 같은 모양이 되고,
 *  비정수 배율이라도 근사치로는 잘 맞습니다)
 */
function compareToTemplate(band: Mask, seg: Segment, segW: number, segH: number, g: PixelGlyphMask): number {
	let agree = 0;
	for (let y = 0; y < segH; y++) {
		const ty = Math.min(g.height - 1, Math.floor((y * g.height) / segH));
		const row = (seg.y0 + y) * band.w;
		const trow = ty * g.width;
		for (let x = 0; x < segW; x++) {
			const tx = Math.min(g.width - 1, Math.floor((x * g.width) / segW));
			const a = band.data[row + seg.x0 + x];
			const b = g.bits[trow + tx];
			if (a === b) agree++;
		}
	}
	return agree / (segW * segH);
}

/**
 * 인식 문자열에서 EXP 값/퍼센트를 뽑습니다.
 *
 * 기대 형식: `123456789[12.34%]`
 *
 * 안전 규칙 (조금이라도 의심스러우면 무조건 null — 틀린 값을 흘리면 측정이 통째로 오염됩니다):
 * - **`]` 는 없어도 됩니다.** EXP 숫자가 길어지면 닫는 괄호가 밝은 UI 패널 위로 밀려나
 *   밝기 기준 마스킹으로 분리되지 않는 경우가 있습니다. 하지만 `]` 는 값에도 퍼센트에도
 *   영향을 주지 않으므로, 없어도 판독 결과는 그대로 유효합니다.
 * - **퍼센트는 `[` 바로 뒤 + 소수점 두 자리 + `%` 를 모두 붙여서 요구합니다.**
 *   이렇게 하면 중간 숫자가 하나라도 미인식(`?`)이면 정규식 자체가 안 맞아 조용히 틀린
 *   퍼센트가 나올 수 없습니다. (예: `[8?.18%` → 매칭 실패. 느슨하면 18%로 읽혔을 것)
 * - **값 바로 앞에 숫자 자리 미인식(`?`)이 있으면 버립니다.**
 *   자릿수가 잘린 값을 채택하면 안 됩니다. (예: `1214??91?3[83.18%` → `3` 이 되어버림)
 *   반면 `_`(라벨/UI 등 숫자가 아닌 미인식)는 값과 무관하므로 허용합니다.
 */
export function parsePixelExpText(text: string): { value: number; percent: number } | null {
	const m = text.match(/(\d{1,12})\[(\d{1,3}\.\d{2})%\]?/);
	if (!m || m.index == null) return null;
	// `(\d{1,12})` 는 greedy라 앞 글자는 숫자가 아닙니다. 남은 위험은 "숫자 자리 미인식"뿐입니다.
	if (m.index > 0 && text[m.index - 1] === UNKNOWN_DIGIT_SLOT) return null;
	const value = parseInt(m[1], 10);
	const percent = parseFloat(m[2]);
	if (!Number.isFinite(value) || !Number.isFinite(percent)) return null;
	if (percent < 0 || percent > 100) return null;
	return { value, percent };
}
