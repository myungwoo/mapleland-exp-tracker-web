import type { Config } from "tailwindcss";

export default {
	content: [
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}"
	],
	theme: {
		extend: {
			colors: {
				bg: "#0b1020",
				card: "#141a2f",
				accent: "#5eead4"
			}
		}
	},
	plugins: []
} satisfies Config;


