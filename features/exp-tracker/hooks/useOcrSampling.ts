import { useCallback, useRef, useState } from "react";
import { cropBinaryForegroundBoundingBox, cropDigitBoundingBox, drawRoiCanvas, preprocessExpCanvas, preprocessLevelCanvas, toVideoSpaceRect } from "@/lib/canvas";
import { recognizeExpBracketedWithText, recognizeLevelDigitsWithText, resetOcrWorkers } from "@/lib/ocr";
import { computeExpDeltaFromTable, requiredExpForLevel, type ExpTable } from "@/lib/expTable";
import type { RoiRect } from "@/components/RoiOverlay";

export type OcrSample = {
	ts: number;
	level: number | null;
	expPercent: number | null;
	expValue: number | null;
	isValid?: boolean;
	isOutlier?: boolean;
	outlierReason?: string;
	levelWasMissing?: boolean;
};

export type OcrSamplingSnapshot = {
	currentLevel: number | null;
	currentExpPercent: number | null;
	currentExpValue: number | null;
	cumExpPct: number;
	cumExpValue: number;
	sampleTick: number;
	lastSampleTs: number | null;
	lastValidSample: OcrSample | null;
};

type Options = {
	captureVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	roiLevel: RoiRect | null;
	roiExp: RoiRect | null;
	expTable: ExpTable;
	debugEnabled: boolean;
	/**
	 * 값(EXP) ↔ 퍼센트(EXP%) 정합성(테이블 기반) 검증을 적용할지 여부
	 * - true(기본): OCR 오탐을 줄이기 위해 mismatch 샘플을 이상치로 처리
	 * - false: 레벨/퍼센트가 흔들리는 환경에서 측정이 "아예 시작 못 하는" 문제를 완화
	 */
	expPercentValidationEnabled: boolean;
};

/**
 * OCR 측정(ROI 캡처 → 전처리 → OCR)과 누적(%) / 누적(값) 계산을 담당하는 훅입니다.
 *
 * - 왜: ExpTracker에 OCR/누적/디버그 프리뷰까지 섞이면 파일이 비대해지고, 변경 영향 범위가 커집니다.
 */
