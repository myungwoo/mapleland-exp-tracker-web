import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T) {
	const [value, setValue] = useState<T>(() => {
		if (typeof window === "undefined") return initialValue;
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return initialValue;
			return JSON.parse(raw) as T;
		} catch {
			return initialValue;
		}
	});
	useEffect(() => {
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// ignore
		}
	}, [key, value]);
	return [value, setValue] as const;
}


