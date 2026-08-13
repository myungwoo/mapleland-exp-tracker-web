#!/usr/bin/env node
/**
 * 측정 루프 타이머(마감 유지 반복 실행기) 자체 검증
 *
 *   node tools/interval-runner/selftest.mjs
 *
 * 이 테스트가 지키는 성질:
 * - **재시작에 무해하다**: 렌더마다 start()를 다시 불러도 발화가 미뤄지지 않는다
 * - 주기를 바꾸면 즉시 새 주기로 돈다
 * - stop 이후에는 돌지 않고, 다시 start하면 처음부터 센다
 * - 드리프트가 누적되지 않고, 오래 밀려도 몰아치기하지 않는다
 * - 콜백이 예외를 던져도 다음 발화가 살아 있다
 *
 * 왜 이 테스트가 중요한가:
 * 실제로 있었던 버그가 정확히 "재시작이 발화를 굶기는 것"이었습니다. 측정 화면은 경과 시간 때문에
 * 최소 1초에 한 번 리렌더되는데, 타이머가 렌더마다 다시 걸리면 주기가 1초보다 긴 측정(5초/10초)은
 * **샘플이 단 한 번도 실행되지 않습니다.** 그런데 인식이 실패한 게 아니라 아예 돌지 않기 때문에
 * 화면에는 경고가 뜨지 않고, 경과 시간만 흐르면서 경험치·페이스가 영구히 멈춥니다.
 * 아래 `굶주림` 테스트는 옛 구현(매번 다시 걸기)과 새 구현을 같은 조건에서 나란히 돌려 비교합니다.
 */
import { loadLibModules } from "../pixel-font/loadLib.mjs";

const { createIntervalRunner, planFire, planAfterFire } = await loadLibModules(["intervalRunner"], "intervalRunner");

let failures = 0;
const check = (name, ok, extra = "") => {
	if (!ok) {
		failures++;
		console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
	}
};

/**
 * 가상 시계. 실제 시간을 기다리지 않고 타이머 순서를 그대로 재현합니다.
 *
 * 같은 시각에 만기된 타이머는 등록 순서대로 실행합니다. (브라우저 규칙)
 * 콜백 예외는 삼킵니다 — 브라우저에서도 한 타이머의 예외가 다른 타이머를 취소하지 않습니다.
 */
function createVirtualClock() {
	let now = 0;
	let seq = 0;
	const timers = new Map();
	const clock = {
		now: () => now,
		setTimeout: (fn, delayMs) => {
			const id = ++seq;
			timers.set(id, { dueAt: now + Math.max(0, delayMs), fn, order: id });
			return id;
		},
		clearTimeout: (id) => {
			timers.delete(id);
		}
	};
	const advanceTo = (target) => {
		for (;;) {
			let pick = null;
			for (const [id, t] of timers) {
				if (t.dueAt > target) continue;
				if (!pick || t.dueAt < pick.t.dueAt || (t.dueAt === pick.t.dueAt && t.order < pick.t.order)) {
					pick = { id, t };
				}
			}
			if (!pick) break;
			now = pick.t.dueAt;
			timers.delete(pick.id);
			try {
				pick.t.fn();
			} catch {
				// 타이머 콜백의 예외는 다른 타이머에 영향을 주지 않습니다.
			}
		}
		now = target;
	};
	return { clock, advanceTo, at: () => now, pending: () => timers.size };
}

/**
 * 옛 구현: start()마다 타이머를 처음부터 다시 겁니다. (= setInterval을 다시 거는 것과 같음)
 *
 * 회귀 비교용으로만 씁니다. 이 동작이 버그의 원인이었습니다.
 */
function createNaiveRunner(clock) {
	let id = null;
	let period = 0;
	let run = null;
	const arm = () => {
		if (id != null) clock.clearTimeout(id);
		id = clock.setTimeout(() => {
			run?.();
			arm();
		}, period);
	};
	return {
		start(intervalMs, nextRun) {
			period = intervalMs;
			run = nextRun;
			arm();
		},
		stop() {
			if (id != null) clock.clearTimeout(id);
			id = null;
		}
	};
}

