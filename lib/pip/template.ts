export function pipStyles(): string {
  return `
    :root { color-scheme: dark; }
    html, body { margin: 0; padding: 0; background: rgba(10,10,10,0.92); color: #f7f7f7; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    .container { display: grid; grid-template-rows: auto auto auto; gap: 2px; padding: 10px 12px; text-align: center; }
    .row { display: flex; align-items: center; justify-content: center; }
    .timer { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 36px; line-height: 1; letter-spacing: 0.5px; }
    .meta { font-size: 12px; opacity: 0.85; display: flex; gap: 8px; justify-content: center; margin-top: 4px; margin-bottom: 4px; }
    .bigger { color: #ffcf33; font-weight: 800; font-size: 24px; }
    .big { color: #ffcf33; font-weight: 800; font-size: 16px; }
    .reset { margin-right: 3px; }
    button.pip { background: #ffffff14; color: white; border: 1px solid #ffffff22; border-radius: 8px; width: 40px; height: 40px; font-size: 18px; transition: background-color 120ms ease; }
    button.pip.play { background: #22c55e; border-color: #16a34a; }   /* green */
    button.pip.pause { background: #f59e0b; border-color: #d97706; }  /* yellow/amber */
    button.pip.reset { background: #ef4444; border-color: #dc2626; }  /* red */
    button.pip:active { transform: translateY(1px); }
    .label { font-size: 12px; opacity: 0.7; margin-right: 8px; }
  `;
}

export function pipMarkup(): string {
  return `
    <div class="row" style="gap: 6px;">
      <button id="pip-toggle" class="pip play" aria-label="시작">▶</button>
      <button id="pip-reset" class="pip reset" aria-label="초기화">↺</button>
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

