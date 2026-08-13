"use client";

import PaceChart from "@/components/PaceChart";
import ExpCouponPanel from "@/components/exp-tracker/ExpCouponPanel";
import LevelUpEtaPanel from "@/components/exp-tracker/LevelUpEtaPanel";
import { cn } from "@/lib/cn";
import { formatClockTime, formatElapsed, formatNumber, formatNumberCompact } from "@/lib/format";
import type { LevelUpEta } from "@/lib/levelProgress";
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
	/** 측정 중이면 경과 시간 옆에 살아 있다는 표시를 띄웁니다. */
	isSampling: boolean;
	/** 레벨업까지 남은 시간/경험치. 레벨이나 EXP를 아직 못 읽었으면 null입니다. */
	levelUpEta: LevelUpEta | null;
	cumExpValue: number;
	cumExpPct: number;
	paceWindowMin: number;
	paceAtWindow: { pct: number; val: number };
	intervalSec: number;

	/** 경험치 쿠폰 보정: 측정이 끝난 뒤에만 노출합니다. (PiP에는 없음) */
	showCouponPanel: boolean;
	expCouponCount: number;
	onExpCouponCountChange: (n: number) => void;
	couponAdjustedElapsedMs: number;
	couponAdjustedPace: { pct: number; val: number };

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

	/** "결과 이미지 복사"를 위해, 렌더된 요약 카드를 통째로 캡처합니다. */
	captureRef?: Ref<HTMLDivElement>;
};

export default function TrackerSummary(props: Props) {
	return (
		<div ref={props.captureRef} className="card p-4 space-y-4">
			<h2 className="text-lg font-semibold">측정 정보</h2>
			{/*
			 * 왜 sm/xl까지 나누는가: 브레이크포인트가 md 하나였을 때, 600~768px에서는 지표 4개가 1열로
			 * 길게 늘어지고 1600px에서는 2열이라 좌우가 텅 비었습니다.
			 */}
			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
				<div>
					<div className="opacity-70 text-sm flex items-center gap-1.5">
						경과된 시간
						{props.isSampling ? (
							<span className="inline-flex items-center gap-1 text-emerald-300" title="측정 중">
								{/* 왜 애니메이션인가: 버튼 색만으로는 "지금 기록되고 있다"가 잘 안 보였습니다. */}
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />
								<span className="text-xs">측정 중</span>
							</span>
						) : null}
					</div>
					<div className="font-mono text-xl">{formatElapsed(props.elapsedMs)}</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">
						{props.stats ? `${props.stats.nextHours}시간 되는 시각` : "다음 시간 되는 시각"}
					</div>
					<div className="font-mono text-xl" suppressHydrationWarning>
						{props.stats ? formatClockTime(props.stats.nextAt) : "-"}
					</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">현재까지 획득한 경험치</div>
					<div className="font-mono text-xl">
						{formatNumber(props.cumExpValue)} [{props.cumExpPct.toFixed(2)}%]
					</div>
				</div>
				<div>
					<div className="opacity-70 text-sm">페이스 ({props.paceWindowMin}분 기준)</div>
					<div className="font-mono text-xl">
						{formatNumber(props.paceAtWindow.val)} [{props.paceAtWindow.pct.toFixed(2)}%]
					</div>
				</div>
			</div>

			{props.levelUpEta ? <LevelUpEtaPanel eta={props.levelUpEta} /> : null}

			{props.showCouponPanel ? (
				<ExpCouponPanel
					count={props.expCouponCount}
					onCountChange={props.onExpCouponCountChange}
					elapsedMs={props.elapsedMs}
					adjustedElapsedMs={props.couponAdjustedElapsedMs}
					paceWindowMin={props.paceWindowMin}
					adjustedPace={props.couponAdjustedPace}
				/>
			) : null}

			<div className="mt-2">
				<div className="flex items-baseline justify-between">
					<h3 className="font-semibold">
						{props.chartMode === "pace"
							? `전체 페이스 (${props.paceWindowMin}분 기준)`
							: props.chartMode === "paceRecent"
								? `최근 30초 페이스 (${props.paceWindowMin}분 기준)`
								: "누적 경험치"}
					</h3>
					<div className="flex items-center gap-2">
						<div className="text-xs text-white/60 hidden md:block">
							측정 주기 {props.intervalSec}초 · 가변 간격 대응
						</div>
						<div className="inline-flex flex-nowrap whitespace-nowrap rounded overflow-hidden border border-white/10">
							<button
								className={cn(
									"px-2 py-1 text-xs whitespace-nowrap leading-none",
									props.chartMode === "pace" ? "bg-white/15" : "bg-white/5"
								)}
								onClick={() => props.onChartModeChange("pace")}
							>
								페이스
							</button>
							<button
								className={cn(
									"px-2 py-1 text-xs whitespace-nowrap leading-none",
									props.chartMode === "paceRecent" ? "bg-white/15" : "bg-white/5"
								)}
								onClick={() => props.onChartModeChange("paceRecent")}
							>
								최근 30초
							</button>
							<button
								className={cn(
									"px-2 py-1 text-xs whitespace-nowrap leading-none",
									props.chartMode === "cumulative" ? "bg-white/15" : "bg-white/5"
								)}
								onClick={() => props.onChartModeChange("cumulative")}
							>
								누적
							</button>
						</div>
						<div className="inline-flex flex-nowrap whitespace-nowrap rounded overflow-hidden border border-white/10">
							<button
								className={cn(
									"px-2 py-1 text-xs whitespace-nowrap leading-none",
									props.chartShowAxisLabels ? "bg-white/15" : "bg-white/5"
								)}
								onClick={() => props.onChartShowAxisLabelsChange(!props.chartShowAxisLabels)}
								title="축 라벨 표시"
							>
								축
							</button>
							<button
								className={cn(
									"px-2 py-1 text-xs whitespace-nowrap leading-none",
									props.chartShowGrid ? "bg-white/15" : "bg-white/5"
								)}
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

				{/*
				 * 왜 모드마다 한 줄씩 반드시 두는가: 예전에는 "누적"에만 설명이 없어서, 탭을 누를 때마다
				 * 카드 높이가 한 줄만큼 바뀌고 아래의 공유 버튼이 위아래로 튀었습니다.
				 */}
				<p className="text-xs text-white/60 mt-1">
					{props.chartMode === "pace"
						? "시작부터 시점까지의 페이스입니다."
						: props.chartMode === "paceRecent"
							? "시점 기준 최근 30초의 페이스입니다."
							: "시작부터 시점까지 쌓인 총 경험치입니다."}
				</p>

				<div className="mt-2 h-40">
					{props.chartMode === "pace" ? (
						<PaceChart
							data={props.paceOverallSeries}
							tooltipFormatter={(v: number) => `${formatNumber(v)} / ${props.paceWindowMin}분`}
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
							tooltipFormatter={(v: number) => `${formatNumber(v)} / ${props.paceWindowMin}분`}
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
