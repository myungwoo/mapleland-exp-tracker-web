"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type LogKind = "info" | "send" | "recv" | "error";
type LogEntry = { ts: number; kind: LogKind; msg: string };

function fmtTime(ts: number) {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function readyStateLabel(ws: WebSocket | null) {
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
}

export default function LocalWsTestPanel(props: { defaultUrl?: string }) {
	const defaultUrl = props.defaultUrl ?? "ws://127.0.0.1:21537";
	const wsRef = useRef<WebSocket | null>(null);
	const [url, setUrl] = useState(defaultUrl);
	const [connectedUrl, setConnectedUrl] = useState<string | null>(null);
	const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
	const [lastClose, setLastClose] = useState<{ code?: number; reason?: string } | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [sendText, setSendText] = useState<string>('{"type":"toggle"}');

	const pushLog = useCallback((kind: LogKind, msg: string) => {
		setLogs((prev) => {
			const next = [...prev, { ts: Date.now(), kind, msg }];
			return next.length > 200 ? next.slice(next.length - 200) : next;
		});
	}, []);

	const disconnect = useCallback(() => {
		const ws = wsRef.current;
		wsRef.current = null;
		setConnectedUrl(null);
		setLastClose(null);
		if (ws) {
			try {
				ws.close();
			} catch {
				// ignore
			}
		}
		setStatus("idle");
		pushLog("info", "disconnect()");
	}, [pushLog]);

	const connect = useCallback(() => {
		disconnect();
		setStatus("connecting");
		setLastClose(null);
		pushLog("info", `connect() -> ${url}`);

		let ws: WebSocket;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			setStatus("error");
			pushLog("error", `WebSocket ctor failed: ${String(e)}`);
			return;
		}
		wsRef.current = ws;
		setConnectedUrl(url);

		ws.addEventListener("open", () => {
			setStatus("open");
			pushLog("info", "onopen");
		});
		ws.addEventListener("message", (ev) => {
			const data = typeof ev.data === "string" ? ev.data : "[non-string message]";
			pushLog("recv", data);
		});
		ws.addEventListener("error", () => {
			// 브라우저 보안 정책 위반(Mixed Content 등)도 여기로 오지만, 상세 사유는 JS에서 못 받는 경우가 많습니다.
			setStatus("error");
			pushLog("error", "onerror (details may be in DevTools console)");
		});
		ws.addEventListener("close", (ev) => {
			setStatus("closed");
			setLastClose({ code: ev.code, reason: ev.reason });
			pushLog("info", `onclose code=${ev.code} reason=${ev.reason || "-"}`);
		});
	}, [disconnect, pushLog, url]);

	const send = useCallback(
		(payload: string) => {
			const ws = wsRef.current;
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				pushLog("error", "send failed: WebSocket is not OPEN");
				return;
			}
			try {
				ws.send(payload);
				pushLog("send", payload);
			} catch (e) {
				pushLog("error", `send threw: ${String(e)}`);
			}
		},
		[pushLog]
	);

	const ready = useMemo(() => readyStateLabel(wsRef.current), [status]);
	const statusBadge = useMemo(() => {
		const base = "inline-flex items-center rounded px-2 py-0.5 text-xs border";
		if (status === "open") return cn(base, "bg-emerald-500/15 border-emerald-400/20 text-emerald-200");
		if (status === "connecting") return cn(base, "bg-sky-500/15 border-sky-400/20 text-sky-200");
		if (status === "error") return cn(base, "bg-red-500/15 border-red-400/20 text-red-200");
		if (status === "closed") return cn(base, "bg-white/10 border-white/10 text-white/70");
		return cn(base, "bg-white/5 border-white/10 text-white/60");
	}, [status]);

	// 안전장치: 언마운트 시 소켓 정리
	useEffect(() => {
		return () => {
			try {
				wsRef.current?.close();
			} catch {
				// ignore
			}
			wsRef.current = null;
		};
	}, []);

	return (
		<div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
			<div className="flex items-center gap-3">
				<div className="font-medium">Local WebSocket 테스트</div>
				<span className={statusBadge}>
					{status.toUpperCase()} · {ready}
				</span>
				<div className="ml-auto text-xs text-white/60">
					GitHub Pages(HTTPS)에서 <span className="font-mono">ws://</span> 연결은 브라우저 정책으로 막힐 수 있어요.
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
				<input
					className="w-full bg-white/10 text-white rounded px-3 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 font-mono"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="ws://127.0.0.1:21537"
					spellCheck={false}
				/>
				<button className="btn btn-primary" onClick={connect}>
					Connect
				</button>
				<button className="btn" onClick={() => send("ping")}>
					Send ping
				</button>
				<button className="btn btn-warning" onClick={disconnect}>
					Disconnect
				</button>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
				<input
					className="w-full bg-white/10 text-white rounded px-3 py-2 text-sm border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 font-mono"
					value={sendText}
					onChange={(e) => setSendText(e.target.value)}
					spellCheck={false}
				/>
				<button className="btn" onClick={() => send(sendText)}>
					Send
				</button>
			</div>

			<div className="text-xs text-white/65 space-y-1">
				<div>
					- <span className="font-semibold">연결 대상</span>: {connectedUrl ? <span className="font-mono">{connectedUrl}</span> : "-"}
				</div>
				<div>
					- <span className="font-semibold">마지막 close</span>:{" "}
					{lastClose ? (
						<span className="font-mono">
							code={lastClose.code ?? "-"} reason={lastClose.reason || "-"}
						</span>
					) : (
						"-"
					)}
				</div>
				<div>
					- <span className="font-semibold">팁</span>: 실패하면 DevTools Console에 <span className="font-mono">Mixed Content</span> 같은 메시지가 찍히는지 확인해 주세요.
				</div>
			</div>

			<div className="rounded border border-white/10 bg-black/30 p-3 font-mono text-xs max-h-56 overflow-auto">
				{logs.length === 0 ? (
					<div className="text-white/50">No logs yet.</div>
				) : (
					logs.map((l, idx) => (
						<div key={idx} className="flex gap-2">
							<span className="text-white/40">{fmtTime(l.ts)}</span>
							<span
								className={cn(
									"w-12 shrink-0",
									l.kind === "error" && "text-red-300",
									l.kind === "recv" && "text-emerald-200",
									l.kind === "send" && "text-sky-200",
									l.kind === "info" && "text-white/70"
								)}
							>
								{l.kind.toUpperCase()}
							</span>
							<span className="text-white/80 break-all">{l.msg}</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}


