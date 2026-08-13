"use client";

import type { OcrHealthNotice } from "@/lib/ocrHealth";

type Props = {
	notice: OcrHealthNotice | null;
};

/**
 * "지금 기록이 안 되고 있다"를 알리는 한 줄 띠입니다.
 *
 * 왜 요약 카드(TrackerSummary) 밖에 두는가: 요약 카드는 "결과 이미지 복사"로 통째로 캡처되는
 * 영역입니다. 안에 넣으면 공유 이미지에 경고가 찍힙니다.
 *
 * 문제가 없을 때는 아무것도 렌더하지 않습니다. 평소 레이아웃을 건드리지 않으려는 의도입니다.
 */
export default function OcrHealthBanner(props: Props) {
	const notice = props.notice;
	if (!notice) return null;
	const seconds = Math.floor(notice.stalledMs / 1000);
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100"
		>
			<svg
				className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
				<path d="M12 9v4" />
				<path d="M12 17h.01" />
			</svg>
			<div className="min-w-0">
				<span className="font-semibold">{notice.title}</span>
				{/* 얼마나 됐는지가 "잠깐 그런 것"과 "계속 그런 것"을 가르는 정보입니다. */}
				<span className="ml-2 font-mono text-xs opacity-80">{seconds}초째 기록 안 됨</span>
				<div className="opacity-80">{notice.detail}</div>
			</div>
		</div>
	);
}
