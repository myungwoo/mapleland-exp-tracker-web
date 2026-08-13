"use client";

import ExpValidationRow from "@/components/exp-tracker/ExpValidationRow";
import { formatNumber } from "@/lib/format";
import type { LiveRecognition } from "@/features/exp-tracker/hooks/useSampling";

type Props = {
	/** 측정 중이 아니면 null을 넘기세요. (읽지 않는 동안 옛 값을 띄우지 않기 위함) */
	live: LiveRecognition | null;
};

/**
 * 지금 화면에서 무엇을 읽고 있는지 그대로 보여줍니다.
 *
 * 왜 필요한가: 누적/페이스는 "결과"라서, 인식이 어긋나기 시작해도 한참 뒤에야 이상하다는 걸 알게 됩니다.
 * 설정 창을 열지 않고도 레벨·경험치가 제대로 읽히는지 확인할 수 있어야 합니다.
 *
 * 왜 요약 카드 밖에 두는가: 요약 카드는 "결과 이미지 복사"로 통째로 캡처됩니다. 이건 공유할 성과가 아니라
 * 진단 정보라 공유 이미지에 들어가면 안 됩니다. (RecognitionHealthBanner와 같은 이유)
 *
 * 인식 비용: 없습니다. 측정 루프가 어차피 매 tick 읽은 결과를 그대로 받아 씁니다.
 * 그래서 측정 중이 아닐 때는 읽지도, 보여주지도 않습니다.
 */
export default function LiveRecognitionBar(props: Props) {
	const live = props.live;
	if (!live) return null;

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
			<span className="text-xs font-semibold text-white/45">인식 상태</span>
			<Field label="레벨" value={live.level != null ? String(live.level) : null} />
			<Field label="경험치" value={live.expValue != null ? formatNumber(live.expValue) : null} />
			<Field label="경험치 %" value={live.expPercent != null ? `${live.expPercent.toFixed(2)}%` : null} />
			<ExpValidationRow validation={live.validation} className="ml-auto" />
		</div>
	);
}

function Field(props: { label: string; value: string | null }) {
	return (
		<span className="inline-flex items-baseline gap-1.5 text-sm">
			{/* 라벨은 한글이라 모노를 쓰면 안 됩니다. 모노(D2Coding) 서브셋에는 단위 5자만 있습니다. */}
			<span className="text-xs text-white/50">{props.label}</span>
			{props.value == null ? (
				<span className="text-xs text-amber-200/80">읽지 못함</span>
			) : (
				<span className="font-mono tabular-nums">{props.value}</span>
			)}
		</span>
	);
}
