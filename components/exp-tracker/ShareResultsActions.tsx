"use client";

import { useEffect, useRef } from "react";
import { useShareResults } from "@/features/exp-tracker/hooks/useShareResults";
import { primeDomToPngFonts } from "@/lib/domToPng";

type Props = {
	hasStarted: boolean;
	elapsedMs: number;
	cumExpValue: number;
	cumExpPct: number;
	avgWindowMin: number;
	avgEstimateValue: number;
	avgEstimatePct: number;
	getSummaryEl: () => HTMLElement | null;
};

export default function ShareResultsActions(props: Props) {
	const primedRef = useRef(false);
	useEffect(() => {
		if (primedRef.current) return;
		const el = props.getSummaryEl();
		if (!el) return;
		primedRef.current = true;
		primeDomToPngFonts(el);
	}, [props]);

	const share = useShareResults({
		hasStarted: props.hasStarted,
		elapsedMs: props.elapsedMs,
		cumExpValue: props.cumExpValue,
		cumExpPct: props.cumExpPct,
		avgWindowMin: props.avgWindowMin,
		avgEstimateValue: props.avgEstimateValue,
		avgEstimatePct: props.avgEstimatePct,
		getSummaryEl: props.getSummaryEl
	});

	return (
		<div className="flex items-center justify-end gap-2">
			<button
				className="btn"
				onClick={() => { void share.copyText(); }}
				disabled={!props.hasStarted}
			>
				{share.textButtonLabel}
			</button>
			<button
				className="btn"
				onClick={() => { void share.copyImage(); }}
				disabled={!props.hasStarted || share.isCopyingImage}
				aria-busy={share.isCopyingImage}
			>
				{share.isCopyingImage ? "이미지 생성 중…" : share.imageButtonLabel}
			</button>
		</div>
	);
}


