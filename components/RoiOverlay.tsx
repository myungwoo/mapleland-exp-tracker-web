"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "classnames";

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
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
	const [dragRect, setDragRect] = useState<RoiRect | null>(null);
	// Trigger re-render when video metadata or layout changes so preview rects position correctly immediately
	const [layoutTick, setLayoutTick] = useState(0);

	const highlightRect = useMemo(() => {
		if (!props.active) return null;
		if (dragRect) return dragRect;
		if (props.active === "level" && props.levelRect) return props.levelRect;
		if (props.active === "exp" && props.expRect) return props.expRect;
		return null;
	}, [props.active, dragRect, props.levelRect, props.expRect]);

	const toVideoSpace = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
		const video = props.videoRef.current;
		const overlay = overlayRef.current;
		if (!video || !overlay) return null;
		if (video.videoWidth === 0 || video.videoHeight === 0) return null;
		const container = overlay.getBoundingClientRect();
		if (container.width <= 0 || container.height <= 0) return null;
		const videoAR = video.videoWidth / video.videoHeight;
		const containerAR = container.width / container.height;
		let displayW: number, displayH: number, offX = 0, offY = 0;
		if (videoAR > containerAR) {
			// video fills width, letterbox top/bottom
			displayW = container.width;
			displayH = container.width / videoAR;
			offY = (container.height - displayH) / 2;
		} else {
			// video fills height, letterbox left/right
			displayH = container.height;
			displayW = container.height * videoAR;
			offX = (container.width - displayW) / 2;
		}
		const relX = clientX - container.left;
		const relY = clientY - container.top;
		// Must be inside the displayed video rect
		if (relX < offX || relY < offY || relX > offX + displayW || relY > offY + displayH) return null;
		const scaleX = video.videoWidth / displayW;
		const scaleY = video.videoHeight / displayH;
		return {
			x: Math.round((relX - offX) * scaleX),
			y: Math.round((relY - offY) * scaleY)
		};
	}, [props.videoRef]);

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (!props.active) return;
		const p = toVideoSpace(e.clientX, e.clientY);
		if (!p) {
			// Clicked outside the displayed video area (letterboxed padding): cancel ROI selection mode
			if (props.onCancelSelection) props.onCancelSelection();
			return;
		}
		setDragStart(p);
		setDragRect({ x: p.x, y: p.y, w: 1, h: 1 });
	}, [toVideoSpace, props.active]);

	const onMouseMove = useCallback((e: React.MouseEvent) => {
		if (!dragStart || !props.active) return;
		const p = toVideoSpace(e.clientX, e.clientY);
		if (!p) return;
		const x = Math.min(dragStart.x, p.x);
		const y = Math.min(dragStart.y, p.y);
		const w = Math.abs(p.x - dragStart.x);
		const h = Math.abs(p.y - dragStart.y);
		setDragRect({ x, y, w, h });
	}, [dragStart, toVideoSpace, props.active]);

	const onMouseUp = useCallback(() => {
		if (!props.active) return;
		if (dragRect && dragRect.w > 5 && dragRect.h > 5) {
			if (props.active === "level") props.onChangeLevel(dragRect);
			if (props.active === "exp") props.onChangeExp(dragRect);
		}
		setDragStart(null);
		setDragRect(null);
	}, [dragRect, props]);

	useEffect(() => {
		const onLeave = () => {
			setDragStart(null);
			setDragRect(null);
		};
		window.addEventListener("mouseup", onLeave);
		return () => window.removeEventListener("mouseup", onLeave);
	}, []);

	// Ensure we re-render when video metadata loads or container resizes so preview rects show immediately
	useEffect(() => {
		const video = props.videoRef.current;
		const overlay = overlayRef.current;
		const update = () => setLayoutTick(t => t + 1);
		if (video) {
			try {
				video.addEventListener("loadedmetadata", update);
				// Some browsers update video layout without firing loadedmetadata again; listen to 'resize' if available
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
		// Also listen to window resize to be safe
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
	}, [props.videoRef]);

	const previewRects = useMemo(() => {
		return [
			props.levelRect ? { rect: props.levelRect, color: "border-emerald-400", label: "LEVEL" } : null,
			props.expRect ? { rect: props.expRect, color: "border-cyan-400", label: "EXP%" } : null,
			dragRect ? { rect: dragRect, color: "border-yellow-400", label: props.active === "level" ? "LEVEL*" : "EXP*" } : null
		].filter(Boolean) as Array<{ rect: RoiRect; color: string; label: string }>;
		// layoutTick is used to force recalculation when video/layout changes
	}, [props.levelRect, props.expRect, dragRect, props.active, layoutTick]);

	const getCssRect = (r: RoiRect) => {
		const video = props.videoRef.current;
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
			className={clsx(
				"absolute inset-0",
				props.active ? "cursor-crosshair" : "cursor-default"
			)}
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
		>
			{/* Dim the entire screen to emphasize ROI while in selection mode */}
			{props.active ? (() => {
				// compute viewport size and hole rect in CSS pixels
				const overlay = overlayRef.current;
				const bounds = overlay ? overlay.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
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
				const holeLeftVp = Math.max(0, (bounds as any).left + hole.left);
				const holeTopVp = Math.max(0, (bounds as any).top + hole.top);
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
						className={clsx("absolute border-2 rounded-sm pointer-events-none", p.color)}
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


