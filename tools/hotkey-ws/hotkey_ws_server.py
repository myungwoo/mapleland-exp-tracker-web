#!/usr/bin/env python3
"""
전역(글로벌) 핫키 → 로컬 WebSocket 브로드캐스트 GUI (Windows 전용 지원)

이 파일은 **GUI 모드만** 제공합니다.

기능:
- WebSocket 서버의 listen address / port 설정
- 서버 실행/정지(토글)
- 연결된 커넥션 수 표시
- 디버그 로그 텍스트 박스(디버그 체크 시에만 디버그 로그 표시)
- 토글/리셋 핫키를 “수정(캡처)” 버튼으로 직접 입력해 설정하고, “설정 적용”을 눌렀을 때만 반영

핫키 처리:
- 가능한 조합 제약을 최소화하기 위해 `keyboard` 라이브러리의
  `read_hotkey()`(캡처) + `add_hotkey()`(등록)를 사용합니다.
"""

import asyncio
import json
import queue
import threading
import time
from typing import Set, Callable

import websockets


def jmsg(t: str) -> str:
	return json.dumps({"type": t}, ensure_ascii=False)


class Hub:
	"""서버에 연결된 WebSocket 클라이언트를 관리하고 브로드캐스트를 수행합니다."""

	def __init__(self, loop: asyncio.AbstractEventLoop):
		self.loop = loop
		self.clients: Set[websockets.WebSocketServerProtocol] = set()
		self._lock = asyncio.Lock()

	async def add(self, ws):
		async with self._lock:
			self.clients.add(ws)

	async def remove(self, ws):
		async with self._lock:
			self.clients.discard(ws)

	async def broadcast(self, payload: str):
		# I/O await 중에 락을 오래 잡지 않기 위해 스냅샷을 만든 뒤 전송합니다.
		async with self._lock:
			targets = list(self.clients)
		if not targets:
			return
		await asyncio.gather(*[self._safe_send(ws, payload) for ws in targets])

	async def _safe_send(self, ws, payload: str):
		try:
			await ws.send(payload)
		except Exception:
			# 클라이언트가 이미 끊어진 경우 등은 조용히 무시합니다.
			pass


async def ws_handler(ws, hub: Hub):
	"""WebSocket 연결을 처리합니다."""
	await hub.add(ws)
	try:
		await ws.send(json.dumps({"type": "hello", "msg": "connected"}, ensure_ascii=False))
		async for msg in ws:
			# 헬스체크 용도: ping/pong만 처리하고, 나머지는 에코합니다.
			if msg == "ping":
				await ws.send("pong")
				continue
			await ws.send(f"echo:{msg}")
	finally:
		await hub.remove(ws)


