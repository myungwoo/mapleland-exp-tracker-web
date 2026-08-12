import { useEffect, useRef } from "react";
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
	 * - 항상 "가장 최근 렌더의 함수"가 호출되므로, 최신 상태를 참조하기 위해 useCallback으로 감쌀 필요는 없습니다.
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

	/**
	 * match/onTrigger는 ref로 들고 갑니다.
	 *
	 * 왜: 호출부는 보통 인라인 함수를 넘기므로 매 렌더 새 함수가 됩니다. 이 값들을 effect deps에 넣으면
	 * 렌더마다 keydown 리스너를 해제/재등록하게 되는데, 측정 중에는 경과 시간 때문에 1초마다 리렌더되고
	 * ExpTracker는 이 훅을 3번 쓰기 때문에 초당 3쌍의 add/removeEventListener가 발생했습니다.
	 */
	const matchRef = useRef(match);
	const onTriggerRef = useRef(onTrigger);
	useEffect(() => {
		matchRef.current = match;
		onTriggerRef.current = onTrigger;
	}, [match, onTrigger]);

	useEffect(() => {
		if (!enabled) return;

		const onKeyDown = (e: KeyboardEvent) => {
			if (!matchRef.current(e)) return;
			if (ignoreWhenEditable && isEditableElement(e.target)) return;

			if (preventDefault) e.preventDefault();
			onTriggerRef.current();
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, ignoreWhenEditable, preventDefault]);
}
