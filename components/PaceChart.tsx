import { useMemo, useRef, useState, useEffect, useId } from "react";

type Point = { ts: number; value: number };

type Props = {
  data: Point[];
  tooltipFormatter?: (value: number) => string;
  xLabelFormatter?: (ts: number) => string; // x축 라벨 포맷터(선택) (ts는 data.ts와 동일 단위)
  yLabelFormatter?: (value: number) => string; // y축 라벨 포맷터(선택)
  xDomain?: [number, number] | null; // 외부에서 지정하는 x축 범위(선택) (ms)
  showAxisLabels?: boolean; // 눈금 라벨 + 축 선
  showGrid?: boolean; // 배경 그리드 선
  enableBrush?: boolean;
  onRangeChange?: (startMs: number, endMs: number) => void;
};

const BASE_MARGIN = { left: 10, right: 10, top: 10, bottom: 22 };
const AXIS_LABEL_GAP = 8; // y 라벨과 플롯 영역 사이 px 간격
const AXIS_LABEL_PADDING = 6; // 좌측 추가 패딩

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function estimateMonoTextWidthPx(text: string, fontSizePx: number) {
  // 대략적이지만 안정적: monospace 글리프 폭은 대략 0.6em 정도입니다.
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
      kept.push(v); // 최댓값은 항상 유지
      lastY = y;
      continue;
    }
    if (Math.abs(y - lastY) >= minGapPx) {
      kept.push(v);
      lastY = y;
    }
  }
  // 최솟값이 반드시 포함되도록 보장합니다. 너무 가까우면 가장 가까운 이웃을 제거해 자리를 만듭니다.
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
  // 무한 루프 방지
  for (let v = start, i = 0; v <= end + step / 2 && i < 100; v += step, i++) {
    out.push(v);
  }
  // 범위가 너무 작아 ticks가 안 나오면 대체 값(lo/hi)을 넣습니다.
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

  // 전역 mouseup 핸들러가 최신 brush를 읽을 수 있도록 ref를 유지합니다. (상태 업데이트 콜백 의존 제거)
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

    // x축 범위: 외부 지정값 또는 전체 범위
    const fullMin = data[0].ts;
    const fullMax = data[data.length - 1].ts;
    let minTs = xDomain ? xDomain[0] : fullMin;
    let maxTs = xDomain ? xDomain[1] : fullMax;
    if (maxTs <= minTs) maxTs = minTs + 1;

    const visible = data.filter(p => p.ts >= minTs && p.ts <= maxTs);

    // y축 범위: 현재 보이는 구간 기준
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
      // 평평한 선도 보기 좋게 렌더링되도록 약간 확장
      maxVal = minVal + 1;
    }

    // 눈금(ticks) 계산 (margin과 독립)
    const approxPlotW = Math.max(0, size.width - 60); // tick 개수를 정하기 위한 대략값
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
    // 최댓값/최솟값은 한눈에 보이도록 항상 포함합니다.
    // (niceTicks만 쓰면 maxVal이 "예쁜" step에 걸리지 않아 빠질 수 있음)
    const yBaseCount = Math.max(0, yCount - 2);
    const yTicksBase = niceTicks(minVal, maxVal, yBaseCount);
    const span = Math.max(1e-12, Math.abs(maxVal - minVal));
    const eps = span * 1e-6;
    const yTicksRaw = uniqSorted([minVal, ...yTicksBase, maxVal], eps);

    // y 라벨 중 가장 긴 값을 기준으로 왼쪽 여백(left margin)을 계산합니다. (축약 포맷터 권장)
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

    // y 라벨이 너무 촘촘해지는 것을 방지합니다(예: 2만, 2.2만...). 동시에 최소/최대(min/max)는 유지합니다.
    // 픽셀 거리 기준이라 차트 높이에 따라 자동으로 조정됩니다.
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
    // x 기준으로 가장 가까운 점 찾기
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
        // 너무 작은 드래그는 무시
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
            {/* 그리드 + 축 + 눈금 라벨 */}
            <g pointerEvents="none" style={{ userSelect: "none", WebkitUserSelect: "none" } as React.CSSProperties}>
              {/* 가로 그리드 + y 라벨 */}
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
                        fontFamily='"D2 coding", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                      >
                        {yLabelFormatter ? yLabelFormatter(v) : v.toFixed(0)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {/* 세로 그리드 + x 라벨 */}
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
                        fontFamily='"D2 coding", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                      >
                        {xLabelFormatter ? xLabelFormatter(t) : new Date(t).toLocaleTimeString()}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {/* 축 선 */}
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
            {/* 면 채우기 */}
            <path
              d={`${path} L ${xScale(maxTs)} ${yScale(minVal)} L ${xScale(minTs)} ${yScale(minVal)} Z`}
              fill={`url(#pace-fill-${uid})`}
              stroke="none"
            />
            {/* 메인 라인 */}
            <path d={path} fill="none" stroke={`url(#pace-stroke-${uid})`} strokeWidth={2} />
            {/* 호버 마커 */}
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

