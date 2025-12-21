import { useCallback, useEffect, useRef } from "react";

/**
 * setInterval 기반 반복 실행을 안전하게 관리하는 훅입니다.
 *
 * - 왜: 여러 곳에서 interval을 직접 다루면 clear 누락/중복 실행 같은 버그가 생기기 쉽습니다.
 */
export function useIntervalRunner() {
	const idRef = useRef<number | null>(null);

	const stop = useCallback(() => {
		if (idRef.current != null) {
			window.clearInterval(idRef.current);
			idRef.current = null;
		}
	}, []);

	const start = useCallback((intervalMs: number, run: () => void) => {
		stop();
		idRef.current = window.setInterval(run, intervalMs) as unknown as number;
	}, [stop]);

	useEffect(() => stop, [stop]);

	return { start, stop };
}


