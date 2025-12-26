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
from pathlib import Path
from typing import Set, Callable

import websockets


def jmsg(t: str) -> str:
	return json.dumps({"type": t}, ensure_ascii=False)


SETTINGS_PATH = Path(__file__).with_name("settings.local.json")


def _default_settings() -> dict:
	return {
		"listen_host": "127.0.0.1",
		"listen_port": 21537,
		"toggle_hotkey": "f6",
		"reset_hotkey": "f7",  # null 허용
		"debug_enabled": False,
	}


def load_settings() -> dict:
	"""
	로컬 설정 파일을 읽어 기본값과 병합합니다.
	- 파일이 없거나 JSON이 깨졌으면 기본값을 사용합니다.
	"""
	base = _default_settings()
	try:
		if not SETTINGS_PATH.exists():
			return base
		raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
		if not isinstance(raw, dict):
			return base
	except Exception:
		return base

	merged = dict(base)
	for k in base.keys():
		if k in raw:
			merged[k] = raw[k]

	# 간단한 타입/값 보정
	try:
		merged["listen_host"] = str(merged.get("listen_host") or base["listen_host"])
	except Exception:
		merged["listen_host"] = base["listen_host"]

	try:
		merged["listen_port"] = int(merged.get("listen_port") or base["listen_port"])
	except Exception:
		merged["listen_port"] = base["listen_port"]

	try:
		th = merged.get("toggle_hotkey")
		merged["toggle_hotkey"] = str(th) if th else base["toggle_hotkey"]
	except Exception:
		merged["toggle_hotkey"] = base["toggle_hotkey"]

	try:
		rh = merged.get("reset_hotkey")
		merged["reset_hotkey"] = (str(rh) if rh else None)
	except Exception:
		merged["reset_hotkey"] = base["reset_hotkey"]

	try:
		merged["debug_enabled"] = bool(merged.get("debug_enabled"))
	except Exception:
		merged["debug_enabled"] = base["debug_enabled"]

	return merged


