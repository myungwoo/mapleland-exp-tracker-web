#!/usr/bin/env python3
"""
WebSocket 브로드캐스트 서버 + 전역(글로벌) 핫키 리스너 (Windows 친화)

동작:
  - ws://127.0.0.1:21537 (기본값)에서 WebSocket 서버를 엽니다.
  - 전역 핫키를 감지합니다. (기본: F6)
  - 핫키가 눌리면 연결된 모든 클라이언트(웹앱 탭)에 JSON 메시지를 브로드캐스트합니다.
      {"type":"toggle"}  (F6)
      {"type":"reset"}   (F7)

설치:
  python -m pip install -r tools/hotkey-ws/requirements.txt

실행:
  python tools/hotkey-ws/hotkey_ws_server.py --host 127.0.0.1 --port 21537

참고:
  - Windows 환경에 따라 전역 키 훅이 막히면 “관리자 권한으로 실행”이 필요할 수 있습니다.
"""

import argparse
import asyncio
import json
import threading
import platform
from typing import Set

import websockets
from pynput import keyboard


def jmsg(t: str) -> str:
	return json.dumps({"type": t}, ensure_ascii=False)


class Hub:
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

	def broadcast_from_thread(self, payload: str):
		# pynput 콜백(별도 스레드)에서 asyncio 루프로 안전하게 전달합니다.
		asyncio.run_coroutine_threadsafe(self.broadcast(payload), self.loop)


async def ws_handler(ws, hub: Hub):
	await hub.add(ws)
	try:
		await ws.send(json.dumps({"type": "hello", "msg": "connected"}, ensure_ascii=False))
		async for msg in ws:
			# 디버그/헬스체크 용도: ping/pong만 처리하고 나머지는 에코합니다.
			if msg == "ping":
				await ws.send("pong")
				continue
			await ws.send(f"echo:{msg}")
	finally:
		await hub.remove(ws)


def start_hotkey_listener(hub: Hub, toggle_key: str, reset_key: str | None):
	"""
	pynput 리스너를 백그라운드 스레드에서 실행합니다.
	"""
	toggle = toggle_key.lower()
	reset = reset_key.lower() if reset_key else None

	def key_name(k):
		# k는 Key 또는 KeyCode일 수 있습니다.
		if isinstance(k, keyboard.Key):
			return k.name or str(k)
		try:
			return k.char  # type: ignore[attr-defined]
		except Exception:
			return str(k)

	def on_press(k):
		name = (key_name(k) or "").lower()
		if name == toggle:
			hub.broadcast_from_thread(jmsg("toggle"))
		elif reset and name == reset:
			hub.broadcast_from_thread(jmsg("reset"))

	def run():
		with keyboard.Listener(on_press=on_press) as listener:
			listener.join()

	th = threading.Thread(target=run, daemon=True)
	th.start()


def start_hotkey_listener_keyboard_lib(hub: Hub, toggle_key: str, reset_key: str | None, debug_keys: bool):
	"""
	`keyboard` 라이브러리를 이용한 전역 핫키 리스너입니다. (Windows에서 비교적 안정적인 편)
	"""
	import keyboard as kb  # type: ignore

	def on_toggle():
		hub.broadcast_from_thread(jmsg("toggle"))

	def on_reset():
		hub.broadcast_from_thread(jmsg("reset"))

	# 디버그 모드에서는 모든 키 이벤트를 출력해 어떤 키로 인식되는지 확인할 수 있게 합니다.
	if debug_keys:
		def _dbg(ev):
			# ev: keyboard.KeyboardEvent
			print(f"[키 디버그] name={getattr(ev, 'name', None)} event_type={getattr(ev, 'event_type', None)} scan_code={getattr(ev, 'scan_code', None)}")
		kb.hook(_dbg)

	# hotkey 등록 (대소문자 무시)
	kb.add_hotkey(toggle_key, on_toggle, suppress=False, trigger_on_release=False)
	if reset_key:
		kb.add_hotkey(reset_key, on_reset, suppress=False, trigger_on_release=False)

	# 블로킹 대기(백그라운드 스레드에서 실행)
	def run():
		kb.wait()

	th = threading.Thread(target=run, daemon=True)
	th.start()


async def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--host", default="127.0.0.1")
	ap.add_argument("--port", type=int, default=21537)
	ap.add_argument("--toggle-key", default="f6", help="기본값: f6")
	ap.add_argument("--reset-key", default="f7", help="기본값: f7 (비활성화하려면 빈 문자열)")
	ap.add_argument("--hotkey-backend", default="auto", choices=["auto", "keyboard", "pynput"], help="기본값: auto (Windows에서는 keyboard 우선)")
	ap.add_argument("--debug-keys", action="store_true", help="키 인식 디버그 로그 출력")
	args = ap.parse_args()

	loop = asyncio.get_running_loop()
	hub = Hub(loop)

	reset_key = args.reset_key.strip() or None
	backend = args.hotkey_backend
	if backend == "auto":
		backend = "keyboard" if platform.system().lower() == "windows" else "pynput"

	if backend == "keyboard":
		try:
			start_hotkey_listener_keyboard_lib(hub, args.toggle_key, reset_key, args.debug_keys)
			print("핫키 백엔드: keyboard")
		except Exception as e:
			print(f"핫키 백엔드 keyboard 초기화 실패: {e}")
			print("pynput 백엔드로 폴백합니다.")
			start_hotkey_listener(hub, args.toggle_key, reset_key)
			print("핫키 백엔드: pynput")
	else:
		start_hotkey_listener(hub, args.toggle_key, reset_key)
		print("핫키 백엔드: pynput")

	print(f"리스닝: ws://{args.host}:{args.port}")
	print(f"핫키: {args.toggle_key} -> toggle" + (f", {args.reset_key} -> reset" if reset_key else ""))

	async with websockets.serve(lambda ws: ws_handler(ws, hub), args.host, args.port):
		await asyncio.Future()


if __name__ == "__main__":
	asyncio.run(main())


