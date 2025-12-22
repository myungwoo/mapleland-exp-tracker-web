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
	// Hidden, always-mounted video used for OCR sampling
	const captureVideoRef = useRef<HTMLVideoElement | null>(null);
	// Modal preview video used only for ROI selection
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	// 캡처 스트림은 별도 훅에서 관리합니다.

	const [intervalSec, setIntervalSec] = usePersistentState<IntervalSec>("intervalSec", 1 as IntervalSec);
	const [roiLevel, setRoiLevel] = usePersistentState<RoiRect | null>("roiLevel", null);
	const [roiExp, setRoiExp] = usePersistentState<RoiRect | null>("roiExp", null);
	const [paceWindowMin, setPaceWindowMin] = usePersistentState<number>("paceWindowMin", 60);
	// Interactive chart x-range (elapsed ms). Null = full range.
	const [chartRangeMs, setChartRangeMs] = useState<[number, number] | null>(null);
	const [chartShowAxisLabels, setChartShowAxisLabels] = usePersistentState<boolean>("chartShowAxisLabels", true);
	const [chartShowGrid, setChartShowGrid] = usePersistentState<boolean>("chartShowGrid", true);
	const expTable = EXP_TABLE;

	const [isSampling, setIsSampling] = useState(false); // running
	const [hasStarted, setHasStarted] = useState(false);
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

	// 화면/창 캡처 스트림 관리 (start/stop + video attach)
	const { stream, startCapture, stopCapture } = useDisplayCapture({
		captureVideoRef,
		previewVideoRef,
		settingsOpen
	});
	const hasStream = !!stream;
	// Live refs for PiP event handlers (avoid stale closures)
	const { open: pipOpen, update: pipUpdate, close: pipClose } = useDocumentPip({
		onToggle: () => {
			if (isSamplingRef.current) {
				pauseSamplingRef.current();
			} else {
				// Match main UI: cannot start when no capture stream selected
				if (!hasStreamRef.current) return;
				startOrResumeRef.current();
			}
		},
		onReset: () => {
			// Match main UI: cannot reset before timer has ever started
			if (!hasStartedRef.current) return;
			resetSamplingRef.current();
		}
	});
	const [pipSupported, setPipSupported] = useState(false);
	useEffect(() => {
		// Ensure SSR and first client render match; detect support after mount
		setPipSupported(isDocumentPipSupported());
	}, []);
	const pipUnsupportedTooltip =
		"이 브라우저에서는 문서 PiP(Document Picture-in-Picture) 기능을 지원하지 않습니다. 이 기능을 사용하려면 최신 버전의 Chrome 또는 Edge 브라우저를 이용해 주세요.";
	// Live sampling state for PiP event handlers (avoid stale closures)
	const isSamplingRef = useRef<boolean>(false);
	useEffect(() => { isSamplingRef.current = isSampling; }, [isSampling]);
	const hasStartedRef = useRef<boolean>(false);
	useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);
	const hasStreamRef = useRef<boolean>(false);
	useEffect(() => { hasStreamRef.current = hasStream; }, [hasStream]);

	useEffect(() => {
		initOcr(); // warm up worker lazily
	}, []);

	const ocr = useOcrSampling({
		captureVideoRef,
		roiLevel,
		roiExp,
		expTable,
		debugEnabled
	});

	// On first load, automatically open settings and prompt for window selection or onboarding
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
					// Permission or gesture required; leave modal open.
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

	// Finalize selection when a new ROI is set
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
		// Match toolbar disabled state: cannot start without an active capture stream.
		if (!stream) return;
		if (!captureVideoRef.current) return;
		if (!roiLevel || !roiExp) {
			alert("먼저 레벨/경험치 영역(ROI)을 설정해 주세요.");
			return;
		}
		// Baseline capture: used for both first start and resume
		const captureBaseline = async (resetTotals: boolean) => {
			// baseline은 UI에 보여줄 값만 갱신하고, 누적은 증가시키지 않습니다.
			await ocr.readOnce();
			if (resetTotals) {
				ocr.resetTotals();
				setHasStarted(true);
				stopwatch.reset();
			}
		};
		// First start resets totals; resume only resets baseline
		await captureBaseline(!hasStarted);

		// Start clock
		stopwatch.start();

		// 왜: setInterval 콜백에서 async/await를 직접 쓰면 예외가 unhandled로 튈 수 있어,
		// 명시적으로 Promise를 소거(void)하고 실패는 조용히 무시합니다.
		const runner = () => {
			void ocr.sampleOnceAndAccumulate().catch(() => {
				// OCR 실패는 흔할 수 있으므로 사용자 경험을 위해 조용히 무시합니다.
			});
		};

		// Start sampling interval
		sampler.start(intervalSec * 1000, runner);

		setIsSampling(true);
	}, [stream, intervalSec, roiLevel, roiExp, hasStarted, stopwatch, sampler, ocr]);

	const pauseSampling = useCallback(async () => {
		// Stop timers first to freeze state
		sampler.stop();
		stopwatch.pause();
		// Take an immediate sample at pause time (independent of intervalSec)
		try {
			await ocr.sampleOnceAndAccumulate();
		} catch {
			// ignore OCR failures on pause
		}
		setIsSampling(false);
	}, [ocr, sampler, stopwatch]);

	const resetSampling = useCallback(() => {
		// Match toolbar disabled state: cannot reset before the first start.
		if (!hasStarted) return;
		sampler.stop();
		stopwatch.reset();
		ocr.resetTotals();
		setIsSampling(false);
		setHasStarted(false);
	}, [hasStarted, sampler, stopwatch, ocr]);

	// Keep latest control functions for PiP handlers to avoid stale closures
	const startOrResumeRef = useRef(startOrResume);
	useEffect(() => { startOrResumeRef.current = startOrResume; }, [startOrResume]);
	const pauseSamplingRef = useRef(pauseSampling);
	useEffect(() => { pauseSamplingRef.current = pauseSampling; }, [pauseSampling]);
	const resetSamplingRef = useRef(resetSampling);
	useEffect(() => { resetSamplingRef.current = resetSampling; }, [resetSampling]);


	const stats = useMemo(() => {
		if (!hasStarted) return null;
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		const gainedPctPoints = ocr.cumExpPct; // accumulated per-sample
		const ratePerSec = elapsedSec > 0 ? gainedPctPoints / elapsedSec : 0;
		// Dynamic "N시간 되는 시각": N = floor(elapsed/3600)+1
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

	// Extrapolate from cumulative totals using elapsed time:
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
				// Match toolbar disabled state: cannot start without selecting a capture window.
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

	// ESC: when ROI selection is active, cancel ROI mode. If onboarding was paused for ROI, return to tutorial.
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

	// ESC while tutorial (onboarding) is open: act like pressing "Skip" (close tutorial and settings)
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
		// capture to preempt other ESC handlers (e.g., modal)
		const opts: AddEventListenerOptions = { capture: true };
		window.addEventListener("keydown", onKey, opts);
		return () => {
			window.removeEventListener("keydown", onKey, opts);
		};
	}, [onboardingOpen, setOnboardingDone]);

	// Click outside the game window (ROI container) cancels ROI selection mode
	useEffect(() => {
		const onMouseDown = (e: MouseEvent) => {
			if (!activeRoi && !roiSelectionMode) return;
			const container = roiContainerRef.current;
			if (!container) return;
			const target = e.target as Node | null;
			if (target && container.contains(target)) {
				return; // inside ROI container, ignore
			}
			// outside the ROI container: cancel ROI mode
			setActiveRoi(null);
			setRoiSelectionMode(null);
			if (onboardingPausedForRoi) {
				setOnboardingPausedForRoi(null);
				setOnboardingOpen(true);
			}
		};
		// capture to ensure we see it even if underlying elements stop propagation later
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

	// Keep PiP contents in sync whenever relevant values change
	useEffect(() => {
		updatePipContents();
	}, [updatePipContents]);

	const openPip = useCallback(async () => {
		await pipOpen();
		updatePipContents(); // initial paint
	}, [pipOpen, updatePipContents]);

	// ----- Pace history and series (time-normalized) -----
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

	// Chart mode toggle
	const [chartMode, setChartMode] = useState<"pace" | "paceRecent" | "cumulative">("pace");

	// x축 레이블은 경과 시간(ms)을 바로 사용

	return (
		<div className="space-y-4">
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

			{/* Share / Copy buttons (below summary card, right aligned) */}
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
					// Stop all running loops first
					sampler.stop();
					setIsSampling(false);
					setSettingsOpen(false);
					setActiveRoi(null);
					setRoiSelectionMode(null);
					setOnboardingOpen(false);

					// Core computed state
					const nextHasStarted = !!snap.runtime.hasStarted;
					setHasStarted(nextHasStarted);
					ocr.applySnapshot(snap.ocr);
					// Always restore as paused (constraint/UX): never auto-run on load.
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
			{/* Hidden always-on video for OCR sampling */}
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
					// Auto-toggle helpful modes per step
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


