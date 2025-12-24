/**
 * `html-to-image`를 사용해 DOM element -> PNG blob으로 변환합니다.
 *
 * 이유:
 * - raw foreignObject 기반 fallback보다 웹폰트/인라인 SVG(예: 페이스 차트)를 훨씬 잘 보존합니다.
 *
 * 제약:
 * - 브라우저 제한(CORS 리소스, 클립보드 API 지원 등)의 영향을 받습니다.
 */
import { getFontEmbedCSS, toBlob as htmlToImageToBlob } from "html-to-image";

type Options = { scale?: number; background?: string };

function pickPixelRatio(scale?: number) {
	const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
	// 기본값: 텍스트 선명도를 위해 devicePixelRatio를 따르되, 최대 2로 제한합니다.
	const v = scale ?? Math.min(2, dpr);
	return Math.max(1, Math.min(2, v));
}

let cachedFontEmbedCssPromise: Promise<string> | null = null;

async function getCachedFontEmbedCss(node: HTMLElement): Promise<string> {
	if (!cachedFontEmbedCssPromise) {
		// 1회만 계산합니다. html-to-image가 매번 재스캔/재요청하지 않고 이 CSS로 폰트를 임베드합니다.
		cachedFontEmbedCssPromise = getFontEmbedCSS(node, {
			cacheBust: false,
			// woff2만 선호(여러 포맷을 임베드하는 것 대비 큰 속도 이점)
			...((
				{
					preferredFontFormat: "woff2"
				} as any
			))
		}).catch(() => "");
	}
	return await cachedFontEmbedCssPromise;
}

export function primeDomToPngFonts(node: HTMLElement | null) {
	if (!node) return;
	// 결과를 기다리지 않고 실행: 폰트 CSS 캐시를 미리 채워 첫 캡처를 빠르게 합니다.
	void getCachedFontEmbedCss(node);
}

function getDefaultBackground(): string | undefined {
	try {
		const bg = window.getComputedStyle(document.body).backgroundColor;
		if (typeof bg === "string" && bg.trim().length > 0) return bg;
	} catch {
		// 무시
	}
	return undefined;
}

export async function elementToPngBlob(el: HTMLElement, opts?: Options): Promise<Blob> {
	if (typeof window === "undefined") throw new Error("브라우저에서만 사용할 수 있습니다.");
	if (!el) throw new Error("캡처 대상 요소가 없습니다.");

	// 스크롤/viewport 오프셋 특이 케이스(상단 여백/하단 잘림)를 피하기 위해
	// 고정 위치(fixed-position) 클론을 만들어 캡처합니다.
	const rect = el.getBoundingClientRect();
	const w = Math.max(1, Math.ceil(rect.width));
	const h = Math.max(1, Math.ceil(rect.height));
	const guard = 4; // 반올림/AA로 인한 1px 클리핑을 막기 위한 가드 밴드

	const pixelRatio = pickPixelRatio(opts?.scale);
	const backgroundColor = opts?.background ?? getDefaultBackground();
	const fontEmbedCSS = await getCachedFontEmbedCss(el);

	const stage = document.createElement("div");
	stage.setAttribute("data-dom-to-png-stage", "true");
	stage.style.position = "fixed";
	stage.style.left = "0";
	stage.style.top = "0";
	stage.style.width = `${w + guard}px`;
	stage.style.height = `${h + guard}px`;
	stage.style.overflow = "hidden";
	stage.style.pointerEvents = "none";
	stage.style.opacity = "0";
	stage.style.zIndex = "-1";
	stage.style.margin = "0";
	stage.style.padding = "0";
	// 메인 페이지가 "깜빡"이지 않도록 layout/paint를 최대한 격리합니다.
	(stage.style as any).contain = "layout paint size style";

	const clone = el.cloneNode(true) as HTMLElement;
	clone.style.margin = "0";
	clone.style.width = `${w}px`;
	clone.style.height = `${h}px`;
	stage.appendChild(clone);

	document.body.appendChild(stage);
	try {
		// 캡처 전에 클론이 DOM에 붙고 스타일 계산이 끝나도록 보장합니다.
		await new Promise<void>((r) => requestAnimationFrame(() => r()));

		const blob = await htmlToImageToBlob(clone, {
			cacheBust: false,
			backgroundColor,
			pixelRatio,
			width: w,
			height: h,
			// 래스터 타깃이 선택된 pixelRatio와 일치하도록 보장합니다. (텍스트 선명도 개선)
			canvasWidth: Math.ceil((w + guard) * pixelRatio),
			canvasHeight: Math.ceil((h + guard) * pixelRatio),
			...((
				{
					preferredFontFormat: "woff2"
				} as any
			)),
			fontEmbedCSS
		});
		if (!blob) throw new Error("PNG 생성에 실패했습니다.");
		return blob;
	} finally {
		try {
			document.body.removeChild(stage);
		} catch {
			// 무시
		}
	}
}

export async function copyPngBlobToClipboard(blob: Blob) {
	// 이미지 클립보드 복사는 보안 컨텍스트(https)와 최신 브라우저(Chrome/Edge)가 필요합니다.
	const nav = navigator as any;
	if (!nav.clipboard?.write || typeof (window as any).ClipboardItem === "undefined") {
		throw new Error("이 브라우저에서는 이미지 클립보드 복사를 지원하지 않습니다. (Chrome/Edge 권장)");
	}
	// Chrome은 탭/창이 비활성 상태면 "Document is not focused" 에러를 던집니다.
	if (typeof document !== "undefined" && !document.hasFocus()) {
		const err = new Error("Document is not focused");
		(err as any).code = "DOCUMENT_NOT_FOCUSED";
		throw err;
	}
	const item = new (window as any).ClipboardItem({ "image/png": blob });
	await nav.clipboard.write([item]);
}

export async function copyElementAsPngToClipboard(el: HTMLElement, opts?: { scale?: number; background?: string }) {
	const blob = await elementToPngBlob(el, opts);
	await copyPngBlobToClipboard(blob);
	return blob;
}


