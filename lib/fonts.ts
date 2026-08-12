import { assetPath } from "@/lib/assetPath";

/**
 * 자체 호스팅 폰트 파일 경로
 *
 * 왜 CDN(@import)에서 옮겼나:
 * - `globals.css`의 `@import url(https://cdn.jsdelivr.net/...)`는 CSS 안의 import라 렌더 블로킹 체인을 만듭니다.
 *   (앱 CSS를 받고 → 그 안의 @import를 발견하고 → 다시 외부 도메인에 접속)
 * - 기존 `pretendard.css`는 굵기별 **전체 한글 폰트(각 1.1MB)** 를 선언해서, 실제로 쓰는 굵기마다 1MB 넘게 받았습니다.
 * - `html-to-image`로 "결과 이미지 복사"를 할 때 폰트를 인라인하려면 폰트 파일을 다시 fetch해야 하는데,
 *   외부 도메인이면 느리고 오프라인/차단 환경에서는 글꼴이 빠진 이미지가 나옵니다.
 *
 * 지금은 변수형 서브셋 1개(476KB, 45~930 굵기 전부)와 라틴 전용 D2Coding(14KB)만 받습니다.
 * 서브셋을 다시 만드는 방법은 `tools/fonts/README.md` 참고.
 */
const PRETENDARD_PATH = "/fonts/PretendardVariable.subset.woff2";
const D2CODING_PATH = "/fonts/D2Coding.subset.woff2";

/**
 * D2Coding 서브셋에 실제로 들어 있는 범위입니다.
 *
 * 모노 글꼴은 숫자/경과 시간/OCR 텍스트에만 쓰므로 한글을 담지 않았습니다.
 * `unicode-range`로 범위를 명시해야, 모노 영역에 한글이 섞여도 브라우저가 이 파일을 받지 않고
 * 곧바로 Pretendard로 폴백합니다. (서브셋 범위를 바꾸면 이 값도 함께 고쳐야 합니다)
 */
const D2CODING_UNICODE_RANGE =
	"U+0020-007E, U+00A0-00FF, U+2018-201D, U+2026, U+2030, U+2032-2033, U+20A9, U+20BF, U+2190-2193, U+2212, U+25A0-25CF";

export function pretendardUrl(options: { absolute?: boolean } = {}): string {
	return resolveFontUrl(PRETENDARD_PATH, options.absolute);
}

function resolveFontUrl(path: string, absolute?: boolean): string {
	const withBase = assetPath(path);
	if (!absolute) return withBase;
	// 문서 PiP 창은 URL이 about:blank라서 상대/루트 상대 경로가 해석되지 않습니다.
	// 그래서 PiP에 넣을 CSS는 절대 URL로 만들어야 합니다.
	if (typeof window === "undefined") return withBase;
	try {
		return new URL(withBase, window.location.href).href;
	} catch {
		return withBase;
	}
}

/**
 * 본문과 PiP 창이 공유하는 `@font-face` 선언을 만듭니다.
 *
 * CSS 파일에 직접 적지 않는 이유: GitHub Pages 서브패스 배포에서는 basePath가 붙어야 하는데,
 * CSS의 `url(/fonts/...)`는 basePath를 반영하지 못해 404가 납니다. `assetPath()`를 쓰려면 JS에서 만들어야 합니다.
 */
export function fontFaceCss(options: { absolute?: boolean } = {}): string {
	const pretendard = resolveFontUrl(PRETENDARD_PATH, options.absolute);
	const d2coding = resolveFontUrl(D2CODING_PATH, options.absolute);
	return `@font-face {
	font-family: "Pretendard";
	font-style: normal;
	/* 변수형 폰트 하나로 모든 굵기를 커버합니다. (파일 1개 = 요청 1번) */
	font-weight: 45 930;
	font-display: swap;
	src: url("${pretendard}") format("woff2");
}
@font-face {
	font-family: "D2 coding";
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url("${d2coding}") format("woff2");
	unicode-range: ${D2CODING_UNICODE_RANGE};
}`;
}
