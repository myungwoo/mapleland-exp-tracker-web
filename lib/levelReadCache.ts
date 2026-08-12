import { levelRoiFingerprintEquals, type LevelRoiFingerprint } from "./levelRoiFingerprint";

/**
 * 레벨 판독 재사용 규칙 (순수 상태 기계)
 *
 * 레벨은 몇 시간에 한 번 바뀌는데 매 샘플(기본 1초) 인식을 돌리는 것은 낭비입니다.
 * ROI가 그대로면 인식 결과도 그대로이므로 앞 판독을 재사용합니다.
 *
 * 다만 **잘못 읽은 값이 고착되는 것**이 이 최적화의 유일한 실제 위험입니다.
 * 그래서 세 가지 규칙을 겁니다.
 *
 * 1. **성공만 캐시합니다.** 인식 실패는 캐시하지 않고 기존 캐시까지 버립니다.
 *    실패를 캐시하면 "한 번 못 읽은 ROI"가 계속 못 읽은 상태로 굳습니다.
 * 2. **같은 ROI에서 두 번 연속 같은 값이 나와야** 재사용 대상이 됩니다.
 * 3. 지문이 같아도 **일정 시간마다 반드시 다시 인식**합니다.
 *
 * 그리고 재사용의 근거는 지문입니다. 지문은 레벨 인식 파이프라인이 실제로 보는 마스크와
 * 같은 규칙으로 계산되므로(`lib/levelRoiFingerprint.ts`), 지문이 같다는 것은 입력이 같다는 뜻이고
 * 다시 인식해도 같은 결과가 나옵니다. 1픽셀이라도 다르면 지문이 달라져 그냥 다시 인식합니다.
 *
 * **이 캐시가 막아주지 못하는 것 (오해하지 마세요):**
 * 규칙 2와 3은 "같은 화면인데 판독이 흔들리는" 경우를 위한 것입니다. 인식기가 특정 화면을
 * **일관되게** 잘못 읽는 경우(예: 193을 항상 183으로)는 막지 못합니다. 두 번 읽어도 같은 값이
 * 나오니 확인을 통과하고, 재검증도 같은 값을 다시 확인할 뿐입니다.
 * (실측: tesseract는 같은 입력에 8/8 동일한 결과를 냅니다 — 결정적입니다)
 *
 * 다만 그 경우에도 **이 캐시가 상황을 악화시키지는 않습니다.** 캐시가 없어도 매 샘플 같은
 * 픽셀을 같은 인식기에 넣어 같은 틀린 값을 얻기 때문입니다. 즉 일관된 오인식은 캐시 문제가
 * 아니라 인식기 문제이고, 해결책도 인식기 쪽(픽셀 템플릿 매칭 전환)에 있습니다.
 *
 * React에 의존하지 않는 순수 함수로 둔 이유: 위 성질들을 그대로 테스트할 수 있어야 합니다.
 * (`tools/level-roi/selftest.mjs`)
 */

/** 지문과 함께 기억해 두는 레벨 판독 결과 */
export type LevelReadEntry = { fp: LevelRoiFingerprint; text: string; value: number };

export type LevelReadCacheState = {
	/** 두 번 연속 같은 값으로 확인된 판독. 재사용되는 것은 이것뿐입니다. */
	confirmed: LevelReadEntry | null;
	/** 아직 한 번만 본, 확인 전 판독 */
	pending: LevelReadEntry | null;
	/** 마지막으로 실제 인식을 돌린 시각 (epoch ms) */
	lastFullReadAt: number;
};

/**
 * 지문이 같아도 최소 이 주기마다는 실제로 다시 인식합니다.
 *
 * 왜 1분인가: 재사용을 건너뛰는 비용은 1분에 인식 한 번(측정 주기가 1초면 60번 중 1번)으로
 * 사실상 무료인데, 얻는 것은 "최악의 경우 틀린 레벨이 유지되는 시간 ≤ 1분"이라는 보장입니다.
 */
export const LEVEL_CACHE_REVALIDATE_MS = 60_000;

export function emptyLevelReadCache(): LevelReadCacheState {
	return { confirmed: null, pending: null, lastFullReadAt: 0 };
}

/**
 * 이번 틱에서 재사용할 수 있는 판독을 돌려줍니다. 재사용할 수 없으면 null입니다.
 *
 * `fp`가 null(지문을 만들 수 없는 상태 — 게임 창이 가려졌거나 ROI가 엉뚱한 곳을 보는 중)이면
 * 항상 null입니다. 애매할 때는 재사용하지 않는 쪽으로 실패합니다.
 */
export function getReusableLevelRead(
	state: LevelReadCacheState,
	fp: LevelRoiFingerprint | null,
	now: number
): LevelReadEntry | null {
	if (fp == null) return null;
	const { confirmed } = state;
	if (confirmed == null) return null;
	if (!levelRoiFingerprintEquals(confirmed.fp, fp)) return null;
	if (now - state.lastFullReadAt >= LEVEL_CACHE_REVALIDATE_MS) return null;
	return confirmed;
}

/**
 * 실제 인식을 돌린 결과를 반영한 새 상태를 돌려줍니다.
 *
 * `now`는 이 인식이 끝난 시각입니다. (재검증 주기의 기준점)
 */
export function applyLevelRead(
	state: LevelReadCacheState,
	fp: LevelRoiFingerprint | null,
	res: { text: string; value: number | null },
	now: number
): LevelReadCacheState {
	// 지문이 없거나 인식이 실패했으면 아무것도 기억하지 않습니다. (규칙 1)
	if (fp == null || res.value == null) {
		return { confirmed: null, pending: null, lastFullReadAt: now };
	}
	const entry: LevelReadEntry = { fp, text: res.text, value: res.value };

	// 주기적 재검증을 통과한 경우: 확인 상태를 그대로 유지합니다.
	const { confirmed } = state;
	if (confirmed && levelRoiFingerprintEquals(confirmed.fp, fp) && confirmed.value === res.value) {
		return { confirmed, pending: null, lastFullReadAt: now };
	}

	// 같은 ROI에서 두 번 연속 같은 값이 나왔습니다. 이제 재사용해도 됩니다. (규칙 2)
	const { pending } = state;
	if (pending && levelRoiFingerprintEquals(pending.fp, fp) && pending.value === res.value) {
		return { confirmed: entry, pending: null, lastFullReadAt: now };
	}

	// 처음 본 판독입니다. 아직 재사용하지 않습니다.
	return { confirmed: null, pending: entry, lastFullReadAt: now };
}
