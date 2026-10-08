import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { cx } from "./ui";

export type MenuItem =
  | { label: string; icon?: React.ElementType; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { separator: true }
  | { header: string }
  | { swatches: string[]; value?: string; onPick: (c: string) => void };

const useMenu = create<{ x: number; y: number; items: MenuItem[] | null; show: (x: number, y: number, items: MenuItem[]) => void; hide: () => void }>((set) => ({
  x: 0,
  y: 0,
  items: null,
  show: (x, y, items) => set({ x, y, items }),
  hide: () => set({ items: null }),
}));

export function openMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const fromButton = e.type === "click";
  useMenu.getState().show(fromButton ? r.left : e.clientX, fromButton ? r.bottom + 4 : e.clientY, items);
}

export function MenuHost() {
  const { x, y, items, hide } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    if (!ref.current) return setPos({ x, y });
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y, items]);
  useEffect(() => {
    if (!items) return;
    const close = () => hide();
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [items, hide]);
  return (
    <AnimatePresence>
      {items && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="glass-strong fixed z-[60] min-w-[200px] origin-top-left rounded-xl p-1 shadow-2xl"
          style={{ left: pos.x, top: pos.y }}
        >
          {items.map((it, i) => {
            if ("separator" in it) return <div key={i} className="my-1 h-px bg-white/[0.07]" />;
            if ("header" in it) return <div key={i} className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wider text-sand-500 uppercase">{it.header}</div>;
            if ("swatches" in it)
              return (
                <div key={i} className="flex gap-1.5 px-2.5 py-1.5">
                  {it.swatches.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        it.onPick(c);
                        hide();
                      }}
                      className={cx("size-5 rounded-full ring-offset-2 ring-offset-[#1e1915] transition hover:scale-110", it.value === c && "ring-2 ring-white/70")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              );
            const Icon = it.icon;
            return (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  hide();
                  it.onClick();
                }}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40",
                  it.danger ? "text-[#ff8a87] hover:bg-bad/15" : "text-sand-200 hover:bg-white/[0.07] hover:text-sand-50",
                )}
              >
                {Icon ? <Icon className="size-3.5 shrink-0 opacity-80" /> : <span className="w-3.5" />}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-[11px] text-sand-500">{it.hint}</span>}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
