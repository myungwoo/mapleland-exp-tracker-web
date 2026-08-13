import { useEffect, useRef } from "react";
import { browserIntervalClock, createIntervalRunner, type IntervalRunner } from "@/lib/intervalRunner";

type Options = {
	/**
	 * 실행 주기(ms). `null`이면 돌지 않습니다.
	 *
	 * **원시값만 받는 것이 이 훅의 핵심입니다.** 아래 effect의 의존성이 원시값 하나뿐이라
	 * 렌더가 몇 번 일어나도 타이머가 다시 걸리지 않습니다. 예전에는 호출자가 effect를 직접 들고
	 * `{ start, stop }` 객체를 의존성에 넣었는데, 그 객체가 렌더마다 새로 만들어져서
	 * **매 렌더 타이머가 리셋됐습니다.** 측정 화면은 경과 시간 때문에 최소 1초에 한 번 리렌더되므로,
	 * 주기가 1초보다 길면 샘플이 단 한 번도 실행되지 않았습니다. (자세한 근거는 `lib/intervalRunner.ts`)
	 */
	intervalMs: number | null;
	/**
	 * 매 주기 실행할 함수. 렌더마다 새로 만들어져도 됩니다. (ref로 최신 것을 호출합니다)
	 *
	 * 왜 ref인가: 측정 중에 바꾼 ROI·검증 설정이 즉시 반영되어야 하는데, 콜백을 의존성에 넣으면
	 * 위의 "매 렌더 리셋" 문제가 그대로 돌아옵니다.
	 */
	run: () => void;
};

/**
 * 주기 실행을 선언적으로 관리하는 훅입니다.
 *
 * - 왜 훅이 타이머를 소유하는가: 호출자가 effect를 직접 들고 있으면 의존성 실수 하나로
 *   측정 루프가 조용히 죽습니다. (실제로 있었던 버그) 소유권을 여기로 모아 그 실수를 봉쇄합니다.
 * - 재시작에도 마감이 유지되므로(`lib/intervalRunner.ts`), 혹시 다시 걸리더라도 굶지 않습니다.
 */
export function useIntervalRunner(options: Options) {
	const { intervalMs, run } = options;

	const runnerRef = useRef<IntervalRunner | null>(null);
	// SSR에서 타이머를 만들지 않도록 지연 생성합니다. (팩토리 자체는 window를 만지지 않습니다)
	if (!runnerRef.current) runnerRef.current = createIntervalRunner(browserIntervalClock);
	const runner = runnerRef.current;

	const runRef = useRef(run);
	useEffect(() => {
		runRef.current = run;
	}, [run]);

	useEffect(() => {
		if (intervalMs == null) {
			runner.stop();
			return;
		}
		runner.start(intervalMs, () => {
			runRef.current();
		});
		return () => {
			runner.stop();
		};
	}, [intervalMs, runner]);

	// 언마운트 시 확실히 정리합니다. (위 effect가 이미 정리하지만, 방어적으로 한 번 더)
	useEffect(() => {
		return () => {
			runner.stop();
		};
	}, [runner]);

	/**
	 * 호출자에게는 `stop`만 노출합니다.
	 *
	 * 왜 stop이 필요한가: 일시정지는 "상태를 고정한 뒤 마지막 샘플 1회"라서, 상태 갱신(=다음 렌더)을
	 * 기다리지 않고 그 자리에서 타이머를 끊어야 합니다. 그 사이에 다음 틱이 끼면 안 됩니다.
	 * 단, stop 이후 루프를 되살리는 것은 `intervalMs`뿐입니다. (stop만 부르고 주기를 그대로 두면 멈춰 있습니다)
	 *
	 * 왜 객체를 ref에 담아 고정하는가: 이 객체가 렌더마다 새로 만들어지면 호출자의 의존성 배열을 통해
	 * "매 렌더 재실행"이 다시 번질 수 있습니다. 이 훅이 막으려던 바로 그 문제입니다.
	 */
	const apiRef = useRef<{ stop: () => void } | null>(null);
	if (!apiRef.current) apiRef.current = { stop: () => runnerRef.current?.stop() };
	return apiRef.current;
}
