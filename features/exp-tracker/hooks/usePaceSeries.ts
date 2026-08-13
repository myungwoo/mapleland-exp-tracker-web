import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PaceHistoryPoint = { ts: number; cumExp: number; cumPct: number; elapsedAtMs: number };
export type PaceSeriesPoint = { ts: number; value: number };

export type PaceSeriesSnapshot = {
	history: PaceHistoryPoint[];
};

type Options = {
	hasStarted: boolean;
	sampleTick: number;
	lastSampleTsRef: React.MutableRefObject<number | null>;
	cumExpValue: number;
	cumExpPct: number;
	elapsedMs: number;
	paceWindowMin: number;
};

/**
 * 측정 결과(cumExp/elapsed)를 기반으로 차트 시리즈를 생성하는 훅입니다.
 *
 * - 왜: 히스토리 누적/시리즈 계산이 ExpTracker에 섞이면, “측정 로직”과 “표시 로직”이 얽힙니다.
 */
export function usePaceSeries(options: Options) {
	const { hasStarted, sampleTick, lastSampleTsRef, cumExpValue, cumExpPct, elapsedMs, paceWindowMin } = options;

	const [history, setHistory] = useState<PaceHistoryPoint[]>([]);
	const handledTickRef = useRef<number>(0);

	// 장시간 실행(수시간)에서도 메모리/GC 압박을 줄이기 위한 정책:
	// - 최대 포인트 수를 제한(브라우저 크래시/탭 프리즈 방지)
	const HISTORY_MAX_POINTS = 12000; // 3시간 * (1점/1초) = 10800 < 12000

	// 유효한 샘플링 틱마다 1회 히스토리에 추가합니다. (증가량이 0이어도 기록)
	useEffect(() => {
		if (!hasStarted) return;
		if (sampleTick === 0) return;
		if (handledTickRef.current === sampleTick) return;
		const ts = lastSampleTsRef.current;
		if (ts == null) return;

		setHistory((prev) => {
			let next = prev.length
				? [...prev, { ts, cumExp: cumExpValue, cumPct: cumExpPct, elapsedAtMs: elapsedMs }]
				: [{ ts, cumExp: cumExpValue, cumPct: cumExpPct, elapsedAtMs: elapsedMs }];

			// 무한 증가를 막기 위해 최근 3시간만 유지합니다.
			const cutoff = ts - 3 * 3600 * 1000;
			let start = 0;
			while (start < next.length && next[start]!.ts < cutoff) start++;
			if (start > 0) next = next.slice(start);

			// 포인트 수 상한(브라우저 장시간 안정성)
			if (next.length > HISTORY_MAX_POINTS) {
				next = next.slice(next.length - HISTORY_MAX_POINTS);
			}
			return next;
		});
		handledTickRef.current = sampleTick;
	}, [sampleTick, hasStarted, lastSampleTsRef, cumExpValue, cumExpPct, elapsedMs]);

	// 완전 초기화(측정 종료) 시 히스토리를 초기화합니다.
	useEffect(() => {
		if (!hasStarted) {
			setHistory([]);
		}
	}, [hasStarted]);

	const paceOverallSeries = useMemo((): PaceSeriesPoint[] => {
		if (history.length < 1) return [];
		const scaleSec = paceWindowMin * 60;
		const points: PaceSeriesPoint[] = [];
		for (let i = 0; i < history.length; i++) {
			const h = history[i];
			const elapsedSec = Math.max(1, Math.floor(h.elapsedAtMs / 1000));
			const ratePerSec = h.cumExp / elapsedSec;
			// 일시정지가 x축 범위를 늘리지 않도록, x에는 경과 시간(ms)을 사용합니다.
			points.push({ ts: h.elapsedAtMs, value: ratePerSec * scaleSec });
		}
		return points;
	}, [history, paceWindowMin]);

	const cumulativeSeries = useMemo((): PaceSeriesPoint[] => {
		return history.map((h) => ({ ts: h.elapsedAtMs, value: h.cumExp }));
	}, [history]);

	const recentPaceSeries = useMemo((): PaceSeriesPoint[] => {
		if (history.length < 1) return [];
		const windowMs = 30 * 1000;
		const scaleSec = paceWindowMin * 60;
		const points: PaceSeriesPoint[] = [];
		let j = 0;
		for (let i = 0; i < history.length; i++) {
			const cur = history[i];
			const t0 = Math.max(0, cur.elapsedAtMs - windowMs);
			while (j < i && history[j].elapsedAtMs < t0) j++;
			let k = j;
			if (k >= i) k = Math.max(0, i - 1);
			const prev = history[k];
			const deltaExp = cur.cumExp - prev.cumExp;
			const deltaMs = Math.max(1, cur.elapsedAtMs - prev.elapsedAtMs);
			const ratePerSec = deltaExp / (deltaMs / 1000);
			points.push({ ts: cur.elapsedAtMs, value: ratePerSec * scaleSec });
		}
		return points;
	}, [history, paceWindowMin]);

	const getSnapshot = useCallback((): PaceSeriesSnapshot => {
		return { history };
	}, [history]);

	/**
	 * 기록에서 히스토리를 복원합니다.
	 *
	 * `handledTick`에는 **같이 복원되는 측정 스냅샷의 sampleTick**을 넘겨야 합니다.
	 * 왜: 이 값을 0으로 두면 "복원된 sampleTick(예: 500) != handledTick(0)"이 되어,
	 * 아래 append effect가 한 번 더 돌아 마지막 포인트와 사실상 같은 점이 차트에 중복 추가됩니다.
	 */
	const applySnapshot = useCallback((snap: PaceSeriesSnapshot, handledTick = 0) => {
		const next = Array.isArray(snap.history) ? snap.history : [];
		setHistory(next);
		handledTickRef.current = Number.isFinite(handledTick) ? handledTick : 0;
	}, []);

	// 반환 객체는 값이 바뀔 때만 새로 만듭니다. (근거는 CLAUDE.md "훅 반환 객체" 항목)
	// 이 훅의 값은 샘플마다 바뀌므로 identity도 샘플마다 바뀝니다.
	return useMemo(
		() => ({ history, paceOverallSeries, cumulativeSeries, recentPaceSeries, getSnapshot, applySnapshot }),
		[history, paceOverallSeries, cumulativeSeries, recentPaceSeries, getSnapshot, applySnapshot]
	);
}
