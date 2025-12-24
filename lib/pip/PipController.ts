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
      alert("이 브라우저에서는 문서 PiP(Document Picture-in-Picture) 기능을 지원하지 않습니다. 이 기능을 사용하려면 최신 버전의 Chrome 또는 Edge 브라우저를 이용해 주세요.");
      return;
    }
    // 기존 창이 있으면 먼저 닫습니다.
    const existing: Window | null = dpi.window ?? null;
    if (existing) {
      try { existing.close(); } catch {}
      await new Promise(r => setTimeout(r, 40));
    }
    // 새 창을 요청합니다.
    const win: Window = await dpi.requestWindow({ width: 330, height: 220 });
    this.pipWindow = win;
    // 스타일과 마크업을 주입합니다.
    const style = win.document.createElement("style");
    style.textContent = pipStyles();
    win.document.head.appendChild(style);
    const root = win.document.createElement("div");
    root.id = "pip-root";
    root.className = "container";
    root.innerHTML = pipMarkup();
    win.document.body.appendChild(root);
    // 이벤트를 바인딩합니다.
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
        // 비동기 업데이트 기회를 조금 줍니다.
        setTimeout(() => this.lastState && this.update(this.lastState), 0);
      });
    }
    // 키보드: Space는 시작/일시정지 토글, R은 초기화 (입력 중에는 무시, Space가 포커스된 버튼을 누르지 않게 보장)
    const onKeyDown = (e: KeyboardEvent) => {
      const key = (e as any).key;
      const code = (e as any).code || (e as any).key;
      if (code === "Escape" || key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      if (code === "Space" || (e as any).key === " ") {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        const isForm = !!el && (el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
        // 폼 컨트롤 입력은 허용합니다. 그 외에는 Space가 항상 타이머 토글이 되도록 합니다.
        if (isForm) return;
        // Space가 포커스된 버튼(예: 초기화)을 누르지 않도록 기본 동작을 막습니다.
        e.preventDefault();
        e.stopPropagation();
        // 해당 키업(keyup)의 기본 클릭도 1회 억제합니다.
        const suppressSpaceUp = (ev: KeyboardEvent) => {
          const upCode = (ev as any).code || (ev as any).key;
          if (upCode === "Space" || (ev as any).key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
          }
        };
        try {
          // 키업(keyup)에서 버튼 클릭이 발동되지 않도록 캡처(capture) + once로 등록합니다.
          win.addEventListener("keyup", suppressSpaceUp, { capture: true, once: true } as any);
        } catch {
          // 아무 동작 없음
        }
        try { this.callbacks.onToggle(); } catch {}
      } else if (code === "KeyR" || (e as any).key === "r" || (e as any).key === "R") {
        // 브라우저 새로고침 단축키(Cmd+R / Ctrl+R)는 통과시킵니다.
        if ((e as any).metaKey || (e as any).ctrlKey) return;
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        const isForm = !!el && (el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select");
        // 폼 컨트롤 입력 중을 제외하고 어디서든 R이 동작하도록 합니다.
        if (isForm) return;
        e.preventDefault();
        try { this.callbacks.onReset(); } catch {}
      }
    };
    // Space의 기본 버튼 활성화를 확실히 선점하기 위해 캡처(capture)로 등록합니다.
    try {
      win.addEventListener("keydown", onKeyDown, true);
    } catch {
      win.addEventListener("keydown", onKeyDown);
    }
    try { win.focus?.(); } catch {}
    const cleanup = () => {
      try { win.removeEventListener("keydown", onKeyDown, true); } catch {}
      try { win.removeEventListener("keydown", onKeyDown as any); } catch {}
      this.pipWindow = null;
    };
    win.addEventListener("pagehide", cleanup);
    win.addEventListener("unload", cleanup);
    try {
      win.addEventListener("visibilitychange", () => {
        const cur: Window | null = (window as any).documentPictureInPicture?.window ?? null;
        if (!cur || cur.closed) this.pipWindow = null;
      });
    } catch {}
    // 상태가 이미 있으면 최초 렌더링을 수행합니다.
    if (this.lastState) this.update(this.lastState);
  }

  update(state: PipState): void {
    this.lastState = state;
    const win = this.pipWindow;
    if (!win) return;
    const d = win.document;
    const qs = (id: string) => d.getElementById(id);
    // 토글 버튼
    const playBtn = qs("pip-toggle");
    if (playBtn) {
      playBtn.setAttribute("aria-label", state.isSampling ? "일시정지" : "시작");
      playBtn.classList.remove("play", "pause");
      playBtn.classList.add(state.isSampling ? "pause" : "play");
    }
    // 타이머
    const timer = qs("pip-timer");
    if (timer) timer.textContent = this.formatElapsed(state.elapsedMs);
    // 다음 시간 라벨/시간
    const nextLabel = qs("pip-next-label");
    if (nextLabel) nextLabel.textContent = state.nextHours != null ? `${state.nextHours}시간 되는 시각` : "다음 시간 되는 시각";
    const nextEl = qs("pip-next");
    if (nextEl) nextEl.textContent = state.nextAt ? state.nextAt.toLocaleTimeString() : "-";
    // 텍스트들
    const gainedEl = qs("pip-gained");
    if (gainedEl) gainedEl.textContent = state.gainedText;
    const paceEl = qs("pip-pace");
    if (paceEl) paceEl.textContent = state.paceText;
  }

  close(): void {
    // 저장된 참조와 API가 관리하는 현재 창(있다면) 둘 다 닫습니다.
    try { this.pipWindow?.close(); } catch {}
    try {
      const cur: Window | null = (window as any).documentPictureInPicture?.window ?? null;
      if (cur && !cur.closed) cur.close();
    } catch {}
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

