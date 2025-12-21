import { useCallback, useRef, useState } from "react";
import { cropDigitBoundingBox, drawRoiCanvas, preprocessExpCanvas, preprocessLevelCanvas, toVideoSpaceRect } from "@/lib/canvas";
import { recognizeExpBracketedWithText, recognizeLevelDigitsWithText } from "@/lib/ocr";
import { computeExpDeltaFromTable, type ExpTable } from "@/lib/expTable";
import type { RoiRect } from "@/components/RoiOverlay";

type Sample = {
	ts: number;
	level: number | null;
	expPercent: number | null;
	expValue: number | null;
	isValid?: boolean;
};

type Options = {
	captureVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	roiLevel: RoiRect | null;
	roiExp: RoiRect | null;
	expTable: ExpTable;
	debugEnabled: boolean;
};

/**
 * OCR 샘플링(ROI 캡처 → 전처리 → OCR)과 누적(%) / 누적(값) 계산을 담당하는 훅입니다.
 *
 * - 왜: ExpTracker에 OCR/누적/디버그 프리뷰까지 섞이면 파일이 비대해지고, 변경 영향 범위가 커집니다.
 */
export function useOcrSampling(options: Options) {
	const { captureVideoRef, roiLevel, roiExp, expTable, debugEnabled } = options;

	const [currentLevel, setCurrentLevel] = useState<number | null>(null);
	const [currentExpPercent, setCurrentExpPercent] = useState<number | null>(null);
	const [currentExpValue, setCurrentExpValue] = useState<number | null>(null);

	const [cumExpPct, setCumExpPct] = useState(0);
	const [cumExpValue, setCumExpValue] = useState(0);

	const lastValidSampleRef = useRef<Sample | null>(null);
	const lastSampleTsRef = useRef<number | null>(null);
	const [sampleTick, setSampleTick] = useState<number>(0);

	// 디버그 프리뷰 (dataURL)
	const [levelPreviewRaw, setLevelPreviewRaw] = useState<string | null>(null);
	const [levelPreviewProc, setLevelPreviewProc] = useState<string | null>(null);
	const [expPreviewRaw, setExpPreviewRaw] = useState<string | null>(null);
	const [expPreviewProc, setExpPreviewProc] = useState<string | null>(null);
	const [levelOcrText, setLevelOcrText] = useState<string>("");
	const [expOcrText, setExpOcrText] = useState<string>("");

	const readOnce = useCallback(async (): Promise<Sample> => {
		const video = captureVideoRef.current;
		if (!video || !roiExp || !roiLevel) return { ts: Date.now(), level: null, expPercent: null, expValue: null };
		if (video.videoWidth === 0 || video.videoHeight === 0) return { ts: Date.now(), level: null, expPercent: null, expValue: null };

		// ROI는 “표시 좌표”로 저장될 수 있으므로, 비디오 픽셀 공간으로 변환해서 처리합니다.
		const rectLevel = toVideoSpaceRect(video, roiLevel);
		const rectExp = toVideoSpaceRect(video, roiExp);

		// 레벨: 색 기반 전처리 → 숫자 bbox로 타이트 크롭
		const canvasLevelProc = preprocessLevelCanvas(video, rectLevel, { scale: 4, pad: 0 });
		const canvasLevelCrop = cropDigitBoundingBox(canvasLevelProc, { margin: 3, targetHeight: 72, outPad: 6 });

		// 경험치: 괄호 포함 문자열을 OCR 하기 쉽게 전처리
		const canvasExpProc = preprocessExpCanvas(video, rectExp, { minHeight: 120 });

		const [levelRes, expRes] = await Promise.all([
			recognizeLevelDigitsWithText(canvasLevelCrop),
			recognizeExpBracketedWithText(canvasExpProc)
		]);

		if (debugEnabled) {
			try {
				const canvasLevelRaw = drawRoiCanvas(video, rectLevel, { scale: 4 });
				const canvasExpRaw = drawRoiCanvas(video, rectExp, { scale: 2 });
				setLevelPreviewRaw(canvasLevelRaw.toDataURL("image/png"));
				setLevelPreviewProc(canvasLevelCrop.toDataURL("image/png"));
				setExpPreviewRaw(canvasExpRaw.toDataURL("image/png"));
				setExpPreviewProc(canvasExpProc.toDataURL("image/png"));
				setLevelOcrText(levelRes.text || "");
				setExpOcrText(expRes.text || "");
			} catch {
				// 프리뷰 생성 실패는 치명적이지 않으므로 무시합니다.
			}
		}

		// EXP는 잡히는데 레벨이 안 잡히는 경우가 종종 있어서, 레벨을 1로 가정해 추적이 이어지게 합니다.
		const inferredLevel =
			levelRes.value != null
				? levelRes.value
				: (expRes.percent != null || expRes.value != null)
					? 1
					: null;

		return {
			ts: Date.now(),
			level: inferredLevel,
			expPercent: expRes.percent ?? null,
			expValue: expRes.value ?? null
		};
	}, [captureVideoRef, roiExp, roiLevel, debugEnabled]);

	const sampleOnceAndAccumulate = useCallback(async () => {
		const s = await readOnce();
		const isValid = s.level != null && s.expValue != null && s.expPercent != null;
		const sample: Sample = { ...s, isValid };

		setCurrentLevel(s.level);
		setCurrentExpPercent(s.expPercent);
		setCurrentExpValue(s.expValue ?? null);

		const prev = lastValidSampleRef.current;
		if (prev && isValid) {
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

		if (isValid) {
			lastValidSampleRef.current = sample;
			lastSampleTsRef.current = sample.ts;
			setSampleTick((t) => t + 1);
		}
	}, [readOnce, expTable]);

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

	return {
		// state
		currentLevel,
		currentExpPercent,
		currentExpValue,
		cumExpPct,
		cumExpValue,
		sampleTick,
		lastSampleTsRef,

		// actions
		readOnce,
		sampleOnceAndAccumulate,
		resetTotals,

		// debug
		levelPreviewRaw,
		levelPreviewProc,
		expPreviewRaw,
		expPreviewProc,
		levelOcrText,
		expOcrText
	};
}


