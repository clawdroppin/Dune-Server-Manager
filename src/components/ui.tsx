import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { create } from "zustand";
import React, { useEffect, useRef, useState } from "react";
import type { Health } from "../lib/types";
import { HEALTH_META } from "../lib/health";

export const cx = clsx;

// ------------------------------------------------------------------ Button
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: React.ElementType; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "relative inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-all duration-150 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-0",
        "disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97]",
        size === "sm" && "h-8 px-3 text-[12.5px]",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" && "accent-bg text-[#1a0f05] shadow-[0_6px_24px_-6px_var(--accent-glow)] hover:brightness-110",
        variant === "secondary" && "bg-white/[0.055] text-sand-100 border border-white/[0.07] hover:bg-white/[0.09] hover:border-white/[0.12]",
        variant === "ghost" && "text-sand-300 hover:text-sand-100 hover:bg-white/[0.06]",
        variant === "subtle" && "bg-[var(--accent-soft)] text-[var(--accent-2)] hover:brightness-125",
        variant === "danger" && "bg-bad/15 text-[#ff8a87] border border-bad/25 hover:bg-bad/25",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className={size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, active, className, size = "md", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ElementType; label: string; active?: boolean; size?: "sm" | "md" }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40",
        size === "sm" ? "size-7" : "size-8",
        active ? "bg-[var(--accent-soft)] text-[var(--accent-2)]" : "text-sand-400 hover:text-sand-100 hover:bg-white/[0.07]",
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </button>
  );
}

// ------------------------------------------------------------------ Card
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("glass rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ icon: Icon, title, subtitle, actions, className }: { icon?: React.ElementType; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start gap-3 px-5 pt-4 pb-3", className)}>
      {Icon && (
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-2)]">
          <Icon className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] font-semibold tracking-tight text-sand-50">{title}</div>
        {subtitle && <div className="mt-0.5 text-[12.5px] text-sand-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Status
export function StatusDot({ color, pulse, className }: { color: string; pulse?: boolean; className?: string }) {
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", pulse && "pulse-dot", className)} style={{ background: color, color }} />;
}

export function StatusPill({ health, className, compact }: { health: Health; className?: string; compact?: boolean }) {
  const m = HEALTH_META[health];
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full border font-medium", compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs", className)}
      style={{ color: m.color, borderColor: `${m.color}38`, background: `${m.color}14` }}
    >
      <StatusDot color={m.color} pulse={m.pulse} className="size-1.5" />
      {m.label}
    </span>
  );
}

export function Badge({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", !color && "bg-white/[0.06] text-sand-300", className)}
      style={color ? { color, background: `${color}1c`, boxShadow: `inset 0 0 0 1px ${color}30` } : undefined}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-sand-300">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-sand-400", className)} />;
}

