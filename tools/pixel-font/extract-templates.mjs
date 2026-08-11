#!/usr/bin/env node
/**
 * 게임 캡처에서 픽셀 글꼴 글리프 템플릿을 뽑아냅니다.
 *
 *   node tools/pixel-font/extract-templates.mjs <screenshot.png> \
 *        [--roi=x,y,w,h] --text='1214349360[83.16%]'
 *
 * - `--text` 를 주면 잘라낸 글리프에 순서대로 라벨을 붙이고,
 *   `lib/pixelFont.ts` 의 기존 템플릿과 비교해서 **다르거나 새로운 글리프만** 알려줍니다.
 * - `--text` 없이 돌리면 잘라낸 글리프를 그대로 그려주기만 합니다. (라벨은 사람이 확인)
 *
 * 왜 필요한가:
 *   비트맵 글꼴 인식은 템플릿이 실제 게임 픽셀과 1:1로 같아야 정확합니다.
 *   패치로 글꼴이 또 바뀌거나 아직 못 본 글자(예: 5, 7)가 나오면 이 도구로 다시 뽑으면 됩니다.
 */
import { readPng, cropRgba } from "./png.mjs";
import { loadPixelOcr, loadPixelFont } from "./loadLib.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
	console.error(
		"사용법: node tools/pixel-font/extract-templates.mjs <screenshot.png> [--roi=x,y,w,h] [--text='1214349360[83.16%]']"
	);
	process.exit(1);
}
const roiArg = args.find((a) => a.startsWith("--roi="));
const text = args.find((a) => a.startsWith("--text="))?.slice("--text=".length);

const { recognizePixelFontLine } = await loadPixelOcr();
const { PIXEL_FONT_GLYPHS } = await loadPixelFont();

let img = readPng(file);
if (roiArg) {
	const [x, y, w, h] = roiArg.slice("--roi=".length).split(",").map(Number);
	img = cropRgba(img, x, y, w, h);
}

const res = recognizePixelFontLine(img, { debug: true });
if (!res) {
	console.error("글리프를 찾지 못했습니다. ROI가 EXP 텍스트를 포함하는지 확인하세요.");
	process.exit(1);
}
const { scale, digitTop, debug } = res;
console.log(`캡처 배율 ${scale}x, 숫자 윗줄 y=${digitTop}, 글리프 ${debug.length}개\n`);

/** 캡처 배율만큼 축소해서 원본 픽셀 격자로 되돌립니다. (블록 다수결) */
function toNative(art, scale) {
	if (scale === 1) return art;
	const h = Math.round(art.length / scale);
	const w = Math.round(art[0].length / scale);
	const rows = [];
	for (let y = 0; y < h; y++) {
		let row = "";
		for (let x = 0; x < w; x++) {
			let on = 0;
			let total = 0;
			for (let dy = 0; dy < scale; dy++) {
				const line = art[Math.round(y * scale + dy)];
				if (!line) continue;
				for (let dx = 0; dx < scale; dx++) {
					const c = line[Math.round(x * scale + dx)];
					if (c === undefined) continue;
					total++;
					if (c === "#") on++;
				}
			}
			row += total > 0 && on * 2 >= total ? "#" : ".";
		}
		rows.push(row);
	}
	return rows;
}

const known = new Map(PIXEL_FONT_GLYPHS.map((g) => [g.char, g]));
const labels = text ? [...text] : null;
if (labels && labels.length !== debug.length) {
	console.log(
		`주의: --text 글자 수(${labels.length})와 잘라낸 글리프 수(${debug.length})가 다릅니다.\n` +
			`     ROI에 "EXP." 라벨이나 UI가 섞였을 수 있습니다. 아래 그림으로 확인 후 --roi 를 조정하세요.\n`
	);
}

const snippets = [];
debug.forEach((d, i) => {
	const rows = toNative(d.art, Math.round(scale));
	const top = Math.round((d.y0 - digitTop) / scale);
	const label = labels && labels.length === debug.length ? labels[i] : null;
	const prev = label ? known.get(label) : null;
	const same = prev && prev.rows.length === rows.length && prev.rows.every((r, k) => r === rows[k]) && prev.top === top;
	const status = !label ? "" : !prev ? "  ← 새 글리프" : same ? "  (기존과 동일)" : "  ← 기존 템플릿과 다름!";
	console.log(`[${i}] ${label ?? "?"}  top=${top} ${rows[0].length}x${rows.length}${status}`);
	for (const r of rows) console.log("    " + r);
	console.log();
	if (label && (!prev || !same)) {
		snippets.push(`\tglyph("${label}", ${top}, [${rows.map((r) => `"${r}"`).join(", ")}], true),`);
	}
});

if (snippets.length) {
	console.log("lib/pixelFont.ts 의 PIXEL_FONT_GLYPHS 에 반영할 항목:\n");
	console.log(snippets.join("\n"));
} else if (labels) {
	console.log("기존 템플릿과 모두 일치합니다. 수정할 것이 없습니다.");
}
