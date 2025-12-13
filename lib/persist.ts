import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initialValue: T) {
	// Start with the given initialValue for SSR/first client paint,
	// then hydrate from localStorage in an effect to avoid hydration mismatch.
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
		// run only once per key
		// eslint-disable-next-line react-hooks/exhaustive-deps
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


