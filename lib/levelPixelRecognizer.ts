import { LEVEL_FONT_DIGIT_HEIGHT, LEVEL_FONT_MASKS, type LevelGlyphMask } from "./levelPixelFont";
import { isLevelGlyphPixel, type RgbaImage } from "./levelRoiFingerprint";

/**
 * 레벨(LEVEL) 전용 픽셀 글꼴 인식기
 *
 * 왜 범용 인식 엔진이 아니라 템플릿 매칭인가 — EXP와 같은 이유입니다.
 * 레벨 숫자도 안티에일리어싱이 없는 고정 픽셀 패턴이라, 픽셀 단위로 맞춰보면 정확히 일치하거나
 * 아예 일치하지 않거나 둘 중 하나입니다. 반면 LSTM 기반 인식기는 8과 9, 6과 8을 헷갈리면서도
 * **확신에 찬 틀린 값**을 돌려줍니다. (레벨 193을 183으로 읽는 식)
 *
 * 이 차이가 핵심입니다. 템플릿 매칭은 애매하면 `null`을 돌려주지, 둘 중 하나를 찍지 않습니다.
 * 틀린 레벨은 누적 EXP 계산을 통째로 오염시키지만, null은 그냥 그 샘플을 건너뛸 뿐입니다.
 *
 * 왜 레벨이 EXP보다 조건이 좋은가:
 * - 글리프가 7px 글꼴을 2배로 렌더한 것이라 100% 배율에서 14px입니다. (EXP 숫자는 7px)
 * - 전경 분리가 훨씬 쉽습니다. 글자는 흰색~크림색(chroma <= 58), 타일은 오렌지(chroma >= 105)라
 *   그 사이에 폭 47짜리 빈 구간이 있습니다. EXP처럼 밝은 UI 패널과 싸울 일이 없습니다.
 * - 숫자가 1~3자뿐이고, 각 숫자가 별도 타일에 얹혀 있어 글자 사이 간격이 넉넉합니다.
 *
 * 처리 순서
 *  1) ROI를 원본 배율 그대로 읽어 "글자색 픽셀" 마스크를 만듭니다.
 *  2) 연결요소로 글리프 후보를 찾고, 높이 최빈값으로 캡처 배율을 추정합니다.
 *  3) 빈 열 기준으로 글리프를 자릅니다.
 *  4) 각 글리프를 템플릿과 비교해 문자를 확정합니다. 확신이 없으면 그 자리는 `?`가 되고,
 *     `?`가 하나라도 있으면 값은 `null`입니다. (자릿수가 빠진 레벨을 채택하면 안 됩니다)
 *
 * **ROI 캔버스는 반드시 원본 배율(scale: 1)로 넘겨야 합니다.** 확대하거나 이진화하면
 * 글리프가 뭉개져서 인식이 망가집니다. (EXP 경로와 같은 원칙)
 *
 * 격자가 어긋나는 캡처: 글리프 상자를 각 변마다 ±1px 움직여 다시 채점하는 재시도가 있습니다.
 * (`alignSegment`) 4)에서 확신이 없을 때만 돌므로, 격자가 정확한 캡처의 동작·비용은 그대로입니다.
 *
 * 알려진 한계: 그래도 캡처 배율이 정수가 아니면(예: 글리프가 10.5px로 리샘플된 경우) 글리프의
 * 블록 구조가 템플릿 격자와 어긋나 점수가 떨어지고 `null`이 납니다. 이건 **EXP 인식기도 똑같습니다.**
 * (실측: `1214349360[83.16%]` 를 1.25/1.5/2.25/2.5/3.5배로 렌더하면 EXP도 전부 null)
 * 즉 이 앱은 원래 정수 배율 캡처를 전제로 하며, EXP가 안 읽히면 그 샘플은 어차피 쓸모가 없으므로
 * 레벨만 더 관대하게 만들 이유가 없습니다. 두 경로 모두 **틀린 값 대신 null** 로 실패합니다.
 */

/** 미인식 글리프 표기 */
export const UNKNOWN_DIGIT = "?";

