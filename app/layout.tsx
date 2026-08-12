import "./globals.css";
import { assetPath } from "@/lib/assetPath";
import { fontFaceCss, pretendardUrl } from "@/lib/fonts";

export const metadata = {
	title: "메이플랜드 경험치 측정기",
	description: "메이플랜드 게임 화면을 캡처해 레벨·경험치를 자동 인식하고, 누적 EXP·페이스를 실시간으로 보여주는 웹앱 · PiP(항상 위 미니 창) 지원."
};

export default function RootLayout(props: { children: React.ReactNode }) {
	return (
		<html lang="ko">
			<head>
				{/* 본문 글꼴은 첫 화면에 바로 필요하므로 미리 받아둡니다. (폰트는 CORS-anonymous로 요청되므로 crossOrigin 필요) */}
				<link rel="preload" href={pretendardUrl()} as="font" type="font/woff2" crossOrigin="anonymous" />
				<style dangerouslySetInnerHTML={{ __html: fontFaceCss() }} />
			</head>
			<body className="min-h-screen antialiased font-sans">
				{props.children}
			</body>
		</html>
	);
}

