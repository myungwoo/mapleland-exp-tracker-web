"use client";

type Props = {
	levelPreviewRaw: string | null;
	levelPreviewProc: string | null;
	expPreviewRaw: string | null;
	expPreviewProc: string | null;
	levelOcrText: string;
	expOcrText: string;
};

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
					<div className="text-xs opacity-70 mb-1">EXP Proc</div>
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
			{/* eslint-enable @next/next/no-img-element */}

			<p className="text-xs opacity-60">미리보기는 디버그가 켜진 동안에만 매 tick 갱신됩니다.</p>
		</div>
	);
}


