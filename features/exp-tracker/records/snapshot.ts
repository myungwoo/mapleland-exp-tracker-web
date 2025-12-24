import type { ExpTrackerSnapshot } from "@/features/exp-tracker/records/types";
import type { OcrSamplingSnapshot } from "@/features/exp-tracker/hooks/useOcrSampling";
import type { PaceSeriesSnapshot } from "@/features/exp-tracker/hooks/usePaceSeries";
import type { StopwatchSnapshot } from "@/features/exp-tracker/hooks/useStopwatch";

function isObject(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === "object";
}

function num(x: unknown, fallback: number) {
	return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function bool(x: unknown, fallback: boolean) {
	return typeof x === "boolean" ? x : fallback;
}

export function makeEmptySnapshot(nowMs = Date.now()): ExpTrackerSnapshot {
	const stopwatch: StopwatchSnapshot = { elapsedMs: 0, baseElapsedMs: 0, isRunning: false };
	const ocr: OcrSamplingSnapshot = {
		currentLevel: null,
		currentExpPercent: null,
		currentExpValue: null,
		cumExpPct: 0,
		cumExpValue: 0,
		sampleTick: 0,
		lastSampleTs: null,
		lastValidSample: null
	};
	const pace: PaceSeriesSnapshot = { history: [] };
	return {
		version: 3,
		capturedAt: nowMs,
		runtime: { hasStarted: false },
		stopwatch,
		ocr,
		pace
	};
}

function normalizeStopwatch(x: unknown): StopwatchSnapshot {
	if (!isObject(x)) return makeEmptySnapshot().stopwatch;
	return {
		elapsedMs: num(x.elapsedMs, 0),
		baseElapsedMs: num(x.baseElapsedMs, 0),
		isRunning: bool(x.isRunning, false)
	};
}

function normalizeOcr(x: unknown): OcrSamplingSnapshot {
	if (!isObject(x)) return makeEmptySnapshot().ocr;
	return {
		currentLevel: typeof x.currentLevel === "number" ? x.currentLevel : null,
		currentExpPercent: typeof x.currentExpPercent === "number" ? x.currentExpPercent : null,
		currentExpValue: typeof x.currentExpValue === "number" ? x.currentExpValue : null,
		cumExpPct: num(x.cumExpPct, 0),
		cumExpValue: num(x.cumExpValue, 0),
		sampleTick: num(x.sampleTick, 0),
		lastSampleTs: typeof x.lastSampleTs === "number" ? x.lastSampleTs : null,
		lastValidSample: isObject(x.lastValidSample) ? (x.lastValidSample as any) : null
	};
}

function normalizePace(x: unknown): PaceSeriesSnapshot {
	if (!isObject(x)) return makeEmptySnapshot().pace;
	const historyRaw = (x as any).history;
	const history = Array.isArray(historyRaw)
		? historyRaw
			.map((p: any) => {
				if (!p || typeof p !== "object") return null;
				return {
					ts: num(p.ts, 0),
					cumExp: num(p.cumExp, 0),
					cumPct: num(p.cumPct, 0),
					elapsedAtMs: num(p.elapsedAtMs, 0)
				};
			})
			.filter(Boolean)
		: [];
	return { history: history as any };
}

/**
 * Accepts unknown (including legacy v1 snapshot) and returns a clean v2 snapshot.
 * - v1 -> v2: keeps only hasStarted/isSampling + stopwatch/ocr/pace
 */
export function normalizeSnapshot(input: unknown): ExpTrackerSnapshot {
	const empty = makeEmptySnapshot();
	if (!isObject(input)) return empty;

	const version = (input as any).version;
	if (version === 3) {
		const runtimeRaw = isObject((input as any).runtime) ? (input as any).runtime : {};
		return {
			version: 3,
			capturedAt: num((input as any).capturedAt, Date.now()),
			runtime: {
				hasStarted: bool(runtimeRaw.hasStarted, false)
			},
			stopwatch: normalizeStopwatch((input as any).stopwatch),
			ocr: normalizeOcr((input as any).ocr),
			pace: normalizePace((input as any).pace)
		};
	}

	if (version === 2) {
		const runtimeRaw = isObject((input as any).runtime) ? (input as any).runtime : {};
		return {
			version: 3,
			capturedAt: num((input as any).capturedAt, Date.now()),
			runtime: {
				hasStarted: bool(runtimeRaw.hasStarted, false)
			},
			stopwatch: normalizeStopwatch((input as any).stopwatch),
			ocr: normalizeOcr((input as any).ocr),
			pace: normalizePace((input as any).pace)
		};
	}

	// (구버전) v1 스냅샷은 `state` 필드를 사용했습니다.
	const stateRaw = isObject((input as any).state) ? (input as any).state : {};
	return {
		version: 3,
		capturedAt: num((input as any).capturedAt, Date.now()),
		runtime: {
			hasStarted: bool((stateRaw as any).hasStarted, false)
		},
		stopwatch: normalizeStopwatch((input as any).stopwatch),
		ocr: normalizeOcr((input as any).ocr),
		pace: normalizePace((input as any).pace)
	};
}


