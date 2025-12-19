import { useMemo, useRef, useState, useEffect } from "react";

type Point = { ts: number; value: number };

type Props = {
  data: Point[];
  tooltipFormatter?: (value: number) => string;
  xLabelFormatter?: (ts: number) => string; // optional label for x (ts in same units as data.ts)
  xDomain?: [number, number] | null; // optional external x-domain (ms)
  enableBrush?: boolean;
  onRangeChange?: (startMs: number, endMs: number) => void;
};

export default function PaceChart(props: Props) {
  const {
    data,
    tooltipFormatter,
    xLabelFormatter,
    xDomain = null,
    enableBrush = true,
    onRangeChange
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; idx: number } | null>(null);
  const [brush, setBrush] = useState<{ startX: number; endX: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
    const margin = { left: 8, right: 8, top: 8, bottom: 4 };
    const w = Math.max(0, size.width - margin.left - margin.right);
    const h = Math.max(0, size.height - margin.top - margin.bottom);
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
  }, [data, size.width, size.height, xDomain]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current || !series || series.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
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
    if (enableBrush && isDragging) {
      setIsDragging(false);
      setBrush(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!enableBrush) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setIsDragging(true);
    setBrush({ startX: x, endX: x });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!enableBrush) return;
    if (!containerRef.current) return;
    if (!brush) {
      setIsDragging(false);
      return;
    }
    setIsDragging(false);
    const startPx = Math.min(brush.startX, brush.endX);
    const endPx = Math.max(brush.startX, brush.endX);
    setBrush(null);
    // Ignore tiny drags
    if (endPx - startPx < 4) return;
    // Invert xScale
    const inv = (px: number) => {
      // clamp to chart area horizontally
      const left = 8; // margin.left
      const right = size.width - 8; // approx margin.right
      const clamped = Math.max(left, Math.min(right, px));
      const t = (clamped - left) / Math.max(1, right - left);
      return minTs + t * (maxTs - minTs);
    };
    const sTs = inv(startPx);
    const eTs = inv(endPx);
    if (onRangeChange) onRangeChange(Math.min(sTs, eTs), Math.max(sTs, eTs));
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
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
            {hover && hover.idx >= 0 && hover.idx < series.length ? (
              <>
                <line x1={hover.x} x2={hover.x} y1={0} y2={size.height} stroke="rgba(255,255,255,0.2)" />
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