class WsServerController:
	"""Tkinter 메인 스레드와 분리하기 위해 WebSocket 서버를 별도 스레드에서 실행합니다."""

	def __init__(self, log_cb: Callable[[str], None]):
		self._log_cb = log_cb
		self._thread: threading.Thread | None = None
		self._loop: asyncio.AbstractEventLoop | None = None
		self._server = None
		self._hub: Hub | None = None
		self._running = False
		self._client_count = 0
		self._client_count_lock = threading.Lock()

	def _log(self, msg: str):
		self._log_cb(msg)

	def is_running(self) -> bool:
		return self._running

	def get_client_count(self) -> int:
		with self._client_count_lock:
			return int(self._client_count)

	def start(self, host: str, port: int):
		if self._running:
			return
		self._running = True

		def run():
			loop = asyncio.new_event_loop()
			asyncio.set_event_loop(loop)
			self._loop = loop
			self._hub = Hub(loop)

			async def handler(ws):
				with self._client_count_lock:
					self._client_count += 1
				self._log(f"[서버] 연결됨 (현재 {self.get_client_count()}개)")
				try:
					await ws_handler(ws, self._hub)  # type: ignore[arg-type]
				finally:
					with self._client_count_lock:
						self._client_count = max(0, self._client_count - 1)
					self._log(f"[서버] 연결 종료 (현재 {self.get_client_count()}개)")

			async def start_server():
				self._log(f"[서버] 시작: ws://{host}:{port}")
				return await websockets.serve(handler, host, port)

			try:
				self._server = loop.run_until_complete(start_server())
				loop.run_forever()
			except Exception as e:
				self._log(f"[서버] 오류: {e}")
			finally:
				try:
					if self._server is not None:
						self._server.close()
						loop.run_until_complete(self._server.wait_closed())
				except Exception:
					pass
				try:
					loop.close()
				except Exception:
					pass
				self._running = False
				self._log("[서버] 정지됨")

		self._thread = threading.Thread(target=run, daemon=True)
		self._thread.start()

	def stop(self):
		if not self._running:
			return
		loop = self._loop
		if loop is None:
			self._running = False
			return

		async def shutdown():
			# 연결된 클라이언트를 먼저 닫고 서버를 종료합니다.
			try:
				if self._hub is not None:
					async with self._hub._lock:  # type: ignore[attr-defined]
						clients = list(self._hub.clients)
					for c in clients:
						try:
							await c.close()
						except Exception:
							pass
			except Exception:
				pass
			try:
				if self._server is not None:
					self._server.close()
					await self._server.wait_closed()
			except Exception:
				pass
			loop.stop()

		try:
			asyncio.run_coroutine_threadsafe(shutdown(), loop)
		except Exception:
			try:
				loop.call_soon_threadsafe(loop.stop)
			except Exception:
				pass

	def broadcast(self, payload: str):
		loop = self._loop
		hub = self._hub
		if not self._running or loop is None or hub is None:
			return
		try:
			asyncio.run_coroutine_threadsafe(hub.broadcast(payload), loop)
		except Exception:
			pass


class HotkeyManager:
	"""keyboard 라이브러리로 핫키를 등록/해제합니다."""

	def __init__(self, log_cb: Callable[[str], None], debug_log_cb: Callable[[str], None]):
		self._log_cb = log_cb
		self._debug_log_cb = debug_log_cb
		self._handles: list[int] = []
		self._debug_hooked = False

	def _log(self, msg: str):
		self._log_cb(msg)

	def _debug_log(self, msg: str):
		self._debug_log_cb(msg)

	def clear(self):
		try:
			import keyboard as kb  # type: ignore
		except Exception:
			return

		for h in self._handles:
			try:
				kb.remove_hotkey(h)
			except Exception:
				pass
		self._handles = []

		if self._debug_hooked:
			try:
				kb.unhook_all()
			except Exception:
				pass
			self._debug_hooked = False

	def apply(self, toggle_hotkey: str, reset_hotkey: str | None, debug_enabled: bool, on_toggle, on_reset):
		# 기존 등록 해제 후 재등록
		self.clear()
		try:
			import keyboard as kb  # type: ignore
		except Exception as e:
			self._log(f"[핫키] keyboard 라이브러리 로드 실패: {e}")
			return

		if debug_enabled and not self._debug_hooked:
			def _dbg(ev):
				self._debug_log(
					f"[키 디버그] name={getattr(ev, 'name', None)} "
					f"event_type={getattr(ev, 'event_type', None)} "
					f"scan_code={getattr(ev, 'scan_code', None)}"
				)
			kb.hook(_dbg)
			self._debug_hooked = True

		try:
			h1 = kb.add_hotkey(toggle_hotkey, on_toggle, suppress=False, trigger_on_release=False)
			self._handles.append(h1)
			self._log(f"[핫키] 토글 등록됨: {toggle_hotkey}")
		except Exception as e:
			self._log(f"[핫키] 토글 등록 실패 ({toggle_hotkey}): {e}")

		if reset_hotkey:
			try:
				h2 = kb.add_hotkey(reset_hotkey, on_reset, suppress=False, trigger_on_release=False)
				self._handles.append(h2)
				self._log(f"[핫키] 리셋 등록됨: {reset_hotkey}")
			except Exception as e:
				self._log(f"[핫키] 리셋 등록 실패 ({reset_hotkey}): {e}")


