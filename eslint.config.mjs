import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint flat config
 *
 * 왜 `next lint`에서 옮겼나:
 * - `next lint`는 Next.js 16에서 제거됩니다.
 * - 그리고 기본 검사 대상이 app/components/lib 등 정해진 디렉터리뿐이라,
 *   `features/`와 `hooks/`가 **한 번도 검사되지 않고 있었습니다.**
 *   (그 안에 실제로 react-hooks/exhaustive-deps 경고가 남아 있었습니다)
 * flat config는 `eslint .`로 저장소 전체를 검사하므로 이런 사각지대가 생기지 않습니다.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
	{
		// 빌드 산출물/의존성/자동 생성 파일은 검사하지 않습니다.
		ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts", ".claude/**"]
	},
	// 기존 .eslintrc.cjs와 동일한 규칙 세트를 유지합니다.
	// 왜: 이 프로젝트는 빠르게 반복 개발되며 리팩터링 중이라,
	// 과도한 규칙 추가보다는 Next 기본 권장 규칙부터 적용합니다.
	...compat.extends("next/core-web-vitals")
];

export default config;
