#!/usr/bin/env node
/**
 * 레벨 ROI 변화 감지 지문 자체 검증
 *
 *   node tools/level-roi/selftest.mjs
 *
 * 이 지문이 지켜야 하는 성질을 검증합니다.
 * - 같은 입력 → 같은 지문 (결정적)
 * - 영상 노이즈에는 흔들리지 않음 (실제 캡처 기준)
 * - 글자가 **1픽셀이라도** 달라지면 지문이 달라짐 (변화를 놓치면 틀린 값을 계속 서빙하게 됨)
 * - 전경이 없거나 화면 대부분이 전경이면 null (캡처 이상 상태에서는 캐시를 쓰지 않음)
 *
 * 왜 이 테스트가 중요한가:
 * 이 지문이 틀리면 "레벨이 바뀌었는데 못 알아채는" 사고가 납니다. 그건 캐시가 잘못된 레벨을
 * 계속 서빙한다는 뜻이고, 누적 EXP 계산이 통째로 오염됩니다.
 */
import { readPng } from "../pixel-font/png.mjs";
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const { computeLevelRoiFingerprint, levelRoiFingerprintEquals, isLevelGlyphPixel } = await loadLibModules(
	["levelRoiFingerprint"],
	"levelRoiFingerprint"
);
const { emptyLevelReadCache, getReusableLevelRead, applyLevelRead, LEVEL_CACHE_REVALIDATE_MS } = await loadLibModules(
	["levelRoiFingerprint", "levelReadCache"],
	"levelReadCache"
);

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

/** 예제 캡처는 디버그 프리뷰(4배)이므로, 실제 측정 입력과 같은 원본 배율로 되돌립니다. */
function downscale(img, s) {
	const w = Math.floor(img.width / s);
	const h = Math.floor(img.height / s);
	const data = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = (y * s * img.width + x * s) * 4;
			const di = (y * w + x) * 4;
			data[di] = img.data[si];
			data[di + 1] = img.data[si + 1];
			data[di + 2] = img.data[si + 2];
			data[di + 3] = 255;
		}
	}
	return { width: w, height: h, data };
}

const preview = readPng(new URL("../../public/examples/level-roi.png", import.meta.url).pathname);
const roi = downscale(preview, 4);

// --- 1) 결정적인가 ---
const base = computeLevelRoiFingerprint(roi);
check("지문 생성", base != null);
check("같은 입력 → 같은 지문", levelRoiFingerprintEquals(base, computeLevelRoiFingerprint(roi)));

// --- 2) 영상 노이즈에 둔감한가 ---
// 결정적 의사난수를 씁니다. (테스트가 실행마다 다른 결과를 내면 안 됩니다)
let seed = 12345;
const rnd = () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};
function withNoise(img, amp) {
	const out = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
	for (let p = 0; p < img.width * img.height; p++) {
		const i = p * 4;
		for (let c = 0; c < 3; c++) {
			const v = img.data[i + c] + Math.round((rnd() * 2 - 1) * amp);
			out.data[i + c] = Math.max(0, Math.min(255, v));
		}
		out.data[i + 3] = 255;
	}
	return out;
}
for (const amp of [5, 10, 15]) {
	let stable = 0;
	const trials = 100;
	for (let t = 0; t < trials; t++) {
		if (levelRoiFingerprintEquals(base, computeLevelRoiFingerprint(withNoise(roi, amp)))) stable++;
	}
	check(`노이즈 ±${amp} 에서 지문 유지`, stable === trials, `${stable}/${trials} 만 유지`);
}

// --- 3) 1픽셀 변화도 잡아내는가 ---
// 글자(전경) 픽셀 하나를 배경색으로 바꿔서, 지문이 반드시 달라지는지 확인합니다.
{
	let flippedAny = 0;
	let missed = 0;
	for (let p = 0; p < roi.width * roi.height; p++) {
		const i = p * 4;
		if (!isLevelGlyphPixel(roi.data[i], roi.data[i + 1], roi.data[i + 2])) continue;
		const copy = { width: roi.width, height: roi.height, data: Uint8Array.from(roi.data) };
		// 오렌지 타일 색으로 덮어 전경 판정을 확실히 벗어나게 합니다.
		copy.data[i] = 254;
		copy.data[i + 1] = 137;
		copy.data[i + 2] = 17;
		flippedAny++;
		if (levelRoiFingerprintEquals(base, computeLevelRoiFingerprint(copy))) missed++;
	}
	check("전경 1픽셀 변화를 모두 감지", missed === 0, `${missed}/${flippedAny} 건을 놓침`);
	check("전경 픽셀이 실제로 존재", flippedAny > 0);
}

