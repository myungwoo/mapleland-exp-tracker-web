"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, formatNumber } from "@/lib/format";
import { copyPngBlobToClipboard, elementToPngBlob } from "@/lib/domToPng";
import type { NoticeHandler } from "@/lib/notice";

type Inputs = {
	hasStarted: boolean;
	elapsedMs: number;
	cumExpValue: number;
	cumExpPct: number;
	paceWindowMin: number;
	paceValue: number;
	pacePct: number;
	/** 경험치 쿠폰 보정(0개면 공유 텍스트에서 생략) */
	expCouponCount: number;
	couponAdjustedElapsedMs: number;
	couponPaceValue: number;
	couponPacePct: number;
	getSummaryEl: () => HTMLElement | null;
	/** 안내 메시지를 앱 UI로 띄우기 위한 콜백 (네이티브 alert 대체) */
	onNotice: NoticeHandler;
};

type Result = {
	isCopyingImage: boolean;
	textButtonLabel: string;
	imageButtonLabel: string;
	copyText: () => Promise<void>;
	copyImage: () => Promise<void>;
};

export function useShareResults(inputs: Inputs): Result {
	const [isCopyingImage, setIsCopyingImage] = useState(false);
	const [textButtonLabel, setTextButtonLabel] = useState("결과 텍스트 복사");
	const [imageButtonLabel, setImageButtonLabel] = useState("결과 이미지 복사");
	const textResetTimerRef = useRef<number | null>(null);
	const imageResetTimerRef = useRef<number | null>(null);
	const pendingImageBlobRef = useRef<Blob | null>(null);
	const pendingAlertedRef = useRef(false);

	useEffect(() => {
		return () => {
			if (textResetTimerRef.current) window.clearTimeout(textResetTimerRef.current);
			if (imageResetTimerRef.current) window.clearTimeout(imageResetTimerRef.current);
		};
	}, []);

	const bumpTextCopiedLabel = useCallback(() => {
		setTextButtonLabel("텍스트를 복사했습니다");
		if (textResetTimerRef.current) window.clearTimeout(textResetTimerRef.current);
		textResetTimerRef.current = window.setTimeout(() => {
			setTextButtonLabel("결과 텍스트 복사");
			textResetTimerRef.current = null;
		}, 1400);
	}, []);

	const bumpImageCopiedLabel = useCallback(() => {
		setImageButtonLabel("이미지를 복사했습니다");
		if (imageResetTimerRef.current) window.clearTimeout(imageResetTimerRef.current);
		imageResetTimerRef.current = window.setTimeout(() => {
			setImageButtonLabel("결과 이미지 복사");
			imageResetTimerRef.current = null;
		}, 1400);
	}, []);

	const bumpImageNeedFocusLabel = useCallback(() => {
		setImageButtonLabel("창을 활성화해 주세요");
		if (imageResetTimerRef.current) window.clearTimeout(imageResetTimerRef.current);
		imageResetTimerRef.current = window.setTimeout(() => {
			setImageButtonLabel("결과 이미지 복사");
			imageResetTimerRef.current = null;
		}, 1800);
	}, []);

	// 포커스 문제로 쓰기(write)가 실패하면, 창이 다시 포커스될 때 자동으로 재시도합니다.
	useEffect(() => {
		const onFocus = () => {
			const blob = pendingImageBlobRef.current;
			if (!blob) return;
			// 포커스가 있을 때만 재시도합니다.
			if (typeof document !== "undefined" && !document.hasFocus()) return;
			void (async () => {
				try {
					await copyPngBlobToClipboard(blob);
					pendingImageBlobRef.current = null;
					pendingAlertedRef.current = false;
					bumpImageCopiedLabel();
				} catch {
					// 계속 실패하면 pending으로 유지합니다. (사용자가 다시 클릭해서 재시도 가능)
				}
			})();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [bumpImageCopiedLabel]);

	const copyText = useCallback(async () => {
		if (!inputs.hasStarted) {
			inputs.onNotice("먼저 측정을 시작해 주세요.");
			return;
		}
		const elapsed = formatElapsed(inputs.elapsedMs);
		const gained = `${formatNumber(inputs.cumExpValue)} EXP [${inputs.cumExpPct.toFixed(2)}%]`;
		const paceText = `${formatNumber(inputs.paceValue)} EXP [${inputs.pacePct.toFixed(2)}%] / ${inputs.paceWindowMin}분`;
		// 경험치 쿠폰을 쓴 경우에만 "쿠폰 보정" 두 줄을 덧붙입니다.
		const couponText =
			inputs.expCouponCount > 0
				? `🎟️ 경험치 쿠폰: ${inputs.expCouponCount}개 (보정 사냥 시간 ${formatElapsed(inputs.couponAdjustedElapsedMs)})\n` +
					`🎯 실제 사냥터 효율: ${formatNumber(inputs.couponPaceValue)} EXP [${inputs.couponPacePct.toFixed(2)}%] / ${inputs.paceWindowMin}분\n`
				: "";
		const text =
			`🍁 메이플랜드 경험치 측정 결과 공유합니다!\n\n` +
			`⏱️ 경과 시간: ${elapsed}\n` +
			`✨ 획득 EXP: ${gained}\n` +
			`🏃 페이스: ${paceText}\n` +
			couponText +
			`\n📌 메이플랜드 경험치 측정기`;

		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				bumpTextCopiedLabel();
				return;
			}
		} catch {
			// 아래 대체 로직으로 진행
		}

		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.left = "-9999px";
			ta.style.top = "0";
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			const ok = document.execCommand("copy");
			document.body.removeChild(ta);
			if (!ok) throw new Error("copy failed");
			bumpTextCopiedLabel();
		} catch {
			inputs.onNotice("텍스트 복사에 실패했습니다. (브라우저 권한을 확인해 주세요)", "복사 실패");
		}
	}, [inputs, bumpTextCopiedLabel]);

	const copyImage = useCallback(async () => {
		if (!inputs.hasStarted) {
			inputs.onNotice("먼저 측정을 시작해 주세요.");
			return;
		}
		const el = inputs.getSummaryEl();
		if (!el) {
			inputs.onNotice("요약 영역을 찾지 못했습니다.", "복사 실패");
			return;
		}
		if (isCopyingImage) return;
		setIsCopyingImage(true);
		// 무거운 작업을 시작하기 전에 React가 "이미지 생성 중…"을 먼저 그리게 합니다.
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		let blob: Blob | null = null;
		try {
			blob = await elementToPngBlob(el);
			await copyPngBlobToClipboard(blob);
			bumpImageCopiedLabel();
		} catch (e) {
			const anyErr = e as any;
			if (anyErr?.code === "DOCUMENT_NOT_FOCUSED" || (e instanceof Error && e.message.includes("Document is not focused"))) {
				// 포커스 복귀 시 자동 재시도를 위해 저장합니다.
				if (blob) pendingImageBlobRef.current = blob;
				bumpImageNeedFocusLabel();
				if (!pendingAlertedRef.current) {
					pendingAlertedRef.current = true;
					inputs.onNotice("다른 창으로 이동하여 복사에 실패했습니다.\n이 탭으로 돌아오면 자동으로 다시 복사합니다.", "복사를 예약했습니다");
				}
			} else {
				const msg = e instanceof Error ? e.message : "이미지 복사에 실패했습니다.";
				inputs.onNotice(msg, "복사 실패");
			}
		} finally {
			setIsCopyingImage(false);
		}
	}, [inputs, isCopyingImage, bumpImageCopiedLabel, bumpImageNeedFocusLabel]);

	return { isCopyingImage, textButtonLabel, imageButtonLabel, copyText, copyImage };
}