// ------------------------------------------------------------------ Form controls
export function Toggle({ checked, onChange, disabled, size = "md" }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        sm ? "h-[18px] w-8" : "h-[22px] w-10",
        checked ? "bg-[var(--accent)] shadow-[0_0_14px_-2px_var(--accent-glow)]" : "bg-white/[0.12]",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 35 }}
        className={cx("absolute top-[3px] rounded-full bg-white shadow", sm ? "size-3" : "size-4")}
        style={{ left: checked ? (sm ? 17 : 21) : 3 }}
      />
    </button>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 text-[13px] text-sand-50 placeholder:text-sand-500 outline-none transition focus:border-[var(--accent)]/60 focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ElementType; mono?: boolean }>(
  ({ className, icon: Icon, mono, ...rest }, ref) => (
    <div className={cx("relative", className)}>
      {Icon && <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sand-500" />}
      <input ref={ref} {...rest} className={cx(inputCls, "h-9", Icon && "pl-9", mono && "font-mono text-[12.5px]")} />
    </div>
  ),
);

export function Textarea({ className, mono, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return <textarea {...rest} className={cx(inputCls, "py-2 leading-relaxed", mono && "font-mono text-[12.5px]", className)} />;
}

export function Select({ value, onChange, options, className, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputCls, "h-9 cursor-pointer appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a98c69%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-sand-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-5 flex-1 cursor-pointer" style={{ ["--fill" as any]: `${fill}%` }} />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
        className={cx(inputCls, "h-8 w-20 px-2 text-right font-mono text-[12px]")}
        title={format?.(value)}
      />
    </div>
  );
}

export function Field({ label, hint, children, className, inline }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; inline?: boolean }) {
  if (inline)
    return (
      <div className={cx("flex items-center justify-between gap-6 py-2.5", className)}>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-sand-100">{label}</div>
          {hint && <div className="mt-0.5 text-[12px] leading-snug text-sand-400">{hint}</div>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  return (
    <label className={cx("block", className)}>
      <div className="mb-1.5 text-[12px] font-medium tracking-wide text-sand-300">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[11.5px] leading-snug text-sand-500">{hint}</div>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; icon?: React.ElementType }[]; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-xl border border-white/[0.07] bg-black/25 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("relative flex h-7 items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-medium transition-colors", value === o.value ? "text-sand-50" : "text-sand-400 hover:text-sand-200")}
        >
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join("")}`} className="absolute inset-0 rounded-[10px] bg-white/[0.09] shadow-inner" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          {o.icon && <o.icon className="relative size-3.5" />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Modal
export function Modal({ open, onClose, children, width = 560, className, dismissable = true }: { open: boolean; onClose: () => void; children: React.ReactNode; width?: number; className?: string; dismissable?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && dismissable && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose, dismissable]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={() => dismissable && onClose()} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className={cx("glass-strong relative max-h-[88vh] w-full overflow-hidden rounded-3xl", className)}
            style={{ maxWidth: width }}
          >
            {dismissable && <IconButton icon={X} label="Close" onClick={onClose} className="absolute top-4 right-4 z-10" />}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ Confirm (promise API)
interface ConfirmReq {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  typeToConfirm?: string;
  resolve: (v: boolean) => void;
}
const useConfirm = create<{ req: ConfirmReq | null; set: (r: ConfirmReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirm(opts: Omit<ConfirmReq, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirm.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirm();
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTyped("");
    if (req?.typeToConfirm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [req]);
  const close = (v: boolean) => {
    req?.resolve(v);
    set(null);
  };
  const ok = !req?.typeToConfirm || typed === req.typeToConfirm;
  return (
    <Modal open={!!req} onClose={() => close(false)} width={460}>
      {req && (
        <div className="p-6">
          <div className="font-display text-lg font-semibold text-sand-50">{req.title}</div>
          {req.body && <div className="mt-2 text-[13.5px] leading-relaxed text-sand-300">{req.body}</div>}
          {req.typeToConfirm && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs text-sand-400">
                Type <span className="font-mono text-sand-100">{req.typeToConfirm}</span> to confirm
              </div>
              <Input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} mono onKeyDown={(e) => e.key === "Enter" && ok && close(true)} />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={req.danger ? "danger" : "primary"} disabled={!ok} onClick={() => close(true)} autoFocus={!req.typeToConfirm}>
              {req.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Misc
export function Empty({ icon: Icon, title, body, action }: { icon: React.ElementType; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4 grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-2)]">
        <Icon className="size-6" />
      </div>
      <div className="font-display text-[15px] font-semibold text-sand-100">{title}</div>
      {body && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-sand-400">{body}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ElementType; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-sand-400 uppercase">
        {Icon && <Icon className="size-3.5" style={accent ? { color: accent } : undefined} />}
        {label}
      </div>
      <div className="mt-1 truncate font-display text-[22px] font-semibold tracking-tight text-sand-50 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-sand-400">{sub}</div>}
    </div>
  );
}

export function Meter({ value, color = "var(--accent)", className }: { value: number | null | undefined; color?: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const c = v > 90 ? "#ef5350" : v > 75 ? "#f5b83d" : color;
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <motion.div className="h-full rounded-full" style={{ background: c }} initial={false} animate={{ width: `${v}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 6, color, children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const col = color ?? (v >= 85 ? "#34d399" : v >= 60 ? "#f5b83d" : "#ef5350");
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,226,190,0.08)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={col}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
          style={{ filter: `drop-shadow(0 0 6px ${col}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="text-[11.5px] font-semibold tracking-[0.08em] text-sand-400 uppercase">{children}</div>
      {right}
    </div>
  );
}

export function Callout({ kind = "info", icon: Icon, title, children, className }: { kind?: "info" | "warn" | "error" | "success"; icon?: React.ElementType; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const col = { info: "#60a5fa", warn: "#f5b83d", error: "#ef5350", success: "#34d399" }[kind];
  return (
    <div className={cx("flex gap-3 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed", className)} style={{ borderColor: `${col}30`, background: `${col}0d` }}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" style={{ color: col }} />}
      <div className="min-w-0 text-sand-200">
        {title && <div className="mb-0.5 font-semibold text-sand-50">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: (text: string, key = text) => {
      navigator.clipboard?.writeText(text).catch(() => {});
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    },
  };
}
