import { pipMarkup, pipStyles } from "./template";
import type { PipCallbacks, PipState } from "./types";

export class PipController {
  private pipWindow: Window | null = null;
  private callbacks: PipCallbacks;
  private lastState: PipState | null = null;

  constructor(callbacks: PipCallbacks) {
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: PipCallbacks) {
    this.callbacks = callbacks;
  }

  isOpen(): boolean {
    const dpi: any = (window as any).documentPictureInPicture;
    const w: Window | null = dpi?.window ?? null;
    return !!(w && !w.closed);
  }

  async open(): Promise<void> {
    // @ts-ignore experimental
    const dpi: any = (window as any).documentPictureInPicture;
    if (!dpi || typeof dpi.requestWindow !== "function") {
      alert("이 브라우저는 문서 PIP(Document Picture-in-Picture)를 지원하지 않습니다. 크롬 최신 버전을 사용해 주세요.");
      return;
    }
    // Close existing if any
    const existing: Window | null = dpi.window ?? null;
    if (existing) {
      try { existing.close(); } catch {}
      await new Promise(r => setTimeout(r, 40));
    }
    // Request a new window
    const win: Window = await dpi.requestWindow({ width: 330, height: 220 });
    this.pipWindow = win;
    // Inject styles and markup
    const style = win.document.createElement("style");
    style.textContent = pipStyles();
    win.document.head.appendChild(style);
    const root = win.document.createElement("div");
    root.id = "pip-root";
    root.className = "container";
    root.innerHTML = pipMarkup();
    win.document.body.appendChild(root);
    // Bind events
    const toggle = win.document.getElementById("pip-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        try { this.callbacks.onToggle(); } catch {}
      });
    }
    const reset = win.document.getElementById("pip-reset");
    if (reset) {
      reset.addEventListener("click", () => {
        try { this.callbacks.onReset(); } catch {}
        // small async update opportunity
        setTimeout(() => this.lastState && this.update(this.lastState), 0);
      });
    }
    const cleanup = () => { this.pipWindow = null; };
    win.addEventListener("pagehide", cleanup);
    win.addEventListener("unload", cleanup);
    try {
      win.addEventListener("visibilitychange", () => {
        const cur: Window | null = (window as any).documentPictureInPicture?.window ?? null;
        if (!cur || cur.closed) this.pipWindow = null;
      });
    } catch {}
    // Initial paint if we had state
    if (this.lastState) this.update(this.lastState);
  }

  update(state: PipState): void {
    this.lastState = state;
    const win = this.pipWindow;
    if (!win) return;
    const d = win.document;
    const qs = (id: string) => d.getElementById(id);
    // Toggle button
    const playBtn = qs("pip-toggle");
    if (playBtn) {
      playBtn.textContent = state.isSampling ? "⏸" : "▶";
      playBtn.setAttribute("aria-label", state.isSampling ? "일시정지" : "시작");
      playBtn.classList.remove("play", "pause");
      playBtn.classList.add(state.isSampling ? "pause" : "play");
    }
    // Timer
    const timer = qs("pip-timer");
    if (timer) timer.textContent = this.formatElapsed(state.elapsedMs);
    // Next hour label/time
    const nextLabel = qs("pip-next-label");
    if (nextLabel) nextLabel.textContent = state.nextHours != null ? `${state.nextHours}시간 되는 시각` : "다음 시간 되는 시각";
    const nextEl = qs("pip-next");
    if (nextEl) nextEl.textContent = state.nextAt ? state.nextAt.toLocaleTimeString() : "-";
    // Texts
    const gainedEl = qs("pip-gained");
    if (gainedEl) gainedEl.textContent = state.gainedText;
    const estEl = qs("pip-est");
    if (estEl) estEl.textContent = state.estText;
    // Keep reset button style
    const resetBtn = qs("pip-reset");
    if (resetBtn) resetBtn.classList.add("reset");
  }

  close(): void {
    try { this.pipWindow?.close(); } catch {}
    this.pipWindow = null;
  }

  private formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
  }
}

