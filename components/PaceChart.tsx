import { useMemo, useRef, useState, useEffect, useId } from "react";

type Point = { ts: number; value: number };

type Props = {
  data: Point[];
  tooltipFormatter?: (value: number) => string;
  xLabelFormatter?: (ts: number) => string; // optional label for x (ts in same units as data.ts)
  yLabelFormatter?: (value: number) => string; // optional label for y
  xDomain?: [number, number] | null; // optional external x-domain (ms)
  showAxisLabels?: boolean; // tick labels + axis lines
  showGrid?: boolean; // background grid lines
  enableBrush?: boolean;
  onRangeChange?: (startMs: number, endMs: number) => void;
};

const BASE_MARGIN = { left: 10, right: 10, top: 10, bottom: 22 };
const AXIS_LABEL_GAP = 8; // px between y labels and plot area
const AXIS_LABEL_PADDING = 6; // extra left padding

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function estimateMonoTextWidthPx(text: string, fontSizePx: number) {
  // Rough but stable: monospace glyphs are ~0.6em wide.
  return Math.ceil(text.length * fontSizePx * 0.62);
}

function uniqSorted(nums: number[], eps: number) {
  const sorted = [...nums].filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (out.length === 0 || Math.abs(n - last) > eps) out.push(n);
  }
  return out;
}

function filterTicksByPixelGap(
  ticksAsc: number[],
  scaleY: (v: number) => number,
  minGapPx: number,
  eps: number
) {
  if (ticksAsc.length <= 2) return ticksAsc;
  const desc = [...ticksAsc].sort((a, b) => b - a);
  const kept: number[] = [];
  let lastY = Infinity;
  for (const v of desc) {
    const y = scaleY(v);
    if (kept.length === 0) {
      kept.push(v); // always keep max
      lastY = y;
      continue;
    }
    if (Math.abs(y - lastY) >= minGapPx) {
      kept.push(v);
      lastY = y;
    }
  }
  // Ensure min is present; if too close, drop the closest neighbor to make room.
  const minV = ticksAsc[0];
  const hasMin = kept.some(k => Math.abs(k - minV) <= eps);
  if (!hasMin) {
    const yMin = scaleY(minV);
    const lastKept = kept[kept.length - 1];
    const yLast = scaleY(lastKept);
    if (Math.abs(yMin - yLast) < minGapPx && kept.length > 1) {
      kept.pop();
    }
    kept.push(minV);
  }
  return uniqSorted(kept, eps);
}

function niceTicks(min: number, max: number, approxCount: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (approxCount <= 0) return [];
  if (max === min) return [min];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo;
  const roughStep = span / approxCount;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-12, roughStep))));
  const err = roughStep / mag;
  let step = mag;
  if (err >= 7.5) step = 10 * mag;
  else if (err >= 3) step = 5 * mag;
  else if (err >= 1.5) step = 2 * mag;

  const start = Math.ceil(lo / step) * step;
  const end = Math.floor(hi / step) * step;
  const out: number[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0) return [];
  // Guard against infinite loops
  for (let v = start, i = 0; v <= end + step / 2 && i < 100; v += step, i++) {
    out.push(v);
  }
  // Fallback if range too tiny
  if (out.length === 0) out.push(lo, hi);
  return out;
}