export type LevelPixelResult = {
	/** 인식된 문자열. 미인식 글리프는 `?` 입니다. */
	text: string;
	/** 모든 자리를 확신할 때만 숫자, 하나라도 못 읽으면 null */
	value: number | null;
	/** 추정한 캡처 배율 (글꼴 원본 1px 이 화면에서 몇 px 인지) */
	scale: number;
	/** `debug: true` 일 때만 채워집니다. (tools/level-font/* 용) */
	debug?: LevelSegmentDebug[];
};

export type LevelSegmentDebug = {
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
	/** 템플릿 일치율 하한 */
	minScore?: number;
	/** 1등과 2등의 최소 점수 차 */
	minMargin?: number;
	/** 세그먼트별 후보 점수를 결과에 담습니다. (디버깅용) */
	debug?: boolean;
};

/**
 * 채택 기준
 *
 * 글리프끼리 가장 헷갈리기 쉬운 쌍은 `6`↔`8` 과 `8`↔`9` 로, 유사도가 0.9388입니다.
 * (49픽셀 중 3픽셀 차이) 그래서 하한을 그 위인 0.95로 잡았습니다.
 *
 * 왜 이 값인가: 정수 배율 캡처에서 정답 글리프는 **정확히 1.0000** 이 나옵니다. 하한이
 * 0.9388보다 위에 있으면, 정답이 무슨 이유로 후보에서 빠지더라도 **틀린 글리프가 단독으로
 * 채택되는 일이 구조적으로 불가능**합니다. 마진 규칙에만 기대는 것보다 훨씬 강한 보장입니다.
 */
const DEFAULT_MIN_SCORE = 0.95;
const DEFAULT_MIN_MARGIN = 0.05;

/** 0/1 마스크와 그 크기 */
type Mask = { data: Uint8Array; w: number; h: number };

function isRgbaImage(src: unknown): src is RgbaImage {
	if (!src || typeof src !== "object") return false;
	const s = src as Record<string, unknown>;
	return typeof s.width === "number" && typeof s.height === "number" && ArrayBuffer.isView(s.data as never);
}

export function recognizeLevelPixelFont(
	source: HTMLCanvasElement | ImageData | RgbaImage,
	options: Options = {}
): LevelPixelResult | null {
	const img = isRgbaImage(source) ? source : getImageData(source as HTMLCanvasElement);
	if (!img || img.width < 3 || img.height < LEVEL_FONT_DIGIT_HEIGHT) return null;

	const mask = buildGlyphMask(img);
	if (!mask) return null;

	const layout = estimateScale(mask);
	if (!layout) return null;
	const { scale, digitHeight } = layout;

	// 글리프 후보 픽셀만 남긴 마스크를 만듭니다.
	// 높이가 숫자와 같은 연결요소만 통과시켜, ROI에 섞여 들어온 다른 UI 조각을 버립니다.
	const tol = Math.max(1, Math.round(scale * 0.7));
	const band: Mask = { data: new Uint8Array(mask.w * mask.h), w: mask.w, h: mask.h };
	let kept = 0;
	let bandTop = mask.h;
	let bandBottom = -1;
	for (const c of findComponents(mask)) {
		if (Math.abs(c.h - digitHeight) > tol) continue;
		for (let i = 0; i < c.pixels.length; i++) band.data[c.pixels[i]] = 1;
		kept++;
		if (c.y0 < bandTop) bandTop = c.y0;
		if (c.y1 > bandBottom) bandBottom = c.y1;
	}
	// 레벨은 1~3자리입니다. 그보다 많으면 ROI가 잘못 잡힌 것으로 봅니다.
	if (kept === 0 || bandBottom < bandTop) return null;

	const segments = segmentColumns(band, bandTop, bandBottom);
	if (segments.length === 0 || segments.length > 3) return null;

	// 채점은 "블록 안의 전경 픽셀 수"만 필요하므로 누적합을 한 번 만들어 두고 씁니다.
	// 정렬 재시도는 같은 블록을 수십 번 다시 세는데, 누적합이 있으면 그게 4번의 배열 조회가 됩니다.
	const sat = buildSat(band);

	let text = "";
	let unknown = 0;
	const debug: LevelSegmentDebug[] = [];
	for (const seg of segments) {
		let scored = scoreSegment(sat, seg, scale);
		let ch = pickBest(scored, options);
		if (ch == null) {
			// 정렬이 어긋난 캡처를 한 번 더 구제합니다. (아래 alignSegment 주석 참고)
			const realigned = alignSegment(sat, seg, scale, options);
			if (realigned) {
				scored = realigned;
				ch = pickBest(scored, options);
			}
		}
		if (ch == null) {
			unknown++;
			text += UNKNOWN_DIGIT;
		} else {
			text += ch;
		}
		if (options.debug) {
			debug.push({ ...seg, char: ch, top: scored.slice(0, 3), art: renderSegment(band, seg) });
		}
	}

	// 한 자리라도 확신이 없으면 값을 내지 않습니다.
	// (예: `1?3` 을 그냥 파싱하면 13이 되어버립니다)
	let value: number | null = null;
	if (unknown === 0) {
		const parsed = parseInt(text, 10);
		// 레벨에 선행 0은 없습니다. (`06` 같은 판독은 ROI가 잘못 잡힌 것)
		if (Number.isFinite(parsed) && parsed >= 1 && text[0] !== "0") value = parsed;
	}

	return { text, value, scale, ...(options.debug ? { debug } : {}) };
}