/**
 * "측정 중" 시나리오를 돌립니다.
 *
 * @param runner 검사할 실행기
 * @param opts.periodMs 측정 주기
 * @param opts.renderEveryMs 리렌더 주기 (경과 시간 표시가 1초마다 렌더를 만듭니다)
 * @param opts.renderOffsetMs 렌더가 발화 직후에 오도록 하는 오프셋 (굶주림에 가장 불리한 배치)
 * @param opts.durationMs 총 실행 시간
 */
function runSamplingScenario(clock, advanceTo, runner, opts) {
	const { periodMs, renderEveryMs, renderOffsetMs = 2, durationMs } = opts;
	const fires = [];
	const startLoop = () => runner.start(periodMs, () => fires.push(clock.now()));
	// 측정 시작 직후의 첫 렌더에서 루프가 걸립니다.
	advanceTo(renderOffsetMs);
	startLoop();
	for (let t = renderEveryMs; t <= durationMs; t += renderEveryMs) {
		// 스톱워치가 매초 경과 시간을 갱신 → 리렌더 → effect 재실행(= start 재호출)
		advanceTo(t + renderOffsetMs);
		startLoop();
	}
	advanceTo(durationMs);
	return fires;
}

// 1) 기본 동작: 주기만큼 뒤에 발화하고 계속 반복한다
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const fires = [];
	runner.start(1000, () => fires.push(clock.now()));
	advanceTo(3500);
	check("기본 발화 시각", JSON.stringify(fires) === JSON.stringify([1000, 2000, 3000]), JSON.stringify(fires));
	runner.stop();
}

// 2) ⭐ 핵심 회귀: 렌더마다 다시 걸어도 굶지 않는다 (측정 주기 5초 + 1초마다 렌더)
{
	const naive = createVirtualClock();
	const naiveFires = runSamplingScenario(naive.clock, naive.advanceTo, createNaiveRunner(naive.clock), {
		periodMs: 5000,
		renderEveryMs: 1000,
		durationMs: 30_000
	});
	check("옛 구현은 굶는다(버그 재현)", naiveFires.length === 0, `발화 ${naiveFires.length}회`);

	const fixed = createVirtualClock();
	const runner = createIntervalRunner(fixed.clock);
	const fires = runSamplingScenario(fixed.clock, fixed.advanceTo, runner, {
		periodMs: 5000,
		renderEveryMs: 1000,
		durationMs: 30_000
	});
	// 2ms 오프셋에서 시작했으므로 5002, 10002, ... 6회
	check("새 구현은 5초 주기를 지킨다", fires.length === 6, `발화 ${fires.length}회: ${fires}`);
	check(
		"새 구현의 발화 간격이 정확히 주기와 같다",
		fires.every((t, i) => (i === 0 ? t === 5002 : t - fires[i - 1] === 5000)),
		JSON.stringify(fires)
	);
	runner.stop();
}

// 3) 측정 주기 1초 + 매초 렌더: 실제 기본 설정에서도 매 초 정확히 한 번 발화한다
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const fires = runSamplingScenario(clock, advanceTo, runner, {
		periodMs: 1000,
		renderEveryMs: 1000,
		durationMs: 60_000
	});
	check("1초 주기 60초 동안 60회 발화", fires.length === 60, `발화 ${fires.length}회`);
	runner.stop();
}

// 4) 주기를 바꾸면 즉시 새 주기로 다시 센다
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const fires = [];
	const cb = () => fires.push(clock.now());
	runner.start(10_000, cb);
	advanceTo(3000);
	runner.start(1000, cb); // 사용자가 측정 주기를 10초 → 1초로 변경
	advanceTo(5500);
	check("주기 변경 후 새 주기로 발화", JSON.stringify(fires) === JSON.stringify([4000, 5000]), JSON.stringify(fires));
	runner.stop();
}