export default function PaceChart(props: Props) {
  const {
    data,
    tooltipFormatter,
    xLabelFormatter,
    yLabelFormatter,
    xDomain = null,
    showAxisLabels = true,
    showGrid = true,
    enableBrush = true,
    onRangeChange
  } = props;
  const uid = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [brush, setBrush] = useState<{ startX: number; endX: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const brushRef = useRef<{ startX: number; endX: number } | null>(null);

  // Keep a ref so global mouseup handler can read latest brush without using a state updater callback.
  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onResize = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) });
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (!data || data.length === 0 || size.width === 0 || size.height === 0) {
      return {
        series: [] as Point[],
        path: "",
        xScale: (t: number) => 0,
        yScale: (v: number) => 0,
        minTs: 0,
        maxTs: 1,
        minVal: 0,
        maxVal: 1,
        margin: { ...BASE_MARGIN, left: 52 },
        plotW: 0,
        plotH: 0,
        xTicks: [] as number[],
        yTicks: [] as number[]
      };
    }

    // x-domain: external or full range
    const fullMin = data[0].ts;
    const fullMax = data[data.length - 1].ts;
    let minTs = xDomain ? xDomain[0] : fullMin;
    let maxTs = xDomain ? xDomain[1] : fullMax;
    if (maxTs <= minTs) maxTs = minTs + 1;

    const visible = data.filter(p => p.ts >= minTs && p.ts <= maxTs);

    // y domain based on visible
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const pnt of visible) {
      const val = pnt.value;
      if (Number.isFinite(val)) {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
      minVal = 0;
      maxVal = 1;
    }
    if (maxVal === minVal) {
      // expand a bit to render a flat line nicely
      maxVal = minVal + 1;
    }

    // Ticks (independent of margins)
    const approxPlotW = Math.max(0, size.width - 60); // rough guess to choose tick count
    const approxPlotH = Math.max(0, size.height - BASE_MARGIN.top - BASE_MARGIN.bottom);
    const xCount = Math.max(2, Math.min(6, Math.floor(approxPlotW / 90)));
    const yCount = Math.max(2, Math.min(5, Math.floor(approxPlotH / 42)));

    const xTicks: number[] = [];
    if (Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs) {
      for (let i = 0; i < xCount; i++) {
        const t = xCount === 1 ? 0 : i / (xCount - 1);
        xTicks.push(minTs + t * (maxTs - minTs));
      }
    }
    // Always include endpoints so the max/min are readable at a glance.
    // (niceTicks alone may skip maxVal if it doesn't land on a "nice" step)
    const yBaseCount = Math.max(0, yCount - 2);
    const yTicksBase = niceTicks(minVal, maxVal, yBaseCount);
    const span = Math.max(1e-12, Math.abs(maxVal - minVal));
    const eps = span * 1e-6;
    const yTicksRaw = uniqSorted([minVal, ...yTicksBase, maxVal], eps);

    // Compute left margin based on widest y-label (compact formatter recommended)
    let margin = { ...BASE_MARGIN };
    if (showAxisLabels) {
      const fontSize = 10;
      const yLabels = yTicksRaw.map(v => (yLabelFormatter ? yLabelFormatter(v) : v.toFixed(0)));
      const maxLabelWidth = yLabels.reduce((acc, s) => Math.max(acc, estimateMonoTextWidthPx(s, fontSize)), 0);
      const left = clamp(
        BASE_MARGIN.left + AXIS_LABEL_PADDING + maxLabelWidth + AXIS_LABEL_GAP,
        40,
        Math.max(40, size.width * 0.5)
      );
      margin = { ...BASE_MARGIN, left };
    }

    const plotW = Math.max(0, size.width - margin.left - margin.right);
    const plotH = Math.max(0, size.height - margin.top - margin.bottom);

    const xScale = (ts: number) => {
      const t = (ts - minTs) / Math.max(1, (maxTs - minTs));
      return margin.left + t * plotW;
    };
    const yScale = (v: number) => {
      const t = (v - minVal) / (maxVal - minVal);
      return margin.top + (1 - t) * plotH;
    };

    // Prevent overly-dense y labels (e.g., 2만, 2.2만...) while keeping min/max visible.
    // This uses pixel distance, so it adapts to chart height.
    const MIN_Y_LABEL_GAP_PX = 14;
    const yTicks = showAxisLabels
      ? filterTicksByPixelGap(yTicksRaw, yScale, MIN_Y_LABEL_GAP_PX, eps)
      : yTicksRaw;

    let d = "";
    for (let i = 0; i < visible.length; i++) {
      const pnt = visible[i];
      const x = xScale(pnt.ts);
      const y = yScale(pnt.value);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }

    return { series: visible, path: d, xScale, yScale, minTs, maxTs, minVal, maxVal, margin, plotW, plotH, xTicks, yTicks };
  }, [data, size.width, size.height, xDomain, yLabelFormatter, showAxisLabels]);

  const { series, path, xScale, yScale, minTs, maxTs, minVal, maxVal, margin, plotW, plotH, xTicks, yTicks } = chart;

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || !series || series.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = clamp(rawX, margin.left, Math.max(margin.left, size.width - margin.right));
    if (enableBrush && isDragging) {
      setBrush(b => (b ? { ...b, endX: x } : null));
    }
    // find nearest by x
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.length; i++) {
      const px = xScale(series[i].ts);
      const dist = Math.abs(px - x);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const px = xScale(series[bestIdx].ts);
    const py = yScale(series[bestIdx].value);
    setHover({ x: px, y: py, idx: bestIdx });
  };

  const handleMouseLeave = () => {
    setHover(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!enableBrush) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const x = clamp(rawX, margin.left, Math.max(margin.left, size.width - margin.right));
    setIsDragging(true);
    setBrush({ startX: x, endX: x });
  };

  useEffect(() => {
    if (!enableBrush || !isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      setBrush(b => {
        if (!b) return b;
        const rect = containerRef.current!.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const x = clamp(rawX, margin.left, Math.max(margin.left, size.width - margin.right));
        return { ...b, endX: x };
      });
    };
    const onUp = () => {
      if (!containerRef.current) {
        setIsDragging(false);
        setBrush(null);
        return;
      }
      setIsDragging(false);
      const current = brushRef.current;
      if (current) {
        const startPx = Math.min(current.startX, current.endX);
        const endPx = Math.max(current.startX, current.endX);
        // Ignore tiny drags
        if (endPx - startPx >= 4) {
          const inv = (px: number) => {
            const left = margin.left;
            const right = size.width - margin.right;
            const clamped = clamp(px, left, Math.max(left, right));
            const t = (clamped - left) / Math.max(1, right - left);
            return minTs + t * (maxTs - minTs);
          };
          const sTs = inv(startPx);
          const eTs = inv(endPx);
          if (onRangeChange) onRangeChange(Math.min(sTs, eTs), Math.max(sTs, eTs));
        }
      }
      setBrush(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [enableBrush, isDragging, size.width, margin.left, margin.right, minTs, maxTs, onRangeChange]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
    >
      {size.width > 0 && size.height > 0 && series && series.length > 0 ? (
        <>
          <svg width={size.width} height={size.height} className="absolute inset-0">
            <defs>
              <linearGradient id={`pace-stroke-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id={`pace-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(16,185,129,0.25)" />
                <stop offset="100%" stopColor="rgba(16,185,129,0.0)" />
              </linearGradient>
            </defs>
            {/* grid + axes + tick labels */}
            <g pointerEvents="none" style={{ userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties}>
              {/* horizontal grid + y labels */}
              {yTicks.map((v, i) => {
                const y = yScale(v);
                return (
                  <g key={`y-${i}`}>
                    {showGrid ? (
                      <line
                        x1={margin.left}
                        x2={size.width - margin.right}
                        y1={y}
                        y2={y}
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={1}
                      />
                    ) : null}
                    {showAxisLabels ? (
                      <text
                        x={margin.left - AXIS_LABEL_GAP}
                        y={y}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fill="rgba(255,255,255,0.55)"
                        fontSize={10}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
                      >
                        {yLabelFormatter ? yLabelFormatter(v) : v.toFixed(0)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {/* vertical grid + x labels */}
              {xTicks.map((t, i) => {
                const x = xScale(t);
                const isFirst = i === 0;
                const isLast = i === xTicks.length - 1;
                const anchor: "start" | "middle" | "end" = isFirst ? "start" : isLast ? "end" : "middle";
                const xPos = isFirst ? x + 2 : isLast ? x - 2 : x;
                return (
                  <g key={`x-${i}`}>
                    {showGrid ? (
                      <line
                        x1={x}
                        x2={x}
                        y1={margin.top}
                        y2={size.height - margin.bottom}
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth={1}
                      />
                    ) : null}
                    {showAxisLabels ? (
                      <text
                        x={xPos}
                        y={size.height - 6}
                        textAnchor={anchor}
                        dominantBaseline="alphabetic"
                        fill="rgba(255,255,255,0.55)"
                        fontSize={10}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
                      >
                        {xLabelFormatter ? xLabelFormatter(t) : new Date(t).toLocaleTimeString()}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {/* axes */}
              {showAxisLabels ? (
                <>
                  <line
                    x1={margin.left}
                    x2={margin.left}
                    y1={margin.top}
                    y2={size.height - margin.bottom}
                    stroke="rgba(255,255,255,0.14)"
                    strokeWidth={1}
                  />
                  <line
                    x1={margin.left}
                    x2={size.width - margin.right}
                    y1={size.height - margin.bottom}
                    y2={size.height - margin.bottom}
                    stroke="rgba(255,255,255,0.14)"
                    strokeWidth={1}
                  />
                </>
              ) : null}
            </g>
            {/* area fill */}
            <path
              d={`${path} L ${xScale(maxTs)} ${yScale(minVal)} L ${xScale(minTs)} ${yScale(minVal)} Z`}
              fill={`url(#pace-fill-${uid})`}
              stroke="none"
            />
            {/* main line */}
            <path d={path} fill="none" stroke={`url(#pace-stroke-${uid})`} strokeWidth={2} />
            {/* hover marker */}
            {hover && hover.idx >= 0 && hover.idx < series.length ? (
              <>
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={margin.top}
                  y2={size.height - margin.bottom}
                  stroke="rgba(255,255,255,0.2)"
                />
                <circle cx={hover.x} cy={hover.y} r={3} fill="#34d399" stroke="#111827" />
              </>
            ) : null}
          </svg>
          {enableBrush && brush ? (
            <div
              className="absolute top-0 bottom-0 bg-white/10 border border-white/20 pointer-events-none"
              style={{
                left: Math.min(brush.startX, brush.endX),
                width: Math.abs(brush.endX - brush.startX)
              }}
            />
          ) : null}
          {hover && hover.idx >= 0 && hover.idx < series.length ? (
            <div
              className="absolute pointer-events-none text-xs bg-black/70 text-white px-2 py-1 rounded border border-white/10"
              style={{
                left: Math.min(Math.max(hover.x + 8, 0), Math.max(0, size.width - 160)),
                top: Math.min(Math.max(hover.y - 28, 0), Math.max(0, size.height - 24))
              }}
            >
              <div className="font-mono">
                {tooltipFormatter ? tooltipFormatter(series[hover.idx].value) : series[hover.idx].value.toFixed(0)}
              </div>
              <div className="opacity-70">
                {xLabelFormatter ? xLabelFormatter(series[hover.idx].ts) : new Date(series[hover.idx].ts).toLocaleTimeString()}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm text-white/50">데이터 없음</div>
      )}
    </div>
  );
}

