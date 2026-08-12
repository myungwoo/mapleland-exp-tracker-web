"use client";

import { useEffect, useState } from "react";
import { EXP_COUPON_MINUTES, EXP_COUPON_MS, normalizeCouponCount } from "@/lib/expCoupon";
import { formatElapsed, formatNumber } from "@/lib/format";

type Props = {
	count: number;
	onCountChange: (n: number) => void;
	elapsedMs: number;
	adjustedElapsedMs: number;
	paceWindowMin: number;
	adjustedPace: { pct: number; val: number };
};

/**
 * 경험치 쿠폰(경쿠) 사용 개수를 입력받아, 쿠폰 효과를 제외한 "실제 사냥터 효율"을 보여줍니다.
 * - 측정이 끝난 뒤(일시정지 상태)에만 노출합니다.
 * - PiP에는 노출하지 않습니다. (웹 페이지 전용 기능)
 */
export default function ExpCouponPanel(props: Props) {
	// 입력 중 "지우기"가 자연스럽도록 표시용 문자열을 별도로 들고 있습니다.
	const [text, setText] = useState<string>(String(props.count));
	useEffect(() => {
		// 외부에서 값이 바뀌면(초기화/기록 불러오기 등) 입력창도 따라갑니다.
		setText((prev) => (normalizeCouponCount(prev) === props.count ? prev : String(props.count)));
	}, [props.count]);

	const commit = (next: number) => {
		const n = normalizeCouponCount(next);
		setText(String(n));
		props.onCountChange(n);
	};

	const bonusMs = props.count * EXP_COUPON_MS;

	return (
		<div className="rounded-lg border border-white/10 bg-white/5 p-3">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<div>
					<div className="text-sm font-semibold text-white/90">경험치 쿠폰 보정</div>
					<div className="text-xs text-white/60">쿠폰 1개 = {EXP_COUPON_MINUTES}분</div>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<label className="text-sm text-white/70" htmlFor="exp-coupon-count">
						사용한 쿠폰
					</label>
					<div className="inline-flex items-center overflow-hidden rounded border border-white/10">
						<button
							type="button"
							className="px-2 py-1 text-sm leading-none bg-white/5 hover:bg-white/10 disabled:opacity-40"
							onClick={() => commit(props.count - 1)}
							disabled={props.count <= 0}
							aria-label="쿠폰 개수 감소"
						>
							−
						</button>
						<input
							id="exp-coupon-count"
							type="number"
							min={0}
							step={1}
							inputMode="numeric"
							className="w-16 bg-white/10 px-2 py-1 text-center font-mono text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
							value={text}
							onChange={(e) => {
								setText(e.target.value);
								props.onCountChange(normalizeCouponCount(e.target.value));
							}}
							onBlur={() => commit(normalizeCouponCount(text))}
						/>
						<button
							type="button"
							className="px-2 py-1 text-sm leading-none bg-white/5 hover:bg-white/10"
							onClick={() => commit(props.count + 1)}
							aria-label="쿠폰 개수 증가"
						>
							+
						</button>
					</div>
					<span className="text-sm text-white/70">개</span>
				</div>
			</div>

			{props.count > 0 ? (
				<div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
					<div>
						<div className="text-sm opacity-70">보정된 사냥 시간</div>
						<div className="font-mono text-xl">{formatElapsed(props.adjustedElapsedMs)}</div>
						<div className="text-xs text-white/60">
							{formatElapsed(props.elapsedMs)} + {formatElapsed(bonusMs)} (쿠폰 {props.count}개)
						</div>
					</div>
					<div>
						<div className="text-sm opacity-70">실제 사냥터 효율 ({props.paceWindowMin}분 기준)</div>
						<div className="font-mono text-xl">
							{formatNumber(props.adjustedPace.val)} [{props.adjustedPace.pct.toFixed(2)}%]
						</div>
					</div>
				</div>
			) : (
				<p className="mt-2 text-xs text-white/60">
					사용한 경험치 쿠폰 개수를 입력하면, 쿠폰 효과를 제외한 실제 사냥터 효율(페이스)을 계산합니다.
				</p>
			)}
		</div>
	);
}
