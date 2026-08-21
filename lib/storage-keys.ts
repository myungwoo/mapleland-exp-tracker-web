/**
 * localStorage 키에 앱 접두어를 붙입니다.
 *
 * 왜: mapleland.myungwoo.kr 은 유틸 여러 개가 한 오리진을 공유합니다
 * (myungwoo.github.io 의 프로젝트 페이지들도 마찬가지입니다). `roiLevel`,
 * `onboardingDone` 처럼 흔한 이름을 접두어 없이 쓰면 다른 유틸의 값과 부딪힙니다.
 *
 * 테마(`ml:theme`)처럼 여러 유틸이 **일부러** 공유하는 값은 예외입니다.
 * 이 앱에는 아직 없습니다.
 */
export const APP_STORAGE_PREFIX = "ml:exp:";

/** 접두어 없는 이름(`"roiLevel"`)을 실제 저장 키(`"ml:exp:roiLevel"`)로 바꿉니다. */
export function storageKey(name: string): string {
	return `${APP_STORAGE_PREFIX}${name}`;
}

/**
 * 접두어 붙은 키를 먼저 보고, 없으면 접두어 없던 예전 키를 봅니다. 쓰지는 않습니다.
 *
 * 저장은 하지 않으므로, 마이그레이션까지 필요하면 `migrateLegacyKey`를 쓰세요.
 */
export function readPersistedRaw(name: string): string | null {
	try {
		return window.localStorage.getItem(storageKey(name)) ?? window.localStorage.getItem(name);
	} catch {
		return null;
	}
}

/**
 * 접두어 붙은 키의 값을 읽습니다. 비어 있고 예전 키에 값이 있으면 한 번 옮겨 옵니다.
 *
 * 예전 키는 지우지 않습니다 — 배포를 되돌릴 일이 생겨도 설정이 남아 있어야 합니다.
 * 그래서 여러 번 불러도 결과가 같고, 이미 새 키에 값이 있으면 예전 값이 덮어쓰지 못합니다.
 */
export function migrateLegacyKey(name: string): string | null {
	try {
		const key = storageKey(name);
		const raw = window.localStorage.getItem(key);
		if (raw !== null) return raw;

		const legacyRaw = window.localStorage.getItem(name);
		if (legacyRaw !== null) window.localStorage.setItem(key, legacyRaw);
		return legacyRaw;
	} catch {
		return null;
	}
}
