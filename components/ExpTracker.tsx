"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isRoiRectOrNull, RoiRect } from "./RoiOverlay";
import { formatNumber } from "@/lib/format";
import { EXP_TABLE } from "@/lib/expTable";
import { computeLevelUpEta } from "@/lib/levelProgress";
import { couponAdjustedElapsedMs, couponAdjustedPace, normalizeCouponCount } from "@/lib/expCoupon";
import { paceForDuration } from "@/lib/pace";
import { formatRecognitionHealthOneLine } from "@/lib/recognitionHealth";
import type { NoticeHandler } from "@/lib/notice";
import { isBooleanValue, oneOf, usePersistentState } from "@/lib/persist";
import AlertDialog from "@/components/AlertDialog";
import { useDocumentPip, isDocumentPipSupported } from "@/lib/pip/useDocumentPip";
import type { PipState } from "@/lib/pip/types";
import OnboardingOverlay from "@/components/OnboardingOverlay";
import { useGlobalHotkey } from "@/hooks/useGlobalHotkey";
import TrackerToolbar from "@/components/exp-tracker/TrackerToolbar";
import TrackerSummary from "@/components/exp-tracker/TrackerSummary";
import DebugRecognitionPreview from "@/components/exp-tracker/DebugRecognitionPreview";
import LiveRecognitionBar from "@/components/exp-tracker/LiveRecognitionBar";
import RecognitionHealthBanner from "@/components/exp-tracker/RecognitionHealthBanner";
import RecordsModal from "@/components/exp-tracker/RecordsModal";
import SettingsModal from "@/components/exp-tracker/SettingsModal";
import SetupChecklist from "@/components/exp-tracker/SetupChecklist";
import ShareResultsActions from "@/components/exp-tracker/ShareResultsActions";
import { useDisplayCapture } from "@/features/exp-tracker/hooks/useDisplayCapture";
import { useRoiReadPreview } from "@/features/exp-tracker/hooks/useRoiReadPreview";
import { usePaceSeries } from "@/features/exp-tracker/hooks/usePaceSeries";
import { useStopwatch } from "@/features/exp-tracker/hooks/useStopwatch";
import { useIntervalRunner } from "@/features/exp-tracker/hooks/useIntervalRunner";
import { useSampling } from "@/features/exp-tracker/hooks/useSampling";
import { ExternalWsEvent, useExternalWsControl } from "@/features/exp-tracker/hooks/useExternalWsControl";
import type { ExpTrackerSnapshot } from "@/features/exp-tracker/records/types";
import { normalizeSnapshot } from "@/features/exp-tracker/records/snapshot";

type IntervalSec = 1 | 5 | 10;

// 저장된 설정 검증기: UI에서 고를 수 있는 값만 복원합니다.
// (모듈 스코프에 두는 이유 — 렌더마다 새 함수가 만들어지지 않게 하려고)
const INTERVAL_SEC_VALIDATOR = oneOf<IntervalSec>([1, 5, 10]);
const PACE_WINDOW_MIN_VALIDATOR = oneOf([1, 5, 10, 30, 60]);

