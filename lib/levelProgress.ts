import { requiredExpForLevel, type ExpTable } from "@/lib/expTable";

export type LevelUpEta = {
	/** 현재 레벨 */
	level: number;
	/** 도달할 다음 레벨 */
	nextLevel: number;
	/** 현재 레벨을 채우는 데 필요한 총 EXP */
	requiredExp: number;
	/** 레벨업까지 남은 EXP */
	remainingExp: number;
	/** 레벨업까지 남은 퍼센트(%p) */
	remainingPct: number;
	/** 남은 시간(ms). 실측 속도를 구할 수 없으면 null */
	etaMs: number | null;
};

/**
 * "레벨업까지 얼마나 남았는지"를 계산합니다.
 *
 * - 남은 EXP는 퍼센트가 아니라 **절대 EXP 값**에서 뺍니다. 퍼센트는 게임이 소수점 둘째 자리까지만
 *   보여줘서, 레벨 후반의 큰 수(수억)에서는 반올림 오차가 수백만 EXP까지 벌어집니다.
 * - 속도는 이번 측정의 전체 평균(누적 EXP / 경과 시간)을 씁니다. 경험치 쿠폰 보정을 쓰지 않는 이유는,
 *   쿠폰 보정은 "이 사냥터가 실제로 얼마나 좋은가"를 돌아보는 지표이고, 여기서 필요한 건
 *   "지금 이 속도로 계속 하면 언제 레벨업하는가"라는 예측이기 때문입니다.
 *
 * 계산할 수 없으면 null을 돌려줍니다. (레벨/EXP를 아직 못 읽었거나, 다음 레벨이 테이블에 없는 만렙)
 */
export function computeLevelUpEta(args: {
	table: ExpTable;
	level: number | null;
	currentExpValue: number | null;
	cumExpValue: number;
	elapsedMs: number;
}): LevelUpEta | null {
	const { table, level, currentExpValue, cumExpValue, elapsedMs } = args;
	if (level == null || !Number.isFinite(level)) return null;
	if (currentExpValue == null || !Number.isFinite(currentExpValue)) return null;

	const requiredExp = requiredExpForLevel(table, level);
	if (requiredExp == null || requiredExp <= 0) return null;
	// 다음 레벨이 테이블에 없으면(만렙) 보여줄 목표가 없습니다.
	if (requiredExpForLevel(table, level + 1) == null) return null;

	const remainingExp = Math.max(0, requiredExp - currentExpValue);
	const remainingPct = (remainingExp / requiredExp) * 100;

	// 속도를 신뢰할 수 있을 만큼 측정이 쌓였을 때만 시간을 계산합니다.
	// (1초 미만이거나 아직 한 톨도 못 얻었으면 나눗셈이 발산합니다)
	const expPerMs = elapsedMs >= 1000 && cumExpValue > 0 ? cumExpValue / elapsedMs : 0;
	const etaMs = expPerMs > 0 ? Math.round(remainingExp / expPerMs) : null;

	return {
		level,
		nextLevel: level + 1,
		requiredExp,
		remainingExp,
		remainingPct,
		etaMs
	};
}