/**
 * "글자색 픽셀"만 남기는 마스크
 *
 * 판정 규칙(`isLevelGlyphPixel`)은 `lib/levelRoiFingerprint.ts` 가 소유합니다.
 * 왜: 레벨 ROI 변화 감지 지문이 **이 인식기와 완전히 같은 마스크**를 봐야
 * "지문이 같으면 인식 결과도 같다"가 성립하고, 판독 재사용 캐시가 순수 메모이제이션이 됩니다.
 * 규칙이 두 곳에 적혀 있으면 한쪽만 고쳐졌을 때 캐시가 조용히 틀린 값을 서빙합니다.
 */
function buildGlyphMask(img: RgbaImage): Mask | null {
	const { width: w, height: h, data } = img;
	const n = w * h;
	const out = new Uint8Array(n);
	let fg = 0;
	for (let p = 0, i = 0; p < n; p++, i += 4) {
		if (isLevelGlyphPixel(data[i], data[i + 1], data[i + 2])) {
			out[p] = 1;
			fg++;
		}
	}
	// 전경이 거의 없거나 화면 대부분이 전경이면 글자 영역이 아닙니다.
	if (fg < 6 || fg > n * 0.8) return null;
	return { data: out, w, h };
}

/**
 * 글리프 높이 최빈값으로 캡처 배율을 추정합니다.
 *
 * 레벨 숫자는 **모두 높이가 같아서** EXP처럼 글리프별 세로 오프셋을 맞출 필요가 없습니다.
 * 다만 자릿수가 1개뿐일 수도 있어서(레벨 1~9), 최빈값이 아니라 "가장 큰 후보 높이"를 씁니다.
 * (`.` 처럼 작은 조각이 최빈값을 뺏는 상황이 레벨에는 없고, 오히려 ROI에 섞인 작은 UI 얼룩이
 *  최빈값을 차지하는 쪽이 위험합니다)
 */
function estimateScale(mask: Mask): { scale: number; digitHeight: number } | null {
	const comps = findComponents(mask);
	if (comps.length === 0) return null;
	// ROI를 세로로 가득 채우는 덩어리는 글리프가 아닙니다. (테두리 등)
	const glyphish = comps.filter((c) => c.h >= LEVEL_FONT_DIGIT_HEIGHT && c.h <= mask.h);
	if (glyphish.length === 0) return null;
	const digitHeight = Math.max(...glyphish.map((c) => c.h));
	const scale = digitHeight / LEVEL_FONT_DIGIT_HEIGHT;
	if (scale < 0.99 || scale > 24) return null;
	return { scale, digitHeight };
}

