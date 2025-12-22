"use client";

import PaceChart from "@/components/PaceChart";
import { cn } from "@/lib/cn";
import { formatElapsed, formatNumber, formatNumberCompact } from "@/lib/format";
import type { Ref } from "react";

type Stats = {
	nextAt: Date;
	nextHours: number;
};

type ChartMode = "pace" | "paceRecent" | "cumulative";

type SeriesPoint = { ts: number; value: number };

type Props = {
	elapsedMs: number;
	stats: Stats | null;
	cumExpValue: number;
	cumExpPct: number;
	avgWindowMin: number;
	avgEstimate: { pct: number; val: number };
	intervalSec: number;

	chartMode: ChartMode;
	onChartModeChange: (m: ChartMode) => void;

	chartRangeMs: [number, number] | null;
	onChartRangeChange: (r: [number, number] | null) => void;

	chartShowAxisLabels: boolean;
	onChartShowAxisLabelsChange: (v: boolean) => void;
	chartShowGrid: boolean;
	onChartShowGridChange: (v: boolean) => void;

	paceOverallSeries: SeriesPoint[];
	recentPaceSeries: SeriesPoint[];
	cumulativeSeries: SeriesPoint[];

	/** For "결과 이미지 복사": capture the whole summary card as rendered */
	captureRef?: Ref<HTMLDivElement>;
};

export default function TrackerSummary(props: Props) {
	return (
		<div ref={props.captureRef} className="card p-4 space-y-4">
			<h2 className="text-lg font-semibold">측정 정보</h2>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<div className="opacity-70 text-sm">경과된 시간</div>
					<div className="font-mono text-xl">{formatElapsed(props.elapsedMs)}</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">{props.stats ? `${props.stats.nextHours}시간 되는 시각` : "다음 시간 되는 시각"}</div>
					<div className="font-mono text-xl" suppressHydrationWarning>{props.stats ? props.stats.nextAt.toLocaleTimeString() : "-"}</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">현재까지 획득한 경험치</div>
					<div className="font-mono text-xl">
						{formatNumber(props.cumExpValue)} [{props.cumExpPct.toFixed(2)}%]
					</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">페이스 ({props.avgWindowMin}분 기준)</div>
					<div className="font-mono text-xl">
						{formatNumber(props.avgEstimate.val)} [{props.avgEstimate.pct.toFixed(2)}%]
					</div>
				</div>
			</div>

			<div className="mt-2">
				<div className="flex items-baseline justify-between">
					<h3 className="font-semibold">
						{props.chartMode === "pace"
							? `전체 페이스 (${props.avgWindowMin}분 기준)`
							: props.chartMode === "paceRecent"
								? `최근 30초 페이스 (${props.avgWindowMin}분 기준)`
								: "누적 경험치"}
					</h3>
					<div className="flex items-center gap-2">
						<div className="text-xs text-white/60 hidden md:block">측정 주기 {props.intervalSec}초 · 가변 간격 대응</div>
						<div className="inline-flex flex-nowrap whitespace-nowrap rounded overflow-hidden border border-white/10">
							<button
								className={cn("px-2 py-1 text-xs whitespace-nowrap leading-none", props.chartMode === "pace" ? "bg-white/15" : "bg-white/5")}
								onClick={() => props.onChartModeChange("pace")}
							>
								페이스
							</button>
							<button
								className={cn("px-2 py-1 text-xs whitespace-nowrap leading-none", props.chartMode === "paceRecent" ? "bg-white/15" : "bg-white/5")}
								onClick={() => props.onChartModeChange("paceRecent")}
							>
								최근 30초
							</button>
							<button
								className={cn("px-2 py-1 text-xs whitespace-nowrap leading-none", props.chartMode === "cumulative" ? "bg-white/15" : "bg-white/5")}
								onClick={() => props.onChartModeChange("cumulative")}
							>
								누적
							</button>
						</div>
						<div className="inline-flex flex-nowrap whitespace-nowrap rounded overflow-hidden border border-white/10">
							<button
								className={cn("px-2 py-1 text-xs whitespace-nowrap leading-none", props.chartShowAxisLabels ? "bg-white/15" : "bg-white/5")}
								onClick={() => props.onChartShowAxisLabelsChange(!props.chartShowAxisLabels)}
								title="축 라벨 표시"
							>
								축
							</button>
							<button
								className={cn("px-2 py-1 text-xs whitespace-nowrap leading-none", props.chartShowGrid ? "bg-white/15" : "bg-white/5")}
								onClick={() => props.onChartShowGridChange(!props.chartShowGrid)}
								title="그리드 표시"
							>
								그리드
							</button>
						</div>
						{props.chartRangeMs ? (
							<button
								className="ml-2 px-2 py-1 text-xs rounded border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 whitespace-nowrap leading-none"
								onClick={() => props.onChartRangeChange(null)}
							>
								전체 보기
							</button>
						) : null}
					</div>
				</div>

				{props.chartMode === "pace" ? (
					<p className="text-xs text-white/60 mt-1">시작부터 시점까지의 평균 페이스입니다.</p>
				) : props.chartMode === "paceRecent" ? (
					<p className="text-xs text-white/60 mt-1">시점 기준 최근 30초의 페이스입니다.</p>
				) : null}

				<div className="mt-2 h-40">
					{props.chartMode === "pace" ? (
						<PaceChart
							data={props.paceOverallSeries}
							tooltipFormatter={(v: number) => `${formatNumber(v)} / ${props.avgWindowMin}분`}
							yLabelFormatter={(v: number) => formatNumberCompact(v)}
							xLabelFormatter={(ts: number) => formatElapsed(ts)}
							xDomain={props.chartRangeMs}
							showAxisLabels={props.chartShowAxisLabels}
							showGrid={props.chartShowGrid}
							enableBrush
							onRangeChange={(s, e) => props.onChartRangeChange([s, e])}
						/>
					) : props.chartMode === "paceRecent" ? (
						<PaceChart
							data={props.recentPaceSeries}
							tooltipFormatter={(v: number) => `${formatNumber(v)} / ${props.avgWindowMin}분`}
							yLabelFormatter={(v: number) => formatNumberCompact(v)}
							xLabelFormatter={(ts: number) => formatElapsed(ts)}
							xDomain={props.chartRangeMs}
							showAxisLabels={props.chartShowAxisLabels}
							showGrid={props.chartShowGrid}
							enableBrush
							onRangeChange={(s, e) => props.onChartRangeChange([s, e])}
						/>
					) : (
						<PaceChart
							data={props.cumulativeSeries}
							tooltipFormatter={(v: number) => `${formatNumber(v)} 누적`}
							yLabelFormatter={(v: number) => formatNumberCompact(v)}
							xLabelFormatter={(ts: number) => formatElapsed(ts)}
							xDomain={props.chartRangeMs}
							showAxisLabels={props.chartShowAxisLabels}
							showGrid={props.chartShowGrid}
							enableBrush
							onRangeChange={(s, e) => props.onChartRangeChange([s, e])}
						/>
					)}
				</div>
			</div>
		</div>
	);
}


