"use client";

import { ReactNode, useEffect } from "react";
import clsx from "classnames";

type Props = {
	open: boolean;
	onClose: () => void;
	title?: string;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
};

export default function Modal(props: Props) {
	useEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") props.onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [props.open, props.onClose]);

	if (!props.open) return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
			<div className={clsx("relative z-10 w-[95vw] max-w-5xl max-h-[90vh] overflow-auto card p-4", props.className)}>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-lg font-semibold">{props.title}</h3>
					<button className="btn" onClick={props.onClose}>닫기</button>
				</div>
				<div className="space-y-3">
					{props.children}
				</div>
				{props.footer ? (
					<div className="mt-4">{props.footer}</div>
				) : null}
			</div>
		</div>
	);
}


