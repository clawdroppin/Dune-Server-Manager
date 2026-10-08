import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Archive,
  Bell,
  CheckCircle2,
  CircleX,
  Cog,
  Download,
  Info,
  LayoutDashboard,
  Loader2,
  Play,
  Plus,
  RotateCw,
  Search,
  Server,
  Square,
  Terminal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { useJobs, type Job } from "../lib/jobs";
import { killStream } from "../lib/api";
import { ago, clock, duration } from "../lib/format";
import { restartInstance, startInstance, stopInstance, updateInstance } from "../lib/actions";
import { Button, cx, IconButton, Kbd } from "./ui";
import type { InstanceTab } from "../lib/types";

// ------------------------------------------------------------------ Toasts
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const icon = { info: Info, success: CheckCircle2, error: XCircle, warn: AlertTriangle };
  const color = { info: "#60a5fa", success: "#34d399", error: "#ef5350", warn: "#f5b83d" };
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-[360px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const I = icon[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="glass-strong pointer-events-auto flex gap-3 rounded-2xl p-3.5 pr-2"
              role="status"
            >
              <I className="mt-0.5 size-4.5 shrink-0" style={{ color: color[t.kind] }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-sand-50">{t.title}</div>
                {t.body && <div className="mt-0.5 line-clamp-3 text-[12.5px] leading-snug break-words text-sand-300">{t.body}</div>}
              </div>
              <IconButton icon={X} label="Dismiss" size="sm" onClick={() => dismiss(t.id)} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ Drawer
function Drawer({ open, onClose, title, icon: Icon, children, actions }: { open: boolean; onClose: () => void; title: string; icon: React.ElementType; children: React.ReactNode; actions?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="glass-strong fixed top-12 right-2 bottom-2 z-50 flex w-[520px] flex-col rounded-2xl"
            initial={{ x: 540, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 540, opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <div className="flex items-center gap-2.5 border-b hairline px-5 py-3.5">
              <Icon className="size-4 text-[var(--accent)]" />
              <div className="flex-1 font-display text-[15px] font-semibold">{title}</div>
              {actions}
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ Activity
export function ActivityPanel() {
  const open = useStore((s) => s.activityOpen);
  const setOpen = useStore((s) => s.setActivityOpen);
  const activity = useStore((s) => s.activity);
  const instances = useStore((s) => s.instances);
  const [filter, setFilter] = useState<"all" | "error">("all");
  const items = useMemo(() => [...activity].reverse().filter((a) => filter === "all" || a.level === "error"), [activity, filter]);
  const col = { info: "#60a5fa", warn: "#f5b83d", error: "#ef5350" };
  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Activity"
      icon={Bell}
      actions={
        <div className="mr-1 flex gap-1">
          {(["all", "error"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-md px-2 py-1 text-[11.5px]", filter === f ? "bg-white/10 text-sand-50" : "text-sand-400")}>
              {f === "all" ? "All" : "Errors"}
            </button>
          ))}
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-sand-500">No activity yet. Automation events, crashes, backups and actions appear here.</div>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {items.map((a, i) => (
            <div key={i} className="flex gap-3 px-5 py-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: col[a.level] ?? "#888" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11.5px] text-sand-500">
                  <span className="font-medium text-sand-300">{instances.find((x) => x.id === a.instanceId)?.name ?? "System"}</span>
                  <span>·</span>
                  <span className="uppercase">{a.kind}</span>
                  <span className="ml-auto" title={new Date(a.ts).toLocaleString()}>
                    {ago(a.ts)}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px] leading-snug break-words text-sand-200 selectable">{a.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ Jobs
function JobView({ job, expanded, onToggle }: { job: Job; expanded: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [job.lines.length, expanded]);
  const icon =
    job.status === "running" ? <Loader2 className="size-4 animate-spin text-info" /> : job.status === "ok" ? <CheckCircle2 className="size-4 text-ok" /> : <CircleX className="size-4 text-bad" />;
  return (
    <div className="border-b hairline">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.03]">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-sand-100">{job.title}</div>
          <div className="text-[11.5px] text-sand-500">
            {clock(job.started)} · {job.ended ? duration((job.ended - job.started) / 1000) : "running"} · {job.lines.length} lines
          </div>
        </div>
        {job.status === "running" && job.streamId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              killStream(job.streamId!);
            }}
          >
            Cancel
          </Button>
        )}
      </button>
      {job.progress != null && job.status === "running" && (
        <div className="mx-5 mb-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full accent-bg transition-all" style={{ width: `${job.progress}%` }} />
        </div>
      )}
      {expanded && (
        <div ref={ref} className="mx-4 mb-3 max-h-[360px] overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[11.5px] leading-[1.55] selectable">
          {job.lines.length === 0 && <div className="text-sand-600">Waiting for output…</div>}
          {job.lines.map((l, i) => (
            <div key={i} className={cx("break-all whitespace-pre-wrap", l.err ? "text-[#ff9e9b]" : "text-sand-200")}>
              {l.t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function JobsDrawer() {
  const { jobs, open, focus, setOpen, clearFinished } = useJobs();
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (focus) setExpanded(focus);
  }, [focus]);
  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Operations"
      icon={Terminal}
      actions={
        <Button size="sm" variant="ghost" icon={Trash2} onClick={clearFinished}>
          Clear finished
        </Button>
      }
    >
      {jobs.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-sand-500">Long-running operations (updates, restarts, installs, backups) stream their output here.</div>
      ) : (
        jobs.map((j) => <JobView key={j.id} job={j} expanded={expanded === j.id} onToggle={() => setExpanded(expanded === j.id ? null : j.id)} />)
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ Command palette
interface Cmd {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
  hint?: string;
  run: () => void;
}

function score(q: string, s: string) {
  if (!q) return 1;
  const a = s.toLowerCase();
  const b = q.toLowerCase();
  if (a.includes(b)) return 3 - a.indexOf(b) / 100;
  let i = 0;
  for (const ch of a) if (ch === b[i]) i++;
  return i === b.length ? 1 : 0;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);
  const instances = useStore((s) => s.instances);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const s = useStore.getState();
    const out: Cmd[] = [
      { id: "home", label: "Fleet overview", group: "Navigate", icon: LayoutDashboard, run: () => s.setView({ kind: "home" }) },
      { id: "new", label: "Create new battlegroup", group: "Navigate", icon: Plus, hint: "Ctrl N", run: () => s.setWizard(true) },
      { id: "settings", label: "App settings", group: "Navigate", icon: Cog, run: () => s.setView({ kind: "settings" }) },
      { id: "system", label: "Host & prerequisites check", group: "Navigate", icon: Server, run: () => s.setView({ kind: "system" }) },
      { id: "jobs", label: "Show operations", group: "Navigate", icon: Terminal, run: () => useJobs.getState().setOpen(true) },
      { id: "activity", label: "Show activity feed", group: "Navigate", icon: Bell, run: () => s.setActivityOpen(true) },
    ];
    const tabs: [InstanceTab, string][] = [
      ["overview", "Overview"],
      ["maps", "Maps & pods"],
      ["players", "Players"],
      ["console", "Console"],
      ["logs", "Logs"],
      ["config", "Game settings"],
      ["backups", "Backups"],
      ["automation", "Automation"],
      ["network", "Network"],
      ["integrations", "Discord & webhooks"],
    ];
    for (const i of instances) {
      out.push({ id: `open-${i.id}`, label: `Open ${i.name}`, group: "Servers", icon: Server, run: () => s.openInstance(i.id) });
      out.push({ id: `start-${i.id}`, label: `Start ${i.name}`, group: "Actions", icon: Play, run: () => startInstance(i) });
      out.push({ id: `stop-${i.id}`, label: `Stop ${i.name}`, group: "Actions", icon: Square, run: () => stopInstance(i) });
      out.push({ id: `restart-${i.id}`, label: `Restart ${i.name}`, group: "Actions", icon: RotateCw, run: () => restartInstance(i) });
      out.push({ id: `update-${i.id}`, label: `Update ${i.name}`, group: "Actions", icon: Download, run: () => updateInstance(i) });
      out.push({ id: `backup-${i.id}`, label: `Back up ${i.name}`, group: "Actions", icon: Archive, run: () => s.openInstance(i.id, "backups") });
      for (const [t, l] of tabs) out.push({ id: `tab-${i.id}-${t}`, label: `${i.name} › ${l}`, group: "Jump to", icon: LayoutDashboard, run: () => s.openInstance(i.id, t) });
    }
    return out;
  }, [instances, open]);

  const results = useMemo(
    () =>
      cmds
        .map((c) => ({ c, s: score(q, c.label) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((x) => x.c),
    [cmds, q],
  );

  useEffect(() => {
    setSel(0);
  }, [q, open]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (c?: Cmd) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[65] flex justify-center pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <motion.div initial={{ y: -12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, scale: 0.98 }} className="glass-strong relative h-fit w-[620px] overflow-hidden rounded-2xl">
            <div className="flex items-center gap-3 border-b hairline px-4">
              <Search className="size-4 text-sand-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") (e.preventDefault(), setSel((v) => Math.min(results.length - 1, v + 1)));
                  if (e.key === "ArrowUp") (e.preventDefault(), setSel((v) => Math.max(0, v - 1)));
                  if (e.key === "Enter") run(results[sel]);
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Type a command or server name…"
                className="h-13 flex-1 bg-transparent text-[14.5px] text-sand-50 placeholder:text-sand-500 outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[420px] overflow-y-auto p-1.5">
              {results.length === 0 && <div className="p-6 text-center text-[13px] text-sand-500">No matches</div>}
              {results.map((c, i) => (
                <button
                  key={c.id}
                  data-i={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]", i === sel ? "bg-[var(--accent-soft)] text-sand-50" : "text-sand-300")}
                >
                  <c.icon className={cx("size-4", i === sel ? "text-[var(--accent-2)]" : "text-sand-500")} />
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-[11px] text-sand-500">{c.hint ?? c.group}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