function getImageData(canvas: HTMLCanvasElement): ImageData | null {
	// 주의: willReadFrequently는 컨텍스트가 "처음 만들어질 때"만 반영됩니다.
	// 캔버스를 만드는 쪽(lib/canvas.ts의 get2dContext)에서 이미 같은 플래그를 주고 있습니다.
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	try {
		return ctx.getImageData(0, 0, canvas.width, canvas.height);
	} catch {
		return null;
	}
}

type Component = { x0: number; y0: number; x1: number; y1: number; w: number; h: number; pixels: Int32Array };

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
		let x0 = w,
			y0 = h,
			x1 = -1,
			y1 = -1;
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
		out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, pixels: Int32Array.from(buf) });
	}
	return out;
}

type Segment = { x0: number; x1: number; y0: number; y1: number };

/**
 * 빈 열을 기준으로 글리프를 자릅니다.
 *
 * 레벨은 숫자마다 별도의 오렌지 타일에 얹혀 있어서 글자 사이가 원본 기준 5px 이상 벌어집니다.
 * 연결요소로 자르지 않고 열로 자르는 이유는, 마스크 잡음으로 한 글자가 두 조각이 나더라도
 * 한 글리프로 묶이게 하기 위함입니다.
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
 * 마스크의 2D 누적합(적분 영상).
 *
 * `data[(y) * (w + 1) + x]` = 원점부터 (x, y) 직전까지의 전경 픽셀 수.
 * 블록 하나의 전경 개수를 블록 크기와 무관하게 4번의 조회로 구하기 위한 것입니다.
 */
type Sat = { data: Int32Array; w: number; h: number };

function buildSat(mask: Mask): Sat {
	const { w, h, data } = mask;
	const sw = w + 1;
	const out = new Int32Array(sw * (h + 1));
	for (let y = 0; y < h; y++) {
		const src = y * w;
		const prev = y * sw;
		const cur = prev + sw;
		let rowSum = 0;
		for (let x = 0; x < w; x++) {
			rowSum += data[src + x];
			out[cur + x + 1] = out[prev + x + 1] + rowSum;
		}
	}
	return { data: out, w, h };
}

/** `[x0, x1) × [y0, y1)` 의 전경 픽셀 수. 마스크 밖은 배경(0)으로 봅니다. */
function satSum(sat: Sat, x0: number, y0: number, x1: number, y1: number): number {
	const cx0 = x0 < 0 ? 0 : x0 > sat.w ? sat.w : x0;
	const cx1 = x1 < 0 ? 0 : x1 > sat.w ? sat.w : x1;
	const cy0 = y0 < 0 ? 0 : y0 > sat.h ? sat.h : y0;
	const cy1 = y1 < 0 ? 0 : y1 > sat.h ? sat.h : y1;
	if (cx1 <= cx0 || cy1 <= cy0) return 0;
	const sw = sat.w + 1;
	const d = sat.data;
	return d[cy1 * sw + cx1] - d[cy0 * sw + cx1] - d[cy1 * sw + cx0] + d[cy0 * sw + cx0];
}

/**
 * 크기가 같은 템플릿끼리 묶어 둡니다. (레벨 글꼴은 폭 3짜리 `1` 과 폭 7짜리 나머지, 두 묶음)
 *
 * 왜: 블록 격자는 템플릿의 **크기**만으로 정해지므로, 같은 크기의 템플릿 9개를 각각 채점하면
 * 똑같은 격자를 9번 다시 계산하게 됩니다. 묶어서 격자를 한 번만 만들면 그 9배가 사라집니다.
 * (정렬 재시도는 이 채점을 수십 번 돌리므로 차이가 그대로 곱해집니다)
 */
const LEVEL_FONT_SIZE_GROUPS: { width: number; height: number; glyphs: LevelGlyphMask[] }[] = (() => {
	const by = new Map<string, { width: number; height: number; glyphs: LevelGlyphMask[] }>();
	for (const g of LEVEL_FONT_MASKS) {
		const key = `${g.width}x${g.height}`;
		let entry = by.get(key);
		if (!entry) by.set(key, (entry = { width: g.width, height: g.height, glyphs: [] }));
		entry.glyphs.push(g);
	}
	return [...by.values()];
})();

