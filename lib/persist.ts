import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T) {
	/**
	 * SSR/첫 렌더에서는 `initialValue`로 시작하고,
	 * 마운트 이후에 localStorage 값을 읽어 “수화(hydration) 불일치”를 피합니다.
	 *
	 * - 왜: localStorage는 브라우저에서만 접근 가능해서, SSR 단계에서 값을 맞추려 하면 경고가 납니다.
	 */
	const [value, setValue] = useState<T>(initialValue);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(key);
			if (raw != null) {
				setValue(JSON.parse(raw) as T);
			}
		} catch {
			// ignore
		}
	}, [key]);

	useEffect(() => {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// ignore
		}
	}, [key, value]);
	return [value, setValue] as const;
}


