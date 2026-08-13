"use client";

import { cn } from "@/lib/cn";
import type { ExpValidationResult } from "@/lib/expValidation";

type Props = {
	validation: ExpValidationResult | null;
	className?: string;
};

function Dot(props: { className: string }) {
	return <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", props.className)} />;
}

/**
 * 지금 읽힌 값이 EXP 테이블과 맞는지 한 줄로 보여줍니다.
 *
 * 설정 창(ROI 조정 중)과 메인 화면(측정 중)이 **같은 컴포넌트**를 씁니다.
 * 왜: 문구와 색이 갈라지면 같은 상태를 두 화면이 다르게 설명하게 됩니다.
 * (판정 규칙 자체가 `lib/expValidation.ts` 한 곳에 있는 것과 같은 이유입니다)
 *
 * ⚠️ 원인을 단정하지 마세요. 불일치만으로는 레벨을 잘못 읽은 건지 경험치를 잘못 읽은 건지 알 수 없습니다.
 */
export default function ExpValidationRow(props: Props) {
	const v = props.validation;
	if (!v) return null;

	const cls = (tone: string) => cn("flex flex-wrap items-center gap-1.5 text-xs", tone, props.className);

	if (!v.enabled) {
		return (
			<div className={cls("text-white/50")}>
				<Dot className="bg-white/30" />
				EXP% 검증 꺼짐 — 인식된 값을 그대로 사용합니다
			</div>
		);
	}
	if (v.status === "unavailable") {
		return (
			<div className={cls("text-amber-200/90")}>
				<Dot className="bg-amber-300" />
				EXP% 검증 대기 — 레벨 / 경험치 / 경험치 % 중 못 읽은 값이 있습니다
			</div>
		);
	}

	const detail =
		v.expectedPercent != null ? (
			<span className="ml-1 tabular-nums opacity-70">(테이블 기준 {v.expectedPercent.toFixed(2)}%)</span>
		) : v.requiredExp == null ? (
			<span className="ml-1 opacity-70">(이 레벨의 EXP 테이블이 없어 검증을 건너뜁니다)</span>
		) : null;

	if (v.status === "pass") {
		return (
			<div className={cls("text-emerald-200/90")}>
				<Dot className="bg-emerald-400" />
				EXP% 검증 통과{detail}
			</div>
		);
	}
	return (
		<div className={cls("text-rose-200")}>
			<Dot className="bg-rose-400" />
			EXP% 검증 불일치 — 지금 이 값은 측정에 반영되지 않습니다{detail}
		</div>
	);
}