def save_settings(settings: dict) -> None:
	"""설정을 로컬 JSON 파일로 저장합니다(원자적 교체)."""
	try:
		data = dict(_default_settings())
		for k in data.keys():
			if k in settings:
				data[k] = settings[k]

		tmp = SETTINGS_PATH.with_suffix(SETTINGS_PATH.suffix + ".tmp")
		tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
		tmp.replace(SETTINGS_PATH)
	except Exception:
		# 설정 저장 실패는 프로그램 동작을 막지 않도록 조용히 무시합니다.
		pass


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
		# 등록 타입에 따라 해제 API가 달라서 (add_hotkey vs on_press_key) 구분해서 저장합니다.
		self._handles: list[tuple[str, object]] = []
		self._debug_hooked = False
		self._debug_hook_handle = None

	def _log(self, msg: str):
		self._log_cb(msg)

	def _debug_log(self, msg: str):
		self._debug_log_cb(msg)

	def _set_debug_hook(self, enabled: bool):
		"""
		디버그 키 훅을 켜거나 끕니다.
		- enabled=True: 모든 키 이벤트를 받아 디버그 로그로 기록합니다. (부하가 생길 수 있음)
		- enabled=False: 디버그 훅을 제거해 부하를 최소화합니다.
		"""
		try:
			import keyboard as kb  # type: ignore
		except Exception:
			return

		if enabled:
			if self._debug_hook_handle is not None:
				return

			def _dbg(ev):
				self._debug_log(
					f"[키 디버그] name={getattr(ev, 'name', None)} "
					f"event_type={getattr(ev, 'event_type', None)} "
					f"scan_code={getattr(ev, 'scan_code', None)}"
				)

			try:
				self._debug_hook_handle = kb.hook(_dbg)
				self._debug_hooked = True
			except Exception:
				self._debug_hook_handle = None
				self._debug_hooked = False
		else:
			if self._debug_hook_handle is None:
				self._debug_hooked = False
				return
			try:
				kb.unhook(self._debug_hook_handle)
			except Exception:
				pass
			self._debug_hook_handle = None
			self._debug_hooked = False

	def set_debug_enabled(self, enabled: bool):
		"""GUI 체크박스 변경에 맞춰 디버그 훅을 즉시 반영합니다."""
		self._set_debug_hook(enabled)

	def clear(self):
		try:
			import keyboard as kb  # type: ignore
		except Exception:
			return

		for kind, h in self._handles:
			try:
				if kind == "hotkey":
					kb.remove_hotkey(h)  # type: ignore[arg-type]
				elif kind == "hook":
					kb.unhook(h)  # type: ignore[arg-type]
			except Exception:
				pass
		self._handles = []

		# 디버그 훅은 전체 unhook_all()로 내리면 다른 훅까지 같이 내려갈 수 있어,
		# 우리가 만든 훅 핸들만 정확히 제거합니다.
		self._set_debug_hook(False)

	@staticmethod
	def _is_single_key_hotkey(hk: str) -> bool:
		"""
		단일 키 핫키인지 판별합니다.
		- 예: "caps lock", "f6", "space"
		- 조합/복수는 제외: "ctrl+f6", "alt+shift+x", "a, b"
		"""
		s = (hk or "").strip()
		if not s:
			return False
		return ("+" not in s) and ("," not in s)

	def apply(self, toggle_hotkey: str, reset_hotkey: str | None, debug_enabled: bool, on_toggle, on_reset):
		# 기존 등록 해제 후 재등록
		self.clear()
		try:
			import keyboard as kb  # type: ignore
		except Exception as e:
			self._log(f"[핫키] keyboard 라이브러리 로드 실패: {e}")
			return

		# 디버그 훅은 체크 상태에 맞춰 켜거나 끕니다.
		self._set_debug_hook(debug_enabled)

		try:
			# 단일 키 핫키는 다른 키를 누르고 있어도 트리거되도록 on_press_key를 사용합니다.
			if self._is_single_key_hotkey(toggle_hotkey):
				h1 = kb.on_press_key(toggle_hotkey, lambda _e: on_toggle(), suppress=False)
				self._handles.append(("hook", h1))
			else:
				h1 = kb.add_hotkey(toggle_hotkey, on_toggle, suppress=False, trigger_on_release=False)
				self._handles.append(("hotkey", h1))
			self._log(f"[핫키] 토글 등록됨: {toggle_hotkey}")
		except Exception as e:
			self._log(f"[핫키] 토글 등록 실패 ({toggle_hotkey}): {e}")

		if reset_hotkey:
			try:
				if self._is_single_key_hotkey(reset_hotkey):
					h2 = kb.on_press_key(reset_hotkey, lambda _e: on_reset(), suppress=False)
					self._handles.append(("hook", h2))
				else:
					h2 = kb.add_hotkey(reset_hotkey, on_reset, suppress=False, trigger_on_release=False)
					self._handles.append(("hotkey", h2))
				self._log(f"[핫키] 리셋 등록됨: {reset_hotkey}")
			except Exception as e:
				self._log(f"[핫키] 리셋 등록 실패 ({reset_hotkey}): {e}")


