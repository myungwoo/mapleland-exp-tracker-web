"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoiOverlay, { RoiRect } from "./RoiOverlay";
import { initOcr } from "@/lib/ocr";
import { formatNumber } from "@/lib/format";
import { EXP_TABLE } from "@/lib/expTable";
import { usePersistentState } from "@/lib/persist";
import { cn } from "@/lib/cn";
import Modal from "./Modal";
import { useDocumentPip, isDocumentPipSupported } from "@/lib/pip/useDocumentPip";
import type { PipState } from "@/lib/pip/types";
import OnboardingOverlay from "@/components/OnboardingOverlay";
import { useGlobalHotkey } from "@/hooks/useGlobalHotkey";
import TrackerToolbar from "@/components/exp-tracker/TrackerToolbar";
import TrackerSummary from "@/components/exp-tracker/TrackerSummary";
import DebugOcrPreview from "@/components/exp-tracker/DebugOcrPreview";
import RecordsModal from "@/components/exp-tracker/RecordsModal";
import ShareResultsActions from "@/components/exp-tracker/ShareResultsActions";
import LocalWsTestPanel from "@/components/exp-tracker/LocalWsTestPanel";
import { useDisplayCapture } from "@/features/exp-tracker/hooks/useDisplayCapture";
import { useOnboardingRoiAssist } from "@/features/exp-tracker/hooks/useOnboardingRoiAssist";
import { usePaceSeries } from "@/features/exp-tracker/hooks/usePaceSeries";
import { useStopwatch } from "@/features/exp-tracker/hooks/useStopwatch";
import { useIntervalRunner } from "@/features/exp-tracker/hooks/useIntervalRunner";
import { useOcrSampling } from "@/features/exp-tracker/hooks/useOcrSampling";
import type { ExpTrackerSnapshot } from "@/features/exp-tracker/records/types";
import { normalizeSnapshot } from "@/features/exp-tracker/records/snapshot";

type IntervalSec = 1 | 5 | 10;

