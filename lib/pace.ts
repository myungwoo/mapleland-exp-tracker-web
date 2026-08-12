export type PaceValues = { pct: number; val: number };

/**
 * 누적 획득량을 임의의 기준 시간(windowMin)으로 비례 환산합니다.
 *
 *   pace = cumulative * (windowMin * 60) / durationSec
 *
 * - durationMs를 인자로 받는 이유: 경험치 쿠폰 보정처럼 "실제 경과 시간"이 아닌
 *   보정된 시간으로도 같은 계산을 재사용하기 위함입니다.
 */
export function paceForDuration(args: {
	cumExpValue: number;
	cumExpPct: number;
	durationMs: number;
	windowMin: number;
}): PaceValues {
	const durationSec = Math.max(0, Math.floor(args.durationMs / 1000));
	if (durationSec <= 0) return { pct: 0, val: 0 };
	const factor = (args.windowMin * 60) / durationSec;
	return {
		pct: args.cumExpPct * factor,
		val: args.cumExpValue * factor
	};
}
