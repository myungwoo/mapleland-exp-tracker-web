import { useEffect, useRef, useState } from "react";
import { drawRoiCanvas, toVideoSpaceRect } from "@/lib/canvas";
import { recognizeExp, recognizeLevel } from "@/lib/recognize";
import { describeExpValidation, type ExpValidationResult } from "@/lib/expValidation";
import type { ExpTable } from "@/lib/expTable";
import type { RoiRect } from "@/components/RoiOverlay";

type Options = {
	/** 갱신을 돌릴지 여부입니다. (온보딩 또는 설정 모달이 열려 있을 때) */
	active: boolean;
	/**
	 * 인식에 사용할 비디오입니다.
	 * 호출자가 "지금 실제로 재생 중인" 비디오를 넘겨야 합니다. (설정 모달이 열려 있으면 프리뷰 비디오)
	 */
	videoRef: React.MutableRefObject<HTMLVideoElement | null>;
	roiLevel: RoiRect | null;
	roiExp: RoiRect | null;
	/**
	 * ROI 썸네일(dataURL)도 만들지 여부입니다.
	 * - 왜 옵션인가: `toDataURL()`은 인식 자체보다 훨씬 비쌉니다. 온보딩처럼 실제로 그림을 보여주는
	 *   곳에서만 켜고, 판독 텍스트만 필요한 곳(설정 모달의 ROI 상태 표시)에서는 끕니다.
	 */
	withThumbnails?: boolean;
	/** 값이 바뀌면 즉시 한 번 다시 읽습니다. (온보딩 단계 이동 등) */
	refreshKey?: unknown;
	/** EXP%↔값 검증 결과도 함께 계산합니다. (측정 루프와 같은 판정을 씁니다) */
	expTable: ExpTable;
	expPercentValidationEnabled: boolean;
};

/**
 * ROI를 1초마다 다시 읽어, "지금 이 영역이 제대로 읽히는지"를 즉시 보여주는 훅입니다.
 *
 * - 왜 측정 루프를 쓰지 않는가: 측정 전(설정/온보딩 중)에도 확인이 필요하고, 이 결과는 누적에
 *   반영하면 안 되기 때문입니다.
 * - 비용: 픽셀 글꼴 템플릿 매칭이라 ROI 하나당 1ms 미만입니다. 1초에 두 번 도는 정도는
 *   측정 루프(1초 주기)와 같은 수준이라 문제되지 않습니다. 비싼 건 `toDataURL()` 쪽입니다.
 */
export function useRoiReadPreview(options: Options) {
	const {
		active,
		videoRef,
		roiLevel,
		roiExp,
		withThumbnails = false,
		refreshKey,
		expTable,
		expPercentValidationEnabled
	} = options;

	const [levelRoiShot, setLevelRoiShot] = useState<string | null>(null);
	const [expRoiShot, setExpRoiShot] = useState<string | null>(null);
	const [levelText, setLevelText] = useState<string | null>(null);
	const [expText, setExpText] = useState<string | null>(null);
	const [validation, setValidation] = useState<ExpValidationResult | null>(null);

	// 매 초 캔버스를 새로 만들지 않도록 재사용합니다.
	// 중요: SSR 렌더 단계에서는 document가 없으므로 캔버스를 즉시 생성하면 안 됩니다.
	const levelRawCanvasRef = useRef<HTMLCanvasElement | null>(null);
	// 레벨도 픽셀 글꼴 매칭용 원본 배율 ROI가 필요합니다.
	const levelNativeCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const expRawCanvasRef = useRef<HTMLCanvasElement | null>(null);
	// 픽셀 글꼴 매칭용 원본 배율 ROI (확대/이진화하면 글리프가 뭉개져서 인식이 망가집니다)
	const expNativeCanvasRef = useRef<HTMLCanvasElement | null>(null);

	const getOrCreateCanvas = (r: React.MutableRefObject<HTMLCanvasElement | null>) => {
		if (!r.current) r.current = document.createElement("canvas");
		return r.current;
	};

	useEffect(() => {
		if (!active) return;
		let timer: number | null = null;
		// 왜: 인식이 1초보다 오래 걸리면 tick이 큐에 쌓여서, 창을 닫은 뒤에도 밀린 작업이 계속 돕니다.
		// 진행 중이면 이번 tick은 그냥 건너뜁니다. (미리보기는 다음 tick에 갱신되면 충분)
		let inFlight = false;

		const tick = async () => {
			const video = videoRef.current;
			if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
			if (inFlight) return;
			inFlight = true;
			// 검증은 레벨과 EXP를 모두 읽은 뒤에야 판정할 수 있어서, 이번 tick의 판독을 모아 둡니다.
			let readLevel: number | null = null;
			let readExpValue: number | null = null;
			let readExpPercent: number | null = null;
			try {
				if (roiLevel) {
					const rect = toVideoSpaceRect(video, roiLevel);
					// 측정 루프와 동일하게 원본 배율 ROI를 픽셀 글꼴로 읽습니다.
					// (ROI가 제대로 잡혔는지 확인하는 게 목적이므로 같은 경로를 써야 의미가 있습니다)
					const canvasLevelNative = drawRoiCanvas(video, rect, {
						scale: 1,
						outCanvas: getOrCreateCanvas(levelNativeCanvasRef)
					});
					const res = recognizeLevel(canvasLevelNative);
					setLevelText(res.text || "");
					readLevel = res.value;
					if (withThumbnails) {
						const cRaw = drawRoiCanvas(video, rect, { scale: 2, outCanvas: getOrCreateCanvas(levelRawCanvasRef) });
						setLevelRoiShot(cRaw.toDataURL("image/png"));
					}
				}
				if (roiExp) {
					const rect = toVideoSpaceRect(video, roiExp);
					const canvasExpNative = drawRoiCanvas(video, rect, {
						scale: 1,
						outCanvas: getOrCreateCanvas(expNativeCanvasRef)
					});
					const res = recognizeExp(canvasExpNative);
					setExpText(res.text || "");
					readExpValue = res.value;
					readExpPercent = res.percent;
					if (withThumbnails) {
						const cRaw = drawRoiCanvas(video, rect, { scale: 2, outCanvas: getOrCreateCanvas(expRawCanvasRef) });
						setExpRoiShot(cRaw.toDataURL("image/png"));
					}
				}
				// ROI를 둘 다 지정하기 전에는 판정할 값 자체가 없으므로 검증도 띄우지 않습니다.
				setValidation(
					roiLevel && roiExp
						? describeExpValidation({
								table: expTable,
								enabled: expPercentValidationEnabled,
								level: readLevel,
								expValue: readExpValue,
								expPercent: readExpPercent
							})
						: null
				);
			} catch {
				// 인식 실패는 흔하므로 조용히 무시합니다.
			} finally {
				inFlight = false;
			}
		};

		void tick();
		timer = window.setInterval(() => {
			void tick();
		}, 1000) as unknown as number;
		return () => {
			if (timer) window.clearInterval(timer);
		};
	}, [active, roiLevel, roiExp, videoRef, withThumbnails, refreshKey, expTable, expPercentValidationEnabled]);

	return { levelRoiShot, expRoiShot, levelText, expText, validation };
}
