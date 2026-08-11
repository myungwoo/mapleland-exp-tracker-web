#!/usr/bin/env node
/**
 * 게임 캡처 스크린샷으로 픽셀 글꼴 인식기를 검증합니다.
 *
 *   node tools/pixel-font/verify.mjs <screenshot.png> [--roi=x,y,w,h] [--expect=문자열]
 *
 * 예)
 *   node tools/pixel-font/verify.mjs ~/Downloads/exp.png --expect='1214349360[83.16%'
 *
 * ROI를 주지 않으면 이미지 전체를 인식 대상으로 삼습니다.
 * (인식기는 게이지 바/테두리 같은 큰 덩어리를 스스로 걸러냅니다)
 */
import { readPng, cropRgba } from "./png.mjs";
import { loadPixelOcr } from "./loadLib.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
	console.error("사용법: node tools/pixel-font/verify.mjs <screenshot.png> [--roi=x,y,w,h] [--expect=...]");
	process.exit(1);
}
const roiArg = args.find((a) => a.startsWith("--roi="));
const expect = args.find((a) => a.startsWith("--expect="))?.slice("--expect=".length);

const { recognizePixelFontLine, parsePixelExpText } = await loadPixelOcr();

let img = readPng(file);
if (roiArg) {
	const [x, y, w, h] = roiArg.slice("--roi=".length).split(",").map(Number);
	img = cropRgba(img, x, y, w, h);
}

const debug = args.includes("--debug");
const res = recognizePixelFontLine(img, { debug });
if (!res) {
	console.log("인식 실패: 비트맵 글꼴 글리프를 찾지 못했습니다. ROI/캡처 배율을 확인하세요.");
	process.exit(expect ? 1 : 0);
}
console.log(`텍스트   : ${res.text}`);
console.log(`글리프 수: ${res.glyphCount} (미인식 ${res.unknownCount})`);
console.log(`캡처 배율: ${res.scale}x`);
const parsed = parsePixelExpText(res.text);
console.log(`파싱     : ${parsed ? `value=${parsed.value} percent=${parsed.percent}` : "실패"}`);

if (debug && res.debug) {
	for (const d of res.debug) {
		const cands = d.top.map((t) => `${t.char}=${t.score.toFixed(3)}`).join("  ");
		console.log(`\n--- x${d.x0}..${d.x1} y${d.y0}..${d.y1} (${d.x1 - d.x0 + 1}x${d.y1 - d.y0 + 1}) → ${d.char ?? "?"}`);
		console.log(`    후보: ${cands || "(크기 조건 통과 없음)"}`);
		for (const row of d.art) console.log("    " + row);
	}
}

if (expect) {
	const ok = res.text.includes(expect);
	console.log(ok ? "OK: 기대 문자열 일치" : `FAIL: 기대="${expect}"`);
	process.exit(ok ? 0 : 1);
}
