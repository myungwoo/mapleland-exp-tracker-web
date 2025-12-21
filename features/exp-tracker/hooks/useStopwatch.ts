import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 경과 시간(초 단위 UI 갱신)과 “일시정지 후 재개”를 위한 baseElapsedMs를 함께 관리합니다.
 *
 * - 왜: ExpTracker 안에서 startAtRef/clockRef/baseElapsedMs가 섞여 있으면
 *   샘플링 로직과 시간 로직이 얽혀서 수정이 어려워집니다.
 */
export function useStopwatch() {
	const [elapsedMs, setElapsedMs] = useState(0);
	const [baseElapsedMs, setBaseElapsedMs] = useState(0);

	const startAtRef = useRef<number | null>(null);
	const clockRef = useRef<number | null>(null);
	const elapsedRef = useRef<number>(0);

	useEffect(() => {
		elapsedRef.current = elapsedMs;
	}, [elapsedMs]);

	const stopClock = useCallback(() => {
		if (clockRef.current != null) {
			window.clearInterval(clockRef.current);
			clockRef.current = null;
		}
	}, []);

	const start = useCallback(() => {
		// 기존 타이머가 있으면 먼저 정리합니다.
		stopClock();

		startAtRef.current = Date.now() - baseElapsedMs;
		// 즉시 1회 갱신해서 “시작 버튼 누른 직후”도 자연스럽게 보이게 합니다.
		if (startAtRef.current != null) {
			setElapsedMs(Date.now() - startAtRef.current);
		}
		clockRef.current = window.setInterval(() => {
			const startAt = startAtRef.current;
			if (startAt == null) return;
			setElapsedMs(Date.now() - startAt);
		}, 1000) as unknown as number;
	}, [baseElapsedMs, stopClock]);

	const pause = useCallback(() => {
		stopClock();
		const frozen = elapsedRef.current;
		setBaseElapsedMs(frozen);
		// elapsedMs는 이미 frozen 값이므로 별도 set은 필요 없지만,
		// 혹시 모를 비동기 타이밍을 위해 명시적으로 한 번 더 고정합니다.
		setElapsedMs(frozen);
	}, [stopClock]);

	const reset = useCallback(() => {
		stopClock();
		startAtRef.current = null;
		setBaseElapsedMs(0);
		setElapsedMs(0);
	}, [stopClock]);

	return { elapsedMs, baseElapsedMs, start, pause, reset };
}


