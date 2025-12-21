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
	disableEscClose?: boolean;
};

export default function Modal(props: Props) {
	const { open, onClose, disableEscClose } = props;

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
			<div className={cn("relative z-10 w-[98vw] h-[95vh] max-w-none max-h-none card p-0 overflow-hidden flex flex-col", props.className)}>
				<div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
					<h3 className="text-lg font-semibold">{props.title}</h3>
					<button className="btn" onClick={onClose}>닫기</button>
				</div>
				<div className="flex-1 overflow-auto p-4 space-y-3">
					{props.children}
				</div>
				{props.footer ? (
					<div className="px-4 py-3 border-t border-white/10">{props.footer}</div>
				) : null}
			</div>
		</div>
	);
}