/** 블록별 전경 비율을 담아 두는 재사용 버퍼. (샘플마다 새로 만들면 GC 압박이 커집니다) */
const fracScratch = new Float64Array(
	LEVEL_FONT_SIZE_GROUPS.reduce((m, g) => Math.max(m, g.width * g.height), 0)
);

/** 세그먼트를 크기가 맞는 모든 템플릿과 비교해 점수 내림차순 목록을 돌려줍니다. */
function scoreSegment(sat: Sat, seg: Segment, scale: number): { char: string; score: number }[] {
	const segW = seg.x1 - seg.x0 + 1;
	const segH = seg.y1 - seg.y0 + 1;
	if (segW < 2 || segH < 2) return [];
	// 캡처가 정수배가 아니거나 1px 스케일링 오차가 있을 수 있어 여유를 둡니다.
	const tol = Math.max(1, Math.round(scale * 0.7));
	const out: { char: string; score: number }[] = [];
	for (const group of LEVEL_FONT_SIZE_GROUPS) {
		if (Math.abs(segW - group.width * scale) > tol) continue;
		if (Math.abs(segH - group.height * scale) > tol) continue;
		const n = blockFractions(sat, seg, segW, segH, group.width, group.height);
		for (const g of group.glyphs) {
			let total = 0;
			// 템플릿이 전경이면 관측 전경 비율이, 배경이면 그 여집합이 그대로 점수가 됩니다.
			for (let i = 0; i < n; i++) total += g.bits[i] ? fracScratch[i] : 1 - fracScratch[i];
			out.push({ char: g.char, score: total / n });
		}
	}
	out.sort((a, b) => b.score - a.score);
	return out;
}

/** 정렬 재시도에서 각 변을 움직여 볼 범위(px). */
const ALIGN_DELTA = 1;

/**
 * 세그먼트 상자를 각 변마다 ±1px 움직여 보고, 가장 잘 맞는 정렬에서의 점수표를 돌려줍니다.
 *
 * 왜 필요한가 — 캡처가 "정수 배율"인데도 격자가 어긋나는 경우가 있습니다.
 * 실측(레벨 193, 글리프 높이 21px = 7px 글꼴의 3배)에서 관측된 어긋남은 두 가지입니다.
 *   1) 글리프 오른쪽에 전경 판정을 통과하는 1px 띠가 생겨 상자가 21px이 아니라 22px로 잡힙니다.
 *      (화면 공유는 영상 인코딩 경로를 타므로 흰 글자와 오렌지 타일 경계에서 색이 번집니다)
 *   2) 글꼴 행 사이 경계가 한 행씩 밀립니다. 스케일링이 최근접이 아니라 보간이라, 경계 픽셀의
 *      섞인 값이 임계를 한 행 일찍 넘습니다. (블록이 3,3,3,... 이 아니라 3,5,4,3,3,3 으로 잘립니다)
 * 두 어긋남 모두 점수를 0.91~0.96 대로 끌어내려, 정답 글리프가 하한(0.95) 바로 아래에 걸립니다.
 * 상자를 1px 단위로 다시 맞추면 정답이 0.96~0.98 로 회복됩니다. (실측: `1` 0.913→0.982,
 * `9` 0.950→0.963, `3` 0.956→0.967)
 *
 * ⚠️ **모든 후보를 "같은" 정렬에서 채점합니다.** 후보마다 각자 제일 좋은 정렬을 골라 주면
 * 서로 다른 조건에서 나온 점수를 비교하게 되어 마진 규칙(1등과 2등의 차)이 무의미해집니다.
 * 그래서 정렬을 먼저 하나 고르고(=1등 점수가 가장 높아지는 정렬), 그 정렬의 점수표를 통째로
 * 돌려줍니다. 이렇게 해야 "틀린 글리프는 정답보다 구조적으로 낮다"는 성질이 유지됩니다.
 *
 * 정렬을 못 맞추면 그냥 `null`입니다. 여기서도 하한·마진은 그대로 적용되므로, 이 재시도는
 * **틀린 값을 채택하게 만드는 게 아니라 놓친 정답을 되살리는** 역할만 합니다.
 */
