"use client";

import { ReactNode, useEffect } from "react";
import { cn } from "@/lib/cn";

type Props = {
	open: boolean;
	onClose: () => void;
	title?: string;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
	bodyClassName?: string;
	/**
	 * 본문을 스크롤 없이 "모달 높이에 꽉 채우는" 세로 flex 컨테이너로 만듭니다.
	 * - 왜: 설정 모달처럼 가운데 미리보기가 남는 높이를 전부 먹고 컨트롤은 footer에 고정돼야 하는 경우,
	 *   기본값(overflow-auto)이면 정작 중요한 버튼이 스크롤 아래로 숨습니다.
	 */
	bodyFill?: boolean;
	disableEscClose?: boolean;
	variant?: "full" | "panel" | "dialog";
	showCloseButton?: boolean;
};

export default function Modal(props: Props) {
	const { open, onClose, disableEscClose } = props;
	const variant = props.variant ?? "full";
	const showCloseButton = props.showCloseButton ?? true;

	const containerClass =
		variant === "dialog"
			? "w-[92vw] max-w-md h-auto max-h-[80vh]"
			: variant === "panel"
				? "w-[92vw] max-w-2xl h-auto max-h-[85vh]"
				: "w-[98vw] h-[95vh] max-w-none max-h-none";

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (disableEscClose) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				onClose();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose, disableEscClose]);

	if (!open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/60" onClick={onClose} />
			<div
				className={cn("relative z-10 card p-0 overflow-hidden flex flex-col min-h-0", containerClass, props.className)}
			>
				{/* 왜 shrink-0인가: 창이 낮으면 헤더/푸터가 눌려서 잘립니다. 줄어드는 건 본문이어야 합니다. */}
				<div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/10">
					<h3 className="text-lg font-semibold">{props.title}</h3>
					{showCloseButton ? (
						<button className="btn" onClick={onClose}>
							닫기
						</button>
					) : (
						<div />
					)}
				</div>
				<div
					className={cn(
						"flex-1 p-4 min-h-0",
						props.bodyFill ? "overflow-hidden flex flex-col gap-3" : "overflow-auto space-y-3",
						props.bodyClassName
					)}
				>
					{props.children}
				</div>
				{props.footer ? <div className="shrink-0 px-4 py-3 border-t border-white/10">{props.footer}</div> : null}
			</div>
		</div>
	);
}
