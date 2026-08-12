import { useEffect, useRef, useState } from "react";

/**
 * 저장된 값이 기대한 타입인지 확인하는 타입 가드입니다.
 *
 * 왜: localStorage 값은 사용자가 직접 고칠 수도 있고, 예전 버전이 남긴 형식일 수도 있습니다.
 * 검증 없이 `T`로 신뢰하면 깨진 ROI 같은 값이 측정 로직까지 흘러가 조용히 오작동합니다.
 */
export type PersistedValidator<T> = (parsed: unknown) => parsed is T;

/** 허용 목록 기반 검증기. 예: `oneOf([1, 5, 10] as const)` */
export function oneOf<T extends string | number | boolean>(allowed: readonly T[]): PersistedValidator<T> {
	return (parsed: unknown): parsed is T => allowed.includes(parsed as T);
}

/** boolean 검증기 */
export function isBooleanValue(parsed: unknown): parsed is boolean {
	return typeof parsed === "boolean";
}

export function usePersistentState<T>(key: string, initialValue: T, validate?: PersistedValidator<T>) {
	/**
	 * SSR/첫 클라이언트 렌더에서는 `initialValue`로 시작하고,
	 * 마운트 이후에 localStorage 값을 읽어 “수화(hydration) 불일치”를 피합니다.
	 *
	 * - 왜: localStorage는 브라우저에서만 접근 가능해서, SSR 단계에서 값을 맞추려 하면 경고가 납니다.
	 */
	const [value, setValue] = useState<T>(initialValue);
	/**
	 * 어떤 key로 읽기를 끝냈는지 기억합니다. 이 값이 현재 key와 같을 때만 저장합니다.
	 *
	 * 왜: 읽기/쓰기 effect는 같은 커밋에서 순서대로 실행되므로, 가드가 없으면
	 * **저장된 값을 읽어 반영하기 전에 기본값을 먼저 localStorage에 써버립니다.**
	 * 보통은 다음 렌더에서 복구되지만, 그 사이에 탭이 닫히면 설정이 유실됩니다.
	 */
	const [hydratedKey, setHydratedKey] = useState<string | null>(null);

	// 검증기를 deps에 넣으면 인라인 함수를 넘기는 호출부에서 매 렌더 다시 읽게 되므로 ref로 들고 갑니다.
	const validateRef = useRef(validate);
	useEffect(() => {
		validateRef.current = validate;
	}, [validate]);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(key);
			if (raw != null) {
				const parsed = JSON.parse(raw) as unknown;
				const check = validateRef.current;
				// 검증에 실패한 값은 버리고 기본값을 유지합니다. (아래에서 정상값으로 덮어써집니다)
				if (!check || check(parsed)) {
					setValue(parsed as T);
				}
			}
		} catch {
			// 무시
		}
		setHydratedKey(key);
	}, [key]);

	useEffect(() => {
		if (hydratedKey !== key) return;
		try {
			window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// 무시
		}
	}, [key, value, hydratedKey]);
	return [value, setValue] as const;
}
