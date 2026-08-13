/**
 * "다음 실행 시각(마감)"을 기억하는 반복 실행기
 *
 * ## 왜 setInterval을 그대로 쓰지 않는가
 *
 * 측정 루프의 타이머는 React effect가 소유하고, effect는 의존성이 하나라도 바뀌면
 * 정리(clearInterval) → 재시작(setInterval)됩니다. 그런데 `setInterval`을 다시 걸면
 * **경과 시간이 0으로 되돌아갑니다.**
 *
 * 측정 화면은 경과 시간 때문에 **최소 1초에 한 번 리렌더**됩니다. 그래서 타이머 재시작이
 * 렌더에 묶여 있으면 다음이 일어납니다.
 *
 * - 측정 주기 5초/10초: 타이머가 마감에 도달하기 전에 매초 리셋 → **샘플이 단 한 번도 실행되지 않음**
 * - 측정 주기 1초: 렌더 시점과 마감이 1초 간격으로 나란히 달리는 경합 → 샘플이 임의로 누락되고,
 *   한 번 밀리면 그 뒤 계속 렌더가 먼저 도착해 **영구히 굶습니다**
 *
 * 실제로 있었던 버그입니다: 경과 시간만 흘러가고 현재 경험치·누적·페이스가 영구히 멈추는데,
 * 인식은 실패한 게 아니라 **아예 돌지 않으므로** 화면에는 아무 경고도 뜨지 않습니다.
 * (설정 창의 ROI 실시간 판독은 별도 경로라 정상으로 보여서, 원인을 찾기가 더 어렵습니다)
 *
 * 그래서 이 구현은 주기가 아니라 **마감 시각**을 기억하고, 다시 걸릴 때 남은 시간만 기다립니다.
 * 재시작이 몇 번 일어나도 발화 시점은 그대로입니다. 즉 **재시작에 무해합니다.**
 *
 * ## 시계/타이머를 주입받는 이유
 *
 * 가상 시간으로 "재시작해도 굶지 않는다"는 성질을 그대로 검증할 수 있게 하려고입니다.
 * (`tools/interval-runner/selftest.mjs`)
 */

export type IntervalDeadline = {
	/** 정규화된 주기(ms) */
	intervalMs: number;
	/** 다음 실행 예정 시각 */
	dueAt: number;
};

export type FirePlan = IntervalDeadline & {
	/** 지금부터 기다려야 하는 시간 */
	delayMs: number;
	/** 앞서 정해둔 마감을 그대로 이어받았는지 (= 재시작이 발화를 미루지 않았는지) */
	keptDeadline: boolean;
};

/**
 * 주기 값 방어. 호출자 실수로 타이머가 폭주하거나 영원히 안 도는 것을 막습니다.
 *
 * 상한을 두지 않는 이유: 긴 주기 자체는 정상적인 선택입니다. (측정 주기 10초 등)
 */
function normalizeIntervalMs(intervalMs: number): number {
	if (!Number.isFinite(intervalMs)) return 1000;
	return Math.max(1, Math.floor(intervalMs));
}

/**
 * 타이머를 (다시) 걸 때의 마감과 대기 시간을 정합니다.
 *
 * 핵심 규칙: **같은 주기로 다시 걸면 앞서 정한 마감을 유지합니다.** 이게 재시작에 무해한 이유입니다.
 */
export function planFire(prev: IntervalDeadline | null, intervalMs: number, now: number): FirePlan {
	const period = normalizeIntervalMs(intervalMs);
	// 처음이거나 주기가 바뀌었으면 새로 셉니다. (측정 중 주기를 바꾸면 즉시 새 주기로 도는 게 맞습니다)
	if (!prev || prev.intervalMs !== period) {
		return { intervalMs: period, dueAt: now + period, delayMs: period, keptDeadline: false };
	}
	// 마감이 주기보다 멀다면 시계가 뒤로 점프한 경우입니다. 그대로 두면 그만큼 굶으므로 다시 셉니다.
	if (prev.dueAt > now + period) {
		return { intervalMs: period, dueAt: now + period, delayMs: period, keptDeadline: false };
	}
	// 이미 지난 마감이면 지체 없이(0ms) 실행합니다.
	return { intervalMs: period, dueAt: prev.dueAt, delayMs: Math.max(0, prev.dueAt - now), keptDeadline: true };
}

