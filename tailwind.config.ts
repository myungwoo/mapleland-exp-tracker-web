import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
	// 왜 app/components 밖까지 넣는가:
	// Tailwind는 여기 적힌 파일에서 발견한 클래스만 CSS로 생성합니다.
	// features/·hooks/ 안에서 클래스 문자열을 쓰는 순간(컴포넌트를 옮기거나 헬퍼로 뽑는 순간)
	// 스타일이 조용히 사라지므로, JSX가 들어갈 수 있는 소스 디렉터리를 미리 포함시킵니다.
	//
	// lib/는 일부러 제외합니다: lib/pip/template.ts가 PiP 창용 원시 CSS 문자열을 담고 있어서
	// `display: grid` 같은 값이 Tailwind 후보로 잡혀 쓰지 않는 유틸리티가 생성됩니다.
	// (실측 결과 약 0.3KB 증가) lib/에 UI 컴포넌트를 두게 되면 그때 함께 추가하세요.
	content: [
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./features/**/*.{js,ts,jsx,tsx,mdx}",
		"./hooks/**/*.{js,ts,jsx,tsx,mdx}"
	],
	theme: {
		extend: {
			fontFamily: {
				sans: ["Pretendard", ...defaultTheme.fontFamily.sans],
				// 모노 폰트는 D2Coding을 우선 사용하고, 글리프가 없을 때는 Pretendard로 대체합니다.
				// 참고: jsDelivr의 d2coding.min.css는 폰트 패밀리명을 "D2 coding"(공백 포함)으로 정의합니다.
				mono: ["D2 coding", ...defaultTheme.fontFamily.mono]
			},
			colors: {
				bg: "#0b1020",
				card: "#141a2f",
				accent: "#5eead4"
			}
		}
	},
	plugins: []
} satisfies Config;