def run_gui():
	"""Tkinter GUI를 실행합니다."""
	import tkinter as tk
	from tkinter import ttk

	# (is_debug, message)
	log_q: "queue.Queue[tuple[bool, str]]" = queue.Queue()

	def _stamp(msg: str) -> str:
		return f"{time.strftime('%H:%M:%S')} {msg}"

	def push_log(msg: str):
		log_q.put((False, _stamp(msg)))

	def push_debug(msg: str):
		log_q.put((True, _stamp(msg)))

	server = WsServerController(log_cb=push_log)
	hotkeys = HotkeyManager(log_cb=push_log, debug_log_cb=push_debug)

	root = tk.Tk()
	root.title("Mapleland EXP Tracker - Hotkey WS Server")

	var_host = tk.StringVar(value="127.0.0.1")
	var_port = tk.StringVar(value="21537")
	var_toggle = tk.StringVar(value="f6")
	var_reset = tk.StringVar(value="f7")
	var_debug = tk.BooleanVar(value=False)
	var_running = tk.StringVar(value="정지")
	var_clients = tk.StringVar(value="0")
	var_capture_hint = tk.StringVar(value="")

	def set_status():
		var_running.set("실행 중" if server.is_running() else "정지")
		var_clients.set(str(server.get_client_count()))

	_capture_lock = threading.Lock()
	_capture_in_progress = False

	def start_hotkey_capture(target_var: tk.StringVar, label: str):
		nonlocal _capture_in_progress
		with _capture_lock:
			if _capture_in_progress:
				push_log("[핫키] 이미 다른 핫키 캡처가 진행 중입니다.")
				return
			_capture_in_progress = True

		var_capture_hint.set(f"{label} 핫키 입력 대기 중... (원하는 키 조합을 한 번 누르세요)")
		push_log(f"[핫키] {label} 캡처 시작")

		def worker():
			nonlocal _capture_in_progress
			try:
				import keyboard as kb  # type: ignore
				hk = kb.read_hotkey(suppress=False)
				root.after(0, lambda: target_var.set(hk))
				root.after(0, lambda: push_log(f"[핫키] {label} 캡처됨: {hk}"))
			except Exception as e:
				root.after(0, lambda: push_log(f"[핫키] {label} 캡처 실패: {e}"))
			finally:
				def done():
					nonlocal _capture_in_progress
					with _capture_lock:
						_capture_in_progress = False
					var_capture_hint.set("")
				root.after(0, done)

		threading.Thread(target=worker, daemon=True).start()

	def on_apply_hotkeys():
		toggle_hotkey = var_toggle.get().strip()
		reset_hotkey = var_reset.get().strip()
		if not toggle_hotkey:
			push_log("[핫키] 토글 핫키가 비어있습니다.")
			return
		if reset_hotkey == "":
			reset_hotkey = None

		def do_toggle():
			push_log("[핫키] 토글 트리거")
			server.broadcast(jmsg("toggle"))

		def do_reset():
			push_log("[핫키] 리셋 트리거")
			server.broadcast(jmsg("reset"))

		hotkeys.apply(toggle_hotkey, reset_hotkey, bool(var_debug.get()), do_toggle, do_reset)

	def on_start():
		host = var_host.get().strip() or "127.0.0.1"
		try:
			port = int(var_port.get().strip())
		except Exception:
			push_log("[서버] 포트 값이 올바르지 않습니다.")
			return
		server.start(host, port)
		on_apply_hotkeys()
		set_status()

	def on_stop():
		hotkeys.clear()
		server.stop()
		set_status()

	def on_toggle_server():
		if server.is_running():
			on_stop()
		else:
			on_start()

	def on_close():
		try:
			on_stop()
		finally:
			root.destroy()

	frame_top = ttk.Frame(root, padding=10)
	frame_top.pack(fill="x")

	ttk.Label(frame_top, text="Listen Address").grid(row=0, column=0, sticky="w")
	ttk.Entry(frame_top, textvariable=var_host, width=18).grid(row=0, column=1, padx=5)
	ttk.Label(frame_top, text="Port").grid(row=0, column=2, sticky="w")
	ttk.Entry(frame_top, textvariable=var_port, width=8).grid(row=0, column=3, padx=5)

	btn_server = ttk.Button(frame_top, text="서버 실행", command=on_toggle_server)
	btn_server.grid(row=0, column=4, padx=5)

	ttk.Label(frame_top, text="상태").grid(row=1, column=0, sticky="w", pady=(8, 0))
	ttk.Label(frame_top, textvariable=var_running).grid(row=1, column=1, sticky="w", pady=(8, 0))
	ttk.Label(frame_top, text="연결 수").grid(row=1, column=2, sticky="w", pady=(8, 0))
	ttk.Label(frame_top, textvariable=var_clients).grid(row=1, column=3, sticky="w", pady=(8, 0))

	frame_hotkey = ttk.LabelFrame(root, text="핫키 설정", padding=10)
	frame_hotkey.pack(fill="x", padx=10, pady=(0, 10))

	ttk.Label(frame_hotkey, text="토글").grid(row=0, column=0, sticky="w")
	ttk.Entry(frame_hotkey, textvariable=var_toggle, width=24).grid(row=0, column=1, padx=5)
	ttk.Button(frame_hotkey, text="수정", command=lambda: start_hotkey_capture(var_toggle, "토글")).grid(row=0, column=2, padx=5)
	ttk.Label(frame_hotkey, text="리셋").grid(row=0, column=3, sticky="w")
	ttk.Entry(frame_hotkey, textvariable=var_reset, width=24).grid(row=0, column=4, padx=5)
	ttk.Button(frame_hotkey, text="수정", command=lambda: start_hotkey_capture(var_reset, "리셋")).grid(row=0, column=5, padx=5)

	ttk.Button(frame_hotkey, text="설정 적용", command=on_apply_hotkeys).grid(row=0, column=6, padx=5)

	ttk.Checkbutton(frame_hotkey, text="디버그", variable=var_debug).grid(row=1, column=0, sticky="w", pady=(8, 0))
	ttk.Label(frame_hotkey, textvariable=var_capture_hint).grid(row=1, column=1, columnspan=6, sticky="w", pady=(8, 0))

	frame_log = ttk.LabelFrame(root, text="로그", padding=10)
	frame_log.pack(fill="both", expand=True, padx=10, pady=(0, 10))

	txt = tk.Text(frame_log, height=18, wrap="word")
	txt.pack(side="left", fill="both", expand=True)
	scroll = ttk.Scrollbar(frame_log, command=txt.yview)
	scroll.pack(side="right", fill="y")
	txt.configure(yscrollcommand=scroll.set)
	# 로그 텍스트 박스는 읽기 전용으로 유지합니다. (복사/스크롤은 가능)
	txt.configure(state="disabled")

	def pump_logs():
		set_status()
		btn_server.configure(text=("서버 정지" if server.is_running() else "서버 실행"))
		show_debug = bool(var_debug.get())
		try:
			while True:
				is_debug, line = log_q.get_nowait()
				if (not is_debug) or show_debug:
					# 읽기 전용 상태에서는 삽입이 안 되므로, 삽입하는 동안만 잠깐 해제합니다.
					txt.configure(state="normal")
					txt.insert("end", line + "\n")
					txt.see("end")
					txt.configure(state="disabled")
		except queue.Empty:
			pass
		root.after(200, pump_logs)

	root.protocol("WM_DELETE_WINDOW", on_close)
	pump_logs()
	root.mainloop()


if __name__ == "__main__":
	run_gui()


