import classNames from "classnames";

/**
 * Tailwind 클래스 조합을 간단히 하기 위한 유틸입니다.
 * - 왜: 여러 파일에서 `classnames`를 제각각 alias로 import해서 쓰고 있어서, 한 곳으로 모아 일관성을 유지합니다.
 */
export type ClassNameValue = Parameters<typeof classNames>[number];

export function cn(...values: ClassNameValue[]): string {
	return classNames(...values);
}


