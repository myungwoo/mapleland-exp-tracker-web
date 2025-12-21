import { useCallback, useEffect, useState } from "react";

type Options = {
	captureVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	previewVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	/**
	 * 설정 모달이 열려있을 때, preview video가 끊기지 않도록 보강합니다.
	 */
	settingsOpen: boolean;
};

/**
 * 화면/창 캡처 스트림을 선택하고, 필요한 비디오 엘리먼트에 연결하는 훅입니다.
 *
 * - 왜: ExpTracker에 스트림/비디오 attach 관련 useEffect가 흩어져 있어, 읽기 어려워지고 수정 시 사이드이펙트가 커집니다.
 */
export function useDisplayCapture(options: Options) {
	const { captureVideoRef, previewVideoRef, settingsOpen } = options;
	const [stream, setStream] = useState<MediaStream | null>(null);

	const attachToVideos = useCallback(async (s: MediaStream | null) => {
		const captureVideo = captureVideoRef.current;
		const previewVideo = previewVideoRef.current;
		if (captureVideo) captureVideo.srcObject = s;
		if (previewVideo) previewVideo.srcObject = s;
		if (!s) return;

		// play()는 사용자 제스처 정책으로 실패할 수 있으니 조용히 무시합니다.
		try { await captureVideo?.play(); } catch {}
		try { await previewVideo?.play(); } catch {}
	}, [captureVideoRef, previewVideoRef]);

	const startCapture = useCallback(async () => {
		try {
			const s = await navigator.mediaDevices.getDisplayMedia({
				video: { displaySurface: "window", frameRate: 30 },
				audio: false
			});
			setStream(s);
			await attachToVideos(s);
		} catch (err) {
			console.error(err);
			alert("화면/창 캡처 권한이 필요합니다.");
		}
	}, [attachToVideos]);

	const stopCapture = useCallback(() => {
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
		}
		setStream(null);
		void attachToVideos(null);
	}, [stream, attachToVideos]);

	// 스트림 변경 시 비디오에 재연결 (특히 settings 모달에서 ROI를 잡을 때 중요)
	useEffect(() => {
		void attachToVideos(stream);
	}, [stream, attachToVideos]);

	// settings 모달이 열릴 때 preview video에 스트림이 붙어있도록 보강
	useEffect(() => {
		if (!settingsOpen) return;
		if (!stream) return;
		void attachToVideos(stream);
	}, [settingsOpen, stream, attachToVideos]);

	// 언마운트 시 스트림 정리
	useEffect(() => {
		return () => {
			if (stream) {
				stream.getTracks().forEach((t) => t.stop());
			}
		};
	}, [stream]);

	return { stream, startCapture, stopCapture, setStream };
}