export default function ExpTracker() {
	// OCR 샘플링에 사용하는 숨김(항상 마운트) 비디오
	const captureVideoRef = useRef<HTMLVideoElement | null>(null);
	// ROI 선택에만 사용하는 모달 프리뷰 비디오
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	// 캡처 스트림은 별도 훅에서 관리합니다.

	const [intervalSec, setIntervalSec] = usePersistentState<IntervalSec>("intervalSec", 1 as IntervalSec);
	const [roiLevel, setRoiLevel] = usePersistentState<RoiRect | null>("roiLevel", null);
	const [roiExp, setRoiExp] = usePersistentState<RoiRect | null>("roiExp", null);
	const [paceWindowMin, setPaceWindowMin] = usePersistentState<number>("paceWindowMin", 60);
	// 차트의 인터랙티브 x축 범위(경과 ms). null이면 전체 범위.
	const [chartRangeMs, setChartRangeMs] = useState<[number, number] | null>(null);
	const [chartShowAxisLabels, setChartShowAxisLabels] = usePersistentState<boolean>("chartShowAxisLabels", true);
	const [chartShowGrid, setChartShowGrid] = usePersistentState<boolean>("chartShowGrid", true);
	const expTable = EXP_TABLE;

	const [isSampling, setIsSampling] = useState(false); // 측정 중
	const [hasStarted, setHasStarted] = useState(false);
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
	const [onboardingDone, setOnboardingDone] = usePersistentState<boolean>("onboardingDone", false);
	const [onboardingOpen, setOnboardingOpen] = useState(false);
	const [onboardingStep, setOnboardingStep] = useState<number>(0);
	const [onboardingPausedForRoi, setOnboardingPausedForRoi] = useState<null | "level" | "exp">(null);
	const [roiSelectionMode, setRoiSelectionMode] = useState<null | "level" | "exp">(null);

	// 화면/창 캡처 스트림 관리 (시작/중지 + 비디오 연결)
	const { stream, startCapture, stopCapture, ensureCapturePlaying } = useDisplayCapture({
		captureVideoRef,
		previewVideoRef,
		settingsOpen,
		// 캡처용 hidden video는 "측정/온보딩/측정 준비"에만 재생합니다.
		// (화면 공유만 켜둔 상태에서의 게임 끊김 리포트 완화 목적)
		capturePlaybackWanted: isSampling || onboardingOpen || isPreparingSample,
		// 유저 설정 없이 자동 전환:
		// - 설정 모달(ROI 잡기) 중에는 프리뷰가 부드럽도록 30fps
		// - 평소에는 게임 영향 최소화를 위해 3fps
		captureFps: settingsOpen ? 30 : 3
	});
	const hasStream = !!stream;
	// PiP 이벤트 핸들러에서 오래된 클로저(stale closure)를 피하기 위한 ref들
	const { open: pipOpen, update: pipUpdate, close: pipClose, isOpen: pipIsOpen } = useDocumentPip({
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
		}
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
	useEffect(() => { isSamplingRef.current = isSampling; }, [isSampling]);
	const hasStartedRef = useRef<boolean>(false);
	useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);
	const hasStreamRef = useRef<boolean>(false);
	useEffect(() => { hasStreamRef.current = hasStream; }, [hasStream]);

	useEffect(() => {
		initOcr(); // 워커를 지연 로딩으로 예열
	}, []);

	const ocr = useOcrSampling({
		captureVideoRef,
		roiLevel,
		roiExp,
		expTable,
		debugEnabled
	});

	// OCR 작업이 중첩 실행되지 않도록 방지합니다. (OCR이 intervalSec보다 오래 걸릴 때 중요)
	// 이 가드가 없으면 setInterval이 여러 OCR 작업을 동시에 쌓아 CPU 스파이크/끊김을 유발할 수 있습니다.
	const sampleInFlightRef = useRef<Promise<void> | null>(null);
	const runSampleOnce = useCallback(async () => {
		// 이미 샘플링이 실행 중이면 같은 Promise를 재사용합니다. (예: pause 시 완료를 기다릴 수 있음)
		if (sampleInFlightRef.current) return sampleInFlightRef.current;
		const p = ocr.sampleOnceAndAccumulate()
			.catch(() => {
				// OCR 실패는 흔할 수 있으므로 사용자 경험을 위해 조용히 무시합니다.
			})
			.finally(() => {
				sampleInFlightRef.current = null;
			}) as Promise<void>;
		sampleInFlightRef.current = p;
		return p;
	}, [ocr]);

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

	const { levelRoiShot, expRoiShot, onboardingLevelText, onboardingExpText } = useOnboardingRoiAssist({
		onboardingOpen,
		onboardingStep,
		stream,
		captureVideoRef,
		roiLevel,
		roiExp
	});

	// 새 ROI가 설정되면(선택 완료) 선택 모드를 정리합니다.
	const handleChangeLevel = useCallback((r: RoiRect | null) => {
		setRoiLevel(r);
		if (r && roiSelectionMode === "level") {
			setActiveRoi(null);
			setRoiSelectionMode(null);
			if (onboardingPausedForRoi === "level") {
				setOnboardingPausedForRoi(null);
				setOnboardingOpen(true);
			}
		}
	}, [setRoiLevel, roiSelectionMode, onboardingPausedForRoi]);
	const handleChangeExp = useCallback((r: RoiRect | null) => {
		setRoiExp(r);
		if (r && roiSelectionMode === "exp") {
			setActiveRoi(null);
			setRoiSelectionMode(null);
			if (onboardingPausedForRoi === "exp") {
				setOnboardingPausedForRoi(null);
				setOnboardingOpen(true);
			}
		}
	}, [setRoiExp, roiSelectionMode, onboardingPausedForRoi]);

	const startOrResume = useCallback(async () => {
		// 툴바 비활성 상태와 동일: 활성 캡처 스트림이 없으면 시작 불가
		if (!stream) return;
		if (!captureVideoRef.current) return;
		if (!roiLevel || !roiExp) {
			alert("먼저 레벨/경험치 영역(ROI)을 설정해 주세요.");
			return;
		}
		// 시작/재개 직후 baseline(기준점)을 prev로 기록합니다.
		// - 누적/차트 히스토리는 증가시키지 않음
		// - baseline이 %↔값 불일치 등으로 이상하면, 이번 틱은 무시하고 다음 틱을 첫 틱으로 삼음
		setIsPreparingSample(true);
		try {
			// OCR 전에 캡처 비디오가 실제 프레임을 내고 있는지 보장합니다.
			await ensureCapturePlaying();
			await ocr.captureBaseline({ resetTotals: !hasStarted });
		} finally {
			setIsPreparingSample(false);
		}
		if (!hasStarted) {
			setHasStarted(true);
			stopwatch.reset();
		}

		// 타이머 시작
		stopwatch.start();

		// 왜: setInterval 콜백에서 async/await를 직접 쓰면 예외가 unhandled로 튈 수 있어,
		// 명시적으로 Promise를 소거(void)하고 실패는 조용히 무시합니다.
		const runner = () => {
			void runSampleOnce();
		};

		// 샘플링 인터벌 시작
		sampler.start(intervalSec * 1000, runner);

		setIsSampling(true);
	}, [stream, intervalSec, roiLevel, roiExp, hasStarted, stopwatch, sampler, ocr, ensureCapturePlaying, runSampleOnce]);

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
		ocr.resetTotals();
		setIsSampling(false);
		setIsPreparingSample(false);
		setHasStarted(false);
	}, [hasStarted, sampler, stopwatch, ocr]);

	// PiP 핸들러에서 stale closure를 피하기 위해 최신 함수 ref를 유지합니다.
	const startOrResumeRef = useRef(startOrResume);
	useEffect(() => { startOrResumeRef.current = startOrResume; }, [startOrResume]);
	const pauseSamplingRef = useRef(pauseSampling);
	useEffect(() => { pauseSamplingRef.current = pauseSampling; }, [pauseSampling]);
	const resetSamplingRef = useRef(resetSampling);
	useEffect(() => { resetSamplingRef.current = resetSampling; }, [resetSampling]);


	const stats = useMemo(() => {
		if (!hasStarted) return null;
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		const gainedPctPoints = ocr.cumExpPct; // 샘플 누적
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
	}, [elapsedMs, hasStarted, ocr.cumExpPct]);

	// 경과 시간을 이용해 누적값을 비례 환산합니다:
	// paceAtWindow(targetMinutes) = cumulative * (targetMinutes / elapsedMinutes)
	const paceAtWindow = useMemo(() => {
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		if (elapsedSec <= 0) return { pct: 0, val: 0 };
		const factor = (paceWindowMin * 60) / elapsedSec;
		return {
			pct: ocr.cumExpPct * factor,
			val: ocr.cumExpValue * factor
		};
	}, [elapsedMs, paceWindowMin, ocr.cumExpPct, ocr.cumExpValue]);

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
			gainedText: `${formatNumber(ocr.cumExpValue)} [${ocr.cumExpPct.toFixed(2)}%]`,
			paceText: `${formatNumber(paceAtWindow.val)} [${paceAtWindow.pct.toFixed(2)}%] / ${paceWindowMin}분`
		};
		pipUpdate(state);
	}, [isSampling, elapsedMs, stats, ocr.cumExpValue, ocr.cumExpPct, paceAtWindow.val, paceAtWindow.pct, paceWindowMin, pipUpdate]);

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
		match: (e) =>
			(e.code === "KeyP" || e.key === "p" || e.key === "P") &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey,
		onTrigger: () => {
			if (!pipSupported) return;
			if (pipIsOpen()) return;
			void openPip();
		}
	});

	// ----- 페이스 히스토리/시리즈 (시간 정규화) -----
	const pace = usePaceSeries({
		hasStarted,
		sampleTick: ocr.sampleTick,
		lastSampleTsRef: ocr.lastSampleTsRef,
		cumExpValue: ocr.cumExpValue,
		cumExpPct: ocr.cumExpPct,
		elapsedMs,
		paceWindowMin
	});
	const { paceOverallSeries, recentPaceSeries, cumulativeSeries } = pace;

	// 차트 모드 토글
	const [chartMode, setChartMode] = useState<"pace" | "paceRecent" | "cumulative">("pace");

	// x축 레이블은 경과 시간(ms)을 바로 사용
	const wsTestEnabled = useMemo(() => {
		try {
			return new URLSearchParams(window.location.search).get("wsTest") === "1";
		} catch {
			return false;
		}
	}, []);

	return (
		<div className="space-y-4">
			{wsTestEnabled && <LocalWsTestPanel defaultUrl="ws://127.0.0.1:21537" />}
			<TrackerToolbar
				isSampling={isSampling}
				hasStarted={hasStarted}
				hasStream={hasStream}
				pipSupported={pipSupported}
				pipUnsupportedTooltip={pipUnsupportedTooltip}
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenRecords={() => setRecordsOpen(true)}
				onStart={() => { void startOrResume(); }}
				onPause={() => { void pauseSampling(); }}
				onReset={resetSampling}
				onOpenPip={() => { void openPip(); }}
			/>

			<TrackerSummary
				captureRef={summaryCaptureRef}
				elapsedMs={elapsedMs}
				stats={stats ? { nextAt: stats.nextAt, nextHours: stats.nextHours } : null}
				cumExpValue={ocr.cumExpValue}
				cumExpPct={ocr.cumExpPct}
				paceWindowMin={paceWindowMin}
				paceAtWindow={paceAtWindow}
				intervalSec={intervalSec}
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
					cumExpValue={ocr.cumExpValue}
					cumExpPct={ocr.cumExpPct}
					paceWindowMin={paceWindowMin}
					paceValue={paceAtWindow.val}
					pacePct={paceAtWindow.pct}
					getSummaryEl={() => summaryCaptureRef.current}
				/>
			</div>

			{debugEnabled && (
				<DebugOcrPreview
					levelPreviewRaw={ocr.levelPreviewRaw}
					levelPreviewProc={ocr.levelPreviewProc}
					expPreviewRaw={ocr.expPreviewRaw}
					expPreviewProc={ocr.expPreviewProc}
					levelOcrText={ocr.levelOcrText}
					expOcrText={ocr.expOcrText}
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
						version: 3,
						capturedAt: Date.now(),
						runtime: {
							hasStarted
						},
						stopwatch: stopwatch.getSnapshot(),
						ocr: ocr.getSnapshot(),
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
					ocr.applySnapshot(snap.ocr);
					// 제약/UX: 로드 시 자동 실행하지 않기 위해 항상 "일시정지"로 복원합니다.
					stopwatch.applySnapshot({ ...snap.stopwatch, isRunning: false });
					pace.applySnapshot(nextHasStarted ? snap.pace : { history: [] });
				}}
			/>

			<Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="설정" disableEscClose={activeRoi !== null || onboardingOpen}>
				<div className="flex items-center gap-2">
					<button className="btn btn-primary" onClick={startCapture}>게임 창 선택</button>
					{stream ? (
						<button className="btn" onClick={stopCapture}>공유 중지</button>
					) : null}
					<div className="ml-auto flex items-center gap-2">
						<label className="text-sm text-white/70">측정 주기</label>
						<select
							className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
							value={intervalSec}
							onChange={e => setIntervalSec(parseInt(e.target.value, 10) as IntervalSec)}
						>
							<option value={1}>1초</option>
							<option value={5}>5초</option>
							<option value={10}>10초</option>
						</select>
						<label className="text-sm text-white/70 ml-4">페이스 기준 시간</label>
						<select
							className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
							value={paceWindowMin}
							onChange={e => setPaceWindowMin(parseInt(e.target.value, 10))}
						>
							<option value={5}>5분</option>
							<option value={10}>10분</option>
							<option value={30}>30분</option>
							<option value={60}>60분</option>
						</select>
					</div>
				</div>

				<div ref={roiContainerRef} className="relative w-full h-[70vh] overflow-hidden rounded-lg bg-black/50 mt-3">
					<video ref={previewVideoRef} className="w-full h-full object-contain" muted playsInline />
					<RoiOverlay
						videoRef={previewVideoRef}
						levelRect={roiLevel}
						expRect={roiExp}
						onChangeLevel={handleChangeLevel}
						onChangeExp={handleChangeExp}
						active={activeRoi}
						onActiveChange={setActiveRoi}
						onCancelSelection={() => {
							setActiveRoi(null);
							setRoiSelectionMode(null);
							if (onboardingPausedForRoi) {
								setOnboardingPausedForRoi(null);
								setOnboardingOpen(true);
							}
						}}
					/>
				</div>

				<div className="flex items-center gap-2">
					<button
						className={cn("btn", activeRoi === "level" && "btn-primary")}
						onClick={() => {
							if (activeRoi === "level") {
								setActiveRoi(null);
								setRoiSelectionMode(null);
							} else {
								setActiveRoi("level");
								setRoiSelectionMode("level");
							}
						}}
					>
						레벨 ROI 설정
					</button>
					<button
						className={cn("btn", activeRoi === "exp" && "btn-primary")}
						onClick={() => {
							if (activeRoi === "exp") {
								setActiveRoi(null);
								setRoiSelectionMode(null);
							} else {
								setActiveRoi("exp");
								setRoiSelectionMode("exp");
							}
						}}
					>
						경험치 ROI 설정
					</button>
					<label className="ml-auto flex items-center gap-2 text-sm">
						<input type="checkbox" checked={debugEnabled} onChange={e => setDebugEnabled(e.target.checked)} />
						디버그 미리보기
					</label>
				</div>
			</Modal>
			{/* OCR 샘플링용 숨김 비디오(항상 마운트) */}
			<video ref={captureVideoRef} className="hidden" muted playsInline />
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
					setSettingsOpen(true);
					setOnboardingOpen(false);
					setOnboardingPausedForRoi("level");
					setRoiSelectionMode("level");
					setActiveRoi("level");
				}}
				onActivateExp={() => {
					setSettingsOpen(true);
					setOnboardingOpen(false);
					setOnboardingPausedForRoi("exp");
					setRoiSelectionMode("exp");
					setActiveRoi("exp");
				}}
				onSetIntervalSec={(sec: number) => setIntervalSec(sec as IntervalSec)}
				currentIntervalSec={intervalSec}
				hasLevelRoi={!!roiLevel}
				levelRoiPreview={levelRoiShot}
				hasExpRoi={!!roiExp}
				expRoiPreview={expRoiShot}
				ocrLevelText={onboardingLevelText}
				ocrExpText={onboardingExpText}
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


