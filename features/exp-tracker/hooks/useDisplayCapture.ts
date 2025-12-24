import { useCallback, useEffect, useState } from "react";

type Options = {
	captureVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	previewVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	/**
	 * 설정 모달이 열려있을 때, preview video가 끊기지 않도록 보강합니다.
	 */
	settingsOpen: boolean;
	/**
	 * 측정/온보딩 등으로 OCR 캡처용 비디오 재생이 필요한지 여부입니다.
	 * - false일 때는 pause()해서, 화면 공유만 켜둔 상태의 부하를 줄입니다.
	 */
	capturePlaybackWanted: boolean;
	/**
	 * getDisplayMedia 요청 FPS 상한(저사양 환경에서 게임 끊김 완화).
	 * - 너무 높은 FPS는 화면 캡처 자체가 게임에 영향을 줄 수 있습니다.
	 */
	captureFps: number;
};

/**
 * 화면/창 캡처 스트림을 선택하고, 필요한 비디오 엘리먼트에 연결하는 훅입니다.
 *
 * - 왜: ExpTracker에 스트림/비디오 attach 관련 useEffect가 흩어져 있어, 읽기 어려워지고 수정 시 사이드이펙트가 커집니다.
 */
export function useDisplayCapture(options: Options) {
	const { captureVideoRef, previewVideoRef, settingsOpen, capturePlaybackWanted, captureFps } = options;
	const [stream, setStream] = useState<MediaStream | null>(null);

	const safePause = useCallback((video: HTMLVideoElement | null) => {
		if (!video) return;
		try { video.pause(); } catch {}
	}, []);

	const ensurePlaying = useCallback(async (video: HTMLVideoElement | null) => {
		if (!video) return;
		// play()는 사용자 제스처 정책으로 실패할 수 있으니 조용히 무시합니다.
		try { await video.play(); } catch {}
	}, []);

	const attachStream = useCallback((video: HTMLVideoElement | null, s: MediaStream | null) => {
		if (!video) return;
		try {
			// 불필요한 재할당을 피합니다. (일부 브라우저는 srcObject 재설정 시 디코딩 파이프라인이 재시작될 수 있음)
			if (video.srcObject !== s) video.srcObject = s;
		} catch {
			// ignore
		}
	}, []);

	/**
	 * OCR/측정 시작 직전에 호출해서, capture video가 실제로 프레임을 제공할 수 있게 보장합니다.
	 */
	const ensureCapturePlaying = useCallback(async () => {
		const video = captureVideoRef.current;
		if (!video) return;
		attachStream(video, stream);
		await ensurePlaying(video);
	}, [attachStream, captureVideoRef, ensurePlaying, stream]);

	/**
	 * Best-effort로 현재 스트림의 video track frameRate를 조정합니다.
	 * - 목적: settingsOpen 토글에 따라 "프리뷰는 부드럽게 / 평소는 저부하"를 구현
	 * - 주의: 브라우저/OS에 따라 applyConstraints가 무시되거나 실패할 수 있어, 실패는 조용히 무시합니다.
	 */
	const applyTrackFps = useCallback(async (s: MediaStream | null, fps: number) => {
		try {
			if (!s) return;
			const track = s.getVideoTracks?.()[0];
			if (!track) return;
			const apply = (track as any).applyConstraints as undefined | ((c: MediaTrackConstraints) => Promise<void>);
			if (!apply) return;
			await apply.call(track, { frameRate: { ideal: fps, max: fps } });
		} catch {
			// ignore
		}
	}, []);

	const startCapture = useCallback(async () => {
		try {
			// NOTE: 일부 브라우저는 displaySurface/frameRate 제약을 엄격하게 처리할 수 있으니,
			// 실패 시에는 제약을 줄인 fallback으로 재시도합니다.
			const constraintsWithFps = {
				video: {
					displaySurface: "window",
					frameRate: { ideal: captureFps, max: captureFps }
				},
				audio: false
			} as any;
			let s: MediaStream;
			try {
				s = await navigator.mediaDevices.getDisplayMedia(constraintsWithFps);
			} catch {
				s = await navigator.mediaDevices.getDisplayMedia({
					video: {
						displaySurface: "window"
					},
					audio: false
				});
			}
			setStream(s);
			// 브라우저가 스트림은 허용했지만 초기 frameRate 힌트를 무시했을 수 있으므로,
			// 가능한 경우 applyConstraints로 다시 적용을 시도합니다. (best-effort: 실패해도 무시)
			void applyTrackFps(s, captureFps);
			// 스트림만 붙여두고, 실제 재생(play)은 필요할 때만 수행합니다.
			attachStream(captureVideoRef.current, s);
			attachStream(previewVideoRef.current, settingsOpen ? s : null);
			if (settingsOpen) void ensurePlaying(previewVideoRef.current);
		} catch (err) {
			console.error(err);
			alert("화면/창 캡처 권한이 필요합니다.");
		}
	}, [attachStream, captureFps, captureVideoRef, ensurePlaying, previewVideoRef, settingsOpen, applyTrackFps]);

	const stopCapture = useCallback(() => {
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
		}
		setStream(null);
		safePause(captureVideoRef.current);
		safePause(previewVideoRef.current);
		attachStream(captureVideoRef.current, null);
		attachStream(previewVideoRef.current, null);
	}, [stream, safePause, attachStream, captureVideoRef, previewVideoRef]);

	// 스트림 변경 시 비디오에 재연결 (특히 settings 모달에서 ROI를 잡을 때 중요)
	useEffect(() => {
		attachStream(captureVideoRef.current, stream);
		attachStream(previewVideoRef.current, settingsOpen ? stream : null);
		if (settingsOpen && stream) void ensurePlaying(previewVideoRef.current);
	}, [stream, attachStream, captureVideoRef, previewVideoRef, settingsOpen, ensurePlaying]);

	// settingsOpen 또는 captureFps 변경 시, 현재 video track frameRate를 best-effort로 조정합니다.
	useEffect(() => {
		void applyTrackFps(stream, captureFps);
	}, [stream, captureFps, applyTrackFps]);

	// settings 모달이 열릴 때 preview video에 스트림이 붙어있도록 보강
	useEffect(() => {
		if (settingsOpen && stream) {
			attachStream(previewVideoRef.current, stream);
			void ensurePlaying(previewVideoRef.current);
			return;
		}
		// settings가 닫히면 preview video는 중단(부하 최소화)
		safePause(previewVideoRef.current);
		attachStream(previewVideoRef.current, null);
	}, [settingsOpen, stream, attachStream, ensurePlaying, safePause, previewVideoRef]);

	// OCR 캡처용 hidden video는 "필요할 때만" 재생합니다. (측정 시작 전 부하 완화)
	useEffect(() => {
		const v = captureVideoRef.current;
		if (!v) return;
		if (!stream) {
			safePause(v);
			return;
		}
		if (capturePlaybackWanted) {
			attachStream(v, stream);
			void ensurePlaying(v);
		} else {
			safePause(v);
		}
	}, [capturePlaybackWanted, stream, attachStream, captureVideoRef, ensurePlaying, safePause]);

	// 언마운트 시 스트림 정리
	useEffect(() => {
		return () => {
			if (stream) {
				stream.getTracks().forEach((t) => t.stop());
			}
		};
	}, [stream]);

	return { stream, startCapture, stopCapture, setStream, ensureCapturePlaying };
}


