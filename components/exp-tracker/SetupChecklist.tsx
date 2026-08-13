"use client";

import { cn } from "@/lib/cn";

type Props = {
	hasStream: boolean;
	hasLevelRoi: boolean;
	hasExpRoi: boolean;
	/** 게임 창 선택(설정 모달을 열고 창 선택 프롬프트를 띄웁니다) */
	onSelectWindow: () => void;
	/** 설정 모달을 열고 레벨 ROI 선택 모드로 들어갑니다. */
	onSetupLevelRoi: () => void;
	/** 설정 모달을 열고 경험치 ROI 선택 모드로 들어갑니다. */
	onSetupExpRoi: () => void;
};

function CheckIcon() {
	return (
		<svg
			className="h-3.5 w-3.5 shrink-0 text-emerald-300"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="m20 6-11 11-5-5" />
		</svg>
	);
}

function TodoIcon() {
	return (
		<svg
			className="h-3.5 w-3.5 shrink-0 text-sky-300"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
		</svg>
	);
}

function Item(props: { done: boolean; label: string; onClick: () => void }) {
	if (props.done) {
		return (
			<span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/60">
				<CheckIcon />
				<span className="line-through decoration-white/30">{props.label}</span>
			</span>
		);
	}
	return (
		<button
			type="button"
			className="inline-flex items-center gap-1.5 rounded border border-sky-300/30 bg-sky-300/10 px-2 py-1 text-xs text-sky-100 transition hover:bg-sky-300/20"
			onClick={props.onClick}
		>
			<TodoIcon />
			{props.label}
		</button>
	);
}

/**
 * 측정을 시작하려면 무엇이 더 필요한지 보여주고, 각 항목에서 바로 그 설정으로 보냅니다.
 *
 * 왜 필요한가: 준비가 안 되면 "측정 시작"이 그냥 회색 버튼으로만 남아서, 온보딩을 건너뛴 사용자는
 * 무엇이 빠졌는지 알 방법이 없었습니다. (ROI 미지정은 눌러봐야 알림으로 알 수 있었습니다)
 *
 * 왜 요약 카드 밖에 두는가: 요약 카드는 "결과 이미지 복사"로 통째로 캡처되는 영역입니다.
 * (RecognitionHealthBanner와 같은 이유)
 */
export default function SetupChecklist(props: Props) {
	const allDone = props.hasStream && props.hasLevelRoi && props.hasExpRoi;
	if (allDone) return null;

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-2 gap-y-1",
				"rounded-lg border border-sky-300/25 bg-sky-300/5 px-3 py-2 text-sm text-sky-100"
			)}
		>
			<span className="mr-1 font-semibold">측정을 시작하려면</span>
			<Item done={props.hasStream} label="게임 창 선택" onClick={props.onSelectWindow} />
			<Item done={props.hasLevelRoi} label="레벨 영역 지정" onClick={props.onSetupLevelRoi} />
			<Item done={props.hasExpRoi} label="경험치 영역 지정" onClick={props.onSetupExpRoi} />
		</div>
	);
}
