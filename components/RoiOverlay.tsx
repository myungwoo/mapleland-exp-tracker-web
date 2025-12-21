"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type RoiRect = { x: number; y: number; w: number; h: number };

type Props = {
	videoRef: MutableRefObject<HTMLVideoElement | null>;
	levelRect: RoiRect | null;
	expRect: RoiRect | null;
	onChangeLevel: (r: RoiRect | null) => void;
	onChangeExp: (r: RoiRect | null) => void;
	active: "level" | "exp" | null;
	onActiveChange: (a: "level" | "exp" | null) => void;
	onCancelSelection?: () => void;
};

export default function RoiOverlay(props: Props) {
	const {
		videoRef,
		levelRect,
		expRect,
		onChangeLevel,
		onChangeExp,
		active,
		onCancelSelection
	} = props;

	const overlayRef = useRef<HTMLDivElement | null>(null);
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
	const [dragRect, setDragRect] = useState<RoiRect | null>(null);
	// 왜: 비디오 메타데이터 로딩/리사이즈 시점에 overlay 계산이 늦어져 ROI 미리보기 위치가 순간적으로 틀어질 수 있어,
	// 강제로 재렌더링을 트리거해서 “바로” 올바른 위치를 계산합니다.
	const [layoutTick, setLayoutTick] = useState(0);

	const highlightRect = useMemo(() => {
		if (!active) return null;
		if (dragRect) return dragRect;
		if (active === "level" && levelRect) return levelRect;
		if (active === "exp" && expRect) return expRect;
		return null;
	}, [active, dragRect, levelRect, expRect]);

	const toVideoSpace = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
		const video = videoRef.current;
		const overlay = overlayRef.current;
		if (!video || !overlay) return null;
		if (video.videoWidth === 0 || video.videoHeight === 0) return null;
		const container = overlay.getBoundingClientRect();
		if (container.width <= 0 || container.height <= 0) return null;
		const videoAR = video.videoWidth / video.videoHeight;
		const containerAR = container.width / container.height;
		let displayW: number, displayH: number, offX = 0, offY = 0;
		if (videoAR > containerAR) {
			// 왜: 비디오가 가로를 꽉 채우는 경우 상/하에 레터박스가 생깁니다.
			displayW = container.width;
			displayH = container.width / videoAR;
			offY = (container.height - displayH) / 2;
		} else {
			// 왜: 비디오가 세로를 꽉 채우는 경우 좌/우에 레터박스가 생깁니다.
			displayH = container.height;
			displayW = container.height * videoAR;
			offX = (container.width - displayW) / 2;
		}
		const relX = clientX - container.left;
		const relY = clientY - container.top;
		// 왜: 레터박스 영역(검은 여백)에서 드래그하면 ROI가 비디오 영역을 벗어나므로 무시합니다.
		if (relX < offX || relY < offY || relX > offX + displayW || relY > offY + displayH) return null;
		const scaleX = video.videoWidth / displayW;
		const scaleY = video.videoHeight / displayH;
		return {
			x: Math.round((relX - offX) * scaleX),
			y: Math.round((relY - offY) * scaleY)
		};
	}, [videoRef]);

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (!active) return;
		const p = toVideoSpace(e.clientX, e.clientY);
		if (!p) {
			// 왜: 레터박스(검은 여백)를 클릭하면 ROI 선택 모드를 취소하는 게 더 자연스럽습니다.
			onCancelSelection?.();
			return;
		}
		setDragStart(p);
		setDragRect({ x: p.x, y: p.y, w: 1, h: 1 });
	}, [toVideoSpace, active, onCancelSelection]);

	const onMouseMove = useCallback((e: React.MouseEvent) => {
		if (!dragStart || !active) return;
		const p = toVideoSpace(e.clientX, e.clientY);
		if (!p) return;
		const x = Math.min(dragStart.x, p.x);
		const y = Math.min(dragStart.y, p.y);
		const w = Math.abs(p.x - dragStart.x);
		const h = Math.abs(p.y - dragStart.y);
		setDragRect({ x, y, w, h });
	}, [dragStart, toVideoSpace, active]);

	const onMouseUp = useCallback(() => {
		if (!active) return;
		if (dragRect && dragRect.w > 5 && dragRect.h > 5) {
			if (active === "level") onChangeLevel(dragRect);
			if (active === "exp") onChangeExp(dragRect);
		}
		setDragStart(null);
		setDragRect(null);
	}, [dragRect, active, onChangeLevel, onChangeExp]);

	useEffect(() => {
		const onLeave = () => {
			setDragStart(null);
			setDragRect(null);
		};
		window.addEventListener("mouseup", onLeave);
		return () => window.removeEventListener("mouseup", onLeave);
	}, []);

	// 왜: 비디오 메타데이터 로딩/레이아웃 변경을 감지해서 ROI 미리보기를 즉시 갱신합니다.
	useEffect(() => {
		const video = videoRef.current;
		const overlay = overlayRef.current;
		const update = () => setLayoutTick(t => t + 1);
		if (video) {
			try {
				video.addEventListener("loadedmetadata", update);
				// 왜: 일부 브라우저는 video 레이아웃이 바뀌어도 loadedmetadata를 다시 쏘지 않아서, resize(가능하면)를 추가로 받습니다.
				video.addEventListener("resize" as any, update as any);
			} catch {
				// no-op
			}
		}
		let ro: ResizeObserver | null = null;
		if (overlay && "ResizeObserver" in window) {
			try {
				ro = new ResizeObserver(() => update());
				ro.observe(overlay);
			} catch {
				ro = null;
			}
		}
		// 왜: overlay는 window 리사이즈의 영향을 받으므로 안전하게 같이 듣습니다.
		window.addEventListener("resize", update);
		return () => {
			if (video) {
				try {
					video.removeEventListener("loadedmetadata", update);
					video.removeEventListener("resize" as any, update as any);
				} catch {
					// no-op
				}
			}
			if (ro) {
				try { ro.disconnect(); } catch { /* ignore */ }
			}
			window.removeEventListener("resize", update);
		};
	}, [videoRef]);

	const previewRects = useMemo(() => {
		// 왜: layoutTick을 의존성으로 포함해서, 레이아웃 변화 시 미리보기 rect 계산을 강제로 다시 돌립니다.
		void layoutTick;
		return [
			levelRect ? { rect: levelRect, color: "border-emerald-400", label: "LEVEL" } : null,
			expRect ? { rect: expRect, color: "border-cyan-400", label: "EXP%" } : null,
			dragRect ? { rect: dragRect, color: "border-yellow-400", label: active === "level" ? "LEVEL*" : "EXP*" } : null
		].filter(Boolean) as Array<{ rect: RoiRect; color: string; label: string }>;
	}, [levelRect, expRect, dragRect, active, layoutTick]);

	const getCssRect = (r: RoiRect) => {
		const video = videoRef.current;
		const overlay = overlayRef.current;
		if (!video || !overlay) return { left: 0, top: 0, width: 0, height: 0 };
		if (video.videoWidth === 0 || video.videoHeight === 0) return { left: 0, top: 0, width: 0, height: 0 };
		const container = overlay.getBoundingClientRect();
		if (container.width <= 0 || container.height <= 0) return { left: 0, top: 0, width: 0, height: 0 };
		const videoAR = video.videoWidth / video.videoHeight;
		const containerAR = container.width / container.height;
		let displayW: number, displayH: number, offX = 0, offY = 0;
		if (videoAR > containerAR) {
			displayW = container.width;
			displayH = container.width / videoAR;
			offY = (container.height - displayH) / 2;
		} else {
			displayH = container.height;
			displayW = container.height * videoAR;
			offX = (container.width - displayW) / 2;
		}
		const scaleX = displayW / video.videoWidth;
		const scaleY = displayH / video.videoHeight;
		// Guard against NaN/Infinity
		if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
			return { left: 0, top: 0, width: 0, height: 0 };
		}
		return {
			left: offX + r.x * scaleX,
			top: offY + r.y * scaleY,
			width: Math.max(1, r.w * scaleX),
			height: Math.max(1, r.h * scaleY)
		};
	};

	return (
		<div
			ref={overlayRef}
			className={cn(
				"absolute inset-0",
				active ? "cursor-crosshair" : "cursor-default"
			)}
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
		>
			{/* Dim the entire screen to emphasize ROI while in selection mode */}
			{props.active ? (() => {
				// compute viewport size and hole rect in CSS pixels
				const overlay = overlayRef.current;
				const bounds = overlay ? overlay.getBoundingClientRect() : null;
				const hole = highlightRect ? getCssRect(highlightRect) : null;
				const vw = typeof window !== "undefined" ? window.innerWidth : 0;
				const vh = typeof window !== "undefined" ? window.innerHeight : 0;
				if (!hole) {
					// no hole yet: dim entire viewport
					return (
						<div className="fixed inset-0 bg-black/50 pointer-events-none z-[60]" />
					);
				}
				// Convert hole to viewport coordinates by adding container offset
				const containerLeft = bounds?.left ?? 0;
				const containerTop = bounds?.top ?? 0;
				const holeLeftVp = Math.max(0, containerLeft + hole.left);
				const holeTopVp = Math.max(0, containerTop + hole.top);
				const holeRightVp = holeLeftVp + hole.width;
				const holeBottomVp = holeTopVp + hole.height;
				const topH = Math.max(0, holeTopVp);
				const leftW = Math.max(0, holeLeftVp);
				const rightW = Math.max(0, vw - holeRightVp);
				const bottomH = Math.max(0, vh - holeBottomVp);
				return (
					<>
						{/* top strip */}
						<div
							className="fixed left-0 top-0 bg-black/50 pointer-events-none z-[60]"
							style={{ width: vw, height: topH }}
						/>
						{/* left strip */}
						<div
							className="fixed bg-black/50 pointer-events-none z-[60]"
							style={{ left: 0, top: holeTopVp, width: leftW, height: hole.height }}
						/>
						{/* right strip */}
						<div
							className="fixed bg-black/50 pointer-events-none z-[60]"
							style={{ left: holeRightVp, top: holeTopVp, width: rightW, height: hole.height }}
						/>
						{/* bottom strip */}
						<div
							className="fixed left-0 bg-black/50 pointer-events-none z-[60]"
							style={{ top: holeBottomVp, width: vw, height: bottomH }}
						/>
					</>
				);
			})() : null}

			{previewRects.map((p, idx) => {
				const css = getCssRect(p.rect);
				return (
					<div
						key={idx}
						className={cn("absolute border-2 rounded-sm pointer-events-none", p.color)}
						style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
						title={p.label}
					>
						<div className="absolute -top-5 left-0 text-xs font-mono text-white/80 bg-black/60 px-1 rounded">
							{p.label}
						</div>
					</div>
				);
			})}
		</div>
	);
}


