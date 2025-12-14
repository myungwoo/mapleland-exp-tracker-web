"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoiOverlay, { RoiRect } from "./RoiOverlay";
import { drawRoiCanvas, toVideoSpaceRect, preprocessLevelCanvas, cropDigitBoundingBox } from "@/lib/canvas";
import { initOcr, recognizeExpBracketedWithText, recognizeLevelDigitsWithText } from "@/lib/ocr";
import { formatElapsed, formatNumber } from "@/lib/format";
import { EXP_TABLE, computeExpDeltaFromTable } from "@/lib/expTable";
import { usePersistentState } from "@/lib/persist";
import clsx from "classnames";
import Modal from "./Modal";
import { useDocumentPip } from "@/lib/pip/useDocumentPip";
import type { PipState } from "@/lib/pip/types";
import OnboardingOverlay from "@/components/OnboardingOverlay";

type IntervalSec = 1 | 5 | 10;

type Sample = {
	ts: number;
	level: number | null;
	expPercent: number | null;
	expValue: number | null;
	isValid?: boolean;
};

export default function ExpTracker() {
	// Hidden, always-mounted video used for OCR sampling
	const captureVideoRef = useRef<HTMLVideoElement | null>(null);
	// Modal preview video used only for ROI selection
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);

	const [intervalSec, setIntervalSec] = usePersistentState<IntervalSec>("intervalSec", 1 as IntervalSec);
	const [roiLevel, setRoiLevel] = usePersistentState<RoiRect | null>("roiLevel", null);
	const [roiExp, setRoiExp] = usePersistentState<RoiRect | null>("roiExp", null);
	const [avgWindowMin, setAvgWindowMin] = usePersistentState<number>("avgWindowMin", 60);
	const expTable = EXP_TABLE;

	const [isSampling, setIsSampling] = useState(false); // running
	const [hasStarted, setHasStarted] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [baseElapsedMs, setBaseElapsedMs] = useState(0); // accumulated elapsed across pauses

	const [currentLevel, setCurrentLevel] = useState<number | null>(null);
	const [currentExp, setCurrentExp] = useState<number | null>(null);
	const [currentExpValue, setCurrentExpValue] = useState<number | null>(null);
	const lastValidSampleRef = useRef<Sample | null>(null);
	const [cumExpPct, setCumExpPct] = useState(0);
	const [cumExpValue, setCumExpValue] = useState(0);

	const [activeRoi, setActiveRoi] = useState<"level" | "exp" | null>(null);
	const [debugEnabled, setDebugEnabled] = useState(false);
	const [levelPreviewRaw, setLevelPreviewRaw] = useState<string | null>(null);
	const [levelPreviewProc, setLevelPreviewProc] = useState<string | null>(null);
	const [expPreviewRaw, setExpPreviewRaw] = useState<string | null>(null);
	const [expPreviewProc, setExpPreviewProc] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [levelOcrText, setLevelOcrText] = useState<string>("");
	const [expOcrText, setExpOcrText] = useState<string>("");
	const startAtRef = useRef<number | null>(null);
	const autoInitDoneRef = useRef<boolean>(false);
	// Onboarding
	const [onboardingDone, setOnboardingDone] = usePersistentState<boolean>("onboardingDone", false);
	const [onboardingOpen, setOnboardingOpen] = useState(false);
	const [onboardingStep, setOnboardingStep] = useState<number>(0);
	const [levelRoiShot, setLevelRoiShot] = useState<string | null>(null);
	const [expRoiShot, setExpRoiShot] = useState<string | null>(null);
	const [onboardingLevelText, setOnboardingLevelText] = useState<string | null>(null);
	const [onboardingExpText, setOnboardingExpText] = useState<string | null>(null);
	const [onboardingPausedForRoi, setOnboardingPausedForRoi] = useState<null | "level" | "exp">(null);
	const [roiSelectionMode, setRoiSelectionMode] = useState<null | "level" | "exp">(null);
	// Document Picture-in-Picture via service + hook
	const { open: pipOpen, update: pipUpdate, close: pipClose } = useDocumentPip({
		onToggle: () => {
			if (isSamplingRef.current) {
				pauseSamplingRef.current();
			} else {
				startOrResumeRef.current();
			}
		},
		onReset: () => {
			resetSamplingRef.current();
		}
	});
	// Live sampling state for PiP event handlers (avoid stale closures)
	const isSamplingRef = useRef<boolean>(false);
	useEffect(() => { isSamplingRef.current = isSampling; }, [isSampling]);

	useEffect(() => {
		initOcr(); // warm up worker lazily
	}, []);

	// On first load, automatically open settings and prompt for window selection or onboarding
	useEffect(() => {
		if (autoInitDoneRef.current) return;
		autoInitDoneRef.current = true;
		setSettingsOpen(true);
		if (!onboardingDone) {
			setOnboardingOpen(true);
			setOnboardingStep(0);
		} else {
			// Try to immediately start capture so the "게임 창 선택" prompt opens
			// Some browsers might require a user gesture; if so, the user can click the button.
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

	const startCapture = useCallback(async () => {
		try {
			const s = await navigator.mediaDevices.getDisplayMedia({
				video: { displaySurface: "window", frameRate: 30 },
				audio: false
			});
			setStream(s);
			if (captureVideoRef.current) {
				captureVideoRef.current.srcObject = s;
				await captureVideoRef.current.play();
			}
			if (previewVideoRef.current) {
				previewVideoRef.current.srcObject = s;
				await previewVideoRef.current.play();
			}
		} catch (err) {
			console.error(err);
			alert("화면/창 캡처 권한이 필요합니다.");
		}
	}, []);

	useEffect(() => {
		return () => {
			if (stream) {
				stream.getTracks().forEach(t => t.stop());
			}
		};
	}, [stream]);

	const stopCapture = useCallback(() => {
		if (stream) {
			stream.getTracks().forEach(t => t.stop());
			setStream(null);
			if (captureVideoRef.current) captureVideoRef.current.srcObject = null;
			if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
		}
	}, [stream]);

	// When stream changes or settings modal opens, attach to preview video without reselecting
	useEffect(() => {
		(async () => {
			if (!stream) return;
			if (captureVideoRef.current && captureVideoRef.current.srcObject !== stream) {
				captureVideoRef.current.srcObject = stream;
				try { await captureVideoRef.current.play(); } catch {}
			}
			if (previewVideoRef.current && previewVideoRef.current.srcObject !== stream) {
				previewVideoRef.current.srcObject = stream;
				try { await previewVideoRef.current.play(); } catch {}
			}
		})();
	}, [stream]);

	useEffect(() => {
		if (!settingsOpen || !stream) return;
		(async () => {
			if (previewVideoRef.current && previewVideoRef.current.srcObject !== stream) {
				previewVideoRef.current.srcObject = stream;
				try { await previewVideoRef.current.play(); } catch {}
			}
		})();
	}, [settingsOpen, stream]);

	const tickRef = useRef<number | null>(null);
	const clockRef = useRef<number | null>(null);

	// Capture lightweight thumbnails for onboarding ROI confirmation
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
			// ignore thumbnail failures
		}
		// Update when step changes or inputs change
	}, [onboardingOpen, onboardingStep, roiLevel, roiExp, stream]);

	// Periodically refresh OCR texts at 1s while onboarding is open
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
					// also keep preview relatively fresh
					const cRaw = drawRoiCanvas(video, rect, { scale: 2 });
					setLevelRoiShot(cRaw.toDataURL("image/png"));
				}
				if (roiExp) {
					const rect = toVideoSpaceRect(video, roiExp);
					const canvasExpProc = drawRoiCanvas(video, rect, { binarize: true, scale: 2 });
					const res = await recognizeExpBracketedWithText(canvasExpProc);
					setOnboardingExpText(res.text || "");
					const cRaw = drawRoiCanvas(video, rect, { scale: 2 });
					setExpRoiShot(cRaw.toDataURL("image/png"));
				}
			} catch {
				// ignore OCR failures
			}
		};
		// initial
		void tick();
		timer = window.setInterval(() => { void tick(); }, 1000) as unknown as number;
		return () => {
			if (timer) {
				clearInterval(timer);
			}
		};
	}, [onboardingOpen, roiLevel, roiExp]);

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

	const readRoisOnce = useCallback(async (): Promise<Sample> => {
		const video = captureVideoRef.current;
		if (!video || !roiExp || !roiLevel) return { ts: Date.now(), level: null, expPercent: null, expValue: null };
		const { videoWidth, videoHeight } = video;
		if (videoWidth === 0 || videoHeight === 0) return { ts: Date.now(), level: null, expPercent: null, expValue: null };

		// Convert ROI to video pixel space in case ROI was set using CSS pixels
		const rectLevel = toVideoSpaceRect(video, roiLevel);
		const rectExp = toVideoSpaceRect(video, roiExp);

		// For level digits: color-based extraction, then tight crop to remove whitespace
		const canvasLevelProc = preprocessLevelCanvas(video, rectLevel, { scale: 4, pad: 0 });
		const canvasLevelCrop = cropDigitBoundingBox(canvasLevelProc, { margin: 3, targetHeight: 72, outPad: 6 });
		const canvasLevelRaw = drawRoiCanvas(video, rectLevel, { scale: 4 });
		const canvasExpProc = drawRoiCanvas(video, rectExp, { binarize: true, scale: 2 });
		const canvasExpRaw = drawRoiCanvas(video, rectExp, { scale: 2 });

		const [levelRes, expRes] = await Promise.all([
			recognizeLevelDigitsWithText(canvasLevelCrop),
			recognizeExpBracketedWithText(canvasExpProc)
		]);

		if (debugEnabled) {
			try {
				setLevelPreviewRaw(canvasLevelRaw.toDataURL("image/png"));
				setLevelPreviewProc(canvasLevelCrop.toDataURL("image/png"));
				setExpPreviewRaw(canvasExpRaw.toDataURL("image/png"));
				setExpPreviewProc(canvasExpProc.toDataURL("image/png"));
				setLevelOcrText(levelRes.text || "");
				setExpOcrText(expRes.text || "");
			} catch {
				// ignore preview failures
			}
		}

		// If EXP is recognized but level is not, assume level = 1 to keep tracking
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
	}, [roiExp, roiLevel, debugEnabled]);

	// Unified sampler: take one OCR sample, update UI fields, and accumulate deltas
	const sampleOnceAndAccumulate = useCallback(async () => {
		const s = await readRoisOnce();
		const isValid = s.level != null && s.expValue != null && s.expPercent != null;
		const sample: Sample = { ...s, isValid };
		setCurrentLevel(s.level);
		setCurrentExp(s.expPercent);
		setCurrentExpValue(s.expValue ?? null);
		// accumulate deltas based on last valid sample
		const prev = lastValidSampleRef.current;
		if (prev && isValid) {
			// Percent-based accumulation
			if (prev.expPercent != null && s.expPercent != null) {
				let deltaPct = 0;
				if (
					prev.level != null &&
					s.level != null &&
					s.level > prev.level
				) {
					deltaPct = (100 - prev.expPercent) + s.expPercent;
				} else if (
					prev.level != null &&
					s.level != null &&
					s.level < prev.level
				) {
					// symmetric negative across-level when level appears to drop
					deltaPct = -((100 - s.expPercent) + prev.expPercent);
				} else {
					deltaPct = s.expPercent - prev.expPercent;
				}
				setCumExpPct(v => v + deltaPct);
			}
			// Value-based accumulation
			if (prev.expValue != null && s.expValue != null && prev.level != null && s.level != null) {
				const dvFromTable = computeExpDeltaFromTable(expTable, prev.level, prev.expValue, s.level, s.expValue);
				if (dvFromTable != null) {
					setCumExpValue(v => v + dvFromTable);
				}
			}
		}
		// update last valid pointer only when the current sample is valid
		if (isValid) {
			lastValidSampleRef.current = sample;
		}
	}, [readRoisOnce, expTable]);

	const startOrResume = useCallback(async () => {
		if (!captureVideoRef.current) return;
		if (!roiLevel || !roiExp) {
			alert("먼저 레벨/경험치 영역(ROI)을 설정해주세요.");
			return;
		}
		// Baseline capture: used for both first start and resume
		const captureBaseline = async (resetTotals: boolean) => {
			const s = await readRoisOnce();
			setCurrentLevel(s.level);
			setCurrentExp(s.expPercent);
			setCurrentExpValue(s.expValue);
			const isValid = s.level != null && s.expValue != null && s.expPercent != null;
			const sample: Sample = { ts: s.ts, level: s.level, expPercent: s.expPercent, expValue: s.expValue, isValid };
			lastValidSampleRef.current = isValid ? sample : null;
			if (resetTotals) {
				setCumExpPct(0);
				setCumExpValue(0);
				setHasStarted(true);
				setBaseElapsedMs(0);
				setElapsedMs(0);
			}
		};
		// First start resets totals; resume only resets baseline
		await captureBaseline(!hasStarted);

		// Start clock with base offset
		startAtRef.current = Date.now() - baseElapsedMs;
		if (clockRef.current) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		clockRef.current = window.setInterval(() => {
			const startVal = startAtRef.current;
			if (startVal != null) {
				setElapsedMs(Date.now() - startVal);
			}
		}, 1000) as unknown as number;

		const runner = async () => {
			await sampleOnceAndAccumulate();
		};

		// Start sampling interval
		if (tickRef.current) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		tickRef.current = window.setInterval(() => {
			runner();
		}, intervalSec * 1000) as unknown as number;

		setIsSampling(true);
	}, [readRoisOnce, intervalSec, roiLevel, roiExp, hasStarted, baseElapsedMs]);

	const pauseSampling = useCallback(async () => {
		// Stop timers first to freeze state
		if (tickRef.current) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (clockRef.current) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		// Take an immediate sample at pause time (independent of intervalSec)
		try {
			await sampleOnceAndAccumulate();
		} catch {
			// ignore OCR failures on pause
		}
		// Freeze elapsed at pause moment
		setBaseElapsedMs(elapsedMs);
		setIsSampling(false);
	}, [elapsedMs, sampleOnceAndAccumulate]);

	const resetSampling = useCallback(() => {
		if (tickRef.current) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (clockRef.current) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		setIsSampling(false);
		setHasStarted(false);
		setBaseElapsedMs(0);
		setElapsedMs(0);
		startAtRef.current = null;
		setCurrentLevel(null);
		setCurrentExp(null);
		setCurrentExpValue(null);
		lastValidSampleRef.current = null;
		setCumExpPct(0);
		setCumExpValue(0);
	}, []);

	// Keep latest control functions for PiP handlers to avoid stale closures
	const startOrResumeRef = useRef(startOrResume);
	useEffect(() => { startOrResumeRef.current = startOrResume; }, [startOrResume]);
	const pauseSamplingRef = useRef(pauseSampling);
	useEffect(() => { pauseSamplingRef.current = pauseSampling; }, [pauseSampling]);
	const resetSamplingRef = useRef(resetSampling);
	useEffect(() => { resetSamplingRef.current = resetSampling; }, [resetSampling]);

	useEffect(() => {
		return () => {
			if (tickRef.current) {
				clearInterval(tickRef.current);
				tickRef.current = null;
			}
		};
	}, []);

	const stats = useMemo(() => {
		if (!hasStarted) return null;
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		const gainedPctPoints = cumExpPct; // accumulated per-sample
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
	}, [elapsedMs, hasStarted, cumExpPct]);

	// Removed window-based averaging. We project to a chosen minutes window based on elapsed time and cumulative gains.

	// Extrapolate from cumulative totals using elapsed time:
	// estimate(targetMinutes) = cumulative * (targetMinutes / elapsedMinutes)
	const avgEstimate = useMemo(() => {
		const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
		if (elapsedSec <= 0) return { pct: 0, val: 0 };
		const factor = (avgWindowMin * 60) / elapsedSec;
		return {
			pct: cumExpPct * factor,
			val: cumExpValue * factor
		};
	}, [elapsedMs, avgWindowMin, cumExpPct, cumExpValue]);

	// Space bar shortcut: toggle start/pause unless focused on input/select/textarea or contentEditable
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code === "Space" || e.key === " ") {
				const el = e.target as HTMLElement | null;
				const tag = el?.tagName?.toLowerCase();
				const isForm =
					!!el &&
					(el.isContentEditable ||
						tag === "input" ||
						tag === "textarea" ||
						tag === "select");
				if (isForm) return;
				e.preventDefault();
				if (isSampling) {
					pauseSampling();
				} else {
					startOrResume();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isSampling, pauseSampling, startOrResume]);

	// 'R' shortcut: reset timer unless focused on form fields
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const code = (e as any).code || (e as any).key;
			if (code === "KeyR" || e.key === "r" || e.key === "R") {
				const el = e.target as HTMLElement | null;
				const tag = el?.tagName?.toLowerCase();
				const isForm =
					!!el &&
					(el.isContentEditable ||
						tag === "input" ||
						tag === "textarea" ||
						tag === "select");
				if (isForm) return;
				e.preventDefault();
				if (hasStarted) {
					resetSampling();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [hasStarted, resetSampling]);

	// --- Document Picture-in-Picture helpers ---
	const closePip = useCallback(() => {
		pipClose();
	}, [pipClose]);

	const updatePipContents = useCallback(() => {
		const state: PipState = {
			isSampling,
			elapsedMs,
			nextAt: stats ? stats.nextAt : null,
			nextHours: stats ? stats.nextHours : null,
			gainedText: `${formatNumber(cumExpValue)} [${cumExpPct.toFixed(2)}%]`,
			estText: `${formatNumber(avgEstimate.val)} [${avgEstimate.pct.toFixed(2)}%] / ${avgWindowMin}분`
		};
		pipUpdate(state);
	}, [isSampling, elapsedMs, stats, cumExpValue, cumExpPct, avgEstimate.val, avgEstimate.pct, avgWindowMin, pipUpdate]);

	// Keep PiP contents in sync whenever relevant values change
	useEffect(() => {
		updatePipContents();
	}, [updatePipContents]);

	const openPip = useCallback(async () => {
		await pipOpen();
		updatePipContents(); // initial paint
	}, [pipOpen, updatePipContents]);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<button className="btn" onClick={() => setSettingsOpen(true)}>설정</button>
				<div className="ml-auto flex items-center gap-2">
					{isSampling ? (
						<button className="btn" onClick={pauseSampling}>
							타이머 일시정지 <span className="ml-2 text-xs opacity-70">Space</span>
						</button>
					) : (
						<button className="btn btn-primary" onClick={startOrResume} disabled={!stream}>
							타이머 시작 <span className="ml-2 text-xs opacity-70">Space</span>
						</button>
					)}
					<button className="btn" onClick={resetSampling} disabled={!hasStarted}>초기화</button>
					<button className="btn" onClick={openPip}>PIP 열기</button>
				</div>
			</div>

			<div className="card p-4 space-y-4">
				<h2 className="text-lg font-semibold">요약</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<div className="opacity-70 text-sm">경과된 시간</div>
						<div className="font-mono text-xl">{formatElapsed(elapsedMs)}</div>
					</div>
					<div>
						<div className="opacity-70 text-sm">{stats ? `${stats.nextHours}시간 되는 시각` : "다음 시간 되는 시각"}</div>
						<div className="font-mono text-xl">{stats ? stats.nextAt.toLocaleTimeString() : "-"}</div>
					</div>
					<div>
						<div className="opacity-70 text-sm">현재까지 획득한 경험치</div>
						<div className="font-mono text-xl">
							{formatNumber(cumExpValue)} [{cumExpPct.toFixed(2)}%]
						</div>
					</div>
					<div>
						<div className="opacity-70 text-sm">예상 경험치 ({avgWindowMin}분)</div>
						<div className="font-mono text-xl">
							{formatNumber(avgEstimate.val)} [{avgEstimate.pct.toFixed(2)}%]
						</div>
					</div>
				</div>
			</div>

			{debugEnabled && (
				<div className="card p-4 space-y-3">
					<h3 className="font-semibold">OCR 입력 미리보기</h3>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div>
							<div className="text-xs opacity-70 mb-1">Level Raw</div>
							{levelPreviewRaw ? (
								<img src={levelPreviewRaw} alt="level-raw" className="w-full h-auto rounded border border-white/10" />
							) : <div className="text-xs opacity-60">-</div>}
						</div>
						<div>
							<div className="text-xs opacity-70 mb-1">Level Proc</div>
							{levelPreviewProc ? (
								<img src={levelPreviewProc} alt="level-proc" className="w-full h-auto rounded border border-white/10" />
							) : <div className="text-xs opacity-60">-</div>}
						</div>
						<div>
							<div className="text-xs opacity-70 mb-1">EXP Raw</div>
							{expPreviewRaw ? (
								<img src={expPreviewRaw} alt="exp-raw" className="w-full h-auto rounded border border-white/10" />
							) : <div className="text-xs opacity-60">-</div>}
						</div>
						<div>
							<div className="text-xs opacity-70 mb-1">EXP Proc</div>
							{expPreviewProc ? (
								<img src={expPreviewProc} alt="exp-proc" className="w-full h-auto rounded border border-white/10" />
							) : <div className="text-xs opacity-60">-</div>}
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="text-xs">
							<div className="opacity-70 mb-1">Level OCR</div>
							<pre className="whitespace-pre-wrap break-all bg-black/30 rounded p-2 border border-white/10 min-h-[2.5rem]">{levelOcrText || "-"}</pre>
						</div>
						<div className="text-xs">
							<div className="opacity-70 mb-1">EXP OCR</div>
							<pre className="whitespace-pre-wrap break-all bg-black/30 rounded p-2 border border-white/10 min-h-[2.5rem]">{expOcrText || "-"}</pre>
						</div>
					</div>
					<p className="text-xs opacity-60">미리보기는 디버그가 켜진 동안에만 매 tick 갱신됩니다.</p>
				</div>
			)}

			<Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="설정">
				<div className="flex items-center gap-2">
					<button className="btn btn-primary" onClick={startCapture}>게임 창 선택</button>
					<button className="btn" onClick={stopCapture} disabled={!stream}>캡처 중지</button>
					<div className="ml-auto flex items-center gap-2">
						<label className="text-sm text-white/70">샘플링 간격</label>
						<select
							className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
							value={intervalSec}
							onChange={e => setIntervalSec(parseInt(e.target.value, 10) as IntervalSec)}
						>
							<option value={1}>1초</option>
							<option value={5}>5초</option>
							<option value={10}>10초</option>
						</select>
						<label className="text-sm text-white/70 ml-4">평균 표시 시간</label>
						<select
							className="bg-white/10 text-white rounded px-2 py-1 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30"
							value={avgWindowMin}
							onChange={e => setAvgWindowMin(parseInt(e.target.value, 10))}
						>
							<option value={5}>5분</option>
							<option value={10}>10분</option>
							<option value={30}>30분</option>
							<option value={60}>60분</option>
						</select>
					</div>
				</div>

				<div className="relative w-full h-[70vh] overflow-hidden rounded-lg bg-black/50 mt-3">
					<video ref={previewVideoRef} className="w-full h-full object-contain" muted playsInline />
					<RoiOverlay
						videoRef={previewVideoRef}
						levelRect={roiLevel}
						expRect={roiExp}
						onChangeLevel={handleChangeLevel}
						onChangeExp={handleChangeExp}
						active={activeRoi}
						onActiveChange={setActiveRoi}
					/>
				</div>

				<div className="flex items-center gap-2">
					<button
						className={clsx("btn", activeRoi === "level" && "btn-primary")}
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
						className={clsx("btn", activeRoi === "exp" && "btn-primary")}
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