export default function ExpTracker() {
	// 인식 샘플링에 사용하는 숨김(항상 마운트) 비디오
	const captureVideoRef = useRef<HTMLVideoElement | null>(null);
	// ROI 선택에만 사용하는 모달 프리뷰 비디오
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	// 캡처 스트림은 별도 훅에서 관리합니다.

	const [intervalSec, setIntervalSec] = usePersistentState<IntervalSec>(
		"intervalSec",
		1 as IntervalSec,
		INTERVAL_SEC_VALIDATOR
	);
	const [roiLevel, setRoiLevel] = usePersistentState<RoiRect | null>("roiLevel", null, isRoiRectOrNull);
	const [roiExp, setRoiExp] = usePersistentState<RoiRect | null>("roiExp", null, isRoiRectOrNull);
	const [paceWindowMin, setPaceWindowMin] = usePersistentState<number>("paceWindowMin", 60, PACE_WINDOW_MIN_VALIDATOR);
	const [expPercentValidationEnabled, setExpPercentValidationEnabled] = usePersistentState<boolean>(
		"expPercentValidationEnabled",
		true,
		isBooleanValue
	);
	// 차트의 인터랙티브 x축 범위(경과 ms). null이면 전체 범위.
	const [chartRangeMs, setChartRangeMs] = useState<[number, number] | null>(null);
	const [chartShowAxisLabels, setChartShowAxisLabels] = usePersistentState<boolean>(
		"chartShowAxisLabels",
		true,
		isBooleanValue
	);
	const [chartShowGrid, setChartShowGrid] = usePersistentState<boolean>("chartShowGrid", true, isBooleanValue);
	const expTable = EXP_TABLE;

	const [isSampling, setIsSampling] = useState(false); // 측정 중
	const [hasStarted, setHasStarted] = useState(false);
	// 측정 종료 후 입력하는 경험치 쿠폰(경쿠) 사용 개수. 측정별 값이라 초기화 시 함께 비웁니다.
	const [expCouponCount, setExpCouponCount] = useState(0);
	const [isPreparingSample, setIsPreparingSample] = useState(false);
	const stopwatch = useStopwatch();
	const sampler = useIntervalRunner();
	const elapsedMs = stopwatch.elapsedMs;

	const [activeRoi, setActiveRoi] = useState<"level" | "exp" | null>(null);
	const [debugEnabled, setDebugEnabled] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [recordsOpen, setRecordsOpen] = useState(false);
	const roiContainerRef = useRef<HTMLDivElement | null>(null);
	const summaryCaptureRef = useRef<HTMLDivElement | null>(null);
	const autoInitDoneRef = useRef<boolean>(false);
	// Onboarding
	const [onboardingDone, setOnboardingDone] = usePersistentState<boolean>("onboardingDone", false, isBooleanValue);
	const [onboardingOpen, setOnboardingOpen] = useState(false);
	const [onboardingStep, setOnboardingStep] = useState<number>(0);
	const [onboardingPausedForRoi, setOnboardingPausedForRoi] = useState<null | "level" | "exp">(null);
	const [roiSelectionMode, setRoiSelectionMode] = useState<null | "level" | "exp">(null);

	// 앱 내부 안내 모달. 네이티브 alert 대신 사용합니다.
	// (alert은 메인 스레드를 블로킹해서 측정 타이머/샘플링에도 영향을 줍니다)
	// 캡처 중단 안내도 이 모달을 씁니다.
	const [notice, setNotice] = useState<{ title?: string; message: string } | null>(null);
	const showNotice = useCallback<NoticeHandler>((message, title) => {
		setNotice({ message, title });
	}, []);

	// 화면/창 캡처 스트림 관리 (시작/중지 + 비디오 연결)
	const { stream, startCapture, stopCapture, ensureCapturePlaying } = useDisplayCapture({
		captureVideoRef,
		previewVideoRef,
		settingsOpen,
		// 캡처용 hidden video는 "측정/온보딩/측정 준비"에만 재생합니다.
		// (화면 공유만 켜둔 상태에서의 게임 끊김 리포트 완화 목적)
		// 디버그 미리보기를 켜면 측정 전에도 프레임이 필요합니다. (기본값 off라 평소에는 영향 없음)
		capturePlaybackWanted: isSampling || onboardingOpen || isPreparingSample || debugEnabled,
		// 유저 설정 없이 자동 전환:
		// - 설정 모달(ROI 잡기) 중에는 프리뷰가 부드럽도록 30fps
		// - 평소에는 게임 영향 최소화를 위해 3fps
		captureFps: settingsOpen ? 30 : 3,
		// 캡처가 우리 코드 밖에서 끊기면 측정을 자동으로 멈추고 알립니다.
		// (그대로 두면 정지된 마지막 프레임을 계속 읽어 "측정되는 것처럼" 보입니다)
		onStreamEnded: () => {
			if (isSamplingRef.current) void pauseSamplingRef.current();
			showNotice(
				"화면/창 공유가 끊겨서 측정을 일시정지했습니다.\n\n계속 측정하려면 설정에서 게임 창을 다시 선택해 주세요.\n(경과 시간과 누적 경험치는 그대로 유지됩니다)",
				"화면 공유가 중지되었습니다"
			);
		},
		onNotice: showNotice
	});
	const hasStream = !!stream;
	// PiP 이벤트 핸들러에서 오래된 클로저(stale closure)를 피하기 위한 ref들
	const {
		open: pipOpen,
		update: pipUpdate,
		close: pipClose,
		isOpen: pipIsOpen
	} = useDocumentPip({
		onToggle: () => {
			if (isSamplingRef.current) {
				pauseSamplingRef.current();
			} else {
				// 메인 UI와 동일: 캡처 스트림이 없으면 시작 불가
				if (!hasStreamRef.current) return;
				startOrResumeRef.current();
			}
		},
		onReset: () => {
			// 메인 UI와 동일: 타이머를 한 번도 시작하지 않았으면 초기화 불가
			if (!hasStartedRef.current) return;
			resetSamplingRef.current();
		},
		onNotice: showNotice
	});
	const [pipSupported, setPipSupported] = useState(false);
	useEffect(() => {
		// SSR/첫 클라이언트 렌더 불일치 방지: 마운트 이후 지원 여부를 판별합니다.
		setPipSupported(isDocumentPipSupported());
	}, []);
	const pipUnsupportedTooltip =
		"이 브라우저에서는 문서 PiP(Document Picture-in-Picture) 기능을 지원하지 않습니다. 이 기능을 사용하려면 최신 버전의 Chrome 또는 Edge 브라우저를 이용해 주세요.";
	// PiP 이벤트 핸들러에서 오래된 클로저(stale closure)를 피하기 위한 sampling 상태(ref)
	const isSamplingRef = useRef<boolean>(false);
	useEffect(() => {
		isSamplingRef.current = isSampling;
	}, [isSampling]);
	const hasStartedRef = useRef<boolean>(false);
	useEffect(() => {
		hasStartedRef.current = hasStarted;
	}, [hasStarted]);
	const hasStreamRef = useRef<boolean>(false);
	useEffect(() => {
		hasStreamRef.current = hasStream;
	}, [hasStream]);

	const sampling = useSampling({
		captureVideoRef,
		roiLevel,
		roiExp,
		expTable,
		debugEnabled,
		expPercentValidationEnabled,
		samplingActive: isSampling
	});

	// 인식 작업이 중첩 실행되지 않도록 방지합니다. (인식이 intervalSec보다 오래 걸릴 때 중요)
	// 이 가드가 없으면 setInterval이 여러 인식 작업을 동시에 쌓아 CPU 스파이크/끊김을 유발할 수 있습니다.
	const sampleInFlightRef = useRef<Promise<void> | null>(null);
	const runSampleOnce = useCallback(async () => {
		// 이미 샘플링이 실행 중이면 같은 Promise를 재사용합니다. (예: pause 시 완료를 기다릴 수 있음)
		if (sampleInFlightRef.current) return sampleInFlightRef.current;
		const p = sampling
			.sampleOnceAndAccumulate()
			.catch(() => {
				// 인식 실패는 흔할 수 있으므로 사용자 경험을 위해 조용히 무시합니다.
			})
			.finally(() => {
				sampleInFlightRef.current = null;
			}) as Promise<void>;
		sampleInFlightRef.current = p;
		return p;
	}, [sampling]);

	// 왜: 샘플링 인터벌 콜백이 "시작 시점의 runSampleOnce"를 붙잡고 있으면,
	// 측정 중에 바꾼 ROI / EXP% 검증 / 디버그 미리보기 설정이 재시작 전까지 반영되지 않습니다.
	// (특히 디버그 미리보기는 측정 중 폴링이 꺼지므로, 켜도 영원히 갱신되지 않았습니다)
	// 항상 최신 함수를 호출하도록 ref로 우회합니다.
	const runSampleOnceRef = useRef(runSampleOnce);
	useEffect(() => {
		runSampleOnceRef.current = runSampleOnce;
	}, [runSampleOnce]);

	// 첫 진입 시: 설정을 열고 "게임 창 선택" 또는 온보딩을 유도합니다.
	useEffect(() => {
		if (autoInitDoneRef.current) return;
		autoInitDoneRef.current = true;
		setSettingsOpen(true);
		if (!onboardingDone) {
			setOnboardingOpen(true);
			setOnboardingStep(0);
		} else {
			// 왜: 온보딩이 끝난 사용자는 바로 “게임 창 선택” 프롬프트가 뜨도록 시도합니다.
			// (단, 일부 브라우저는 사용자 제스처가 필요하므로 실패할 수 있습니다.)
			void (async () => {
				try {
					if (!stream) {
						await startCapture();
					}
				} catch {
					// 권한/사용자 제스처가 필요할 수 있으므로(실패 시) 모달은 열린 채로 둡니다.
				}
			})();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// 온보딩과 설정 모달 모두에서 "이 ROI가 지금 어떻게 읽히는지"를 1초마다 보여줍니다.
	//
	// 왜 프리뷰 비디오를 넘기는가: 두 창 모두 settingsOpen 상태에서만 열리고, 그때 실제로 재생 중인 건
	// 프리뷰 비디오입니다. (인식용 hidden video는 측정/온보딩이 아니면 pause되어 있습니다)
	// 두 비디오는 같은 MediaStream이라 videoWidth/Height가 같고, ROI는 비디오 픽셀 좌표라 그대로 통합니다.
	//
	// 썸네일(dataURL)은 실제로 그림을 보여주는 온보딩에서만 만듭니다. (toDataURL이 인식보다 비쌈)
	const {
		levelRoiShot,
		expRoiShot,
		levelText: roiLevelReadText,
		expText: roiExpReadText,
		validation: roiExpValidation
	} = useRoiReadPreview({
		active: settingsOpen || onboardingOpen,
		videoRef: previewVideoRef,
		roiLevel,
		roiExp,
		withThumbnails: onboardingOpen,
		refreshKey: onboardingStep,
		expTable,
		expPercentValidationEnabled
	});

	// 새 ROI가 설정되면(선택 완료) 선택 모드를 정리합니다.
	const handleChangeLevel = useCallback(
		(r: RoiRect | null) => {
			setRoiLevel(r);
			if (r && roiSelectionMode === "level") {
				setActiveRoi(null);
				setRoiSelectionMode(null);
				if (onboardingPausedForRoi === "level") {
					setOnboardingPausedForRoi(null);
					setOnboardingOpen(true);
				}
			}
		},
		[setRoiLevel, roiSelectionMode, onboardingPausedForRoi]
	);
	const handleChangeExp = useCallback(
		(r: RoiRect | null) => {
			setRoiExp(r);
			if (r && roiSelectionMode === "exp") {
				setActiveRoi(null);
				setRoiSelectionMode(null);
				if (onboardingPausedForRoi === "exp") {
					setOnboardingPausedForRoi(null);
					setOnboardingOpen(true);
				}
			}
		},
		[setRoiExp, roiSelectionMode, onboardingPausedForRoi]
	);

	const startOrResume = useCallback(async () => {
		// 툴바 비활성 상태와 동일: 활성 캡처 스트림이 없으면 시작 불가
		if (!stream) return;
		if (!captureVideoRef.current) return;
		if (!roiLevel || !roiExp) {
			showNotice("먼저 설정에서 레벨/경험치 영역(ROI)을 지정해 주세요.", "측정을 시작할 수 없습니다");
			return;
		}
		// 시작/재개 직후 baseline(기준점)을 prev로 기록합니다.
		// - 누적/차트 히스토리는 증가시키지 않음
		// - baseline이 %↔값 불일치 등으로 이상하면, 이번 틱은 무시하고 다음 틱을 첫 틱으로 삼음
		setIsPreparingSample(true);
		try {
			// 인식 전에 캡처 비디오가 실제 프레임을 내고 있는지 보장합니다.
			await ensureCapturePlaying();
			await sampling.captureBaseline({ resetTotals: !hasStarted });
		} finally {
			setIsPreparingSample(false);
		}
		if (!hasStarted) {
			setHasStarted(true);
			stopwatch.reset();
		}

		// 타이머 시작
		stopwatch.start();

		// 샘플링 인터벌은 아래 effect가 소유합니다. (isSampling/intervalSec 변화에 따라 재시작)
		setIsSampling(true);
	}, [stream, roiLevel, roiExp, hasStarted, stopwatch, sampling, ensureCapturePlaying, showNotice]);

	// 샘플링 인터벌의 생명주기를 한곳에서 관리합니다.
	// - 왜: 측정 중 "측정 주기"를 바꿔도 즉시 반영되어야 하고, 인터벌 clear 누락도 막을 수 있습니다.
	// - setInterval 콜백에서 async/await를 직접 쓰면 예외가 unhandled로 튈 수 있어 void로 소거합니다.
	useEffect(() => {
		if (!isSampling) return;
		sampler.start(intervalSec * 1000, () => {
			void runSampleOnceRef.current();
		});
		return () => {
			sampler.stop();
		};
	}, [isSampling, intervalSec, sampler]);

	const pauseSampling = useCallback(async () => {
		// 상태를 고정하기 위해 타이머를 먼저 멈춥니다.
		sampler.stop();
		stopwatch.pause();
		// 일시정지 시점에 즉시 1회 샘플링합니다. (intervalSec과 무관)
		await runSampleOnce();
		setIsSampling(false);
	}, [runSampleOnce, sampler, stopwatch]);

	const resetSampling = useCallback(() => {
		// 툴바 비활성 상태와 동일: 첫 시작 전에는 초기화 불가
		if (!hasStarted) return;
		sampler.stop();
		stopwatch.reset();
		sampling.resetTotals();
		setIsSampling(false);
		setIsPreparingSample(false);
		setHasStarted(false);
		setExpCouponCount(0);
	}, [hasStarted, sampler, stopwatch, sampling]);

	// PiP 핸들러에서 stale closure를 피하기 위해 최신 함수 ref를 유지합니다.
	const startOrResumeRef = useRef(startOrResume);
	useEffect(() => {
		startOrResumeRef.current = startOrResume;
	}, [startOrResume]);
	const pauseSamplingRef = useRef(pauseSampling);
	useEffect(() => {
		pauseSamplingRef.current = pauseSampling;
	}, [pauseSampling]);
	const resetSamplingRef = useRef(resetSampling);
	useEffect(() => {
		resetSamplingRef.current = resetSampling;
	}, [resetSampling]);

	// 외부(로컬) WebSocket 메시지로 측정 제어 (고급 사용자용, UI 비노출)
	// - 기본값: 비활성 (성능 영향 없음)
	// - 활성화 방법(개발자 도구 Console):
	//   localStorage.setItem("externalWsEnabled", "true")
	//   localStorage.setItem("externalWsUrl", "ws://127.0.0.1:21537")
	//   이후 페이지 새로고침
	const [externalWsConfig, setExternalWsConfig] = useState<{ enabled: boolean; url: string }>(() => ({
		enabled: false,
		url: "ws://127.0.0.1:21537"
	}));
	useEffect(() => {
		try {
			const enabledRaw = window.localStorage.getItem("externalWsEnabled");
			const enabled = enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "yes";
			const url = window.localStorage.getItem("externalWsUrl") || "ws://127.0.0.1:21537";
			setExternalWsConfig({ enabled, url });
		} catch {
			// localStorage 접근이 막힌 환경에서는 자동으로 비활성 상태를 유지합니다.
			setExternalWsConfig({ enabled: false, url: "ws://127.0.0.1:21537" });
		}
	}, []);
	const onExternalWsEvent = useCallback((ev: ExternalWsEvent) => {
		const t = ev.type;
		if (t === "toggle") {
			if (isSamplingRef.current) {
				void pauseSamplingRef.current();
			} else {
				// 메인 UI와 동일: 캡처 스트림이 없으면 시작 불가
				if (!hasStreamRef.current) return;
				void startOrResumeRef.current();
			}
			return;
		}
		if (t === "start") {
			if (!hasStreamRef.current) return;
			if (!isSamplingRef.current) void startOrResumeRef.current();
			return;
		}
		if (t === "pause") {
			if (isSamplingRef.current) void pauseSamplingRef.current();
			return;
		}
		if (t === "reset") {
			if (hasStartedRef.current) resetSamplingRef.current();
		}
	}, []);
	const externalWs = useExternalWsControl({
		enabled: externalWsConfig.enabled,
		url: externalWsConfig.url,
		onEvent: onExternalWsEvent
	});

	const stats = useMemo(() => {
		if (!hasStarted) return null;
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		const gainedPctPoints = sampling.cumExpPct; // 샘플 누적
		const ratePerSec = elapsedSec > 0 ? gainedPctPoints / elapsedSec : 0;
		// 동적 "N시간 되는 시각": N = floor(elapsed/3600)+1
		const nextHours = Math.floor(elapsedSec / 3600) + 1;
		const remainingSec = Math.max(0, nextHours * 3600 - elapsedSec);
		const nextAt = new Date(Date.now() + remainingSec * 1000);
		return {
			elapsedSec,
			gainedPctPoints,
			ratePerSec,
			nextHours,
			nextAt
		};
	}, [elapsedMs, hasStarted, sampling.cumExpPct]);

	// 레벨업까지 남은 시간/경험치. (웹 페이지 전용 — PiP는 폭이 좁아 노출하지 않습니다)
	const levelUpEta = useMemo(() => {
		if (!hasStarted) return null;
		return computeLevelUpEta({
			table: expTable,
			level: sampling.currentLevel,
			currentExpValue: sampling.currentExpValue,
			cumExpValue: sampling.cumExpValue,
			elapsedMs
		});
	}, [hasStarted, expTable, sampling.currentLevel, sampling.currentExpValue, sampling.cumExpValue, elapsedMs]);

	// 경과 시간을 이용해 누적값을 비례 환산합니다:
	// paceAtWindow(targetMinutes) = cumulative * (targetMinutes / elapsedMinutes)
	const paceAtWindow = useMemo(() => {
		return paceForDuration({
			cumExpValue: sampling.cumExpValue,
			cumExpPct: sampling.cumExpPct,
			durationMs: elapsedMs,
			windowMin: paceWindowMin
		});
	}, [elapsedMs, paceWindowMin, sampling.cumExpPct, sampling.cumExpValue]);

	// 경험치 쿠폰 보정: 쿠폰 1개(15분)만큼 사냥 시간이 늘어난 것으로 보고 페이스를 다시 계산합니다.
	// (웹 페이지 전용 — PiP에는 노출하지 않습니다.)
	const couponAdjustedElapsed = useMemo(
		() => couponAdjustedElapsedMs(elapsedMs, expCouponCount),
		[elapsedMs, expCouponCount]
	);
	const couponPace = useMemo(() => {
		return couponAdjustedPace({
			cumExpValue: sampling.cumExpValue,
			cumExpPct: sampling.cumExpPct,
			elapsedMs,
			couponCount: expCouponCount,
			windowMin: paceWindowMin
		});
	}, [elapsedMs, expCouponCount, paceWindowMin, sampling.cumExpPct, sampling.cumExpValue]);

	// Space: 측정 시작/일시정지 토글 (입력 폼 포커스 시에는 무시)
	useGlobalHotkey({
		match: (e) => e.code === "Space" || e.key === " ",
		onTrigger: () => {
			if (isSampling) {
				pauseSampling();
			} else {
				// 툴바 비활성 상태와 동일: 캡처 창을 선택하지 않으면 시작 불가
				if (!stream) return;
				void startOrResume();
			}
		}
	});

	// R: 초기화 (브라우저 새로고침 단축키 Cmd/Ctrl+R은 제외)
	useGlobalHotkey({
		match: (e) => (e.code === "KeyR" || e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey,
		onTrigger: () => {
			if (hasStarted) resetSampling();
		},
		preventDefault: false
	});

	// ESC: ROI 선택 중이면 ROI 모드를 취소합니다. 온보딩이 ROI 때문에 일시정지된 상태면 튜토리얼로 복귀합니다.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && (activeRoi || roiSelectionMode)) {
				e.preventDefault();
				e.stopPropagation();
				setActiveRoi(null);
				setRoiSelectionMode(null);
				if (onboardingPausedForRoi) {
					setOnboardingPausedForRoi(null);
					setOnboardingOpen(true);
				}
			}
		};
		// 왜: 모달 닫기 같은 다른 ESC 핸들러보다 먼저 처리해야, ROI 선택 취소가 확실히 동작합니다.
		const opts: AddEventListenerOptions = { capture: true };
		window.addEventListener("keydown", onKey, opts);
		return () => {
			window.removeEventListener("keydown", onKey, opts);
		};
	}, [activeRoi, roiSelectionMode, onboardingPausedForRoi]);

	// 온보딩(튜토리얼) 중 ESC: "건너뛰기"와 동일하게 동작(튜토리얼/설정 닫기)
	useEffect(() => {
		if (!onboardingOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setOnboardingDone(true);
				setOnboardingOpen(false);
				setActiveRoi(null);
				setSettingsOpen(false);
			}
		};
		// 다른 ESC 핸들러(예: 모달)보다 먼저 잡기 위해 capture로 등록합니다.
		const opts: AddEventListenerOptions = { capture: true };
		window.addEventListener("keydown", onKey, opts);
		return () => {
			window.removeEventListener("keydown", onKey, opts);
		};
	}, [onboardingOpen, setOnboardingDone]);

	// 게임 창(ROI 컨테이너) 밖을 클릭하면 ROI 선택 모드를 취소합니다.
	useEffect(() => {
		const onMouseDown = (e: MouseEvent) => {
			if (!activeRoi && !roiSelectionMode) return;
			const container = roiContainerRef.current;
			if (!container) return;
			const target = e.target as Node | null;
			if (target && container.contains(target)) {
				return; // ROI 컨테이너 내부 클릭은 무시
			}
			// ROI 컨테이너 밖 클릭: ROI 모드 취소
			setActiveRoi(null);
			setRoiSelectionMode(null);
			if (onboardingPausedForRoi) {
				setOnboardingPausedForRoi(null);
				setOnboardingOpen(true);
			}
		};
		// 하위 엘리먼트가 나중에 전파를 막더라도 확실히 받기 위해 capture로 등록합니다.
		window.addEventListener("mousedown", onMouseDown, true);
		return () => {
			try {
				window.removeEventListener("mousedown", onMouseDown, true);
			} catch {
				window.removeEventListener("mousedown", onMouseDown);
			}
		};
	}, [activeRoi, roiSelectionMode, onboardingPausedForRoi]);

	const updatePipContents = useCallback(() => {
		const state: PipState = {
			isSampling,
			elapsedMs,
			nextAt: stats ? stats.nextAt : null,
			nextHours: stats ? stats.nextHours : null,
			gainedText: `${formatNumber(sampling.cumExpValue)} [${sampling.cumExpPct.toFixed(2)}%]`,
			paceText: `${formatNumber(paceAtWindow.val)} [${paceAtWindow.pct.toFixed(2)}%] / ${paceWindowMin}분`,
			// PiP는 폭이 좁으므로 원인 한 줄만 보냅니다. (조치 안내는 메인 창에 있습니다)
			healthText: sampling.healthNotice ? formatRecognitionHealthOneLine(sampling.healthNotice) : null
		};
		pipUpdate(state);
	}, [
		isSampling,
		elapsedMs,
		stats,
		sampling.cumExpValue,
		sampling.cumExpPct,
		sampling.healthNotice,
		paceAtWindow.val,
		paceAtWindow.pct,
		paceWindowMin,
		pipUpdate
	]);

	// 관련 값이 바뀔 때마다 PiP 내용을 동기화합니다.
	useEffect(() => {
		updatePipContents();
	}, [updatePipContents]);

	const openPip = useCallback(async () => {
		await pipOpen();
		updatePipContents(); // 최초 렌더
	}, [pipOpen, updatePipContents]);

	// P: PiP 열기 (입력 폼 포커스 시에는 무시)
	useGlobalHotkey({
		match: (e) => (e.code === "KeyP" || e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey,
		onTrigger: () => {
			if (!pipSupported) return;
			if (pipIsOpen()) return;
			void openPip();
		}
	});

	// ----- 페이스 히스토리/시리즈 (시간 정규화) -----
	const pace = usePaceSeries({
		hasStarted,
		sampleTick: sampling.sampleTick,
		lastSampleTsRef: sampling.lastSampleTsRef,
		cumExpValue: sampling.cumExpValue,
		cumExpPct: sampling.cumExpPct,
		elapsedMs,
		paceWindowMin
	});
	const { paceOverallSeries, recentPaceSeries, cumulativeSeries } = pace;

	// 차트 모드 토글
	const [chartMode, setChartMode] = useState<"pace" | "paceRecent" | "cumulative">("pace");

	// 설정 모달을 열고 곧바로 특정 ROI 선택 모드로 들어갑니다. (체크리스트/온보딩에서 재사용)
	const beginRoiSelection = useCallback((kind: "level" | "exp") => {
		setSettingsOpen(true);
		setRoiSelectionMode(kind);
		setActiveRoi(kind);
	}, []);

	// 설정 모달 안의 ROI 버튼: 같은 버튼을 다시 누르면 선택 모드를 끕니다.
	const toggleRoiSelection = useCallback(
		(kind: "level" | "exp") => {
			if (activeRoi === kind) {
				setActiveRoi(null);
				setRoiSelectionMode(null);
				return;
			}
			setActiveRoi(kind);
			setRoiSelectionMode(kind);
		},
		[activeRoi]
	);

	// 왜 문구로 들고 있는가: 비활성 버튼만 보여주면 무엇이 빠졌는지 알 수 없어서, 툴바 툴팁으로 알립니다.
	// (같은 조건을 화면 위 체크리스트도 씁니다)
	const startDisabledReason = !hasStream
		? "먼저 설정에서 게임 창을 선택해 주세요."
		: !roiLevel || !roiExp
			? "먼저 설정에서 레벨/경험치 영역(ROI)을 지정해 주세요."
			: null;

	// x축 레이블은 경과 시간(ms)을 바로 사용

	return (
		<div className="space-y-4">
			<TrackerToolbar
				isSampling={isSampling}
				hasStarted={hasStarted}
				startDisabledReason={startDisabledReason}
				pipSupported={pipSupported}
				pipUnsupportedTooltip={pipUnsupportedTooltip}
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenRecords={() => setRecordsOpen(true)}
				onStart={() => {
					void startOrResume();
				}}
				onPause={() => {
					void pauseSampling();
				}}
				onReset={resetSampling}
				onOpenPip={() => {
					void openPip();
				}}
			/>

			<RecognitionHealthBanner notice={sampling.healthNotice} />

			{/* 측정 중에만 노출합니다. 측정하지 않을 때는 인식 자체를 돌리지 않으므로 보여줄 값도 없습니다. */}
			<LiveRecognitionBar live={isSampling ? sampling.liveRecognition : null} />

			{/* 준비가 덜 됐을 때만 나타납니다. (요약 카드 밖 — 카드는 "결과 이미지 복사"로 통째로 캡처됩니다) */}
			{!isSampling ? (
				<SetupChecklist
					hasStream={hasStream}
					hasLevelRoi={!!roiLevel}
					hasExpRoi={!!roiExp}
					onSelectWindow={() => {
						setSettingsOpen(true);
						void startCapture();
					}}
					onSetupLevelRoi={() => beginRoiSelection("level")}
					onSetupExpRoi={() => beginRoiSelection("exp")}
				/>
			) : null}

			<TrackerSummary
				captureRef={summaryCaptureRef}
				elapsedMs={elapsedMs}
				isSampling={isSampling}
				stalledReason={sampling.healthNotice ? formatRecognitionHealthOneLine(sampling.healthNotice) : null}
				levelUpEta={levelUpEta}
				stats={stats ? { nextAt: stats.nextAt, nextHours: stats.nextHours } : null}
				cumExpValue={sampling.cumExpValue}
				cumExpPct={sampling.cumExpPct}
				paceWindowMin={paceWindowMin}
				paceAtWindow={paceAtWindow}
				intervalSec={intervalSec}
				showCouponPanel={hasStarted && !isSampling}
				expCouponCount={expCouponCount}
				onExpCouponCountChange={(n) => setExpCouponCount(normalizeCouponCount(n))}
				couponAdjustedElapsedMs={couponAdjustedElapsed}
				couponAdjustedPace={couponPace}
				chartMode={chartMode}
				onChartModeChange={setChartMode}
				chartRangeMs={chartRangeMs}
				onChartRangeChange={setChartRangeMs}
				chartShowAxisLabels={chartShowAxisLabels}
				onChartShowAxisLabelsChange={setChartShowAxisLabels}
				chartShowGrid={chartShowGrid}
				onChartShowGridChange={setChartShowGrid}
				paceOverallSeries={paceOverallSeries}
				recentPaceSeries={recentPaceSeries}
				cumulativeSeries={cumulativeSeries}
			/>

			{/* 공유/복사 버튼 (요약 카드 아래, 우측 정렬) */}
			<div className="flex justify-end">
				<ShareResultsActions
					hasStarted={hasStarted}
					elapsedMs={elapsedMs}
					cumExpValue={sampling.cumExpValue}
					cumExpPct={sampling.cumExpPct}
					paceWindowMin={paceWindowMin}
					paceValue={paceAtWindow.val}
					pacePct={paceAtWindow.pct}
					expCouponCount={expCouponCount}
					couponAdjustedElapsedMs={couponAdjustedElapsed}
					couponPaceValue={couponPace.val}
					couponPacePct={couponPace.pct}
					getSummaryEl={() => summaryCaptureRef.current}
					onNotice={showNotice}
				/>
			</div>

			{debugEnabled && (
				<DebugRecognitionPreview
					levelPreviewRaw={sampling.levelPreviewRaw}
					levelPreviewProc={sampling.levelPreviewProc}
					expPreviewRaw={sampling.expPreviewRaw}
					expPreviewProc={sampling.expPreviewProc}
					levelReadText={sampling.levelReadText}
					expReadText={sampling.expReadText}
					parsedLevel={sampling.parsedLevel}
					parsedExpValue={sampling.parsedExpValue}
					parsedExpPercent={sampling.parsedExpPercent}
					expValidation={sampling.expValidation}
				/>
			)}

			<RecordsModal
				open={recordsOpen}
				onClose={() => setRecordsOpen(false)}
				canSave={hasStarted && !isSampling && !stopwatch.isRunning}
				canLoad={!isSampling && !stopwatch.isRunning}
				paceWindowMin={paceWindowMin}
				getSnapshot={() => {
					const snap: ExpTrackerSnapshot = {
						version: 4,
						capturedAt: Date.now(),
						runtime: {
							hasStarted,
							expCouponCount
						},
						stopwatch: stopwatch.getSnapshot(),
						sampling: sampling.getSnapshot(),
						pace: pace.getSnapshot()
					};
					return snap;
				}}
				applySnapshot={(raw) => {
					const snap = normalizeSnapshot(raw);
					// 먼저 실행 중인 루프를 모두 중단합니다.
					sampler.stop();
					setIsSampling(false);
					setSettingsOpen(false);
					setActiveRoi(null);
					setRoiSelectionMode(null);
					setOnboardingOpen(false);

					// 핵심 계산 상태
					const nextHasStarted = !!snap.runtime.hasStarted;
					setHasStarted(nextHasStarted);
					setExpCouponCount(nextHasStarted ? normalizeCouponCount(snap.runtime.expCouponCount) : 0);
					sampling.applySnapshot(snap.sampling);
					// 제약/UX: 로드 시 자동 실행하지 않기 위해 항상 "일시정지"로 복원합니다.
					stopwatch.applySnapshot({ ...snap.stopwatch, isRunning: false });
					// handledTick으로 복원된 sampleTick을 함께 넘겨, 복원 직후 중복 포인트가 append되지 않게 합니다.
					pace.applySnapshot(
						nextHasStarted ? snap.pace : { history: [] },
						nextHasStarted ? snap.sampling.sampleTick : 0
					);
				}}
			/>

			<SettingsModal
				open={settingsOpen}
				onClose={() => setSettingsOpen(false)}
				disableEscClose={activeRoi !== null || onboardingOpen}
				hasStream={hasStream}
				onStartCapture={() => {
					void startCapture();
				}}
				onStopCapture={stopCapture}
				previewVideoRef={previewVideoRef}
				roiContainerRef={roiContainerRef}
				roiLevel={roiLevel}
				roiExp={roiExp}
				onChangeLevel={handleChangeLevel}
				onChangeExp={handleChangeExp}
				activeRoi={activeRoi}
				onActiveRoiChange={setActiveRoi}
				onToggleRoiMode={toggleRoiSelection}
				onCancelSelection={() => {
					setActiveRoi(null);
					setRoiSelectionMode(null);
					if (onboardingPausedForRoi) {
						setOnboardingPausedForRoi(null);
						setOnboardingOpen(true);
					}
				}}
				levelReadText={roiLevelReadText}
				expReadText={roiExpReadText}
				expValidation={roiExpValidation}
				intervalSec={intervalSec}
				onIntervalSecChange={(sec) => setIntervalSec(sec as IntervalSec)}
				paceWindowMin={paceWindowMin}
				onPaceWindowMinChange={setPaceWindowMin}
				expPercentValidationEnabled={expPercentValidationEnabled}
				onExpPercentValidationEnabledChange={setExpPercentValidationEnabled}
				debugEnabled={debugEnabled}
				onDebugEnabledChange={setDebugEnabled}
				onReplayTutorial={() => {
					// 왜 onboardingDone을 되돌리지 않는가: "다시 보기"는 일회성이고, 다음 방문에 또 뜨면 안 됩니다.
					setActiveRoi(null);
					setRoiSelectionMode(null);
					setOnboardingPausedForRoi(null);
					setOnboardingStep(0);
					setOnboardingOpen(true);
				}}
			/>
			{/* 인식 샘플링용 숨김 비디오(항상 마운트) */}
			<video ref={captureVideoRef} className="hidden" muted playsInline />
			<AlertDialog
				open={!!notice}
				title={notice?.title ?? "알림"}
				message={notice?.message ?? ""}
				onClose={() => setNotice(null)}
			/>
			<OnboardingOverlay
				open={onboardingOpen}
				step={onboardingStep}
				hasStream={!!stream}
				pipSupported={pipSupported}
				onSelectWindow={async () => {
					setSettingsOpen(true);
					await startCapture();
				}}
				onActivateLevel={() => {
					setOnboardingOpen(false);
					setOnboardingPausedForRoi("level");
					beginRoiSelection("level");
				}}
				onActivateExp={() => {
					setOnboardingOpen(false);
					setOnboardingPausedForRoi("exp");
					beginRoiSelection("exp");
				}}
				onSetIntervalSec={(sec: number) => setIntervalSec(sec as IntervalSec)}
				currentIntervalSec={intervalSec}
				hasLevelRoi={!!roiLevel}
				levelRoiPreview={levelRoiShot}
				hasExpRoi={!!roiExp}
				expRoiPreview={expRoiShot}
				levelReadText={roiLevelReadText}
				expReadText={roiExpReadText}
				onOpenPip={() => {
					void openPip();
				}}
				onNext={() => {
					setOnboardingStep((s) => Math.min(s + 1, 4));
					// 단계별로 도움이 되는 모드를 자동 토글합니다.
					setSettingsOpen(true);
					if (onboardingStep === 1) setActiveRoi("level");
					if (onboardingStep === 2) setActiveRoi("exp");
					if (onboardingStep >= 4) {
						setOnboardingDone(true);
						setOnboardingOpen(false);
						setActiveRoi(null);
						setSettingsOpen(false);
					}
				}}
				onSkip={() => {
					setOnboardingDone(true);
					setOnboardingOpen(false);
					setActiveRoi(null);
					setSettingsOpen(false);
				}}
				onClose={() => {
					setOnboardingOpen(false);
				}}
			/>
		</div>
	);
}
