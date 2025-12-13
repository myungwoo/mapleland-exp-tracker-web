import "./globals.css";

export const metadata = {
	title: "EXP Tracker",
	description: "Measure EXP gain over time from a selected game window"
};

export default function RootLayout(props: { children: React.ReactNode }) {
	return (
		<html lang="ko">
			<body className="min-h-screen antialiased">
				{props.children}
			</body>
		</html>
	);
}

