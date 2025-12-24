"use client";

import { useEffect } from "react";
import Modal from "@/components/Modal";

type Props = {
	open: boolean;
	title?: string;
	message: string;
	onCancel: () => void;
	onConfirm: () => void;
	cancelText?: string;
	confirmText?: string;
	danger?: boolean;
};

export default function ConfirmDialog(props: Props) {
	const { open, onCancel, onConfirm } = props;
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.repeat) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onCancel();
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				onConfirm();
			}
		};
		// 캡처: Modal의 기본 ESC 핸들러보다 먼저 처리해서 중복 호출을 피합니다.
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
	}, [open, onCancel, onConfirm]);

	return (
		<Modal
			open={props.open}
			onClose={props.onCancel}
			title={props.title ?? "확인"}
			variant="dialog"
			showCloseButton={false}
			disableEscClose
			footer={
				<div className="flex justify-end gap-2">
					<button className="btn" onClick={props.onCancel}>
						{props.cancelText ?? "취소"}
					</button>
					<button className={props.danger ? "btn btn-danger" : "btn btn-primary"} onClick={props.onConfirm}>
						{props.confirmText ?? "확인"}
					</button>
				</div>
			}
		>
			<div className="text-sm text-white/80 whitespace-pre-wrap">{props.message}</div>
		</Modal>
	);
}


