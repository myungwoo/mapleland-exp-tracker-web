/**
 * 앱 내부 알림(모달)을 띄우기 위한 콜백 타입입니다.
 *
 * 왜: 네이티브 `alert()`은 (1) 스타일이 앱과 완전히 달라 어색하고, (2) 브라우저 UI로 메인 스레드를
 * 블로킹해서 측정 타이머/샘플링에 영향을 주며, (3) 이미 `AlertDialog`/`ConfirmDialog`를 쓰는
 * 기록 모달과 UX가 갈립니다. 훅/클래스에서는 UI를 직접 렌더링할 수 없으니 콜백으로 위임합니다.
 */
export type NoticeHandler = (message: string, title?: string) => void;
