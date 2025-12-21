"use client";

import { useEffect } from "react";
import Modal from "@/components/Modal";

type Props = {
	open: boolean;
	title?: string;
	message: string;
	onClose: () => void;
	confirmText?: string;
};

export default function AlertDialog(props: Props) {
	const { open, onClose } = props;
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.repeat) return;
			if (e.key === "Escape" || e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
	}, [open, onClose]);

	return (
		<Modal
			open={props.open}
			onClose={props.onClose}
			title={props.title ?? "알림"}
			variant="dialog"
			showCloseButton={false}
			disableEscClose
			footer={
				<div className="flex justify-end gap-2">
					<button className="btn btn-primary" onClick={props.onClose}>
						{props.confirmText ?? "확인"}
					</button>
				</div>
			}
		>
			<div className="text-sm text-white/80 whitespace-pre-wrap">{props.message}</div>
		</Modal>
	);
}