// 5) stop 이후에는 돌지 않고, 다시 start하면 처음부터 센다
{
	const { clock, advanceTo, pending } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const fires = [];
	const cb = () => fires.push(clock.now());
	runner.start(1000, cb);
	advanceTo(1500);
	runner.stop();
	advanceTo(9000);
	check("stop 이후 발화 없음", fires.length === 1, JSON.stringify(fires));
	// 타이머를 남겨두면 장시간 실행에서 조용히 새는 경로가 됩니다.
	check("stop 이후 예약된 타이머 없음", pending() === 0, `남은 타이머 ${pending()}개`);
	runner.start(1000, cb);
	advanceTo(10_500);
	// 재개는 마감을 물려받지 않습니다. (일시정지 중의 지연을 소급 적용하면 안 됩니다)
	check("재개는 처음부터 센다", fires.length === 2 && fires[1] === 10_000, JSON.stringify(fires));
	runner.stop();
}

// 6) 콜백을 갈아끼워도 마감은 유지된다 (측정 중 설정 변경이 즉시 반영되어야 함)
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const seen = [];
	runner.start(1000, () => seen.push("old"));
	advanceTo(500);
	runner.start(1000, () => seen.push("new"));
	advanceTo(1200);
	check("최신 콜백이 실행된다", JSON.stringify(seen) === JSON.stringify(["new"]), JSON.stringify(seen));
	check("마감은 유지된다(500ms에 다시 걸어도 1000ms에 발화)", runner.dueAt() === 2000, String(runner.dueAt()));
	runner.stop();
}

// 7) 콜백 예외가 다음 발화를 막지 않는다
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	let calls = 0;
	runner.start(1000, () => {
		calls++;
		throw new Error("boom");
	});
	advanceTo(3500);
	check("예외에도 계속 발화", calls === 3, `호출 ${calls}회`);
	runner.stop();
}

// 8) 마감 계산 규칙 (순수 함수)
{
	check("처음 걸면 now + 주기", planFire(null, 1000, 500).dueAt === 1500);
	const kept = planFire({ intervalMs: 1000, dueAt: 1500 }, 1000, 900);
	check("같은 주기면 마감 유지", kept.keptDeadline && kept.dueAt === 1500 && kept.delayMs === 600);
	const changed = planFire({ intervalMs: 1000, dueAt: 1500 }, 5000, 900);
	check("주기가 바뀌면 새 마감", !changed.keptDeadline && changed.dueAt === 5900);
	const overdue = planFire({ intervalMs: 1000, dueAt: 1500 }, 1000, 2400);
	check("마감이 지났으면 지체 없이", overdue.delayMs === 0 && overdue.dueAt === 1500);
	// 시계가 뒤로 점프하면(마감이 주기보다 멀어지면) 그만큼 굶으므로 다시 셉니다.
	const jumped = planFire({ intervalMs: 1000, dueAt: 60_000 }, 1000, 500);
	check("시계 역행 방어", !jumped.keptDeadline && jumped.dueAt === 1500);
	check("주기 방어(0 이하)", planFire(null, 0, 0).intervalMs === 1);
	check("주기 방어(NaN)", planFire(null, Number.NaN, 0).intervalMs === 1000);

	check("발화 후 드리프트 누적 없음", planAfterFire({ intervalMs: 1000, dueAt: 1000 }, 1003).dueAt === 2000);
	// 백그라운드 탭 스로틀링 등으로 오래 밀렸다면 몰아치지 않고 지금부터 다시 셉니다.
	check("오래 밀렸으면 몰아치기 없음", planAfterFire({ intervalMs: 1000, dueAt: 1000 }, 30_000).dueAt === 31_000);
}

// 9) 장시간(3시간) 실행에서도 발화 횟수가 어긋나지 않는다
{
	const { clock, advanceTo } = createVirtualClock();
	const runner = createIntervalRunner(clock);
	const threeHours = 3 * 60 * 60 * 1000;
	const fires = runSamplingScenario(clock, advanceTo, runner, {
		periodMs: 1000,
		renderEveryMs: 1000,
		durationMs: threeHours
	});
	check("3시간 동안 초당 1회", fires.length === threeHours / 1000, `발화 ${fires.length}회`);
	runner.stop();
}

if (failures > 0) {
	console.log(`\n${failures}개 실패`);
	process.exit(1);
}
console.log("OK: 측정 루프 타이머 자체 검증 통과");