// --- 4) 서로 다른 레벨은 서로 다른 지문인가 ---
// 글자 영역을 통째로 지운 이미지와 원본은 반드시 달라야 합니다.
{
	const blank = { width: roi.width, height: roi.height, data: Uint8Array.from(roi.data) };
	for (let p = 0; p < blank.width * blank.height; p++) {
		const i = p * 4;
		if (isLevelGlyphPixel(blank.data[i], blank.data[i + 1], blank.data[i + 2])) {
			blank.data[i] = 254;
			blank.data[i + 1] = 137;
			blank.data[i + 2] = 17;
		}
	}
	check("글자가 사라지면 지문도 달라짐(=null)", computeLevelRoiFingerprint(blank) == null);
}

// --- 5) 캡처 이상 상태에서는 null ---
{
	const mk = (w, h, fill) => {
		const data = new Uint8Array(w * h * 4);
		for (let p = 0; p < w * h; p++) {
			const i = p * 4;
			data[i] = fill[0];
			data[i + 1] = fill[1];
			data[i + 2] = fill[2];
			data[i + 3] = 255;
		}
		return { width: w, height: h, data };
	};
	check("전경이 전혀 없으면 null", computeLevelRoiFingerprint(mk(20, 10, [17, 17, 17])) == null);
	check("전체가 전경이면 null", computeLevelRoiFingerprint(mk(20, 10, [255, 255, 255])) == null);
	check("빈 ROI면 null", computeLevelRoiFingerprint(mk(0, 0, [0, 0, 0])) == null);
}

// --- 6) 위치에 민감한가 ---
// 전경 픽셀 수가 같아도 배치가 다르면 지문이 달라야 합니다. (개수만 세면 놓칩니다)
{
	const w = 16;
	const h = 8;
	const mk = (onIdx) => {
		const data = new Uint8Array(w * h * 4);
		for (let p = 0; p < w * h; p++) {
			const i = p * 4;
			const on = onIdx.includes(p);
			data[i] = on ? 255 : 17;
			data[i + 1] = on ? 255 : 17;
			data[i + 2] = on ? 255 : 17;
			data[i + 3] = 255;
		}
		return { width: w, height: h, data };
	};
	const a = computeLevelRoiFingerprint(mk([1, 2, 3]));
	const b = computeLevelRoiFingerprint(mk([10, 11, 12]));
	check("전경 수가 같아도 배치가 다르면 지문이 다름", a != null && b != null && !levelRoiFingerprintEquals(a, b));
}

// --- 7) 전처리와 판정 규칙이 어긋나지 않았는가 ---
// `preprocessLevelCanvas`는 이 함수를 import해서 씁니다. 규칙이 바뀌면 여기서 알 수 있게 고정값을 확인합니다.
{
	check("흰 글자는 전경", isLevelGlyphPixel(255, 255, 255));
	check("크림색 글자도 전경", isLevelGlyphPixel(255, 250, 225));
	check("오렌지 타일은 배경", !isLevelGlyphPixel(254, 137, 17));
	check("어두운 UI는 배경", !isLevelGlyphPixel(34, 34, 34));
}

