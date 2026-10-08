import { ArrowDownToLine, Download, Eraser, Pause, Play, ScrollText, Search, WrapText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { onStream, streamId } from "../../lib/tauri";
import { Badge, Button, Card, cx, IconButton, Input, Select } from "../../components/ui";
import type { Instance } from "../../lib/types";

export const useLogTarget = create<{ targets: Record<string, { ns: string; pod: string }>; set: (inst: string, ns: string, pod: string) => void }>((set) => ({
  targets: {},
  set: (inst, ns, pod) => set((s) => ({ targets: { ...s.targets, [inst]: { ns, pod } } })),
}));

const MAX = 5000;

function lineClass(l: string) {
  if (/\b(error|fatal|exception|crash|failed)\b/i.test(l)) return "text-[#ff9e9b]";
  if (/\bwarn(ing)?\b/i.test(l)) return "text-[#f5cf7a]";
  if (/join succeeded|login|connected/i.test(l)) return "text-[#8fe3bf]";
  return "text-sand-200";
}

export function LogsTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const bg = pickBattlegroup(inst, tel);
  const target = useLogTarget((s) => s.targets[inst.id]);
  const setTarget = useLogTarget((s) => s.set);
  const pods = useMemo(() => (tel?.snapshot?.pods ?? []).filter((p) => p.namespace === bg?.namespace || p.namespace.startsWith("funcom")), [tel?.snapshot?.pods, bg?.namespace]);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [stick, setStick] = useState(true);
  const [tail, setTail] = useState("400");
  const [live, setLive] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const buf = useRef<string[]>([]);

  // Default to the busiest game server pod.
  useEffect(() => {
    if (target || pods.length === 0) return;
    const game = pods.find((p) => /survival|sg-|server/i.test(p.name)) ?? pods[0];
    setTarget(inst.id, game.namespace, game.name);
  }, [pods.length, target, inst.id]);

  useEffect(() => {
    if (!target) return;
    setLines([]);
    buf.current = [];
    const id = streamId("logs");
    let flush: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (pausedRef.current || buf.current.length === 0) return;
      const add = buf.current;
      buf.current = [];
      setLines((l) => (l.length + add.length > MAX ? [...l, ...add].slice(-MAX) : [...l, ...add]));
    }, 150);
    const un = onStream(
      id,
      (l) => {
        buf.current.push(l);
        if (buf.current.length > MAX) buf.current = buf.current.slice(-MAX);
      },
      () => setLive(false),
    );
    setLive(true);
    api.logsStream(inst, target.ns, target.pod, Number(tail), true, id).catch((e) => {
      buf.current.push(`[error] ${e}`);
      setLive(false);
    });
    return () => {
      un();
      api.killStream(id);
      if (flush) clearInterval(flush);
      flush = null;
    };
  }, [target?.ns, target?.pod, tail, inst.id]);

  useEffect(() => {
    if (stick && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, stick]);

  const shown = useMemo(() => {
    if (!filter) return lines;
    try {
      const re = new RegExp(filter, "i");
      return lines.filter((l) => re.test(l));
    } catch {
      const f = filter.toLowerCase();
      return lines.filter((l) => l.toLowerCase().includes(f));
    }
  }, [lines, filter]);

  const errors = useMemo(() => lines.filter((l) => /\b(error|fatal|exception)\b/i.test(l)).length, [lines]);

  const exportLogs = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${target?.pod ?? "logs"}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="flex h-[calc(100vh-290px)] min-h-[460px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-3">
        <ScrollText className="size-4 text-[var(--accent)]" />
        <Select
          value={target ? `${target.ns}|${target.pod}` : ""}
          onChange={(v) => {
            const [ns, pod] = v.split("|");
            setTarget(inst.id, ns, pod);
          }}
          options={[{ value: "", label: pods.length ? "Select a pod" : "No pods available" }, ...pods.map((p) => ({ value: `${p.namespace}|${p.name}`, label: p.name }))]}
          className="w-[320px]"
        />
        <Select value={tail} onChange={setTail} options={["100", "400", "1000", "5000"].map((v) => ({ value: v, label: `last ${v}` }))} className="w-[110px]" />
        <Input icon={Search} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter (regex)" className="w-56" mono />
        <div className="flex-1" />
        {live ? <Badge color="#34d399">● live</Badge> : <Badge>stopped</Badge>}
        {errors > 0 && <Badge color="#ef5350">{errors} errors</Badge>}
        <IconButton icon={paused ? Play : Pause} label={paused ? "Resume" : "Pause"} active={paused} onClick={() => setPaused(!paused)} />
        <IconButton icon={WrapText} label="Wrap lines" active={wrap} onClick={() => setWrap(!wrap)} />
        <IconButton icon={ArrowDownToLine} label="Stick to bottom" active={stick} onClick={() => setStick(!stick)} />
        <IconButton icon={Eraser} label="Clear" onClick={() => setLines([])} />
        <Button size="sm" variant="ghost" icon={Download} onClick={exportLogs} disabled={!lines.length}>
          Export
        </Button>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          if (atBottom !== stick) setStick(atBottom);
        }}
        className="min-h-0 flex-1 overflow-auto bg-black/40 px-4 py-3 font-mono text-[11.5px] leading-[1.6] selectable"
      >
        {shown.length === 0 && <div className="text-sand-600">{target ? "Waiting for log output…" : "Pick a pod to tail its logs."}</div>}
        {shown.map((l, i) => (
          <div key={i} className={cx(lineClass(l), wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre")}>
            {l}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t hairline px-4 py-1.5 text-[11px] text-sand-500">
        <span>
          {shown.length.toLocaleString()} / {lines.length.toLocaleString()} lines{paused && " · paused (buffering)"}
        </span>
        <span className="font-mono">{target ? `${target.ns}/${target.pod}` : ""}</span>
      </div>
    </Card>
  );
}
