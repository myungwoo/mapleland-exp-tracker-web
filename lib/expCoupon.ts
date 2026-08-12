import { paceForDuration, type PaceValues } from "@/lib/pace";

/** 경험치 쿠폰(경쿠) 1개의 지속 시간(분). */
export const EXP_COUPON_MINUTES = 15;
/** 경험치 쿠폰 1개의 지속 시간(ms). */
export const EXP_COUPON_MS = EXP_COUPON_MINUTES * 60 * 1000;

/** 입력값(문자열/실수/음수 등)을 쿠폰 개수로 안전하게 정규화합니다. */
export function normalizeCouponCount(input: unknown): number {
	const n = typeof input === "number" ? input : Number.parseInt(String(input ?? ""), 10);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(999, Math.floor(n)));
}

/**
 * 경험치 쿠폰(2배 경험치)을 사용한 구간은 같은 시간 동안 두 배의 경험치를 주므로,
 * "쿠폰 없이 사냥했다면 걸렸을 시간"은 쿠폰 지속 시간만큼 더 길어집니다.
 *
 * 예) 사냥 시간 1시간 1분 15초 + 쿠폰 2개 -> 1시간 31분 15초
 */
export function couponAdjustedElapsedMs(elapsedMs: number, couponCount: number): number {
	const count = normalizeCouponCount(couponCount);
	const base = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	return base + count * EXP_COUPON_MS;
}

/** 쿠폰 보정된 시간을 기준으로 계산한 "실제 사냥터 효율" 페이스입니다. */
export function couponAdjustedPace(args: {
	cumExpValue: number;
	cumExpPct: number;
	elapsedMs: number;
	couponCount: number;
	windowMin: number;
}): PaceValues {
	return paceForDuration({
		cumExpValue: args.cumExpValue,
		cumExpPct: args.cumExpPct,
		durationMs: couponAdjustedElapsedMs(args.elapsedMs, args.couponCount),
		windowMin: args.windowMin
	});
}
