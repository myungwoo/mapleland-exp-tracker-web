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
	 * 인식이 안 돼서 기록이 멈춘 이유. 정상이면 null입니다.
	 *
	 * PiP는 사용자들이 최대한 작게 만들어 쓰므로 줄을 추가하지 않고, 이 값이 있으면
	 * **경험치·페이스 텍스트를 회색으로 죽이고** 원인은 호버 툴팁으로만 노출합니다.
	 * (창 크기와 무관하게 보입니다. 근거는 `lib/pip/template.ts`의 `.stalled` 주석)
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
