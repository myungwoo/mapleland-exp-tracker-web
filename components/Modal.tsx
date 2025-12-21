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
			<div className={cn("relative z-10 card p-0 overflow-hidden flex flex-col min-h-0", containerClass, props.className)}>
				<div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
					<h3 className="text-lg font-semibold">{props.title}</h3>
					{showCloseButton ? <button className="btn" onClick={onClose}>닫기</button> : <div />}
				</div>
				<div className={cn("flex-1 overflow-auto p-4 space-y-3 min-h-0", props.bodyClassName)}>
					{props.children}
				</div>
				{props.footer ? (
					<div className="px-4 py-3 border-t border-white/10">{props.footer}</div>
				) : null}
			</div>
		</div>
	);
}


