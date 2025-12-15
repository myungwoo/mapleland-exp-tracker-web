import { useMemo, useRef, useState, useEffect } from "react";

type Point = { ts: number; value: number };

type Props = {
  data: Point[];
  tooltipFormatter?: (value: number) => string;
  smoothingWindowSec?: number; // defaults to 30s
  xLabelFormatter?: (ts: number) => string; // optional label for x (ts in same units as data.ts)
  domainWarmupSec?: number; // ignore first warmup seconds for y-domain AND rendering (default = smoothingWindowSec)
};

export default function PaceChart(props: Props) {
  const {
    data,
    tooltipFormatter,
    smoothingWindowSec = 30,
    xLabelFormatter,
    domainWarmupSec,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(null);

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

  const { series, path, xScale, yScale, minTs, maxTs, minVal, maxVal } = useMemo(() => {
    if (!data || data.length === 0 || size.width === 0 || size.height === 0) {
      return {
        series: [] as Point[],
        path: "",
        xScale: (t: number) => 0,
        yScale: (v: number) => 0,
        minTs: 0,
        maxTs: 1,
        minVal: 0,
        maxVal: 1
      };
    }
    // Build smoothed series using time-weighted moving average over smoothingWindowSec
    const W = Math.max(1, Math.floor(smoothingWindowSec * 1000));
    const n = data.length;
    const t = data.map(p => p.ts);
    const v = data.map(p => p.value);
    // cumulative trapezoidal integral: I[k] = integral from t0..t[k] of v dt (linear between samples)
    const I = new Array<number>(n).fill(0);
    for (let k = 1; k < n; k++) {
      const dt = t[k] - t[k - 1];
      I[k] = I[k - 1] + ((v[k - 1] + v[k]) / 2) * Math.max(0, dt);
    }
    // helper to compute integral at arbitrary time s within [t[p], t[p+1]]
    let p = 0;
    const integralAt = (s: number): number => {
      if (s <= t[0]) return 0;
      if (s >= t[n - 1]) return I[n - 1];
      while (p + 1 < n && t[p + 1] <= s) p++;
      // now s in (t[p], t[p+1]]
      const dt = t[p + 1] - t[p];
      const r = dt > 0 ? (s - t[p]) / dt : 0;
      const vs = v[p] + (v[p + 1] - v[p]) * r; // linear interpolation
      const seg = ((v[p] + vs) / 2) * (s - t[p]);
      return I[p] + seg;
    };
    const smooth: Point[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const end = t[i];
      const start = end - W;
      const startClamped = Math.max(start, t[0]);
      const dur = Math.max(1, end - startClamped);
      const area = I[i] - integralAt(start);
      const mv = area / dur;
      smooth[i] = { ts: t[i], value: mv };
    }

    const margin = { left: 8, right: 8, top: 8, bottom: 4 };
    const w = Math.max(0, size.width - margin.left - margin.right);
    const h = Math.max(0, size.height - margin.top - margin.bottom);
    // Warmup: hide the first domainWarmupSec from rendering and domain
    const warmupMs = (typeof domainWarmupSec === "number" ? domainWarmupSec : smoothingWindowSec) * 1000;
    const domainStart = smooth[0].ts + Math.max(0, warmupMs);
    const visible = smooth.filter(p => p.ts >= domainStart);
    // x domain
    let minTs = visible.length ? visible[0].ts : domainStart;
    let maxTs = visible.length ? visible[visible.length - 1].ts : (domainStart + 1);
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
    const xScale = (ts: number) => {
      const t = (ts - minTs) / Math.max(1, (maxTs - minTs));
      return margin.left + t * w;
    };
    const yScale = (v: number) => {
      const t = (v - minVal) / (maxVal - minVal);
      return margin.top + (1 - t) * h;
    };
    let d = "";
    for (let i = 0; i < visible.length; i++) {
      const pnt = visible[i];
      const x = xScale(pnt.ts);
      const y = yScale(pnt.value);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    return { series: visible, path: d, xScale, yScale, minTs, maxTs, minVal, maxVal };
  }, [data, size.width, size.height, smoothingWindowSec]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || !series || series.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
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

  const handleMouseLeave = () => setHover(null);

  return (
    <div ref={containerRef} className="w-full h-full relative" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      {size.width > 0 && size.height > 0 && series && series.length > 0 ? (
        <>
          <svg width={size.width} height={size.height} className="absolute inset-0">
            <defs>
              <linearGradient id="pace-stroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id="pace-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(16,185,129,0.25)" />
                <stop offset="100%" stopColor="rgba(16,185,129,0.0)" />
              </linearGradient>
            </defs>
            {/* background grid (light) */}
            <g opacity={0.2}>
              <rect x="0" y="0" width={size.width} height={size.height} fill="none" />
            </g>
            {/* area fill */}
            <path
              d={`${path} L ${xScale(maxTs)} ${yScale(minVal)} L ${xScale(minTs)} ${yScale(minVal)} Z`}
              fill="url(#pace-fill)"
              stroke="none"
            />
            {/* main line */}
            <path d={path} fill="none" stroke="url(#pace-stroke)" strokeWidth={2} />
            {/* hover marker */}
            {hover ? (
              <>
                <line x1={hover.x} x2={hover.x} y1={0} y2={size.height} stroke="rgba(255,255,255,0.2)" />
                <circle cx={hover.x} cy={hover.y} r={3} fill="#34d399" stroke="#111827" />
              </>
            ) : null}
          </svg>
          {hover ? (
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

