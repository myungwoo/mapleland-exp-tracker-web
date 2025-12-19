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
    // Keyboard: Space to toggle timer, R to reset (avoid inputs; ensure Space never triggers focused reset button)
    const onKeyDown = (e: KeyboardEvent) => {
      const code = (e as any).code || (e as any).key;
      if (code === "Space" || (e as any).key === " ") {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        const isForm = !!el && (el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
        // Allow typing in form controls; otherwise, Space should always toggle timer
        if (isForm) return;
        // Prevent default so Space doesn't activate a focused button (e.g., reset)
        e.preventDefault();
        e.stopPropagation();
        // Also suppress the corresponding keyup default click once
        const suppressSpaceUp = (ev: KeyboardEvent) => {
          const upCode = (ev as any).code || (ev as any).key;
          if (upCode === "Space" || (ev as any).key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
          }
        };
        try {
          // capture + once to ensure button click isn't fired on keyup
          win.addEventListener("keyup", suppressSpaceUp, { capture: true, once: true } as any);
        } catch {
          // no-op
        }
        try { this.callbacks.onToggle(); } catch {}
      } else if (code === "KeyR" || (e as any).key === "r" || (e as any).key === "R") {
        // Allow browser refresh shortcuts (Cmd+R / Ctrl+R) to pass through
        if ((e as any).metaKey || (e as any).ctrlKey) return;
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        const isForm = !!el && (el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
        // Allow R to work anywhere except when typing in form controls
        if (isForm) return;
        e.preventDefault();
        try { this.callbacks.onReset(); } catch {}
      }
    };
    // Use capture to reliably preempt default button activation by Space
    try {
      win.addEventListener("keydown", onKeyDown, true);
    } catch {
      win.addEventListener("keydown", onKeyDown);
    }
    try { win.focus?.(); } catch {}
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