/**
 * 한 번 발화한 뒤의 다음 마감입니다.
 *
 * 마감에 주기를 더하는 방식이라 드리프트가 누적되지 않습니다. 다만 백그라운드 탭 스로틀링 등으로
 * 오래 밀렸다면 밀린 횟수만큼 몰아서 실행하지 않고 지금부터 다시 셉니다.
 * (측정은 "지금 화면"을 읽는 일이라 몰아치기가 무의미하고, CPU 스파이크만 만듭니다)
 */
export function planAfterFire(prev: IntervalDeadline, now: number): IntervalDeadline {
	const next = prev.dueAt + prev.intervalMs;
	if (next <= now) return { intervalMs: prev.intervalMs, dueAt: now + prev.intervalMs };
	return { intervalMs: prev.intervalMs, dueAt: next };
}

export type IntervalRunnerClock = {
	now: () => number;
	setTimeout: (fn: () => void, delayMs: number) => number;
	clearTimeout: (id: number) => void;
};

export type IntervalRunner = {
	/**
	 * 반복 실행을 시작합니다.
	 *
	 * **이미 같은 주기로 돌고 있으면 마감을 유지하고 콜백만 갱신합니다.** 그래서 여러 번 불러도
	 * 발화가 미뤄지지 않습니다.
	 */
	start: (intervalMs: number, run: () => void) => void;
	/** 반복을 멈추고 마감을 버립니다. 다음 start는 처음부터 셉니다. */
	stop: () => void;
	/** 지금 예약된 발화 시각. (없으면 null) 테스트·디버깅용입니다. */
	dueAt: () => number | null;
};

export function createIntervalRunner(clock: IntervalRunnerClock): IntervalRunner {
	let timerId: number | null = null;
	let deadline: IntervalDeadline | null = null;
	let run: (() => void) | null = null;

	const clearTimer = () => {
		if (timerId != null) {
			clock.clearTimeout(timerId);
			timerId = null;
		}
	};

	const arm = (delayMs: number) => {
		clearTimer();
		timerId = clock.setTimeout(onFire, delayMs);
	};

	const onFire = () => {
		timerId = null;
		if (!deadline) return;
		// 다음 발화를 **먼저** 예약합니다. 콜백이 오래 걸리거나 예외를 던져도 주기가 무너지지 않게.
		deadline = planAfterFire(deadline, clock.now());
		arm(Math.max(0, deadline.dueAt - clock.now()));
		run?.();
	};

	return {
		start(intervalMs: number, nextRun: () => void) {
			// 콜백은 항상 최신으로 갈아끼웁니다. (마감을 유지하면서도 최신 설정이 반영되어야 합니다)
			run = nextRun;
			const plan = planFire(deadline, intervalMs, clock.now());
			deadline = { intervalMs: plan.intervalMs, dueAt: plan.dueAt };
			// 마감을 그대로 이어받았고 타이머가 이미 걸려 있으면 건드리지 않습니다.
			if (plan.keptDeadline && timerId != null) return;
			arm(plan.delayMs);
		},
		stop() {
			clearTimer();
			deadline = null;
			run = null;
		},
		dueAt() {
			return deadline?.dueAt ?? null;
		}
	};
}

/**
 * 브라우저 타이머 구현.
 *
 * `window`를 호출 시점에만 만지는 이유: SSR 단계에서 이 모듈을 import해도 안전해야 합니다.
 */
export const browserIntervalClock: IntervalRunnerClock = {
	now: () => Date.now(),
	setTimeout: (fn, delayMs) => window.setTimeout(fn, delayMs),
	clearTimeout: (id) => window.clearTimeout(id)
};
