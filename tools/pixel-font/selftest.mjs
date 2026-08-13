#!/usr/bin/env node
/**
 * 픽셀 글꼴 인식기 자체 검증
 *
 *   node tools/pixel-font/selftest.mjs
 *
 * 두 가지를 돌립니다.
 *
 * (1) **실제 게임 캡처** (`fixtures/`) — 합성 렌더로는 만들 수 없는 왜곡을 잡습니다.
 *     `1301770001_89.15.png` 는 Retina + 화면 공유(3842x2392)에서 잡은 ROI입니다.
 *     배율은 정수(4배)인데 여는 대괄호 상자만 8x36이 아니라 7x37로 잡혀서, 점수가 0.892로
 *     떨어져 `1301770001_89.15%]` 가 나왔습니다. 값과 퍼센트를 다 읽었는데도 `[` 를 못 찾아
 *     파싱이 통째로 실패합니다. 정렬 재시도(`alignSegment`)를 지우면 여기서 걸립니다.
 *     (파일명이 곧 정답입니다: `<값>_<퍼센트>.png`)
 *
 * (2) **합성 렌더** — 템플릿으로 EXP 문자열을 직접 그린 뒤 다시 읽어서 파이프라인을 훑습니다.
 *     - 캡처 배율(1x~4x) 자동 추정
 *     - 글리프 분리(빈 열 기준)와 `%`(내부가 3조각인 글리프) 처리
 *     - 어두운 UI 배경 위 흰 글자 / 연두색 대괄호 마스킹
 *     - ROI 안에 게이지 바/UI 덩어리가 섞여 들어와도 무시하는지
 *
 *     주의: 합성 렌더는 "템플릿으로 그려서 템플릿으로 읽는" 자기충족이라 템플릿이 실제 게임과
 *     같은지는 검증하지 못합니다. 그래서 (1)이 필요합니다.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "./png.mjs";
import { loadPixelRecognizer, loadPixelFont } from "./loadLib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const { recognizePixelFontLine, parsePixelExpText, expValueHasUnknownPrefix } = await loadPixelRecognizer();
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

// (1) 실제 게임 캡처
{
	const dir = join(here, "fixtures");
	const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
	if (files.length === 0) {
		failures++;
		console.log("FAIL: 픽스처가 하나도 없습니다");
	}
	for (const f of files) {
		// 파일명이 곧 정답입니다. (예: 1301770001_89.15.png → value 1301770001, percent 89.15)
		const [v, p] = f.replace(/\.png$/, "").split("_");
		const res = recognizePixelFontLine(readPng(join(dir, f)));
		const parsed = res ? parsePixelExpText(res.text) : null;
		const ok = parsed && parsed.value === parseInt(v, 10) && parsed.percent === parseFloat(p);
		if (!ok) {
			failures++;
			console.log(`FAIL 실제 캡처 ${f} → ${res ? `"${res.text}"` : "null"} / ${JSON.stringify(parsed)}`);
		}
	}
}

// (2) 합성 렌더
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

// (3) 훼손 실험 — 이 인식기의 존재 이유인 안전 성질을 못박아 둡니다.
//     **글리프를 다른 글리프로 잘못 읽지 않는다. 확신이 없으면 미인식이다.**
//
//     특히 `alignSegment`(정렬 재시도)가 이 성질을 깨지 않는지 봅니다. 재시도는 상자를
//     ±1px씩 움직여 본 것 중 **최고점**을 고르는 최대화라, 하한이 혼동쌍(0.9429)보다 아래로
//     내려가면 틀린 글리프가 채택될 수 있습니다. 그래서 하한 0.95와 이 실험은 한 묶음입니다.
//
//     실측 A/B (960건, 같은 시드):
//       하한 0.92 / 재시도 없음: 정답 808 / null 146 / 잘림 6 / 오인식 0
//       하한 0.95 / 재시도 있음: 정답 839 / null 114 / 잘림 7 / 오인식 0
//     즉 null 32건이 정답으로 회복되고, **오인식은 양쪽 다 0**입니다. 잘림이 1건 늘어난 것은
//     "이전에는 null이던 판독이 앞자리가 빠진 채 파싱까지 도달"한 경우입니다. (아래 주석 참고)
{
	// 왜: CI에서 결과가 흔들리면 안 되므로 시드 고정 난수를 씁니다.
	let seed = 20260813;
	const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const pick = (n) => Math.floor(rnd() * n);

	let total = 0;
	let nulls = 0;
	let truncated = 0;
	let wrong = 0;
	for (const scale of [1, 2, 3, 4]) {
		for (const text of cases) {
			const expected = parsePixelExpText(text);
			for (let trial = 0; trial < 40; trial++) {
				const img = renderLine(text, scale);
				const { width: w, height: h, data } = img;
				// 실제 캡처에서 관측된 왜곡들을 흉내냅니다.
				// (경계 번짐 / 획 소실 / 얼룩 / 대괄호 탈색)
				const kind = trial % 4;
				const hits = 1 + pick(6);
				for (let i = 0; i < hits; i++) {
					const x = pick(w);
					const y = pick(h);
					const p = (y * w + x) * 4;
					if (kind === 0) {
						// 번짐: 이웃 픽셀 색을 복사
						const q = (Math.min(h - 1, y + 1) * w + Math.min(w - 1, x + 1)) * 4;
						data[p] = data[q];
						data[p + 1] = data[q + 1];
						data[p + 2] = data[q + 2];
					} else if (kind === 1) {
						// 획 소실: 배경색으로 지움
						data[p] = BG[0];
						data[p + 1] = BG[1];
						data[p + 2] = BG[2];
					} else if (kind === 2) {
						// 얼룩: 밝은 점
						data[p] = 220;
						data[p + 1] = 225;
						data[p + 2] = 230;
					} else {
						// 대괄호 탈색: 채도를 떨어뜨림
						const mx = Math.max(data[p], data[p + 1], data[p + 2]);
						data[p] = data[p + 1] = data[p + 2] = mx;
					}
				}
				const res = recognizePixelFontLine(img);
				const parsed = res ? parsePixelExpText(res.text) : null;
				total++;
				if (!parsed) {
					nulls++;
					continue;
				}
				if (parsed.value === expected.value && parsed.percent === expected.percent) continue;
				// 앞자리가 통째로 지워져 값이 **잘린** 경우는 여기서 잡지 않습니다.
				// 남은 숫자는 전부 제대로 읽은 것이고(글리프 오인식이 아님), 이건 인식기가 지역적으로
				// 판별할 수 없다고 이미 문서화한 한계입니다. (`expValueHasUnknownPrefix` 주석)
				// 실제 방어선은 상위(`useSampling`)의 값↔퍼센트 정합성 검사입니다.
				const truncation = String(expected.value).endsWith(String(parsed.value)) && parsed.percent === expected.percent;
				if (truncation) {
					truncated++;
					continue;
				}
				// 여기 걸리는 것만이 진짜 오인식입니다. (`6`을 `8`로 읽는 식)
				wrong++;
				failures++;
				console.log(`FAIL 훼손 오인식 scale=${scale} "${text}" → "${res.text}" (${parsed.value}/${parsed.percent})`);
			}
		}
	}
	// 잘림 건수는 정보로만 남깁니다. 늘어난다면 상위 정합성 검사에 기대는 부분이 커진다는 뜻이라
	// 눈에 띄어야 하지만, 인식기 단독으로는 없앨 수 없어서 실패로 처리하지 않습니다.
	console.log(
		`훼손 실험 ${total}건: 정답 ${total - nulls - truncated - wrong} / null ${nulls} / 잘림 ${truncated} / 오인식 ${wrong}`
	);
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
	// 마우스 포인터가 숫자 중간을 가려 숫자열이 갈라진 경우.
	// 뒤쪽 토막만 매칭되어 자릿수가 잘린 값이 되므로 반드시 버려야 합니다.
	// (`_` 앞에 숫자가 있다는 것이 "라벨이 아니라 숫자열이 갈라졌다"는 증거입니다)
	["1214_49360[83.16%]", null],
	["12_34_9360[83.16%]", null],
	["1214349_60[83.16%]", null],
	["____1214_49360[83.16%]", null],
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

/**
 * "값 앞에 미인식 조각이 붙어 있는지" 신호
 *
 * 앞자리를 통째로 가린 경우(`_49360[...]`)는 남은 문자열만으로는 "EXP." 라벨이 있는 정상 판독과
 * 구분할 수 없어서 파서가 값을 그대로 돌려줍니다. 그때 이 신호가 상위에서 원인을 "레벨 문제"로
 * 오진하지 않게 막아 줍니다. 그래서 **두 경우 모두 true여야** 합니다. (구분하는 게 목적이 아닙니다)
 */
const prefixCases = [
	["1214349360[83.16%]", false],
	["____1214349360[83.16%]", true],
	["_49360[83.16%]", true],
	// 값을 못 읽은 경우엔 애초에 판정할 대상이 없습니다.
	["[83.16%]", false],
	["1214349360 83.16%", false]
];
for (const [input, expected] of prefixCases) {
	const got = expValueHasUnknownPrefix(input);
	if (got !== expected) {
		failures++;
		console.log(`FAIL prefix "${input}" → ${got} (기대: ${expected})`);
	}
}

console.log(failures === 0 ? "모든 자체 검증 통과" : `${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