function alignSegment(
	sat: Sat,
	seg: Segment,
	scale: number,
	options: Options
): { char: string; score: number }[] | null {
	const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
	let best: { char: string; score: number }[] | null = null;
	let bestTop = -1;
	for (let dLeft = -ALIGN_DELTA; dLeft <= ALIGN_DELTA; dLeft++) {
		for (let dRight = -ALIGN_DELTA; dRight <= ALIGN_DELTA; dRight++) {
			for (let dTop = -ALIGN_DELTA; dTop <= ALIGN_DELTA; dTop++) {
				for (let dBottom = -ALIGN_DELTA; dBottom <= ALIGN_DELTA; dBottom++) {
					if (dLeft === 0 && dRight === 0 && dTop === 0 && dBottom === 0) continue;
					const win: Segment = {
						x0: seg.x0 + dLeft,
						x1: seg.x1 + dRight,
						y0: seg.y0 + dTop,
						y1: seg.y1 + dBottom
					};
					const scored = scoreSegment(sat, win, scale);
					if (scored.length === 0 || scored[0].score <= bestTop) continue;
					bestTop = scored[0].score;
					best = scored;
				}
			}
		}
	}
	// 하한도 못 넘는 정렬이면 되살릴 정답이 없는 것이므로 원래대로 미인식 처리합니다.
	return bestTop >= minScore ? best : null;
}

function pickBest(scored: { char: string; score: number }[], options: Options): string | null {
	const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
	const minMargin = options.minMargin ?? DEFAULT_MIN_MARGIN;
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
 * 잘라낸 글리프와 템플릿을 비교합니다.
 *
 * 템플릿을 확대해서 점으로 찍어 비교하지 않고, **템플릿 픽셀 하나가 덮는 관측 영역의
 * 전경 비율**을 계산해서 비교합니다.
 *
 * 왜 이렇게 하는가: 캡처 배율이 정수가 아닐 때(예: 디스플레이 배율 125%) 점으로 찍어 비교하면
 * 경계에서 한 픽셀만 어긋나도 점수가 크게 떨어져, 맞는 글리프인데도 `null`이 되어버립니다.
 * 영역 평균은 경계 오차가 그 블록의 비율에만 반영되므로 훨씬 완만하게 감소합니다.
 * 정수 배율에서는 비율이 항상 0 또는 1이라 픽셀 단위 비교와 완전히 동일합니다.
 */
function blockFractions(
	sat: Sat,
	seg: Segment,
	segW: number,
	segH: number,
	gw: number,
	gh: number
): number {
	for (let ty = 0; ty < gh; ty++) {
		const sy0 = Math.floor((ty * segH) / gh);
		const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * segH) / gh));
		const by1 = sy1 < segH ? sy1 : segH;
		for (let tx = 0; tx < gw; tx++) {
			const sx0 = Math.floor((tx * segW) / gw);
			const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * segW) / gw));
			const bx1 = sx1 < segW ? sx1 : segW;
			// 정렬 재시도(alignSegment)는 상자를 밴드 밖으로도 밀어 봅니다.
			// 밖은 배경으로 세되 분모(블록 넓이)에는 그대로 넣어야, 상자를 밀어서 얻은 점수가
			// 공짜가 되지 않습니다. 그래서 satSum(관측 전경)과 count(블록 넓이)를 따로 구합니다.
			const count = (by1 - sy0) * (bx1 - sx0);
			const on = satSum(sat, seg.x0 + sx0, seg.y0 + sy0, seg.x0 + bx1, seg.y0 + by1);
			fracScratch[ty * gw + tx] = count > 0 ? on / count : 0;
		}
	}
	return gw * gh;
}
