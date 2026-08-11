"use client";

import type { ExpValidationDebug } from "@/features/exp-tracker/hooks/useOcrSampling";

type Props = {
	levelPreviewRaw: string | null;
	levelPreviewProc: string | null;
	expPreviewRaw: string | null;
	expPreviewProc: string | null;
	levelOcrText: string;
	expOcrText: string;
	/** 이번 tick에서 파싱된 값 (이상치 필터를 거치기 전) */
	parsedLevel: number | null;
	parsedExpValue: number | null;
	parsedExpPercent: number | null;
	/** EXP%↔값 정합성 검증 결과 (아직 한 번도 읽지 못했으면 null) */
	expValidation: ExpValidationDebug | null;
};

/**
 * EXP% 검증 결과 한 줄.
 *
 * 검증이 켜져 있으면 이 tick이 측정에 반영되는지가 여기서 갈리므로,
 * "왜 걸렸는지"까지 보여줘야 사용자가 ROI를 고칠 수 있습니다.
 * (대부분은 EXP가 아니라 **레벨**을 잘못 읽어서 테이블 기준 퍼센트가 어긋나는 경우입니다)
 */
function ValidationRow(props: { validation: ExpValidationDebug | null; parsedExpPercent: number | null }) {
	const v = props.validation;
	if (!v) return <span className="opacity-50">-</span>;
	if (!v.enabled) {
		return <span className="opacity-60">꺼짐 — 인식된 값을 그대로 사용합니다</span>;
	}
	if (v.status === "unavailable") {
		return <span className="text-amber-300">판정 불가 — 레벨 / 경험치 / 경험치 % 중 못 읽은 값이 있습니다</span>;
	}
	const detail =
		v.expectedPercent != null && props.parsedExpPercent != null
			? `테이블 기준 ${v.expectedPercent.toFixed(2)}% ↔ 인식 ${props.parsedExpPercent.toFixed(2)}%`
			: v.requiredExp == null
				? "이 레벨의 EXP 테이블이 없어 검증을 건너뜁니다"
				: null;
	return (
		<span className={v.status === "pass" ? "text-emerald-300" : "text-rose-300"}>
			{v.status === "pass" ? "통과" : "불일치 — 이 tick은 측정에 반영되지 않습니다"}
			{detail ? <span className="ml-2 opacity-80 tabular-nums">({detail})</span> : null}
		</span>
	);
}

function ParsedValue(props: { label: string; value: string | null }) {
	return (
		<div className="flex items-baseline gap-2">
			<span className="opacity-70 shrink-0">{props.label}</span>
			<span className={props.value == null ? "opacity-50" : "font-semibold tabular-nums"}>
				{props.value ?? "인식 실패"}
			</span>
		</div>
	);
}

export default function DebugOcrPreview(props: Props) {
	return (
		<div className="card p-4 space-y-3">
			<h3 className="font-semibold">OCR 입력 미리보기</h3>
			{/* 왜: dataURL로 만드는 디버그 미리보기는 next/image 최적화 이점이 거의 없어 <img>를 사용합니다. */}
			{/* eslint-disable @next/next/no-img-element */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				<div>
					<div className="text-xs opacity-70 mb-1">Level Raw</div>
					{props.levelPreviewRaw ? (
						<img src={props.levelPreviewRaw} alt="level-raw" className="w-full h-auto rounded border border-white/10" />
					) : <div className="text-xs opacity-60">-</div>}
				</div>
				<div>
					<div className="text-xs opacity-70 mb-1">Level Proc</div>
					{props.levelPreviewProc ? (
						<img src={props.levelPreviewProc} alt="level-proc" className="w-full h-auto rounded border border-white/10" />
					) : <div className="text-xs opacity-60">-</div>}
				</div>
				<div>
					<div className="text-xs opacity-70 mb-1">EXP Raw</div>
					{props.expPreviewRaw ? (
						<img src={props.expPreviewRaw} alt="exp-raw" className="w-full h-auto rounded border border-white/10" />
					) : <div className="text-xs opacity-60">-</div>}
				</div>
				<div>
					<div className="text-xs opacity-70 mb-1">EXP Proc (픽셀 확대)</div>
					{props.expPreviewProc ? (
						<img src={props.expPreviewProc} alt="exp-proc" className="w-full h-auto rounded border border-white/10" />
					) : <div className="text-xs opacity-60">-</div>}
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="text-xs">
					<div className="opacity-70 mb-1">Level OCR</div>
					<pre className="whitespace-pre-wrap break-all bg-black/30 rounded p-2 border border-white/10 min-h-[2.5rem]">{props.levelOcrText || "-"}</pre>
				</div>
				<div className="text-xs">
					<div className="opacity-70 mb-1">EXP OCR</div>
					<pre className="whitespace-pre-wrap break-all bg-black/30 rounded p-2 border border-white/10 min-h-[2.5rem]">{props.expOcrText || "-"}</pre>
				</div>
			</div>

			<div className="text-xs">
				<div className="opacity-70 mb-1">파싱 결과</div>
				<div className="bg-black/30 rounded p-2 border border-white/10 space-y-2">
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1">
						<ParsedValue label="레벨" value={props.parsedLevel != null ? String(props.parsedLevel) : null} />
						<ParsedValue label="경험치" value={props.parsedExpValue != null ? props.parsedExpValue.toLocaleString() : null} />
						<ParsedValue label="경험치 %" value={props.parsedExpPercent != null ? `${props.parsedExpPercent.toFixed(2)}%` : null} />
					</div>
					<div className="flex items-baseline gap-2 border-t border-white/10 pt-2">
						<span className="opacity-70 shrink-0">EXP% 검증</span>
						<ValidationRow validation={props.expValidation} parsedExpPercent={props.parsedExpPercent} />
					</div>
				</div>
			</div>
			{/* eslint-enable @next/next/no-img-element */}

			<p className="text-xs opacity-60">
				미리보기는 디버그가 켜져 있으면 <span className="font-semibold">측정 시작 전에도</span> 1초마다 갱신됩니다.
				EXP OCR의 <span className="font-mono">?</span>는 못 읽은 숫자 한 자리, <span className="font-mono">_</span>는
				&quot;EXP.&quot; 라벨이나 UI 조각처럼 숫자가 아닌 부분이라 값에 영향을 주지 않습니다.
			</p>
		</div>
	);
}
