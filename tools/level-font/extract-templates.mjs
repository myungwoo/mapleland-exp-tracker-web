#!/usr/bin/env node
/**
 * 게임 캡처에서 레벨 숫자 글리프 템플릿을 뽑아냅니다.
 *
 *   node tools/level-font/extract-templates.mjs <screenshot.png> [--roi=x,y,w,h] [--text=193]
 *
 * - `--text` 를 주면 잘라낸 글리프에 순서대로 라벨을 붙이고, `lib/levelPixelFont.ts` 의 기존
 *   템플릿과 비교해서 **다르거나 새로운 글리프만** 알려줍니다.
 * - `--text` 없이 돌리면 잘라낸 글리프를 그려주기만 합니다. (라벨은 사람이 확인)
 *
 * 왜 필요한가:
 *   템플릿 매칭은 템플릿이 실제 게임 픽셀과 1:1로 같아야 정확합니다. 패치로 글꼴이 바뀌면
 *   이 도구로 다시 뽑으세요. **절대 EXP 글꼴에서 유도하지 마세요** — 골격이 거의 같아 보이지만
 *   폭이 1px씩 달라서, 유도한 템플릿은 조용히 오인식합니다. (`lib/levelPixelFont.ts` 주석 참고)
 */
import { readPng, cropRgba } from "../pixel-font/png.mjs";
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
	console.error("사용법: node tools/level-font/extract-templates.mjs <screenshot.png> [--roi=x,y,w,h] [--text=193]");
	process.exit(1);
}
const roiArg = args.find((a) => a.startsWith("--roi="));
const text = args.find((a) => a.startsWith("--text="))?.slice("--text=".length);

const { isLevelGlyphPixel } = await loadLibModules(["levelRoiFingerprint"], "levelRoiFingerprint");
const { LEVEL_FONT_GLYPHS, LEVEL_FONT_DIGIT_HEIGHT } = await loadLibModules(["levelPixelFont"], "levelPixelFont");

let img = readPng(file);
if (roiArg) {
	const [x, y, w, h] = roiArg.slice("--roi=".length).split(",").map(Number);
	img = cropRgba(img, x, y, w, h);
}

// 전경 마스크 (인식기와 같은 규칙)
const { width: W, height: H, data } = img;
const mask = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
	const i = p * 4;
	if (data[i + 3] < 128) continue;
	if (isLevelGlyphPixel(data[i], data[i + 1], data[i + 2])) mask[p] = 1;
}

// 전체 bbox + 열 분리
let X0 = W,
	Y0 = H,
	X1 = -1,
	Y1 = -1;
for (let y = 0; y < H; y++)
	for (let x = 0; x < W; x++)
		if (mask[y * W + x]) {
			if (x < X0) X0 = x;
			if (x > X1) X1 = x;
			if (y < Y0) Y0 = y;
			if (y > Y1) Y1 = y;
		}
if (X1 < X0) {
	console.error("글자를 찾지 못했습니다. ROI가 레벨 숫자를 포함하는지 확인하세요.");
	process.exit(1);
}

/** 마스크가 s배 블록으로 정확히 구성되어 있는지 확인해 캡처 배율을 정합니다. */
function blockRegular(s) {
	for (let y = Y0; y + s <= Y1 + 1; y += s)
		for (let x = X0; x + s <= X1 + 1; x += s) {
			const v = mask[y * W + x];
			for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) if (mask[(y + dy) * W + x + dx] !== v) return false;
		}
	return true;
}
const glyphH = Y1 - Y0 + 1;
let scale = 1;
for (let s = Math.floor(glyphH / LEVEL_FONT_DIGIT_HEIGHT); s >= 1; s--) {
	if (glyphH % s !== 0) continue;
	if (blockRegular(s)) {
		scale = s;
		break;
	}
}
if (glyphH % scale !== 0 || glyphH / scale !== LEVEL_FONT_DIGIT_HEIGHT) {
	console.error(
		`글리프 높이 ${glyphH}px 가 글꼴 높이 ${LEVEL_FONT_DIGIT_HEIGHT}px 의 정수배가 아닙니다 (추정 배율 ${scale}).\n` +
			"캡처가 비정수 배율로 리샘플된 것 같습니다. 100% 배율의 원본 스크린샷을 쓰세요."
	);
	process.exit(1);
}

const colHas = new Uint8Array(W);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) colHas[x] = 1;
const segs = [];
let st = -1;
for (let x = 0; x <= W; x++) {
	const on = x < W && colHas[x];
	if (on && st < 0) st = x;
	else if (!on && st >= 0) {
		segs.push([st, x - 1]);
		st = -1;
	}
}

console.log(`캡처 배율 ${scale}x, 글리프 ${segs.length}개\n`);
if (text && text.length !== segs.length) {
	console.error(`⚠️  --text 길이(${text.length})와 잘라낸 글리프 수(${segs.length})가 다릅니다.`);
}

const known = new Map(LEVEL_FONT_GLYPHS.map((g) => [g.char, g.rows]));
let changed = 0;
segs.forEach(([x0, x1], idx) => {
	let y0 = H,
		y1 = -1;
	for (let y = 0; y < H; y++)
		for (let x = x0; x <= x1; x++)
			if (mask[y * W + x]) {
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
	const rows = [];
	for (let y = y0; y <= y1; y += scale) {
		let s = "";
		for (let x = x0; x <= x1; x += scale) s += mask[y * W + x] ? "#" : ".";
		rows.push(s);
	}
	const label = text?.[idx];
	console.log(`── 글리프 ${idx + 1}${label ? ` (라벨 "${label}")` : ""}  ${rows[0].length}x${rows.length}`);
	console.log(rows.map((r) => "     " + r).join("\n"));
	if (label) {
		const prev = known.get(label);
		if (!prev) {
			changed++;
			console.log(`   ✨ 새 글리프입니다. lib/levelPixelFont.ts 에 추가하세요:`);
			console.log(`      glyph("${label}", [${rows.map((r) => JSON.stringify(r)).join(", ")}]),`);
		} else if (prev.length !== rows.length || prev.some((r, i) => r !== rows[i])) {
			changed++;
			console.log(`   ⚠️  기존 템플릿과 다릅니다! 기존:`);
			console.log(prev.map((r) => "        " + r).join("\n"));
			console.log(`      glyph("${label}", [${rows.map((r) => JSON.stringify(r)).join(", ")}]),`);
		} else {
			console.log(`   ✅ 기존 템플릿과 일치`);
		}
	}
	console.log("");
});

if (text) {
	console.log(changed === 0 ? "기존 템플릿과 모두 일치합니다." : `${changed}개 글리프가 새롭거나 달라졌습니다.`);
}
