export function pipStyles(): string {
  return `
    @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css");
    :root { color-scheme: dark; }
    html, body { margin: 0; padding: 0; background: rgba(10,10,10,0.92); color: #f7f7f7; font-family: Pretendard, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    /* Center all content vertically when there's extra height */
    html, body { min-height: 100vh; display: grid; place-content: center; }
    .container { display: grid; grid-template-rows: auto auto auto; gap: 2px; padding: 10px 12px; text-align: center; }
    .row { display: flex; align-items: center; justify-content: center; }
    .timer { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 36px; line-height: 1; letter-spacing: 0.5px; }
    .meta { font-size: 12px; opacity: 0.85; display: flex; gap: 8px; justify-content: center; margin-top: 4px; margin-bottom: 4px; }
    .bigger { color: #ffcf33; font-weight: 800; font-size: 24px; }
    .big { color: #ffcf33; font-weight: 800; font-size: 16px; }
    button.pip {
      background: #ffffff14;
      color: white;
      border: 1px solid #ffffff22;
      border-radius: 8px;
      width: 60px;
      height: 40px;
      font-size: 28px;
      transition: background-color 120ms ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 0;
    }
    button.pip.play { background: #22c55e; border-color: #16a34a; }   /* green */
    button.pip.pause { background: #ef4444; border-color: #dc2626; }  /* red */
    button.pip:active { transform: translateY(1px); }
    /* SVG icon sizing and visibility toggling (size follows font-size via em) */
    .pip-icon { width: 1em; height: 1em; display: block; fill: currentColor; pointer-events: none; }
    #pip-toggle .pip-icon { display: none; }
    #pip-toggle.play .icon-play { display: block; }
    #pip-toggle.pause .icon-pause { display: block; }
    /* Ensure timer block visually aligns top/bottom with the 40px button in Edge */
    #pip-timer { height: 40px; line-height: 40px; display: flex; align-items: center; }
    .label { font-size: 12px; opacity: 0.7; margin-right: 8px; }
  `;
}

export function pipMarkup(): string {
  return `
    <div class="row" style="gap: 6px;">
      <button id="pip-toggle" class="pip play" aria-label="시작">
        <svg class="pip-icon icon-play" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z"></path>
        </svg>
        <svg class="pip-icon icon-pause" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 5h5v14H6zM13 5h5v14h-5z"></path>
        </svg>
      </button>
      <div class="timer" id="pip-timer">00:00:00</div>
    </div>
    <div class="row meta">
      <span id="pip-next-label">다음 시간 되는 시각</span>
      <span id="pip-next">-</span>
    </div>
    <div class="row">
      <div class="bigger" id="pip-gained">-</div>
    </div>
    <div class="row">
      <div class="big" id="pip-est">-</div>
    </div>
  `;
}

