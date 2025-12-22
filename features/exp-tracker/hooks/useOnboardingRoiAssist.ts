import { useEffect, useState } from "react";
import { cropBinaryForegroundBoundingBox, drawRoiCanvas, toVideoSpaceRect, preprocessLevelCanvas, cropDigitBoundingBox, preprocessExpCanvas } from "@/lib/canvas";
import { recognizeExpBracketedWithText, recognizeLevelDigitsWithText } from "@/lib/ocr";
import type { RoiRect } from "@/components/RoiOverlay";

type Options = {
	onboardingOpen: boolean;
	onboardingStep: number;
	stream: MediaStream | null;
	captureVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	roiLevel: RoiRect | null;
	roiExp: RoiRect | null;
};

/**
 * 온보딩 중 ROI 썸네일과 OCR 인식 텍스트를 자동 갱신하는 훅입니다.
 *
 * - 왜: 온보딩 관련 state/effect가 ExpTracker에 섞여 있으면, 핵심 측정 로직을 읽기 어렵습니다.
 */
export function useOnboardingRoiAssist(options: Options) {
	const { onboardingOpen, onboardingStep, stream, captureVideoRef, roiLevel, roiExp } = options;

	const [levelRoiShot, setLevelRoiShot] = useState<string | null>(null);
	const [expRoiShot, setExpRoiShot] = useState<string | null>(null);
	const [onboardingLevelText, setOnboardingLevelText] = useState<string | null>(null);
	const [onboardingExpText, setOnboardingExpText] = useState<string | null>(null);

	// ROI 썸네일 (정확도 검증용)
	useEffect(() => {
		if (!onboardingOpen) return;
		const video = captureVideoRef.current;
		if (!video) return;
		if (video.videoWidth === 0 || video.videoHeight === 0) return;

		try {
			if (roiLevel) {
				const r = toVideoSpaceRect(video, roiLevel);
				const c = drawRoiCanvas(video, r, { scale: 2 });
				setLevelRoiShot(c.toDataURL("image/png"));
			}
			if (roiExp) {
				const r = toVideoSpaceRect(video, roiExp);
				const c = drawRoiCanvas(video, r, { scale: 2 });
				setExpRoiShot(c.toDataURL("image/png"));
			}
		} catch {
			// 썸네일 생성 실패는 치명적이지 않으므로 무시합니다.
		}
	}, [onboardingOpen, onboardingStep, roiLevel, roiExp, stream, captureVideoRef]);

	// 온보딩 중에는 1초마다 OCR 텍스트를 갱신해서 “ROI가 제대로 잡혔는지” 즉시 피드백합니다.
	useEffect(() => {
		if (!onboardingOpen) return;
		let timer: number | null = null;

		const tick = async () => {
			const video = captureVideoRef.current;
			if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
			try {
				if (roiLevel) {
					const rect = toVideoSpaceRect(video, roiLevel);
					const canvasLevelProc = preprocessLevelCanvas(video, rect, { scale: 4, pad: 0 });
					const canvasLevelCrop = cropDigitBoundingBox(canvasLevelProc, { margin: 3, targetHeight: 72, outPad: 6 });
					const res = await recognizeLevelDigitsWithText(canvasLevelCrop);
					setOnboardingLevelText(res.text || "");
					const cRaw = drawRoiCanvas(video, rect, { scale: 2 });
					setLevelRoiShot(cRaw.toDataURL("image/png"));
				}
				if (roiExp) {
					const rect = toVideoSpaceRect(video, roiExp);
					const canvasExpProc = preprocessExpCanvas(video, rect, { minHeight: 120 });
					const canvasExpCrop = cropBinaryForegroundBoundingBox(canvasExpProc, {
						foreground: "white",
						margin: 4,
						targetHeight: 120,
						outPad: 6
					});
					const res = await recognizeExpBracketedWithText(canvasExpCrop);
					setOnboardingExpText(res.text || "");
					const cRaw = drawRoiCanvas(video, rect, { scale: 2 });
					setExpRoiShot(cRaw.toDataURL("image/png"));
				}
			} catch {
				// OCR 실패는 흔하므로 조용히 무시합니다.
			}
		};

		void tick();
		timer = window.setInterval(() => { void tick(); }, 1000) as unknown as number;
		return () => {
			if (timer) window.clearInterval(timer);
		};
	}, [onboardingOpen, roiLevel, roiExp, captureVideoRef]);

	return { levelRoiShot, expRoiShot, onboardingLevelText, onboardingExpText };
}


