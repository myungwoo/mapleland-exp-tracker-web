#!/usr/bin/env node
/**
 * 레벨 픽셀 글꼴 인식기 자체 검증
 *
 *   node tools/level-font/selftest.mjs
 *
 * 두 종류를 검증합니다.
 *
 * (1) **실제 게임 캡처** (`fixtures/`) — 템플릿이 실제 픽셀과 여전히 1:1인지 확인합니다.
 *     이게 가장 중요합니다. 템플릿이 실제와 어긋나면 인식이 통째로 망가지는데,
 *     합성 렌더만 돌리면 "템플릿으로 그려서 템플릿으로 읽는" 자기충족이라 절대 못 잡습니다.
 *
 *     `193.png` 는 다른 컴퓨터(Retina + 화면 공유)에서 잡은 캡처입니다. 배율은 정수(3배)인데
 *     격자가 어긋나 있어서 — 글리프 오른쪽에 1px 띠가 번지고 행 경계가 한 칸 밀립니다 —
 *     정답 점수가 채택 하한 바로 아래로 떨어져 `??3` 이 나왔습니다.
 *     합성 렌더로는 이 왜곡을 못 만듭니다. 정렬 재시도(`alignSegment`)를 지우면 여기서 걸립니다.
 *
 * (2) **합성 렌더** — 파이프라인(배율 추정, 글리프 분리, 매칭, 채택 기준)을 넓게 훑습니다.
 *
 * 그리고 이 인식기의 존재 이유인 안전 성질을 못박아 둡니다:
 *   **어떤 입력에도 "틀린 숫자"를 돌려주지 않는다. 확신이 없으면 null이다.**
 *   (범용 인식 엔진은 193을 183으로 읽는 식으로 확신에 찬 틀린 값을 냈고, 그게 전환의 이유였습니다)
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng } from "../pixel-font/png.mjs";
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const { recognizeLevelPixelFont } = await loadLibModules(
	["levelRoiFingerprint", "levelPixelFont", "levelPixelRecognizer"],
	"levelPixelRecognizer"
);
const { LEVEL_FONT_GLYPHS, LEVEL_FONT_MASKS, LEVEL_FONT_DIGIT_HEIGHT } = await loadLibModules(
	["levelPixelFont"],
	"levelPixelFont"
);

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

// ---------------------------------------------------------------- (1) 실제 캡처
{
	const dir = join(here, "fixtures");
	const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
	check("픽스처가 존재", files.length > 0);
	const seen = new Set();
	for (const f of files) {
		// 파일명이 곧 정답입니다. (예: 106.png → 106)
		const expected = parseInt(f.replace(/\.png$/, ""), 10);
		const res = recognizeLevelPixelFont(readPng(join(dir, f)));
		check(`실제 캡처 ${f}`, res != null && res.value === expected, `→ ${res ? res.value : "null"}`);
		for (const ch of String(expected)) seen.add(ch);
	}
	// 픽스처가 10자리를 모두 덮는지 (기존 예제 캡처의 193이 9를 담당합니다)
	const example = join(here, "..", "..", "public", "examples", "level-roi.png");
	{
		// 예제는 디버그 프리뷰라 4배로 저장되어 있습니다. 인식기는 배율을 자동 추정합니다.
		const res = recognizeLevelPixelFont(readPng(example));
		check(
			"실제 캡처 level-roi.png (193, 4배 프리뷰)",
			res != null && res.value === 193,
			`→ ${res ? res.value : "null"}`
		);
		for (const ch of "193") seen.add(ch);
	}
	const missing = "0123456789".split("").filter((d) => !seen.has(d));
	check("픽스처가 0~9 전부를 덮음", missing.length === 0, `누락: ${missing.join(",")}`);
}

// ---------------------------------------------------------------- 합성 렌더
/** 글꼴 원본 격자에 그린 뒤 scale배 최근접 확대. 배경은 오렌지 타일, 글자는 흰색. */
function render(text, scale, { gap = 5, pad = 4, flip = null } = {}) {
	const gs = new Map(LEVEL_FONT_MASKS.map((g) => [g.char, g]));
	let nw = pad * 2;
	for (const ch of text) nw += gs.get(ch).width + gap;
	const nh = pad * 2 + LEVEL_FONT_DIGIT_HEIGHT;
	const base = new Uint8Array(nw * nh);
	let cur = pad;
	for (const ch of text) {
		const g = gs.get(ch);
		for (let y = 0; y < g.height; y++)
			for (let x = 0; x < g.width; x++) if (g.bits[y * g.width + x]) base[(pad + y) * nw + cur + x] = 1;
		cur += g.width + gap;
	}
	if (flip) for (const idx of flip) base[idx] ^= 1;
	const w = Math.round(nw * scale);
	const h = Math.round(nh * scale);
	const data = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const sx = Math.min(nw - 1, Math.floor(x / scale));
			const sy = Math.min(nh - 1, Math.floor(y / scale));
			const v = base[sy * nw + sx];
			const i = (y * w + x) * 4;
			// 글자 = 흰색(255,255,255), 배경 = 오렌지 타일(254,137,17)
			data[i] = v ? 255 : 254;
			data[i + 1] = v ? 255 : 137;
			data[i + 2] = v ? 255 : 17;
			data[i + 3] = 255;
		}
	return { width: w, height: h, data, nativeW: nw, nativeH: nh };
}

// (2-a) 레벨 1~200 전수 × 정수 배율
{
	for (const scale of [1, 2, 3, 4, 6, 8]) {
		let wrong = [];
		let nulls = [];
		for (let lv = 1; lv <= 200; lv++) {
			const res = recognizeLevelPixelFont(render(String(lv), scale));
			if (res?.value === lv) continue;
			if (res?.value == null) nulls.push(lv);
			else wrong.push(`${lv}→${res.value}`);
		}
		check(
			`합성 레벨 1~200 @ ${scale}x`,
			wrong.length === 0 && nulls.length === 0,
			`오인식 ${wrong.slice(0, 4)} / null ${nulls.slice(0, 4)}`
		);
	}
}