export function useOcrSampling(options: Options) {
	const { captureVideoRef, roiLevel, roiExp, expTable, debugEnabled, expPercentValidationEnabled } = options;

	// 장시간 실행 시 워커 내부 메모리 누적/단편화 완화: 일정 샘플마다 워커를 재시작합니다.
	// (1초 샘플링 기준 30분 주기)
	const recycleEverySamples = 1800;
	const recycleCounterRef = useRef<number>(0);

	// 샘플마다 DOM(Canvas) 생성/GC가 반복되는 오버헤드를 줄이기 위해 캔버스를 재사용합니다.
	const levelProcCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const levelCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const expProcCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const expCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const levelRawCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const expRawCanvasRef = useRef<HTMLCanvasElement | null>(null);

	const getOrCreateCanvas = (r: React.MutableRefObject<HTMLCanvasElement | null>) => {
		if (!r.current) r.current = document.createElement("canvas");
		return r.current;
	};

	const [currentLevel, setCurrentLevel] = useState<number | null>(null);
	const [currentExpPercent, setCurrentExpPercent] = useState<number | null>(null);
	const [currentExpValue, setCurrentExpValue] = useState<number | null>(null);

	const [cumExpPct, setCumExpPct] = useState(0);
	const [cumExpValue, setCumExpValue] = useState(0);

	const lastValidSampleRef = useRef<OcrSample | null>(null);
	const lastSampleTsRef = useRef<number | null>(null);
	const [sampleTick, setSampleTick] = useState<number>(0);

	// 디버그 프리뷰 (data URL)
	const [levelPreviewRaw, setLevelPreviewRaw] = useState<string | null>(null);
	const [levelPreviewProc, setLevelPreviewProc] = useState<string | null>(null);
	const [expPreviewRaw, setExpPreviewRaw] = useState<string | null>(null);
	const [expPreviewProc, setExpPreviewProc] = useState<string | null>(null);
	const [levelOcrText, setLevelOcrText] = useState<string>("");
	const [expOcrText, setExpOcrText] = useState<string>("");
	const lastDebugPreviewAtRef = useRef<number>(0);

	const annotateOutlier = useCallback((sample: OcrSample, reason: string): OcrSample => {
		return { ...sample, isValid: false, isOutlier: true, outlierReason: reason };
	}, []);

	const isPercentValueConsistent = useCallback((level: number, expValue: number, expPercent: number): boolean => {
		// EXP_TABLE은 "해당 레벨에서 0% -> 100%까지 필요한 EXP"입니다. 이를 사용해 OCR 결과를 상식선에서 검증합니다.
		const req = requiredExpForLevel(expTable, level);
		if (req == null || req <= 0) return true; // 검증 불가(테이블 없음)면 막지 않습니다.
		// expValue는 [0, req] 범위여야 자연스럽습니다. (약간의 OCR 노이즈/반올림 오차 허용)
		if (expValue < 0) return false;
		if (expValue > req * 1.05) return false;
		const pctFromValue = (expValue / req) * 100;
		if (!Number.isFinite(pctFromValue)) return false;
		// 퍼센트 OCR이 상대적으로 더 흔들리는 편이라, 어느 정도 오차 범위를 허용합니다.
		return Math.abs(pctFromValue - expPercent) <= 2.5;
	}, [expTable]);

	const isPlausibleSameLevelDrop = useCallback((level: number, prevValue: number, curValue: number, prevPct: number, curPct: number): boolean => {
		// 같은 레벨에서 EXP 감소는 정상 케이스가 있습니다. (예: 사망 패널티)
		// 다만 "단일 틱에서 과도한 급락"은 OCR 이상치일 가능성이 높아 차단합니다.
		const req = requiredExpForLevel(expTable, level);
		if (req == null || req <= 0) return true; // 검증 불가(테이블 없음)면 막지 않습니다.
		// 기본 정합성: 값/퍼센트는 같은 방향으로 움직이는 것이 자연스럽습니다.
		const dv = curValue - prevValue;
		const dp = curPct - prevPct;
		if (dv > 0 || dp > 0) return true; // 증가 방향이면 OK
		// 감소: 허용하되, 급락 폭에 상한을 둡니다.
		// 메이플랜드: 사망 시 경험치 감소량은 최대 10%p로 알려져 있습니다.
		// (OCR/반올림 오차를 고려해 아주 약간의 여유를 둡니다.)
		const dropPctPoints = Math.abs(dp);
		const dropFrac = Math.abs(dv) / req;
		// 퍼센트 기준이 가장 직관적이며, 값 기준은 보조 신호로 사용합니다.
		// 사망 패널티(최대 10%p) + OCR 소수점 오차를 고려해 약 0.2%p 정도 여유를 둡니다.
		return dropPctPoints <= 10.2 && dropFrac <= 0.12;
	}, [expTable]);

	const readOnce = useCallback(async (): Promise<OcrSample> => {
		const video = captureVideoRef.current;
		if (!video || !roiExp || !roiLevel) return { ts: Date.now(), level: null, expPercent: null, expValue: null };
		if (video.videoWidth === 0 || video.videoHeight === 0) return { ts: Date.now(), level: null, expPercent: null, expValue: null };

		// ROI는 현재 비디오 픽셀 좌표로 저장됩니다. (여기서는 안전하게 정수화만 수행)
		const rectLevel = toVideoSpaceRect(video, roiLevel);
		const rectExp = toVideoSpaceRect(video, roiExp);

		// 레벨: 색 기반 전처리 → 숫자 bbox로 타이트 크롭
		const canvasLevelProc = preprocessLevelCanvas(video, rectLevel, {
			scale: 4,
			pad: 0,
			outCanvas: getOrCreateCanvas(levelProcCanvasRef)
		});
		const canvasLevelCrop = cropDigitBoundingBox(canvasLevelProc, {
			margin: 3,
			targetHeight: 72,
			outPad: 6,
			outCanvas: getOrCreateCanvas(levelCropCanvasRef)
		});

		// 경험치: 괄호 포함 문자열을 OCR 하기 쉽게 전처리
		const canvasExpProc = preprocessExpCanvas(video, rectExp, {
			minHeight: 120,
			outCanvas: getOrCreateCanvas(expProcCanvasRef)
		});
		// ROI가 너무 넓어도(자리수 감소 등) 숫자/괄호/퍼센트 영역만 남기도록 타이트 크롭
		const canvasExpCrop = cropBinaryForegroundBoundingBox(canvasExpProc, {
			foreground: "white",
			margin: 4,
			targetHeight: 120,
			outPad: 6,
			outCanvas: getOrCreateCanvas(expCropCanvasRef)
		});

		const [levelRes, expRes] = await Promise.all([
			recognizeLevelDigitsWithText(canvasLevelCrop),
			recognizeExpBracketedWithText(canvasExpCrop)
		]);

		if (debugEnabled) {
			try {
				// toDataURL은 비용이 크므로(메모리/CPU) 과도한 갱신을 피합니다.
				const now = Date.now();
				if (now - lastDebugPreviewAtRef.current >= 1000) {
					lastDebugPreviewAtRef.current = now;
					const canvasLevelRaw = drawRoiCanvas(video, rectLevel, { scale: 4, outCanvas: getOrCreateCanvas(levelRawCanvasRef) });
					const canvasExpRaw = drawRoiCanvas(video, rectExp, { scale: 2, outCanvas: getOrCreateCanvas(expRawCanvasRef) });
					setLevelPreviewRaw(canvasLevelRaw.toDataURL("image/png"));
					setLevelPreviewProc(canvasLevelCrop.toDataURL("image/png"));
					setExpPreviewRaw(canvasExpRaw.toDataURL("image/png"));
					setExpPreviewProc(canvasExpCrop.toDataURL("image/png"));
					setLevelOcrText(levelRes.text || "");
					setExpOcrText(expRes.text || "");
				}
			} catch {
				// 프리뷰 생성 실패는 치명적이지 않으므로 무시합니다.
			}
		}

		// 워커 재활용(장시간 실행 방어): 이번 샘플이 끝난 뒤에만 수행합니다.
		recycleCounterRef.current += 1;
		if (recycleCounterRef.current >= recycleEverySamples) {
			recycleCounterRef.current = 0;
			// 다음 샘플에서 워커가 다시 초기화됩니다. (샘플링 루프는 단일 in-flight로 보호됨)
			void resetOcrWorkers();
		}

		return {
			ts: Date.now(),
			level: levelRes.value ?? null,
			expPercent: expRes.percent ?? null,
			expValue: expRes.value ?? null,
			levelWasMissing: levelRes.value == null && (expRes.percent != null || expRes.value != null)
		};
	}, [captureVideoRef, roiExp, roiLevel, debugEnabled]);

	const resetTotals = useCallback(() => {
		setCurrentLevel(null);
		setCurrentExpPercent(null);
		setCurrentExpValue(null);
		setCumExpPct(0);
		setCumExpValue(0);
		lastValidSampleRef.current = null;
		lastSampleTsRef.current = null;
		setSampleTick(0);
	}, []);

	const captureBaseline = useCallback(async (args: { resetTotals: boolean }) => {
		// 시작/재개 직후 "첫 틱"에서 발생하는 이상치를 차트에 기록하지 않기 위해,
		// baseline은 누적/히스토리를 증가시키지 않고 prev(lastValidSample)만 갱신합니다.
		if (args.resetTotals) {
			resetTotals();
		}
		const raw = await readOnce();
		const s: OcrSample = {
			...raw,
			levelWasMissing: raw.level == null && (raw.expPercent != null || raw.expValue != null)
		};
		const isStructValid = s.level != null && s.expValue != null && s.expPercent != null;
		let sample: OcrSample = { ...s, isValid: isStructValid };
		// baseline은 prev가 없더라도 최소한의 검증(%↔값 일관성)은 통과해야 채택합니다.
		if (isStructValid && expPercentValidationEnabled) {
			if (!isPercentValueConsistent(s.level as number, s.expValue as number, s.expPercent as number)) {
				sample = annotateOutlier(sample, "pct_value_mismatch");
			}
		}
		// baseline이 이상치라면 prev를 세팅하지 않습니다. (다음 틱을 첫 틱으로 삼기 위함)
		if (sample.isValid && !sample.isOutlier) {
			setCurrentLevel(s.level);
			setCurrentExpPercent(s.expPercent);
			setCurrentExpValue(s.expValue ?? null);
			lastValidSampleRef.current = sample;
			lastSampleTsRef.current = sample.ts;
		} else {
			// 재개 시 baseline이 불안정하면, 일시정지 이전 값과의 "교차 구간 누적"을 막기 위해 prev를 비웁니다.
			lastValidSampleRef.current = null;
			lastSampleTsRef.current = null;
		}
	}, [annotateOutlier, isPercentValueConsistent, readOnce, resetTotals, expPercentValidationEnabled]);

	const sampleOnceAndAccumulate = useCallback(async () => {
		const raw = await readOnce();
		// 레벨 OCR이 흔들릴 때 측정을 끊지 않기 위한 보정:
		// 직전 유효 레벨이 있고, 이번 샘플에서 EXP 관련 값이 잡히면 "레벨은 그대로"라고 가정합니다.
		const prev = lastValidSampleRef.current;
		const level =
			raw.level != null
				? raw.level
				: (prev?.level != null && (raw.expPercent != null || raw.expValue != null))
					? prev.level
					: null;
		const s: OcrSample = {
			...raw,
			level,
			levelWasMissing: raw.level == null && level != null
		};
		const isStructValid = s.level != null && s.expValue != null && s.expPercent != null;
		let sample: OcrSample = { ...s, isValid: isStructValid };

		// 이상치 감지: 이번 틱이 이상해 보이면 "유효 샘플"로 취급하지 않습니다.
		// 이렇게 하면 sampleTick이 증가하지 않아 차트 히스토리에 기록되지 않습니다.
		if (isStructValid && expPercentValidationEnabled) {
			// 첫 틱(또는 재개 직후)처럼 prev가 없을 때도, 최소한 %↔값 일관성은 통과해야 합니다.
			if (!isPercentValueConsistent(s.level as number, s.expValue as number, s.expPercent as number)) {
				sample = annotateOutlier(sample, "pct_value_mismatch");
			}
		}
		if (isStructValid && !sample.isOutlier && prev && prev.level != null && prev.expValue != null && prev.expPercent != null) {
			// 레벨이 한 번에 크게 튀는 경우는 OCR 이상치로 보는 편이 안전합니다.
			if (s.level != null && Math.abs(s.level - prev.level) >= 2) {
				sample = annotateOutlier(sample, "level_jump");
			} else if (s.level != null && s.expValue != null && s.expPercent != null) {
				// 같은 레벨로 해석했을 때, 값/퍼센트의 상호 일관성을 검사합니다. (테이블 기반)
				if (expPercentValidationEnabled && !isPercentValueConsistent(s.level, s.expValue, s.expPercent)) {
					sample = annotateOutlier(sample, "pct_value_mismatch");
				} else {
					// 같은 레벨에서 감소는 정상(사망 패널티 등)일 수 있으므로 허용하되,
					// 단일 틱에서 과도한 급락은 OCR 이상치로 차단합니다.
					if (s.level === prev.level) {
						if (!isPlausibleSameLevelDrop(s.level, prev.expValue, s.expValue, prev.expPercent, s.expPercent)) {
							sample = annotateOutlier(sample, "implausible_drop");
						}
					}
				}
			}
		}

		// "현재 표시 값"은 이상치가 아닐 때만 갱신해서, PiP/메인 UI가 순간적으로 튀는 값을 보여주지 않게 합니다.
		if (!sample.isOutlier) {
			setCurrentLevel(s.level);
			setCurrentExpPercent(s.expPercent);
			setCurrentExpValue(s.expValue ?? null);
		}

		if (prev && sample.isValid && !sample.isOutlier) {
			// % 누적
			if (prev.expPercent != null && s.expPercent != null) {
				let deltaPct = 0;
				if (prev.level != null && s.level != null && s.level > prev.level) {
					deltaPct = (100 - prev.expPercent) + s.expPercent;
				} else if (prev.level != null && s.level != null && s.level < prev.level) {
					deltaPct = -((100 - s.expPercent) + prev.expPercent);
				} else {
					deltaPct = s.expPercent - prev.expPercent;
				}
				setCumExpPct((v) => v + deltaPct);
			}

			// 값 누적 (EXP_TABLE 기반)
			if (prev.expValue != null && s.expValue != null && prev.level != null && s.level != null) {
				const dvFromTable = computeExpDeltaFromTable(expTable, prev.level, prev.expValue, s.level, s.expValue);
				if (dvFromTable != null) {
					setCumExpValue((v) => v + dvFromTable);
				}
			}
		}

		if (sample.isValid && !sample.isOutlier) {
			lastValidSampleRef.current = sample;
			lastSampleTsRef.current = sample.ts;
			setSampleTick((t) => t + 1);
		}
	}, [readOnce, expTable, annotateOutlier, isPercentValueConsistent, isPlausibleSameLevelDrop, expPercentValidationEnabled]);

	const getSnapshot = useCallback((): OcrSamplingSnapshot => {
		return {
			currentLevel,
			currentExpPercent,
			currentExpValue,
			cumExpPct,
			cumExpValue,
			sampleTick,
			lastSampleTs: lastSampleTsRef.current,
			lastValidSample: (lastValidSampleRef.current as OcrSample | null)
		};
	}, [currentLevel, currentExpPercent, currentExpValue, cumExpPct, cumExpValue, sampleTick]);

	const applySnapshot = useCallback((snap: OcrSamplingSnapshot) => {
		setCurrentLevel(snap.currentLevel ?? null);
		setCurrentExpPercent(snap.currentExpPercent ?? null);
		setCurrentExpValue(snap.currentExpValue ?? null);
		setCumExpPct(Number.isFinite(snap.cumExpPct) ? snap.cumExpPct : 0);
		setCumExpValue(Number.isFinite(snap.cumExpValue) ? snap.cumExpValue : 0);
		lastSampleTsRef.current = snap.lastSampleTs ?? null;
		lastValidSampleRef.current = (snap.lastValidSample as OcrSample | null) ?? null;
		setSampleTick(Number.isFinite(snap.sampleTick) ? snap.sampleTick : 0);
	}, []);

	return {
		// 상태
		currentLevel,
		currentExpPercent,
		currentExpValue,
		cumExpPct,
		cumExpValue,
		sampleTick,
		lastSampleTsRef,

		// 동작
		readOnce,
		captureBaseline,
		sampleOnceAndAccumulate,
		resetTotals,
		getSnapshot,
		applySnapshot,

		// 디버그
		levelPreviewRaw,
		levelPreviewProc,
		expPreviewRaw,
		expPreviewProc,
		levelOcrText,
		expOcrText
	};
}


