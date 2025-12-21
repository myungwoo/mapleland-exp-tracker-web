import { useEffect } from "react";
import { isEditableElement } from "@/lib/dom";

type GlobalHotkeyOptions = {
	enabled?: boolean;
	/**
	 * `e.key` 또는 `e.code` 기반으로 단축키를 매칭합니다.
	 * - 왜: 브라우저/키보드 레이아웃에 따라 key/code가 다를 수 있어서, 둘 중 하나만 강제하지 않습니다.
	 */
	match: (e: KeyboardEvent) => boolean;
	/**
	 * 단축키가 트리거됐을 때 실행할 함수입니다.
	 * - 주의: 내부에서 최신 상태를 참조하도록, 필요하면 `useCallback`으로 감싸 주세요.
	 */
	onTrigger: () => void;
	/**
	 * input/textarea/select/contentEditable에 포커스가 있으면 무시합니다.
	 */
	ignoreWhenEditable?: boolean;
	/**
	 * 매칭 시 `preventDefault()`를 호출합니다.
	 */
	preventDefault?: boolean;
};

export function useGlobalHotkey(options: GlobalHotkeyOptions) {
	const {
		enabled = true,
		match,
		onTrigger,
		ignoreWhenEditable = true,
		preventDefault = true
	} = options;

	useEffect(() => {
		if (!enabled) return;

		const onKeyDown = (e: KeyboardEvent) => {
			if (!match(e)) return;
			if (ignoreWhenEditable && isEditableElement(e.target)) return;

			if (preventDefault) e.preventDefault();
			onTrigger();
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, match, onTrigger, ignoreWhenEditable, preventDefault]);
}


