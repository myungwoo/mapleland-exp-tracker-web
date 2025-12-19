import "./globals.css";

export const metadata = {
	title: "메이플랜드 경험치 측정기",
	description: "메이플랜드 게임 화면을 캡처해 레벨·경험치를 자동 인식하고, 누적 EXP·페이스·예상치를 실시간으로 보여주는 웹앱 · PiP(항상‑위 미니 창) 지원."
};

export default function RootLayout(props: { children: React.ReactNode }) {
	return (
		<html lang="ko">
			<body className="min-h-screen antialiased font-sans">
				{props.children}
			</body>
		</html>
	);
}

