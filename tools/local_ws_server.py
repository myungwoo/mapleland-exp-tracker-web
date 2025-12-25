#!/usr/bin/env python3
"""
Minimal local WebSocket server for testing from the web app.

Requires:
  pip install websockets

Run:
  python tools/local_ws_server.py --host 127.0.0.1 --port 21537
"""

import argparse
import asyncio
import json

import websockets


async def handler(ws):
	print("client connected")
	try:
		await ws.send(json.dumps({"type": "hello", "msg": "connected"}))
		async for msg in ws:
			print("recv:", msg)
			if msg == "ping":
				await ws.send("pong")
				continue
			# Echo + basic "toggle" demo
			try:
				obj = json.loads(msg)
				if isinstance(obj, dict) and obj.get("type") == "toggle":
					await ws.send(json.dumps({"type": "toggled"}))
					continue
			except Exception:
				pass
			await ws.send(f"echo:{msg}")
	except websockets.ConnectionClosed:
		pass
	finally:
		print("client disconnected")


async def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--host", default="127.0.0.1")
	ap.add_argument("--port", type=int, default=21537)
	args = ap.parse_args()

	async with websockets.serve(handler, args.host, args.port):
		print(f"listening on ws://{args.host}:{args.port}")
		await asyncio.Future()


if __name__ == "__main__":
	asyncio.run(main())


