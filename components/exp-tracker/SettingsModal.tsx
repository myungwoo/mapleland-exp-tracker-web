"use client";

import type { Ref } from "react";
import Modal from "@/components/Modal";
import RoiOverlay, { type RoiRect } from "@/components/RoiOverlay";
import ExpValidationRow from "@/components/exp-tracker/ExpValidationRow";
import { cn } from "@/lib/cn";
import type { ExpValidationResult } from "@/lib/expValidation";

type RoiKind = "level" | "exp";

type Props = {
	open: boolean;
	onClose: () => void;
	disableEscClose: boolean;

	/** 캡처 */
	hasStream: boolean;
	onStartCapture: () => void;
	onStopCapture: () => void;
	/** 프리뷰 비디오. RoiOverlay가 좌표 변환에 실제 엘리먼트를 읽어야 해서 ref 객체를 그대로 받습니다. */
	previewVideoRef: React.MutableRefObject<HTMLVideoElement | null>;

	/** ROI */
	roiContainerRef: Ref<HTMLDivElement>;
	roiLevel: RoiRect | null;
	roiExp: RoiRect | null;
	onChangeLevel: (r: RoiRect | null) => void;
	onChangeExp: (r: RoiRect | null) => void;
	activeRoi: RoiKind | null;
	onActiveRoiChange: (k: RoiKind | null) => void;
	onToggleRoiMode: (k: RoiKind) => void;
	onCancelSelection: () => void;
	/** ROI가 지금 어떻게 읽히고 있는지 (1초 주기 갱신, null이면 아직 판독 전) */
	levelReadText: string | null;
	expReadText: string | null;
	/** 지금 읽힌 값이 EXP 테이블과 맞는지 (측정 루프와 같은 판정) */
	expValidation: ExpValidationResult | null;

	/** 측정 설정 */
	intervalSec: number;
	onIntervalSecChange: (sec: number) => void;
	paceWindowMin: number;
	onPaceWindowMinChange: (min: number) => void;
	expPercentValidationEnabled: boolean;
	onExpPercentValidationEnabledChange: (v: boolean) => void;
	debugEnabled: boolean;
	onDebugEnabledChange: (v: boolean) => void;

	onReplayTutorial: () => void;
};

const EXP_PERCENT_VALIDATION_TOOLTIP =
	"켜짐: EXP, EXP%와 레벨을 EXP 테이블을 통해 대조하여 인식 결과를 검증해 이상치를 걸러냅니다.\n" +
	"꺼짐: 레벨/퍼센트 오인식 때문에 측정이 막히는 경우를 완화하지만, 누적/페이스가 더 부정확해질 수 있습니다.";

function SectionLabel(props: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("w-full shrink-0 text-xs font-semibold text-white/45 sm:w-[4.5rem]", props.className)}>
			{props.children}
		</div>
	);
}

/**
 * ROI 버튼 + "지금 어떻게 읽히고 있는지"를 함께 보여줍니다.
 *
 * 왜 판독 결과를 여기 붙이는가: 예전에는 ROI가 제대로 잡혔는지 확인하려면 디버그 미리보기를 켜야 했습니다.
 * ROI를 드래그하는 바로 그 자리에서 결과가 보여야 조정할 수 있습니다.
 */
function RoiControl(props: {
	label: string;
	active: boolean;
	hasRoi: boolean;
	readText: string | null;
	hasStream: boolean;
	onToggle: () => void;
}) {
	// mono는 판독값(숫자)일 때만 씁니다.
	// 왜: 모노(D2Coding) 서브셋에는 한글이 단위 5자만 들어 있어서, "미지정" 같은 한글을 모노로 두면
	// 시스템 대체 글꼴로 떨어져 글꼴이 섞여 보입니다. (`lib/fonts.ts` 참고)
	const status = (() => {
		if (!props.hasRoi)
			return { text: "미지정", mono: false, className: "text-amber-200 border-amber-300/30 bg-amber-300/10" };
		if (!props.hasStream || props.readText == null)
			return { text: "지정됨", mono: false, className: "text-white/60 border-white/15 bg-white/5" };
		if (props.readText === "")
			return { text: "인식 안 됨", mono: false, className: "text-amber-200 border-amber-300/30 bg-amber-300/10" };
		return { text: props.readText, mono: true, className: "text-emerald-200 border-emerald-300/30 bg-emerald-300/10" };
	})();

	return (
		<div className="inline-flex min-w-0 items-center gap-1.5">
			<button className={cn("btn", props.active && "btn-primary")} onClick={props.onToggle}>
				{props.label} 영역 지정
			</button>
			<span
				className={cn(
					"max-w-[14rem] truncate rounded border px-2 py-1 text-xs leading-none",
					status.mono ? "font-mono" : "font-medium",
					status.className
				)}
				title={status.text}
			>
				{status.text}
			</span>
		</div>
	);
}

/** 게임 창을 아직 고르지 않았을 때, 검은 사각형 대신 다음에 할 일을 보여줍니다. */
function CapturePlaceholder(props: { onStartCapture: () => void }) {
	return (
		<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
			<svg
				className="h-10 w-10 text-white/25"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<rect x="2" y="3" width="20" height="14" rx="2" />
				<path d="M8 21h8" />
				<path d="M12 17v4" />
			</svg>
			<div className="text-sm text-white/70">게임 창을 선택하면 여기에 미리보기가 표시됩니다</div>
			<div className="max-w-sm text-xs text-white/45">
				브라우저 정책상 페이지를 새로 열 때마다 측정할 게임 창을 다시 선택해야 합니다.
			</div>
			<button className="btn btn-primary pointer-events-auto" onClick={props.onStartCapture}>
				게임 창 선택
			</button>
		</div>
	);
}

