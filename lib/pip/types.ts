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
	/**
	 * 인식이 안 돼서 기록이 멈춘 이유. 정상이면 null이고, 그때는 해당 줄을 감춥니다.
	 * (PiP만 띄워두고 게임을 하는 경우가 많아, 메인 창과 같은 정보가 여기에도 있어야 합니다)
	 */
	healthText: string | null;
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