// --- 8) 재사용 규칙 (여기가 "틀린 값 고착" 방어의 핵심입니다) ---
{
	const fpA = { w: 10, h: 5, fgCount: 7, hashA: 1111, hashB: 2222 };
	const fpB = { w: 10, h: 5, fgCount: 9, hashA: 3333, hashB: 4444 };
	const read = (value) => ({ text: String(value), value });

	// (a) 첫 판독은 절대 재사용하지 않습니다.
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(193), 1000);
		check("첫 판독은 재사용 안 함", getReusableLevelRead(s, fpA, 1000) == null);
		s = applyLevelRead(s, fpA, read(193), 2000);
		const r = getReusableLevelRead(s, fpA, 2000);
		check("두 번 연속 같은 값이면 재사용", r != null && r.value === 193);
	}

	// (b) 사용자가 우려한 시나리오:
	//     같은 ROI인데 첫 판독이 틀리고(192) 두 번째부터 제대로 읽히는(193) 경우.
	//     틀린 값이 재사용 대상이 되어서는 안 되고, 결국 옳은 값으로 수렴해야 합니다.
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(192), 1000); // 틀린 첫 판독
		check("틀린 첫 판독은 재사용 안 함", getReusableLevelRead(s, fpA, 1000) == null);
		s = applyLevelRead(s, fpA, read(193), 2000); // 제대로 읽힘 (앞과 불일치 → 확인 실패)
		check("값이 흔들리는 동안에는 재사용 안 함", getReusableLevelRead(s, fpA, 2000) == null);
		s = applyLevelRead(s, fpA, read(193), 3000); // 두 번 연속 193
		const r = getReusableLevelRead(s, fpA, 3000);
		check("옳은 값으로 수렴해서 재사용", r != null && r.value === 193, `실제 ${r ? r.value : "null"}`);
	}

	// (c) 인식 실패는 캐시하지 않고, 기존 캐시까지 버립니다.
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(193), 1000);
		s = applyLevelRead(s, fpA, read(193), 2000);
		check("사전 조건: 재사용 가능", getReusableLevelRead(s, fpA, 2000) != null);
		s = applyLevelRead(s, fpA, { text: "", value: null }, 3000);
		check("인식 실패 후에는 재사용 안 함", getReusableLevelRead(s, fpA, 3000) == null);
	}

	// (d) ROI가 달라지면(레벨업 등) 재사용하지 않습니다. 이걸 놓치면 옛 레벨이 계속 나갑니다.
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(193), 1000);
		s = applyLevelRead(s, fpA, read(193), 2000);
		check("다른 지문이면 재사용 안 함", getReusableLevelRead(s, fpB, 2000) == null);
		check("지문이 없으면 재사용 안 함", getReusableLevelRead(s, null, 2000) == null);
	}

	// (e) 재검증 주기가 지나면 지문이 같아도 다시 인식합니다. (고착 지속 시간 상한)
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(193), 1000);
		s = applyLevelRead(s, fpA, read(193), 2000);
		check("재검증 직전에는 재사용", getReusableLevelRead(s, fpA, 2000 + LEVEL_CACHE_REVALIDATE_MS - 1) != null);
		check("재검증 시점에는 재사용 안 함", getReusableLevelRead(s, fpA, 2000 + LEVEL_CACHE_REVALIDATE_MS) == null);
		// 재검증에서 같은 값이 확인되면 추가 비용 없이 계속 재사용됩니다.
		const t = 2000 + LEVEL_CACHE_REVALIDATE_MS;
		s = applyLevelRead(s, fpA, read(193), t);
		check("재검증 통과 후 곧바로 재사용", getReusableLevelRead(s, fpA, t) != null);
	}

	// (f) 재검증에서 값이 달라지면 즉시 재사용을 멈춥니다. (자기 치유)
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, fpA, read(192), 1000);
		s = applyLevelRead(s, fpA, read(192), 2000);
		check("사전 조건: 192가 재사용 중", getReusableLevelRead(s, fpA, 2000)?.value === 192);
		const t = 2000 + LEVEL_CACHE_REVALIDATE_MS;
		s = applyLevelRead(s, fpA, read(193), t); // 재검증에서 다른 값
		check("재검증에서 값이 바뀌면 재사용 중단", getReusableLevelRead(s, fpA, t) == null);
	}

	// (g) 실제 캡처 지문으로도 같은 흐름이 성립하는지 확인합니다.
	{
		let s = emptyLevelReadCache();
		s = applyLevelRead(s, base, read(193), 1000);
		s = applyLevelRead(s, base, read(193), 2000);
		// 노이즈가 섞인 프레임의 지문으로도 재사용이 되어야 합니다. (지문이 같으므로)
		const noisyFp = computeLevelRoiFingerprint(withNoise(roi, 10));
		check("노이즈 프레임에서도 재사용 성립", getReusableLevelRead(s, noisyFp, 2000)?.value === 193);
	}
}

console.log(failures === 0 ? "모든 자체 검증 통과" : `${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
