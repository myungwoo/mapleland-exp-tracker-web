"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ExternalWsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type ExternalWsEvent =
	| { type: "toggle" }
	| { type: "start" }
	| { type: "pause" }
	| { type: "reset" }
	| { type: "raw"; data: unknown };

function parseEvent(raw: string): ExternalWsEvent {
	const trimmed = raw.trim();
	if (!trimmed) return { type: "raw", data: "" };
	if (trimmed === "toggle") return { type: "toggle" };
	if (trimmed === "start") return { type: "start" };
	if (trimmed === "pause") return { type: "pause" };
	if (trimmed === "reset") return { type: "reset" };
	try {
		const obj = JSON.parse(trimmed) as any;
		if (obj && typeof obj === "object") {
			const t = obj.type;
			if (t === "toggle" || t === "start" || t === "pause" || t === "reset") return { type: t };
			return { type: "raw", data: obj };
		}
		return { type: "raw", data: obj };
	} catch {
		return { type: "raw", data: trimmed };
	}
}

export function useExternalWsControl(args: {
	enabled: boolean;
	url: string;
	reconnectToken?: number;
	onEvent: (ev: ExternalWsEvent) => void;
}) {
	const { enabled, url, reconnectToken = 0, onEvent } = args;

	const wsRef = useRef<WebSocket | null>(null);
	const retryTimerRef = useRef<number | null>(null);
	const attemptRef = useRef<number>(0);
	const closingRef = useRef<boolean>(false);

	const [status, setStatus] = useState<ExternalWsStatus>("idle");
	const [connectedUrl, setConnectedUrl] = useState<string | null>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

	const clearRetry = useCallback(() => {
		if (retryTimerRef.current != null) {
			window.clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
	}, []);

	const closeWs = useCallback(() => {
		clearRetry();
		closingRef.current = true;
		const ws = wsRef.current;
		wsRef.current = null;
		setConnectedUrl(null);
		if (ws) {
			try {
				ws.close();
			} catch {
				// 무시
			}
		}
	}, [clearRetry]);

	const scheduleRetry = useCallback(() => {
		if (!enabled) return;
		clearRetry();
		// 서버가 없을 때도 성능 저하/스팸 연결 시도를 피하기 위해 점점 느리게 재시도합니다.
		// 0.5s, 1s, 2s, 5s, 10s, 30s, 60s, 120s, 300s...
		const attempt = Math.min(8, attemptRef.current); // 상한
		const delays = [500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000];
		const delay = delays[attempt] ?? 300000;
		retryTimerRef.current = window.setTimeout(() => {
			retryTimerRef.current = null;
			connect();
		}, delay);
	}, [clearRetry, enabled]);

	const connect = useCallback(() => {
		if (!enabled) return;
		closeWs();

		setStatus("connecting");
		setLastError(null);
		setConnectedUrl(url);
		closingRef.current = false;

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			setStatus("error");
			setLastError(String(e));
			attemptRef.current += 1;
			scheduleRetry();
			return;
		}

		wsRef.current = ws;

		ws.addEventListener("open", () => {
			attemptRef.current = 0;
			setStatus("open");
			setLastError(null);
		});

		ws.addEventListener("message", (ev) => {
			setLastMessageAt(Date.now());
			const data = typeof ev.data === "string" ? ev.data : "";
			onEvent(parseEvent(data));
		});

		ws.addEventListener("error", () => {
			// Mixed Content/정책 위반/네트워크 오류 등은 상세 사유가 JS에 안 내려오는 경우가 많습니다.
			setStatus("error");
			setLastError("WebSocket 오류 (개발자 도구 Console을 확인해 주세요)");
		});

		ws.addEventListener("close", (ev) => {
			wsRef.current = null;
			if (closingRef.current) {
				setStatus("idle");
				return;
			}
			setStatus("closed");
			setLastError(`close code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""}`);
			attemptRef.current += 1;
			scheduleRetry();
		});
	}, [closeWs, enabled, onEvent, scheduleRetry, url]);

	// enabled/url 변경 또는 수동 reconnectToken 변경 시 재연결
	useEffect(() => {
		if (!enabled) {
			setStatus("idle");
			setLastError(null);
			closeWs();
			return;
		}
		connect();
		return () => {
			closeWs();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabled, url, reconnectToken]);

	const readyState = useMemo(() => {
		const ws = wsRef.current;
		if (!ws) return "NONE";
		switch (ws.readyState) {
			case WebSocket.CONNECTING:
				return "CONNECTING";
			case WebSocket.OPEN:
				return "OPEN";
			case WebSocket.CLOSING:
				return "CLOSING";
			case WebSocket.CLOSED:
				return "CLOSED";
			default:
				return String(ws.readyState);
		}
	}, [status]);

	return { status, connectedUrl, lastError, lastMessageAt, readyState, reconnect: connect, disconnect: closeWs };
}