export default function SettingsModal(props: Props) {
	return (
		<Modal
			open={props.open}
			onClose={props.onClose}
			title="설정"
			disableEscClose={props.disableEscClose}
			bodyFill
			footer={
				<div className="space-y-2">
					<div className="flex flex-wrap items-start gap-2">
						<SectionLabel className="sm:mt-2.5">인식 영역</SectionLabel>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<div className="flex flex-wrap items-center gap-2">
								<RoiControl
									label="레벨"
									active={props.activeRoi === "level"}
									hasRoi={!!props.roiLevel}
									readText={props.levelReadText}
									hasStream={props.hasStream}
									onToggle={() => props.onToggleRoiMode("level")}
								/>
								<RoiControl
									label="경험치"
									active={props.activeRoi === "exp"}
									hasRoi={!!props.roiExp}
									readText={props.expReadText}
									hasStream={props.hasStream}
									onToggle={() => props.onToggleRoiMode("exp")}
								/>
								<label className="ml-auto flex items-center gap-2 text-sm text-white/70">
									<input
										type="checkbox"
										checked={props.debugEnabled}
										onChange={(e) => props.onDebugEnabledChange(e.target.checked)}
									/>
									디버그 미리보기
								</label>
							</div>
							{/*
							 * 왜 ROI 판독 바로 아래인가: 레벨과 경험치가 각각 "읽히는" 것과 그 조합이 "말이 되는" 것은
							 * 다릅니다. 레벨을 한 자리 잘못 읽으면 두 값 모두 멀쩡해 보이는데 검증에서 걸려 측정이
							 * 통째로 버려집니다. ROI를 조정하는 자리에서 바로 보여야 원인을 찾을 수 있습니다.
							 */}
							<ExpValidationRow validation={props.expValidation} />
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<SectionLabel>측정 설정</SectionLabel>
						<label className="flex items-center gap-2 text-sm text-white/70">
							측정 주기
							<select
								className="rounded border border-white/10 bg-white/10 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
								value={props.intervalSec}
								onChange={(e) => props.onIntervalSecChange(parseInt(e.target.value, 10))}
							>
								<option value={1}>1초</option>
								<option value={5}>5초</option>
								<option value={10}>10초</option>
							</select>
						</label>
						<label className="flex items-center gap-2 text-sm text-white/70">
							페이스 기준 시간
							<select
								className="rounded border border-white/10 bg-white/10 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
								value={props.paceWindowMin}
								onChange={(e) => props.onPaceWindowMinChange(parseInt(e.target.value, 10))}
							>
								<option value={1}>1분</option>
								<option value={5}>5분</option>
								<option value={10}>10분</option>
								<option value={30}>30분</option>
								<option value={60}>60분</option>
							</select>
						</label>
						<label className="flex items-center gap-2 text-sm text-white/70" title={EXP_PERCENT_VALIDATION_TOOLTIP}>
							<input
								type="checkbox"
								checked={props.expPercentValidationEnabled}
								onChange={(e) => props.onExpPercentValidationEnabledChange(e.target.checked)}
							/>
							EXP% 검증
						</label>
						<button className="btn ml-auto" onClick={props.onReplayTutorial}>
							튜토리얼 다시 보기
						</button>
					</div>

					<p className="text-xs text-white/45">
						EXP% 검증을 켜면 EXP·EXP%·레벨을 EXP 테이블로 대조해 이상치를 걸러냅니다. 끄면 오인식 때문에 측정이 막히는
						경우는 줄지만, 누적·페이스가 더 부정확해질 수 있습니다.
					</p>
				</div>
			}
		>
			<div className="flex flex-wrap items-center gap-2">
				<SectionLabel>게임 화면</SectionLabel>
				<button className="btn btn-primary" onClick={props.onStartCapture}>
					{props.hasStream ? "게임 창 다시 선택" : "게임 창 선택"}
				</button>
				{props.hasStream ? (
					<button className="btn" onClick={props.onStopCapture}>
						공유 중지
					</button>
				) : null}
				<span className="ml-auto text-xs text-white/50">
					{props.hasStream ? "공유 중 · 아래에서 인식 영역을 지정하세요" : "아직 게임 창을 선택하지 않았습니다"}
				</span>
			</div>

			{/*
			 * 왜 flex-1인가: 예전에는 h-[70vh] 고정이라, 화면이 작으면 아래의 ROI 버튼이 스크롤 밑으로 숨었습니다.
			 * 남는 높이를 미리보기가 갖고, 컨트롤은 footer에 항상 붙어 있게 합니다.
			 */}
			<div
				ref={props.roiContainerRef}
				className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg bg-black/50"
			>
				<video ref={props.previewVideoRef} className="h-full w-full object-contain" muted playsInline />
				<RoiOverlay
					videoRef={props.previewVideoRef}
					levelRect={props.roiLevel}
					expRect={props.roiExp}
					onChangeLevel={props.onChangeLevel}
					onChangeExp={props.onChangeExp}
					active={props.activeRoi}
					onActiveChange={props.onActiveRoiChange}
					onCancelSelection={props.onCancelSelection}
				/>
				{props.hasStream ? null : <CapturePlaceholder onStartCapture={props.onStartCapture} />}
			</div>
		</Modal>
	);
}
