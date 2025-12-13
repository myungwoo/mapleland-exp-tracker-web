"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoiOverlay, { RoiRect } from "./RoiOverlay";
import { drawRoiCanvas, toVideoSpaceRect, preprocessLevelCanvas, cropDigitBoundingBox } from "@/lib/canvas";
import { initOcr, recognizeExpBracketedWithText, recognizeLevelDigitsWithText } from "@/lib/ocr";
import { formatElapsed, predictGains, oneHourAt, formatNumber } from "@/lib/format";
import { EXP_TABLE, computeExpDeltaFromTable } from "@/lib/expTable";
import { usePersistentState } from "@/lib/persist";
import clsx from "classnames";
import Modal from "./Modal";

type IntervalSec = 1 | 5 | 10;

type Sample = {
	ts: number;
	level: number | null;
	expPercent: number | null;
	expValue?: number | null;
	isValid?: boolean;
};

export default function ExpTracker() {
	// Hidden, always-mounted video used for OCR sampling
	const captureVideoRef = useRef<HTMLVideoElement | null>(null);
	// Modal preview video used only for ROI selection
	const previewVideoRef = useRef<HTMLVideoElement | null>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);

	const [intervalSec, setIntervalSec] = usePersistentState<IntervalSec>("intervalSec", 5 as IntervalSec);
	const [roiLevel, setRoiLevel] = usePersistentState<RoiRect | null>("roiLevel", null);
	const [roiExp, setRoiExp] = usePersistentState<RoiRect | null>("roiExp", null);
	const [avgWindowMin, setAvgWindowMin] = usePersistentState<number>("avgWindowMin", 10);
	const expTable = EXP_TABLE;

	const [isSampling, setIsSampling] = useState(false); // running
	const [hasStarted, setHasStarted] = useState(false);
	const [startAt, setStartAt] = useState<number | null>(null); // kept for backward compatibility, not used for ETA
	const [elapsedMs, setElapsedMs] = useState(0);
	const [baseElapsedMs, setBaseElapsedMs] = useState(0); // accumulated elapsed across pauses

	const [startLevel, setStartLevel] = useState<number | null>(null);
	const [startExp, setStartExp] = useState<number | null>(null);
	const [startExpValue, setStartExpValue] = useState<number | null>(null);
	const [currentLevel, setCurrentLevel] = useState<number | null>(null);
	const [currentExp, setCurrentExp] = useState<number | null>(null);
	const [currentExpValue, setCurrentExpValue] = useState<number | null>(null);
	const [samples, setSamples] = useState<Sample[]>([]);
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

	useEffect(() => {
		initOcr(); // warm up worker lazily
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

	const readRoisOnce = useCallback(async (): Promise<Sample> => {
		const video = captureVideoRef.current;
		if (!video || !roiExp || !roiLevel) return { ts: Date.now(), level: null, expPercent: null };
		const { videoWidth, videoHeight } = video;
		if (videoWidth === 0 || videoHeight === 0) return { ts: Date.now(), level: null, expPercent: null };

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

		return { ts: Date.now(), level: levelRes.value, expPercent: expRes.percent ?? null, expValue: expRes.value ?? null };
	}, [roiExp, roiLevel, debugEnabled]);

	const startOrResume = useCallback(async () => {
		if (!captureVideoRef.current) return;
		if (!roiLevel || !roiExp) {
			alert("먼저 레벨/경험치 영역(ROI)을 설정해주세요.");
			return;
		}
		// First start: set baselines
		if (!hasStarted) {
			const first = await readRoisOnce();
			setStartLevel(first.level);
			setStartExp(first.expPercent);
			setStartExpValue(first.expValue ?? null);
			setCurrentLevel(first.level);
			setCurrentExp(first.expPercent);
			setCurrentExpValue(first.expValue ?? null);
			const firstValid = first.level != null && first.expPercent != null;
			const firstSample: Sample = { ts: first.ts, level: first.level, expPercent: first.expPercent, expValue: first.expValue ?? null, isValid: firstValid };
			setSamples([firstSample]);
			lastValidSampleRef.current = firstValid ? firstSample : null;
			setCumExpPct(0);
			setCumExpValue(0);
			setStartAt(Date.now());
			setHasStarted(true);
			setBaseElapsedMs(0);
			setElapsedMs(0);
		}

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
			const s = await readRoisOnce();
			const isValid = s.level != null && s.expPercent != null;
			const sample: Sample = { ...s, isValid };
			setSamples(prev => [...prev.slice(-600), sample]); // keep more samples for window averages
			setCurrentLevel(s.level);
			setCurrentExp(s.expPercent);
			setCurrentExpValue(s.expValue ?? null);
			// accumulate deltas
			const prev = lastValidSampleRef.current;
			if (prev && isValid && s.expPercent != null && prev.expPercent != null) {
				let deltaPct = 0;
				if ((s.level ?? prev.level) != null && (prev.level ?? null) != null && s.level != null && prev.level != null && s.level > prev.level) {
					deltaPct = (100 - prev.expPercent) + s.expPercent;
				} else {
					deltaPct = s.expPercent - prev.expPercent;
					if (deltaPct < 0) deltaPct = 0; // ignore negative due to noise/reset
				}
				setCumExpPct(v => v + deltaPct);
			}
			if (prev && isValid && s.expValue != null && prev.expValue != null && prev.level != null && s.level != null) {
				// Prefer table-based exact delta; fallback to same-level positive diff
				const dvFromTable = computeExpDeltaFromTable(expTable, prev.level, prev.expValue, s.level, s.expValue);
				if (dvFromTable != null) {
					if (dvFromTable > 0) setCumExpValue(v => v + dvFromTable);
				} else if (s.level === prev.level) {
					const dv = s.expValue - prev.expValue;
					if (dv > 0) setCumExpValue(v => v + dv);
				}
			}
			// update last valid pointer only when the current sample is valid
			if (isValid) {
				lastValidSampleRef.current = sample;
			}
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

	const pauseSampling = useCallback(() => {
		if (tickRef.current) {
			clearInterval(tickRef.current);
			tickRef.current = null;
		}
		if (clockRef.current) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		setBaseElapsedMs(elapsedMs);
		setIsSampling(false);
	}, [elapsedMs]);

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
		setStartAt(null);
		setStartLevel(null);
		setStartExp(null);
		setStartExpValue(null);
		setCurrentLevel(null);
		setCurrentExp(null);
		setCurrentExpValue(null);
		setSamples([]);
		lastSampleRef.current = null;
		setCumExpPct(0);
		setCumExpValue(0);
	}, []);

	useEffect(() => {
		return () => {
			if (tickRef.current) {
				clearInterval(tickRef.current);
				tickRef.current = null;
			}
		};
	}, []);

	const stats = useMemo(() => {
		if (
			startLevel == null ||
			startExp == null ||
			currentLevel == null ||
			currentExp == null ||
			!hasStarted
		) {
			return null;
		}
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
			predict5: predictGains(ratePerSec, 5),
			predict10: predictGains(ratePerSec, 10),
			predict30: predictGains(ratePerSec, 30),
			predict60: predictGains(ratePerSec, 60),
			nextHours,
			nextAt
		};
	}, [startLevel, startExp, currentLevel, currentExp, elapsedMs, hasStarted, cumExpPct]);

	const windowAvg = useMemo(() => {
		if (samples.length < 2) return { sumPct: 0, sumVal: 0, expectedPct: 0, expectedVal: 0 };
		const now = Date.now();
		const windowMs = avgWindowMin * 60 * 1000;
		const filtered = samples.filter(s => now - s.ts <= windowMs);
		if (filtered.length < 2) return { sumPct: 0, sumVal: 0, expectedPct: 0, expectedVal: 0 };
		let sumPct = 0;
		let sumVal = 0;
		for (let i = 1; i < filtered.length; i++) {
			const prev = filtered[i - 1];
			const cur = filtered[i];
			if (prev.isValid && cur.isValid && prev.expPercent != null && cur.expPercent != null) {
				let d = 0;
				if (cur.level != null && prev.level != null && cur.level > prev.level) {
					d = (100 - prev.expPercent) + cur.expPercent;
				} else {
					d = cur.expPercent - prev.expPercent;
					if (d < 0) d = 0;
				}
				sumPct += d;
			}
			if (prev.isValid && cur.isValid && prev.expValue != null && cur.expValue != null && prev.level != null && cur.level != null) {
				const dvFromTable = computeExpDeltaFromTable(expTable, prev.level, prev.expValue, cur.level, cur.expValue);
				if (dvFromTable != null) {
					if (dvFromTable > 0) sumVal += dvFromTable;
				} else if (prev.level === cur.level) {
					const dv = cur.expValue - prev.expValue;
					if (dv > 0) sumVal += dv;
				}
			}
		}
		// expected over window == sum over window; kept for clarity
		return { sumPct, sumVal, expectedPct: sumPct, expectedVal: sumVal };
	}, [samples, avgWindowMin]);

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
						<div className="opacity-70 text-sm">평균 경험치 ({avgWindowMin}분)</div>
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
							className="bg-white/10 rounded px-2 py-1 text-sm"
							value={intervalSec}
							onChange={e => setIntervalSec(parseInt(e.target.value, 10) as IntervalSec)}
						>
							<option value={1}>1초</option>
							<option value={5}>5초</option>
							<option value={10}>10초</option>
						</select>
						<label className="text-sm text-white/70 ml-4">평균 표시 시간</label>
						<select
							className="bg-white/10 rounded px-2 py-1 text-sm"
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
						onChangeLevel={setRoiLevel}
						onChangeExp={setRoiExp}
						active={activeRoi}
						onActiveChange={setActiveRoi}
					/>
				</div>

				<div className="flex items-center gap-2">
					<button
						className={clsx("btn", activeRoi === "level" && "btn-primary")}
						onClick={() => setActiveRoi(prev => prev === "level" ? null : "level")}
					>
						레벨 ROI 설정
					</button>
					<button
						className={clsx("btn", activeRoi === "exp" && "btn-primary")}
						onClick={() => setActiveRoi(prev => prev === "exp" ? null : "exp")}
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
		</div>
	);
}


