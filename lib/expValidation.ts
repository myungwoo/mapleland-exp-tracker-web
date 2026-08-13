import { requiredExpForLevel, type ExpTable } from "@/lib/expTable";

/** pass=정합, fail=불일치, unavailable=판정에 필요한 값이 없음 */
export type ExpValidationStatus = "pass" | "fail" | "unavailable";

export type ExpValidationResult = {
	/** 검증 옵션이 켜져 있는지 */
	enabled: boolean;
	status: ExpValidationStatus;
	/** EXP 테이블 기준으로 계산한 퍼센트 (레벨/EXP 값이 모두 있을 때) */
	expectedPercent: number | null;
	/** 해당 레벨에서 100%까지 필요한 EXP */
	requiredExp: number | null;
};

/**
 * 인식된 EXP 값이 그 레벨에서 나올 수 있는 범위인지.
 *
 * 1.05를 곱해 두는 이유: 값 자체는 절대치라 거의 정확하지만, 게임이 100%를 살짝 넘긴 상태를
 * 잠깐 보여주는 순간이 있어서 딱 req로 자르면 정상 샘플을 버리게 됩니다.
 */
const VALUE_OVERFLOW_TOLERANCE = 1.05;

/**
 * 테이블에서 계산한 퍼센트와 인식한 퍼센트의 허용 오차(%p).
 *
 * 게임이 퍼센트를 소수점 둘째 자리까지만 보여줘서 값↔퍼센트가 원래도 조금 어긋나고,
 * 퍼센트 쪽이 자릿수가 적어 한 글자만 잘못 읽혀도 크게 튑니다. 그래서 값 기준보다 넉넉히 둡니다.
 */
const PERCENT_TOLERANCE_POINTS = 2.5;

/**
 * EXP_TABLE("해당 레벨에서 0% → 100%까지 필요한 EXP")로 인식 결과를 상식선에서 검증합니다.
 *
 * ⚠️ 이 판정이 측정 로직(`useSampling`)과 설정 창의 표시(`useRoiReadPreview`) 양쪽의 **유일한**
 * 기준이어야 합니다. 한쪽에만 규칙을 복사해 두면, 설정 창에서는 "통과"인데 실제로는 버려지는
 * (또는 그 반대인) 상황이 조용히 생깁니다.
 */
export function isPercentValueConsistent(
	table: ExpTable,
	level: number,
	expValue: number,
	expPercent: number
): boolean {
	const req = requiredExpForLevel(table, level);
	if (req == null || req <= 0) return true; // 검증 불가(테이블 없음)면 막지 않습니다.
	// expValue는 [0, req] 범위여야 자연스럽습니다. (약간의 인식 노이즈/반올림 오차 허용)
	if (expValue < 0) return false;
	if (expValue > req * VALUE_OVERFLOW_TOLERANCE) return false;
	const pctFromValue = (expValue / req) * 100;
	if (!Number.isFinite(pctFromValue)) return false;
	// 퍼센트 인식이 상대적으로 더 흔들리는 편이라, 어느 정도 오차 범위를 허용합니다.
	return Math.abs(pctFromValue - expPercent) <= PERCENT_TOLERANCE_POINTS;
}

/**
 * 검증 결과 + "왜 그런 판정이 나왔는지".
 *
 * 실제 판정(`isPercentValueConsistent`)을 그대로 재사용하되, 테이블 기준 퍼센트도 같이 돌려줍니다.
 * (인식 자체는 멀쩡한데 레벨을 잘못 읽어서 걸리는 경우가 실제로 흔합니다)
 */
export function describeExpValidation(args: {
	table: ExpTable;
	enabled: boolean;
	level: number | null;
	expValue: number | null;
	expPercent: number | null;
}): ExpValidationResult {
	const { table, enabled, level, expValue, expPercent } = args;
	if (level == null || expValue == null || expPercent == null) {
		return { enabled, status: "unavailable", expectedPercent: null, requiredExp: null };
	}
	const req = requiredExpForLevel(table, level);
	const expectedPercent = req != null && req > 0 ? (expValue / req) * 100 : null;
	const ok = isPercentValueConsistent(table, level, expValue, expPercent);
	return {
		enabled,
		status: ok ? "pass" : "fail",
		expectedPercent: expectedPercent != null && Number.isFinite(expectedPercent) ? expectedPercent : null,
		requiredExp: req ?? null
	};
}
