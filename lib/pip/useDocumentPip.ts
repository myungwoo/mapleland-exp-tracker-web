import { useCallback, useEffect, useMemo, useRef } from "react";
import { PipController } from "./PipController";
import type { PipCallbacks, PipState } from "./types";

export function isDocumentPipSupported(): boolean {
	if (typeof window === "undefined") return false;
	const dpi = (window as any).documentPictureInPicture;
	return !!(dpi && typeof dpi.requestWindow === "function");
}

export function useDocumentPip(callbacks: PipCallbacks) {
	const controllerRef = useRef<PipController | null>(null);
	const cbRef = useRef<PipCallbacks>(callbacks);
	useEffect(() => {
		cbRef.current = callbacks;
	}, [callbacks]);

	// 필요할 때만 컨트롤러를 생성합니다.
	const ensure = useCallback(() => {
		if (!controllerRef.current) {
			controllerRef.current = new PipController({
				onToggle: () => cbRef.current.onToggle(),
				onReset: () => cbRef.current.onReset(),
				onNotice: (message, title) => cbRef.current.onNotice?.(message, title)
			});
		} else {
			controllerRef.current.setCallbacks({
				onToggle: () => cbRef.current.onToggle(),
				onReset: () => cbRef.current.onReset(),
				onNotice: (message, title) => cbRef.current.onNotice?.(message, title)
			});
		}
		return controllerRef.current;
	}, []);

	const open = useCallback(async () => {
		const c = ensure();
		await c.open();
	}, [ensure]);

	const update = useCallback(
		(state: PipState) => {
			const c = ensure();
			c.update(state);
		},
		[ensure]
	);

	const close = useCallback(() => {
		controllerRef.current?.close();
		controllerRef.current = null;
	}, []);

	useEffect(() => {
		return () => {
			controllerRef.current?.close();
			controllerRef.current = null;
		};
	}, []);

	const isOpen = useCallback(() => !!controllerRef.current?.isOpen(), []);

	// 반환 객체는 값이 바뀔 때만 새로 만듭니다. (근거는 CLAUDE.md "훅 반환 객체" 항목)
	// 여기는 전부 함수라 **한 번 만들면 끝까지 같은 객체**입니다. (`isOpen`을 인라인 화살표로 두면
	// 렌더마다 새 객체가 되므로 useCallback으로 올렸습니다)
	return useMemo(() => ({ open, update, close, isOpen }), [open, update, close, isOpen]);
}
