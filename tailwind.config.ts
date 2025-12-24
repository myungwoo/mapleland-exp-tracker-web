import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
	content: [
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}"
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


