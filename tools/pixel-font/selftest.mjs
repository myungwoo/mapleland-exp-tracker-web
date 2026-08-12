#!/usr/bin/env node
/**
 * 픽셀 글꼴 인식기 자체 검증
 *
 *   node tools/pixel-font/selftest.mjs
 *
 * 템플릿으로 EXP 문자열을 직접 그린 뒤 다시 읽어서, 아래를 검증합니다.
 * - 캡처 배율(1x~4x) 자동 추정
 * - 글리프 분리(빈 열 기준)와 `%`(내부가 3조각인 글리프) 처리
 * - 어두운 UI 배경 위 흰 글자 / 연두색 대괄호 마스킹
 * - ROI 안에 게이지 바/UI 덩어리가 섞여 들어와도 무시하는지
 *
 * 주의: 이 테스트는 "파이프라인"을 검증하는 것이지 "템플릿이 실제 게임과 같은지"를
 * 검증하지는 않습니다. 템플릿 검증은 tools/pixel-font/verify.mjs 로 실제 캡처에 대해 하세요.
 */
import { loadPixelOcr, loadPixelFont } from "./loadLib.mjs";

const { recognizePixelFontLine, parsePixelExpText } = await loadPixelOcr();
const { PIXEL_FONT_GLYPHS } = await loadPixelFont();

const BG = [45, 57, 62];
const WHITE = [255, 255, 255];
const GREEN = [153, 204, 51];

/** advance(글리프 폭 + 여백)는 실제 글꼴 값에 맞춥니다. */
const ADVANCE = { default: 6, 1: 6, "[": 4, "]": 4, ".": 4, "%": 8 };

function renderLine(text, scale, { pad = 4, withBar = false, withPanel = false } = {}) {
	const glyphs = new Map(PIXEL_FONT_GLYPHS.map((g) => [g.char, g]));
	let nativeW = pad * 2;
	for (const ch of text) nativeW += ADVANCE[ch] ?? ADVANCE.default;
	const nativeH = pad * 2 + 12;
	const w = nativeW * scale;
	const h = nativeH * scale;
	const data = new Uint8Array(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		data[i * 4] = BG[0];
		data[i * 4 + 1] = BG[1];
		data[i * 4 + 2] = BG[2];
		data[i * 4 + 3] = 255;
	}
	const put = (nx, ny, color) => {
		for (let dy = 0; dy < scale; dy++) {
			for (let dx = 0; dx < scale; dx++) {
				const x = nx * scale + dx;
				const y = ny * scale + dy;
				if (x < 0 || y < 0 || x >= w || y >= h) continue;
				const o = (y * w + x) * 4;
				data[o] = color[0];
				data[o + 1] = color[1];
				data[o + 2] = color[2];
			}
		}
	};
	const digitTop = pad + 2;
	let cursor = pad;
	for (const ch of text) {
		const g = glyphs.get(ch);
		if (!g) throw new Error(`템플릿에 없는 문자: ${ch}`);
		const color = ch === "[" || ch === "]" ? GREEN : WHITE;
		// 잉크 bbox 기준 좌표라 advance 안에서 살짝 중앙에 놓습니다.
		const inset = ch === "1" ? 1 : ch === "." ? 1 : 0;
		for (let y = 0; y < g.height; y++) {
			for (let x = 0; x < g.width; x++) {
				if (g.rows[y][x] === "#") put(cursor + inset + x, digitTop + g.top + y, color);
			}
		}
		cursor += ADVANCE[ch] ?? ADVANCE.default;
	}
	if (withBar) {
		// 하단 게이지 바(속이 꽉 찬 큰 덩어리)를 섞어 넣습니다.
		for (let ny = nativeH - 4; ny < nativeH - 1; ny++) {
			for (let nx = 1; nx < nativeW - 1; nx++) put(nx, ny, [204, 255, 102]);
		}
	}
	if (withPanel) {
		// 실제 게임에서 EXP 숫자가 길어지면 닫는 괄호가 이 "밝고 채도 낮은 UI 패널" 위로 올라갑니다.
		// 밝기만으로 마스킹하면 패널이 전경으로 들어와 바로 옆 글자와 붙어버립니다.
		for (let ny = 0; ny < nativeH; ny++) {
			for (let nx = nativeW - 4; nx < nativeW; nx++) put(nx, ny, ny % 2 ? [194, 204, 214] : [136, 170, 187]);
		}
	}
	return { width: w, height: h, data };
}

let failures = 0;
const cases = [
	"1214349360[83.16%]",
	"0[0.00%]",
	"999999999[99.99%]",
	"1023[12.30%]",
	"88888888[8.88%]",
	"4040404[40.40%]"
];

for (const scale of [1, 2, 3, 4]) {
	for (const extra of [{}, { withBar: true }, { withPanel: true }, { withBar: true, withPanel: true }]) {
		for (const text of cases) {
			const img = renderLine(text, scale, extra);
			const res = recognizePixelFontLine(img);
			const parsed = res ? parsePixelExpText(res.text) : null;
			const expected = parsePixelExpText(text);
			const ok = parsed && expected && parsed.value === expected.value && parsed.percent === expected.percent;
			if (!ok) {
				failures++;
				console.log(`FAIL scale=${scale} ${JSON.stringify(extra)} "${text}" → ${res ? res.text : "null"}`);
			}
		}
	}
}

// 픽셀 글꼴이 아닌 입력(단색/노이즈)에서는 조용히 null 이어야 합니다.
const noise = { width: 120, height: 24, data: new Uint8Array(120 * 24 * 4).fill(60) };
if (recognizePixelFontLine(noise) !== null) {
	failures++;
	console.log("FAIL: 글자 없는 입력에서 null이 아님");
}

/**
 * 파서 안전 규칙
 *
 * 잘못된 값을 조용히 흘리는 것이 최악이므로, 조금이라도 의심스러우면 null 이어야 합니다.
 * (`?` = 못 읽은 숫자 한 자리, `_` = 숫자가 아닌 조각)
 */
const parseCases = [
	// 정상
	["1214349360[83.16%]", { value: 1214349360, percent: 83.16 }],
	// 닫는 괄호가 잘리거나 UI에 묻혀도 값/퍼센트는 그대로 유효
	["1214349360[83.16%", { value: 1214349360, percent: 83.16 }],
	// 앞뒤의 "EXP." 라벨 / UI 조각은 값에 영향 없음
	["____1214349360[83.16%]", { value: 1214349360, percent: 83.16 }],
	["940446[7.05%]_", { value: 940446, percent: 7.05 }],
	// 값 안에 못 읽은 숫자가 있으면 자릿수가 잘리므로 반드시 버려야 함
	["1214??91?3[83.18%]", null],
	["____1214??91?3[83.18%]", null],
	// 퍼센트 안에 못 읽은 숫자가 있으면 엉뚱한 퍼센트가 되므로 버려야 함
	["1214349360[8?.16%]", null],
	["1214349360[83.1?%]", null],
	// 구조가 깨진 경우
	["1214349360 83.16%", null],
	["[83.16%]", null],
	// 소수점 두 자리가 아니면 잘린 것으로 보고 버림
	["1214349360[83.1%]", null],
	["1214349360[83%]", null]
];
for (const [input, expected] of parseCases) {
	const got = parsePixelExpText(input);
	const ok = expected == null ? got == null : got && got.value === expected.value && got.percent === expected.percent;
	if (!ok) {
		failures++;
		console.log(`FAIL parse "${input}" → ${JSON.stringify(got)} (기대: ${JSON.stringify(expected)})`);
	}
}

console.log(failures === 0 ? "모든 자체 검증 통과" : `${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