// (2-b) 글자 간격이 좁거나 넓어도 분리되는가
{
	for (const gap of [2, 3, 8, 12]) {
		const res = recognizeLevelPixelFont(render("188", 2, { gap }));
		check(`글자 간격 ${gap}px 에서 분리`, res?.value === 188, `→ ${res ? res.value : "null"}`);
	}
}

// (2-c) 핵심 안전 성질: 글리프를 훼손해도 "틀린 숫자"는 절대 나오지 않는다
{
	// 헷갈리기 쉬운 쌍(6↔8, 8↔9)을 포함한 문자열을 골라, 전경 픽셀을 하나씩 뒤집어 봅니다.
	let wrongCount = 0;
	let okCount = 0;
	let nullCount = 0;
	for (const text of ["189", "68", "193", "806"]) {
		const probe = render(text, 2);
		const nativeCells = probe.nativeW * probe.nativeH;
		for (let idx = 0; idx < nativeCells; idx++) {
			const res = recognizeLevelPixelFont(render(text, 2, { flip: [idx] }));
			const v = res?.value ?? null;
			if (v === parseInt(text, 10)) okCount++;
			else if (v == null) nullCount++;
			else {
				wrongCount++;
				if (wrongCount <= 3) console.log(`   훼손 오인식: "${text}" 픽셀 ${idx} → ${v}`);
			}
		}
	}
	check("픽셀 1개 훼손 시 틀린 숫자를 내지 않음", wrongCount === 0, `오인식 ${wrongCount}건`);
	console.log(
		`  (훼손 실험 ${okCount + nullCount + wrongCount}건: 그대로 정답 ${okCount}, null ${nullCount}, 오인식 ${wrongCount})`
	);
}

// (2-d) 글자가 없거나 화면이 이상하면 null
{
	const blank = { width: 40, height: 20, data: new Uint8Array(40 * 20 * 4) };
	for (let p = 0; p < 40 * 20; p++) {
		const i = p * 4;
		blank.data[i] = 254;
		blank.data[i + 1] = 137;
		blank.data[i + 2] = 17;
		blank.data[i + 3] = 255;
	}
	check("타일만 있고 글자가 없으면 null", recognizeLevelPixelFont(blank) == null);

	const white = { width: 40, height: 20, data: new Uint8Array(40 * 20 * 4).fill(255) };
	check("전체가 흰색이면 null", recognizeLevelPixelFont(white) == null);

	// 4자리는 레벨이 아닙니다. (ROI가 잘못 잡힌 상태)
	const four = recognizeLevelPixelFont(render("1234", 2));
	check("4자리는 거부", four == null || four.value == null, `→ ${four ? four.value : "null"}`);
}

// (2-e) 선행 0은 레벨이 아닙니다
{
	const res = recognizeLevelPixelFont(render("06", 2));
	check("선행 0은 값으로 채택하지 않음", res == null || res.value == null, `→ ${res ? res.value : "null"}`);
}

// ---------------------------------------------------------------- 템플릿 자체 점검
{
	check("글리프 10자 확보", LEVEL_FONT_GLYPHS.length === 10);
	const chars = LEVEL_FONT_GLYPHS.map((g) => g.char)
		.sort()
		.join("");
	check("0~9 전부 존재", chars === "0123456789", `실제: ${chars}`);
	check(
		"모든 글리프 높이가 글꼴 높이와 같음",
		LEVEL_FONT_GLYPHS.every((g) => g.height === LEVEL_FONT_DIGIT_HEIGHT)
	);
	check(
		"rows 폭이 width와 일치",
		LEVEL_FONT_GLYPHS.every((g) => g.rows.every((r) => r.length === g.width))
	);
	// 서로 완전히 같은 글리프가 있으면 절대 구별할 수 없습니다.
	let dup = [];
	for (let i = 0; i < LEVEL_FONT_GLYPHS.length; i++)
		for (let j = i + 1; j < LEVEL_FONT_GLYPHS.length; j++) {
			const a = LEVEL_FONT_GLYPHS[i];
			const b = LEVEL_FONT_GLYPHS[j];
			if (a.width === b.width && a.rows.every((r, k) => r === b.rows[k])) dup.push(`${a.char}=${b.char}`);
		}
	check("서로 같은 글리프가 없음", dup.length === 0, dup.join(","));

	// 가장 헷갈리기 쉬운 쌍의 유사도가 채택 하한보다 낮아야, 틀린 글리프가 단독 채택될 수 없습니다.
	let worst = { v: 0, pair: "" };
	for (const a of LEVEL_FONT_GLYPHS)
		for (const b of LEVEL_FONT_GLYPHS) {
			if (a.char === b.char || a.width !== b.width) continue;
			let agree = 0;
			for (let y = 0; y < a.height; y++)
				for (let x = 0; x < a.width; x++) if ((a.rows[y][x] === "#") === (b.rows[y][x] === "#")) agree++;
			const s = agree / (a.width * a.height);
			if (s > worst.v) worst = { v: s, pair: `${a.char}↔${b.char}` };
		}
	console.log(`  가장 헷갈리기 쉬운 쌍: ${worst.pair} = ${worst.v.toFixed(4)}`);
	check("최악 쌍 유사도가 채택 하한(0.95) 미만", worst.v < 0.95, `${worst.pair}=${worst.v.toFixed(4)}`);
}

console.log(failures === 0 ? "모든 자체 검증 통과" : `${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
