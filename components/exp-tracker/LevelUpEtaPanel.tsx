"use client";

import { cn } from "@/lib/cn";
import { formatClockTime, formatElapsed, formatNumber } from "@/lib/format";
import type { LevelUpEta } from "@/lib/levelProgress";

type Props = {
	eta: LevelUpEta;
};

// 이보다 오래 남았으면 시각을 찍어봐야 의미가 없습니다.
// (막 시작해서 표본이 몇 개 없을 때 "0.3 EXP/초" 같은 값이 나오면 예상이 며칠 단위로 튑니다)
const ETA_DISPLAY_LIMIT_MS = 24 * 60 * 60 * 1000;

/**
 * "레벨업까지 얼마나 남았는지"를 보여줍니다.
 *
 * - 왜 요약 카드 안에 두는가: "결과 이미지 복사"로 공유할 때 함께 담기는 게 자연스러운 성과 정보입니다.
 *   (반면 인식 실패 알림은 공유 이미지에 찍히면 안 되므로 카드 밖에 있습니다)
 * - PiP에는 넣지 않습니다. 사용자들이 PiP 창을 최대한 작게 만들어 쓰기 때문에, 줄을 늘리면 잘립니다.
 */
export default function LevelUpEtaPanel(props: Props) {
	const { eta } = props;
	// "아직 계산할 수 없음"과 "너무 오래 걸림"은 사용자가 할 일이 다르므로 구분해서 알립니다.
	// (전자는 기다리면 되고, 후자는 이 사냥터로는 오늘 안에 못 올린다는 뜻입니다)
	const tooLong = eta.etaMs != null && eta.etaMs > ETA_DISPLAY_LIMIT_MS;
	const etaAt = eta.etaMs != null && !tooLong ? new Date(Date.now() + eta.etaMs) : null;

	const remainingTimeText = eta.etaMs == null ? "-" : tooLong ? "24시간+" : formatElapsed(eta.etaMs);
	const remainingTimeHint =
		eta.etaMs == null
			? "측정이 더 쌓이면 표시됩니다"
			: tooLong
				? "지금 페이스로는 24시간 이상 걸립니다"
				: `${formatClockTime(etaAt as Date)} 도달 예상`;

	return (
		<div className="rounded-lg border border-white/10 bg-white/5 p-3">
			<div className="flex flex-wrap items-baseline gap-x-2">
				<div className="text-sm font-semibold text-white/90">레벨업까지</div>
				<div className="font-mono text-xs text-white/60">
					Lv.{eta.level} → {eta.nextLevel}
				</div>
			</div>

			<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<div className="text-sm opacity-70">남은 시간</div>
					{/*
					 * 왜 "24시간+"만 모노가 아닌가: 모노(D2Coding) 서브셋에는 한글이 단위 5자(누·만·분·억·적)만
					 * 들어 있어서, "시간"은 시스템 대체 글꼴로 떨어져 한 줄 안에서 글꼴이 섞입니다.
					 * 자릿수 정렬이 필요한 건 시:분:초 쪽이고 이 문구는 아니라, 여기만 본문 글꼴을 씁니다.
					 * (서브셋에 글자를 더하려면 `lib/fonts.ts`의 unicode-range도 함께 고쳐야 합니다)
					 */}
					<div className={cn("text-xl", tooLong ? "font-semibold" : "font-mono")}>{remainingTimeText}</div>
					<div className="text-xs text-white/60" suppressHydrationWarning>
						{remainingTimeHint}
					</div>
				</div>
				<div>
					<div className="text-sm opacity-70">남은 경험치</div>
					<div className="font-mono text-xl">
						{formatNumber(eta.remainingExp)} [{eta.remainingPct.toFixed(2)}%]
					</div>
					<div className="text-xs text-white/60">
						Lv.{eta.level} 필요 경험치 {formatNumber(eta.requiredExp)}
					</div>
				</div>
			</div>
		</div>
	);
}
