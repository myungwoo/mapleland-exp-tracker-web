import type { NoticeHandler } from "@/lib/notice";

export type PipCallbacks = {
	onToggle: () => void;
	onReset: () => void;
	/** 지원하지 않는 브라우저 안내 등을 앱 UI로 띄우기 위한 콜백 (네이티브 alert 대체) */
	onNotice?: NoticeHandler;
};

export type PipState = {
	isSampling: boolean;
	elapsedMs: number;
	nextAt: Date | null;
	nextHours: number | null;
	gainedText: string;
	paceText: string;
};

declare global {
	interface Window {
		// Experimental Document Picture-in-Picture API (Chrome/Edge)
		documentPictureInPicture?: {
			window?: Window | null;
			requestWindow?: (options?: { width?: number; height?: number }) => Promise<Window>;
		};
	}
}

export {};