def run_gui():
	"""Tkinter GUI를 실행합니다."""
	import tkinter as tk
	from tkinter import ttk
	from PIL import Image, ImageDraw, ImageFont  # type: ignore

	MAX_LOG_LINES = 300

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

	loaded = load_settings()

	var_host = tk.StringVar(value=str(loaded.get("listen_host", "127.0.0.1")))
	var_port = tk.StringVar(value=str(loaded.get("listen_port", "21537")))
	var_toggle = tk.StringVar(value=str(loaded.get("toggle_hotkey", "f6")))
	_reset_loaded = loaded.get("reset_hotkey", "f7")
	var_reset = tk.StringVar(value="" if (_reset_loaded is None) else str(_reset_loaded))
	var_debug = tk.BooleanVar(value=bool(loaded.get("debug_enabled", False)))
	var_running = tk.StringVar(value="정지")
	var_clients = tk.StringVar(value="0")
	var_capture_hint = tk.StringVar(value="")

	def persist_settings(include_listen: bool = True, include_hotkeys: bool = True):
		"""
		현재 UI 값을 설정 파일에 저장합니다.
		- include_listen: host/port 저장
		- include_hotkeys: hotkey/debug 저장
		"""
		out: dict = {}
		if include_listen:
			out["listen_host"] = var_host.get().strip() or "127.0.0.1"
			try:
				out["listen_port"] = int(var_port.get().strip())
			except Exception:
				# 저장은 하되, 깨진 값은 기본값으로 보정
				out["listen_port"] = 21537
		if include_hotkeys:
			out["toggle_hotkey"] = var_toggle.get().strip() or "f6"
			rh = var_reset.get().strip()
			out["reset_hotkey"] = (rh if rh else None)
			out["debug_enabled"] = bool(var_debug.get())
		save_settings(out)

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

		# 사용자가 "설정 적용"을 눌렀을 때의 값을 저장해, 재실행 시에도 유지되도록 합니다.
		persist_settings(include_listen=False, include_hotkeys=True)

		# 일부 키(예: CapsLock)는 OS/드라이버 특성상 이벤트가 두 번 들어올 수 있어
		# 콜백에 디바운스를 걸어 "짧은 시간 내 연속 트리거"를 1회로 합칩니다.
		DEBOUNCE_MS = 250
		_last_fire = {"toggle": 0.0, "reset": 0.0}
		_fire_lock = threading.Lock()

		def _debounced(name: str, fn):
			def wrapper():
				now = time.monotonic()
				with _fire_lock:
					last = float(_last_fire.get(name, 0.0))
					if (now - last) * 1000.0 < DEBOUNCE_MS:
						# 로그 스팸을 줄이기 위해 디버그 모드에서만 표시합니다.
						if bool(var_debug.get()):
							push_debug(f"[핫키] {name} 디바운스: {(now - last) * 1000.0:.0f}ms")
						return
					_last_fire[name] = now
				fn()

			return wrapper

		def do_toggle():
			push_log("[핫키] 토글 트리거")
			server.broadcast(jmsg("toggle"))

		def do_reset():
			push_log("[핫키] 리셋 트리거")
			server.broadcast(jmsg("reset"))

		hotkeys.apply(
			toggle_hotkey,
			reset_hotkey,
			bool(var_debug.get()),
			_debounced("toggle", do_toggle),
			_debounced("reset", do_reset),
		)

	# 디버그 체크박스 토글 시, 훅을 즉시 켜거나 꺼서 부하를 통제합니다.
	def on_debug_toggle(*_args):
		hotkeys.set_debug_enabled(bool(var_debug.get()))

	try:
		var_debug.trace_add("write", on_debug_toggle)
	except Exception:
		# 일부 오래된 Tk 환경에서는 trace_add가 없을 수 있어 무시합니다.
		pass

	def on_start():
		host = var_host.get().strip() or "127.0.0.1"
		try:
			port = int(var_port.get().strip())
		except Exception:
			push_log("[서버] 포트 값이 올바르지 않습니다.")
			return

		# 서버 실행 시점의 listen 설정을 저장합니다.
		persist_settings(include_listen=True, include_hotkeys=False)

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

	# ---- system tray integration ----
	# 닫기(X)는 기본적으로 "숨김(트레이로)" 처리하고,
	# 트레이 메뉴 "Exit"에서만 완전 종료합니다.
	_quitting = False
	_tray_icon = None

	def _create_tray_image(size: int = 64) -> "Image.Image":
		"""
		트레이 아이콘용 간단한 이미지를 런타임에 생성합니다.
		(별도 .ico 파일 없이 동작)
		"""
		img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
		d = ImageDraw.Draw(img)
		# background
		d.rounded_rectangle((4, 4, size - 4, size - 4), radius=12, fill=(30, 90, 200, 255))
		# centered "WS" glyph (white)
		try:
			# Windows 기본 폰트가 대부분 존재합니다.
			font = ImageFont.truetype("arial.ttf", int(size * 0.42))
		except Exception:
			font = ImageFont.load_default()

		text = "HK"
		# PIL 버전에 따라 anchor 지원 여부가 달라 bbox 기반으로 중앙 정렬합니다.
		try:
			bbox = d.textbbox((0, 0), text, font=font)
			tw = bbox[2] - bbox[0]
			th = bbox[3] - bbox[1]
		except Exception:
			tw, th = d.textsize(text, font=font)  # type: ignore[attr-defined]
		x = (size - tw) / 2
		y = (size - th) / 2 - (size * 0.02)  # 시각적으로 살짝 위로 보정
		d.text((x, y), text, font=font, fill=(255, 255, 255, 255))
		return img

	def show_window():
		# Tk는 메인 스레드에서만 안전하므로 after로 감쌉니다.
		def _do():
			try:
				root.deiconify()
				root.lift()
				root.focus_force()
			except Exception:
				pass

		root.after(0, _do)

	def hide_window():
		def _do():
			try:
				root.withdraw()
			except Exception:
				pass

		root.after(0, _do)

	def request_exit():
		nonlocal _quitting
		_quitting = True

		def _do_exit():
			# 트레이에서 나가기: 설정 저장 + 서버/훅 정리 후 종료
			try:
				persist_settings(include_listen=True, include_hotkeys=True)
				on_stop()
			finally:
				try:
					if _tray_icon is not None:
						_tray_icon.stop()
				except Exception:
					pass
				try:
					root.destroy()
				except Exception:
					pass

		root.after(0, _do_exit)

	def _start_tray():
		# pystray는 별도 스레드에서 run()을 돌리는 게 안전합니다.
		try:
			import pystray  # type: ignore
		except Exception as e:
			push_log(f"[트레이] pystray 로드 실패: {e}")
			return

		nonlocal _tray_icon

		menu = pystray.Menu(
			pystray.MenuItem("열기", lambda _i, _m: show_window(), default=True),
			pystray.MenuItem("종료", lambda _i, _m: request_exit()),
		)
		_tray_icon = pystray.Icon(
			"mapleland-exp-tracker-hotkey-ws",
			_create_tray_image(64),
			"Mapleland EXP Tracker (Hotkey WS)",
			menu=menu,
		)

		def _run():
			try:
				_tray_icon.run()
			except Exception as e:
				push_log(f"[트레이] 실행 오류: {e}")

		threading.Thread(target=_run, daemon=True).start()

	# 시작과 동시에 트레이 아이콘을 띄웁니다.
	_start_tray()

	def on_close():
		# 사용자가 창을 닫아도 프로그램은 계속 실행(트레이로 숨김)
		if _quitting:
			# request_exit() 경로에서 WM_DELETE_WINDOW가 들어온 경우(환경에 따라)
			return
		persist_settings(include_listen=True, include_hotkeys=True)
		hide_window()
		push_log("[트레이] 창이 숨겨졌습니다. 트레이 아이콘에서 다시 열 수 있습니다.")

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

	def _trim_log_lines():
		"""Text 위젯의 로그 라인을 MAX_LOG_LINES로 유지합니다."""
		try:
			total_lines = int(txt.index("end-1c").split(".")[0])
		except Exception:
			return
		excess = total_lines - MAX_LOG_LINES
		if excess <= 0:
			return
		# excess줄을 지우면 (excess+1)번째 줄의 시작이 새 1번째 줄이 됩니다.
		try:
			txt.delete("1.0", f"{excess + 1}.0")
		except Exception:
			pass

	def pump_status():
		# 연결 수/상태는 1초에 한 번만 갱신합니다.
		set_status()
		btn_server.configure(text=("서버 정지" if server.is_running() else "서버 실행"))
		root.after(1000, pump_status)

	def pump_logs():
		"""
		로그는 '필요할 때만' Text 위젯을 갱신합니다.
		- 큐가 비어 있으면 Text를 건드리지 않습니다.
		- 로그가 들어오는 동안은 빠르게(100ms) 비우고, 평소에는 느리게(500ms) 확인합니다.
		"""
		show_debug = bool(var_debug.get())
		lines: list[str] = []
		try:
			while True:
				is_debug, line = log_q.get_nowait()
				if (not is_debug) or show_debug:
					lines.append(line)
		except queue.Empty:
			pass

		if lines:
			# 읽기 전용 상태에서는 삽입이 안 되므로, 삽입하는 동안만 잠깐 해제합니다.
			txt.configure(state="normal")
			txt.insert("end", "\n".join(lines) + "\n")
			_trim_log_lines()
			txt.see("end")
			txt.configure(state="disabled")
			root.after(100, pump_logs)
		else:
			root.after(500, pump_logs)

	root.protocol("WM_DELETE_WINDOW", on_close)
	pump_status()
	pump_logs()
	root.mainloop()


if __name__ == "__main__":
	run_gui()


