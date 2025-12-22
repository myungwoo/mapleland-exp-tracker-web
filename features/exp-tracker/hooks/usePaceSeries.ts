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
	avgWindowMin: number;
};

/**
 * 측정 결과(cumExp/elapsed)를 기반으로 차트 시리즈를 생성하는 훅입니다.
 *
 * - 왜: 히스토리 누적/시리즈 계산이 ExpTracker에 섞이면, “측정 로직”과 “표시 로직”이 얽힙니다.
 */
export function usePaceSeries(options: Options) {
	const { hasStarted, sampleTick, lastSampleTsRef, cumExpValue, cumExpPct, elapsedMs, avgWindowMin } = options;

	const [history, setHistory] = useState<PaceHistoryPoint[]>([]);
	const handledTickRef = useRef<number>(0);

	// Append to history once per valid sampling tick (even if increase is zero)
	useEffect(() => {
		if (!hasStarted) return;
		if (sampleTick === 0) return;
		if (handledTickRef.current === sampleTick) return;
		const ts = lastSampleTsRef.current;
		if (ts == null) return;
		setHistory(prev => {
			const next = prev.concat({ ts, cumExp: cumExpValue, cumPct: cumExpPct, elapsedAtMs: elapsedMs });
			// keep last 24h to avoid unbounded growth
			const cutoff = ts - 24 * 3600 * 1000;
			return next.filter(p => p.ts >= cutoff);
		});
		handledTickRef.current = sampleTick;
	}, [sampleTick, hasStarted, lastSampleTsRef, cumExpValue, cumExpPct, elapsedMs]);

	// Reset history on full reset
	useEffect(() => {
		if (!hasStarted) {
			setHistory([]);
		}
	}, [hasStarted]);

	const paceOverallSeries = useMemo((): PaceSeriesPoint[] => {
		if (history.length < 1) return [];
		const scaleSec = avgWindowMin * 60;
		const points: PaceSeriesPoint[] = [];
		for (let i = 0; i < history.length; i++) {
			const h = history[i];
			const elapsedSec = Math.max(1, Math.floor(h.elapsedAtMs / 1000));
			const ratePerSec = h.cumExp / elapsedSec;
			// Use elapsed time (ms) as x so pauses do not stretch the domain
			points.push({ ts: h.elapsedAtMs, value: ratePerSec * scaleSec });
		}
		return points;
	}, [history, avgWindowMin]);

	const cumulativeSeries = useMemo((): PaceSeriesPoint[] => {
		return history.map(h => ({ ts: h.elapsedAtMs, value: h.cumExp }));
	}, [history]);

	const recentPaceSeries = useMemo((): PaceSeriesPoint[] => {
		if (history.length < 1) return [];
		const windowMs = 30 * 1000;
		const scaleSec = avgWindowMin * 60;
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
	}, [history, avgWindowMin]);

	const getSnapshot = useCallback((): PaceSeriesSnapshot => {
		return { history };
	}, [history]);

	const applySnapshot = useCallback((snap: PaceSeriesSnapshot) => {
		const next = Array.isArray(snap.history) ? snap.history : [];
		setHistory(next);
		handledTickRef.current = 0;
	}, []);

	return { history, paceOverallSeries, cumulativeSeries, recentPaceSeries, getSnapshot, applySnapshot };
}


