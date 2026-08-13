import { normalizeCouponCount } from "@/lib/expCoupon";
import type { ExpTrackerSnapshot } from "@/features/exp-tracker/records/types";
import type { SamplingSnapshot } from "@/features/exp-tracker/hooks/useSampling";
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
	const sampling: SamplingSnapshot = {
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
		version: 4,
		capturedAt: nowMs,
		runtime: { hasStarted: false, expCouponCount: 0 },
		stopwatch,
		sampling,
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

function normalizeSampling(x: unknown): SamplingSnapshot {
	if (!isObject(x)) return makeEmptySnapshot().sampling;
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
 * 임의의 값(옛 버전 스냅샷 포함)을 받아 최신(v4) 스냅샷으로 정규화합니다.
 *
 * 버전 변경 이력:
 * - v1 -> v2: 최상위 `state` 대신 `runtime`을 사용
 * - v3 -> v4: 측정 스냅샷 필드 이름이 `ocr` -> `sampling`
 *
 * 왜: 사용자가 내보낸 JSON 파일이 이미 존재하므로 옛 필드 이름을 계속 읽어야 합니다.
 * (v3 이하 기록은 `ocr` 키를 쓰는데, 이걸 못 읽으면 누적 EXP가 통째로 0으로 복원됩니다)
 */
export function normalizeSnapshot(input: unknown): ExpTrackerSnapshot {
	const empty = makeEmptySnapshot();
	if (!isObject(input)) return empty;

	const version = (input as any).version;
	// v3까지는 `ocr`, v4부터는 `sampling` 입니다.
	const samplingRaw = (input as any).sampling ?? (input as any).ocr;

	if (version === 4 || version === 3 || version === 2) {
		const runtimeRaw = isObject((input as any).runtime) ? (input as any).runtime : {};
		return {
			version: 4,
			capturedAt: num((input as any).capturedAt, Date.now()),
			runtime: {
				hasStarted: bool(runtimeRaw.hasStarted, false),
				expCouponCount: normalizeCouponCount(runtimeRaw.expCouponCount)
			},
			stopwatch: normalizeStopwatch((input as any).stopwatch),
			sampling: normalizeSampling(samplingRaw),
			pace: normalizePace((input as any).pace)
		};
	}

	// (구버전) v1 스냅샷은 `state` 필드를 사용했습니다.
	const stateRaw = isObject((input as any).state) ? (input as any).state : {};
	return {
		version: 4,
		capturedAt: num((input as any).capturedAt, Date.now()),
		runtime: {
			hasStarted: bool((stateRaw as any).hasStarted, false),
			expCouponCount: normalizeCouponCount((stateRaw as any).expCouponCount)
		},
		stopwatch: normalizeStopwatch((input as any).stopwatch),
		sampling: normalizeSampling(samplingRaw),
		pace: normalizePace((input as any).pace)
	};
}
