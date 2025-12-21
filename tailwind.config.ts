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
				// Prefer D2Coding for mono; final fallback Pretendard when glyphs missing
				// NOTE: jsDelivr's d2coding.min.css defines the family as "D2 coding" (with a space).
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


