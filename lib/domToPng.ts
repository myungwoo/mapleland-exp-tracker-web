/**
 * DOM element -> PNG blob using `html-to-image`.
 *
 * Why:
 * - Preserves webfonts and inline SVG (e.g. our pace chart) much better than a raw foreignObject fallback.
 *
 * Constraints:
 * - Still subject to browser limitations (CORS resources, clipboard API support).
 */
import { getFontEmbedCSS, toBlob as htmlToImageToBlob } from "html-to-image";

type Options = { scale?: number; background?: string };

function pickPixelRatio(scale?: number) {
	const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
	// Default: match device pixel ratio (up to 2) for crisp text.
	const v = scale ?? Math.min(2, dpr);
	return Math.max(1, Math.min(2, v));
}

let cachedFontEmbedCssPromise: Promise<string> | null = null;

async function getCachedFontEmbedCss(node: HTMLElement): Promise<string> {
	if (!cachedFontEmbedCssPromise) {
		// Compute once; html-to-image will embed fonts using this CSS without rescanning/fetching every time.
		cachedFontEmbedCssPromise = getFontEmbedCSS(node, {
			cacheBust: false,
			// Prefer woff2 only (big speed win vs embedding multiple formats).
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
	// Fire-and-forget: prime the font CSS cache to speed up the first real capture.
	void getCachedFontEmbedCss(node);
}

function getDefaultBackground(): string | undefined {
	try {
		const bg = window.getComputedStyle(document.body).backgroundColor;
		if (typeof bg === "string" && bg.trim().length > 0) return bg;
	} catch {
		// ignore
	}
	return undefined;
}

export async function elementToPngBlob(el: HTMLElement, opts?: Options): Promise<Blob> {
	if (typeof window === "undefined") throw new Error("브라우저에서만 사용할 수 있습니다.");
	if (!el) throw new Error("캡처 대상 요소가 없습니다.");

	// Capture a fixed-position clone to avoid scroll/viewport offset quirks that can introduce
	// top whitespace and bottom clipping in the resulting image.
	const rect = el.getBoundingClientRect();
	const w = Math.max(1, Math.ceil(rect.width));
	const h = Math.max(1, Math.ceil(rect.height));
	const guard = 4; // guard band to prevent 1px clipping due to rounding/AA

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
	// Isolate layout/paint as much as possible so the main page doesn't "blink".
	(stage.style as any).contain = "layout paint size style";

	const clone = el.cloneNode(true) as HTMLElement;
	clone.style.margin = "0";
	clone.style.width = `${w}px`;
	clone.style.height = `${h}px`;
	stage.appendChild(clone);

	document.body.appendChild(stage);
	try {
		// Ensure the clone is in the tree and styles are computed before capture.
		await new Promise<void>((r) => requestAnimationFrame(() => r()));

		const blob = await htmlToImageToBlob(clone, {
			cacheBust: false,
			backgroundColor,
			pixelRatio,
			width: w,
			height: h,
			// Ensure the raster target matches the chosen pixelRatio (improves text sharpness).
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
			// ignore
		}
	}
}

export async function copyPngBlobToClipboard(blob: Blob) {
	// Clipboard image requires secure context (https) and modern browsers (Chrome/Edge).
	const nav = navigator as any;
	if (!nav.clipboard?.write || typeof (window as any).ClipboardItem === "undefined") {
		throw new Error("이 브라우저에서는 이미지 클립보드 복사를 지원하지 않습니다. (Chrome/Edge 권장)");
	}
	// Chrome throws "Document is not focused" if the tab/window isn't active.
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


