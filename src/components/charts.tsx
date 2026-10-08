import { useEffect, useMemo, useRef, useState } from "react";
import { clock } from "../lib/format";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * p;
}

function path(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let pen = false;
  vals.forEach((v, i) => {
    if (v == null || !isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/**
 * Time-series area/line chart: recessive grid, 2px lines, single y-axis, crosshair + tooltip on hover.
 * Up to two series (validated pair) with a legend; one series gets no legend box.
 */
export function AreaChart({
  times,
  series,
  height = 150,
  max,
  format = (v) => v.toFixed(0),
  showLegend = true,
}: {
  times: number[];
  series: Series[];
  height?: number;
  max?: number;
  format?: (v: number) => string;
  showLegend?: boolean;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 44;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const n = times.length;
  const dataMax = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null && isFinite(v)))), [series]);
  const yMax = max ?? niceMax(dataMax * 1.15 || 1);
  const w = Math.max(10, width - padL - padR);
  const h = height - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? w : (i / (n - 1)) * w);
  const y = (v: number) => padT + h - (Math.min(v, yMax) / yMax) * h;
  const ticks = [0, 0.5, 1].map((f) => f * yMax);
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - padL;
    if (n < 2) return;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / w) * (n - 1)))));
  };

  return (
    <div ref={ref} className="relative w-full select-none">
      {showLegend && series.length > 1 && (
        <div className="mb-2 flex items-center gap-4 text-[11.5px] text-sand-300">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-3.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {width > 0 && (
        <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block overflow-visible" role="img" aria-label={series.map((s) => s.label).join(", ")}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={series.length > 1 ? 0.16 : 0.28} />
                <stop offset="1" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke="rgba(255,226,190,0.06)" strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-sand-500 font-mono text-[10px]">
                {format(t)}
              </text>
            </g>
          ))}
          {n > 1 && (
            <>
              <text x={padL} y={height - 3} className="fill-sand-500 text-[10px]">
                {clock(times[0])}
              </text>
              <text x={padL + w} y={height - 3} textAnchor="end" className="fill-sand-500 text-[10px]">
                {clock(times[n - 1])}
              </text>
            </>
          )}
          {series.map((s, i) => {
            const line = path(s.values, x, y);
            const firstIdx = s.values.findIndex((v) => v != null);
            const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
            const area = line && firstIdx >= 0 ? `${line}L${x(lastIdx)},${y(0)}L${x(firstIdx)},${y(0)}Z` : "";
            return (
              <g key={s.key}>
                {area && <path d={area} fill={`url(#${gid}-${i})`} />}
                <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + h} stroke="rgba(255,236,210,0.25)" />
              {series.map((s) =>
                s.values[hover] != null ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null,
              )}
            </g>
          )}
        </svg>
      )}
      {hover != null && width > 0 && (
        <div
          className="glass-strong pointer-events-none absolute z-10 rounded-lg px-2.5 py-1.5 text-[11.5px] shadow-xl"
          style={{ left: Math.min(Math.max(x(hover) + 10, 0), width - 150), top: 4 + (showLegend && series.length > 1 ? 22 : 0) }}
        >
          <div className="mb-0.5 text-sand-400">{clock(times[hover])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-sand-100">
              <span className="h-[3px] w-3 rounded-full" style={{ background: s.color }} />
              <span className="text-sand-300">{s.label}</span>
              <span className="ml-auto pl-3 font-mono tabular-nums">{s.values[hover] != null ? format(s.values[hover]!) : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact non-interactive trend line for cards and tiles. */
export function Sparkline({ values, color = "var(--accent)", height = 32, max }: { values: (number | null)[]; color?: string; height?: number; max?: number }) {
  const [ref, width] = useWidth();
  const clean = values.filter((v): v is number => v != null && isFinite(v));
  const m = max ?? Math.max(1, ...clean) * 1.1;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width : (i / (n - 1)) * width);
  const y = (v: number) => 2 + (height - 4) * (1 - Math.min(v, m) / m);
  const d = path(values, x, y);
  const gid = useMemo(() => `sp${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && d && (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.25} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${d}L${x(n - 1)},${height}L${x(values.findIndex((v) => v != null))},${height}Z`} fill={`url(#${gid})`} />
          <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
