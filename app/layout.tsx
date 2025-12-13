import "./globals.css";

export const metadata = {
	title: "메이플랜드 경험치 측정기",
	description: "게임 화면에서 레벨과 경험치를 인식하여 경험치를 측정하는 웹앱입니다."
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

