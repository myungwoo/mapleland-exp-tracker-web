/**
 * 레벨 ROI "변화 감지" 지문
 *
 * 왜 필요한가:
 * 레벨은 몇 시간에 한 번 바뀌는데 매 샘플(기본 1초)마다 인식을 돌리고 있었습니다.
 * ROI가 그대로면 인식 결과도 그대로이므로, 값이 바뀔 수 있는 경우에만 인식하면 됩니다.
 *
 * 왜 "원본 픽셀 해시"가 아니라 "마스크 해시"인가:
 * 캡처는 화면 공유(영상 인코딩) 경로를 타므로 원본 픽셀값에는 미세한 노이즈가 섞입니다.
 * 원본 픽셀을 그대로 해시하면 매 프레임 지문이 달라져서 변화 감지가 아무 의미가 없어집니다.
 * 반면 레벨 숫자는 흰/크림색(채도 낮고 밝음)이고 배경은 오렌지 타일(채도 매우 높음) / 어두운 UI라서,
 * **전경 판정을 통과하는지 여부**는 노이즈에 매우 둔감합니다.
 * (실측: 실제 캡처 ROI에 채널당 ±15 균등 노이즈를 200회 넣어도 마스크가 단 1픽셀도 바뀌지 않았습니다.
 *  ±30에서야 평균 2픽셀 정도가 흔들립니다. 화면 공유로 잡은 단색 UI 영역의 노이즈는 이보다 훨씬 작습니다)
 *
 * 왜 하필 "이" 마스크인가 — 이 부분이 안전성의 핵심입니다:
 * 지문은 `lib/levelPixelRecognizer.ts`의 인식기가 실제로 보는 전경 판정(`isLevelGlyphPixel`)과
 * **완전히 같은 규칙**으로 계산합니다. 그래서 지문이 같다는 것은 "레벨 인식 파이프라인에 들어가는
 * 입력이 같다"는 뜻이고, 인식은 결정적이므로 **다시 인식해도 반드시 같은 결과가 나옵니다.**
 * 즉 이 캐시는 동작을 바꾸는 최적화가 아니라 순수한 메모이제이션입니다.
 * 반대로 1픽셀이라도 마스크가 달라지면 지문이 달라져서 그냥 다시 인식합니다.
 * (그래서 "처음엔 잘못 읽었는데 다음 프레임에선 제대로 읽히는" 경우가 캐시 때문에 막히지 않습니다)
 *
 * 이 파일은 일부러 import가 없습니다. DOM 없이 Node에서 그대로 자체 검증할 수 있어야 하기 때문입니다.
 * (`tools/level-roi/selftest.mjs`)
 */

/** 캔버스 대신 ImageData를 직접 받을 수 있게 덕 타이핑으로 판별합니다. (Node 테스트에서도 그대로 쓰기 위함) */
export type RgbaImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type LevelRoiFingerprint = {
	/** ROI 크기. 사용자가 ROI를 다시 지정하면 여기서 바로 갈립니다. */
	w: number;
	h: number;
	/** 전경 픽셀 수. 해시 충돌에 대한 값싼 2차 방어선입니다. */
	fgCount: number;
	/** 마스크 비트를 두 가지 방식으로 해시한 값 (사실상 64비트) */
	hashA: number;
	hashB: number;
};

/**
 * 레벨 글자(오렌지 타일 위 흰 숫자) 전경 판정.
 *
 * `lib/levelPixelRecognizer.ts`의 인식기와 이 지문이 **같은 규칙을 써야** 위에 적은
 * "지문이 같으면 결과도 같다"가 성립합니다. 그래서 규칙을 이 한 곳에만 두고 양쪽이 함께 import합니다.
 * (양쪽에 따로 적어두면 한쪽만 고쳐져서 캐시가 조용히 틀린 값을 서빙하게 됩니다)
 */
export function isLevelGlyphPixel(r: number, g: number, b: number): boolean {
	const maxc = Math.max(r, g, b);
	const minc = Math.min(r, g, b);
	// 밝고(밝기 높음) 채도 낮은(거의 흰색) 픽셀만 글자로 봅니다.
	return maxc - minc <= 80 && (r + g + b) / 3 >= 130;
}

/**
 * ROI의 전경 마스크로부터 지문을 만듭니다.
 *
 * 전경이 아예 없거나 화면 대부분이 전경이면 `null`을 돌려줍니다.
 * (게임 창이 가려졌거나 ROI가 엉뚱한 곳을 보고 있는 상태 — 이럴 때는 캐시를 쓰지도, 만들지도 않습니다)
 */
export function computeLevelRoiFingerprint(img: RgbaImage): LevelRoiFingerprint | null {
	const { width: w, height: h, data } = img;
	if (w <= 0 || h <= 0) return null;
	const n = w * h;

	// FNV-1a(32bit)와 djb2-xor를 나란히 돌립니다.
	// 왜 두 개인가: 한 개(32비트)면 "마스크가 바뀌었는데 지문이 같은" 충돌 확률이
	// 장시간(수 시간) 측정에서 무시하기 어려워집니다. 두 레인을 쓰면 사실상 64비트가 됩니다.
	let hashA = 0x811c9dc5 ^ w ^ (h << 16);
	let hashB = 5381 ^ w ^ (h << 16);
	const mix = (byte: number) => {
		hashA = Math.imul(hashA ^ byte, 16777619);
		hashB = (Math.imul(hashB, 33) ^ byte) | 0;
	};

	let fgCount = 0;
	let acc = 0;
	let bits = 0;
	for (let p = 0, i = 0; p < n; p++, i += 4) {
		const fg = isLevelGlyphPixel(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
		fgCount += fg;
		// 위치에 민감해야 하므로 비트를 순서대로 바이트에 눌러 담아 해시합니다.
		acc = (acc << 1) | fg;
		if (++bits === 8) {
			mix(acc);
			acc = 0;
			bits = 0;
		}
	}
	if (bits > 0) mix(acc << (8 - bits));

	if (fgCount === 0 || fgCount > n * 0.8) return null;
	return { w, h, fgCount, hashA: hashA >>> 0, hashB: hashB >>> 0 };
}

export function levelRoiFingerprintEquals(
	a: LevelRoiFingerprint | null | undefined,
	b: LevelRoiFingerprint | null | undefined
): boolean {
	if (a == null || b == null) return false;
	return a.w === b.w && a.h === b.h && a.fgCount === b.fgCount && a.hashA === b.hashA && a.hashB === b.hashB;
}
