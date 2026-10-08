import { Box, FileCode2, Info, Map, RefreshCw, RotateCcw, ScrollText, Search, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { bytes, cpuCores, since } from "../../lib/format";
import { Badge, Button, Callout, Card, CardHeader, confirm, cx, Empty, IconButton, Input, Modal, Segmented, Textarea } from "../../components/ui";
import type { Instance, Pod } from "../../lib/types";
import { useLogTarget } from "./LogsTab";

const MAP_ART: Record<string, string> = {
  "Hagga Basin": "linear-gradient(135deg,#7a4a1f,#c8823a 55%,#e8b26a)",
  "Deep Desert": "linear-gradient(135deg,#5b2a12,#a24a1d 50%,#e07b2c)",
  "Overland Map": "linear-gradient(135deg,#2c3e50,#4a6378 50%,#c2a477)",
  Arrakeen: "linear-gradient(135deg,#3b2f4a,#6f5a7e 50%,#d6b98c)",
  "Harko Village": "linear-gradient(135deg,#2a2a2a,#5d4a3a 50%,#b08a5a)",
};

export function MapsTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const setTab = useStore((s) => s.setInstanceTab);
  const setLog = useLogTarget((s) => s.set);
  const bg = pickBattlegroup(inst, tel);
  const pods = tel?.snapshot?.pods ?? [];
  const [scope, setScope] = useState<"bg" | "all">("bg");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "cpu" | "mem" | "restarts">("name");
  const [describe, setDescribe] = useState<{ pod: string; text: string } | null>(null);
  const [specOpen, setSpecOpen] = useState(false);

  const list = useMemo(() => {
    let l = pods.filter((p) => scope === "all" || p.namespace === bg?.namespace);
    if (q) l = l.filter((p) => p.name.includes(q.toLowerCase()) || p.namespace.includes(q.toLowerCase()));
    const key: Record<typeof sort, (p: Pod) => number | string> = { name: (p) => p.name, cpu: (p) => -(p.cpuMilli ?? 0), mem: (p) => -(p.memBytes ?? 0), restarts: (p) => -p.restarts };
    return [...l].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : 1));
  }, [pods, scope, bg?.namespace, q, sort]);

  const totalCpu = list.reduce((a, p) => a + (p.cpuMilli ?? 0), 0);
  const totalMem = list.reduce((a, p) => a + (p.memBytes ?? 0), 0);

  const restartPod = async (p: Pod) => {
    if (!(await confirm({ title: `Restart ${p.name}?`, body: "The pod is deleted and its controller recreates it. Players on this map get disconnected.", danger: true, confirmLabel: "Restart pod" }))) return;
    const r = await api.deletePod(inst, p.namespace, p.name);
    useStore.getState().toast({ kind: r.code === 0 ? "success" : "error", title: r.code === 0 ? "Pod restarting" : "Restart failed", body: (r.stdout || r.stderr).trim() });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={Map}
          title="Map partitions"
          subtitle={bg ? `${bg.servers.length} game servers in ${bg.name}. Partitions start on demand and scale per the battlegroup spec.` : "Waiting for battlegroup data"}
          actions={
            <Button size="sm" icon={FileCode2} onClick={() => setSpecOpen(true)} disabled={!bg}>
              Edit battlegroup spec
            </Button>
          }
        />
        <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
          {(bg?.servers ?? []).map((s) => {
            const friendly = s.label.replace(/ #\d+$/, "");
            return (
              <div key={`${s.map}${s.partition}`} className="relative overflow-hidden rounded-2xl border border-white/[0.07]">
                <div className="absolute inset-0 opacity-40" style={{ background: MAP_ART[friendly] ?? "linear-gradient(135deg,#3a2a1d,#7a5a3a)" }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/10" />
                <div className="relative p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-display text-[16px] font-semibold text-white">{friendly}</div>
                      <div className="font-mono text-[11px] text-white/60">
                        {s.map} · partition {s.partition ?? "?"}
                      </div>
                    </div>
                    <Badge color={s.ready ? "#34d399" : "#f5b83d"}>{s.ready ? "Ready" : s.phase || "Pending"}</Badge>
                  </div>
                  <div className="mt-6 flex items-end justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                        <Users className="size-3" /> players
                      </div>
                      <div className="font-display text-[26px] leading-none font-semibold text-white tabular-nums">{s.players ?? "—"}</div>
                    </div>
                    <div className="text-right text-[11px] text-white/60">
                      up {since(s.start)}
                      {s.partition != null && (
                        <div className="font-mono">
                          UDP {7777 + s.partition} · IGW {7888 + s.partition}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {bg && bg.servers.length === 0 && <div className="col-span-full py-8 text-center text-[13px] text-sand-500">{bg.stop ? "Battlegroup is stopped. No map servers running." : "No map servers reported yet."}</div>}
        </div>
        <div className="px-4 pb-4">
          <Callout kind="info" icon={Info}>
            Port numbers follow Funcom’s defaults (game port 7777 + n, IGW = game port + 111). The exact assignment can differ if you changed <span className="font-mono">Port</span>/<span className="font-mono">IGWPort</span>.
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={Box}
          title="Kubernetes pods"
          subtitle={`${list.length} pods · ${cpuCores(totalCpu)} · ${bytes(totalMem)}`}
          actions={
            <>
              <Segmented value={scope} onChange={setScope} options={[{ value: "bg", label: "Battlegroup" }, { value: "all", label: "All namespaces" }]} />
              <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pods" className="w-48" />
            </>
          }
        />
        {list.length === 0 ? (
          <Empty icon={Box} title="No pods" body={tel?.error ?? "Nothing reported yet."} />
        ) : (
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] tracking-wider text-sand-500 uppercase">
                  {(
                    [
                      ["name", "Pod"],
                      [null, "Status"],
                      ["restarts", "Restarts"],
                      ["cpu", "CPU"],
                      ["mem", "Memory"],
                      [null, "Age"],
                      [null, ""],
                    ] as const
                  ).map(([k, l], i) => (
                    <th key={i} className="px-3 py-2 font-medium">
                      {k ? (
                        <button onClick={() => setSort(k)} className={cx("uppercase", sort === k && "text-[var(--accent-2)]")}>
                          {l}
                        </button>
                      ) : (
                        l
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const bad = /crash|error|backoff|oom/i.test(p.reason);
                  return (
                    <tr key={p.namespace + p.name} className="group border-t border-white/[0.04] hover:bg-white/[0.025]">
                      <td className="max-w-[360px] px-3 py-2">
                        <div className="truncate font-mono text-[12px] text-sand-100">{p.name}</div>
                        {scope === "all" && <div className="truncate font-mono text-[10.5px] text-sand-500">{p.namespace}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cx("inline-flex items-center gap-1.5", bad ? "text-[#ff8a87]" : p.phase === "Running" && p.ready.includes("true") ? "text-ok" : "text-warn")}>
                          <span className="size-1.5 rounded-full bg-current" />
                          {p.reason || p.phase}
                        </span>
                      </td>
                      <td className={cx("px-3 py-2 font-mono tabular-nums", p.restarts > 0 ? "text-warn" : "text-sand-400")}>{p.restarts}</td>
                      <td className="px-3 py-2 font-mono text-sand-300 tabular-nums">{cpuCores(p.cpuMilli)}</td>
                      <td className="px-3 py-2 font-mono text-sand-300 tabular-nums">{bytes(p.memBytes)}</td>
                      <td className="px-3 py-2 text-sand-400">{since(p.start)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                          <IconButton
                            icon={ScrollText}
                            label="Logs"
                            size="sm"
                            onClick={() => {
                              setLog(inst.id, p.namespace, p.name);
                              setTab(inst.id, "logs");
                            }}
                          />
                          <IconButton
                            icon={Info}
                            label="Describe"
                            size="sm"
                            onClick={async () => {
                              const r = await api.describePod(inst, p.namespace, p.name);
                              setDescribe({ pod: p.name, text: r.stdout || r.stderr });
                            }}
                          />
                          <IconButton icon={RotateCcw} label="Restart pod" size="sm" onClick={() => restartPod(p)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!describe} onClose={() => setDescribe(null)} width={900}>
        <div className="p-6">
          <div className="mb-3 font-display text-lg font-semibold">kubectl describe {describe?.pod}</div>
          <pre className="max-h-[65vh] overflow-auto rounded-xl bg-black/50 p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-sand-200 selectable">{describe?.text}</pre>
        </div>
      </Modal>

      {bg && <SpecEditor open={specOpen} onClose={() => setSpecOpen(false)} inst={inst} ns={bg.namespace} name={bg.name} />}
    </div>
  );
}

function SpecEditor({ open, onClose, inst, ns, name }: { open: boolean; onClose: () => void; inst: Instance; ns: string; name: string }) {
  const [original, setOriginal] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async () => {
    setLoading(true);
    setResult(null);
    try {
      const y = await api.getSpec(inst, ns, name);
      setOriginal(y);
      setText(y);
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setLoading(false);
    }
  };
  const run = async (dry: boolean) => {
    if (!dry && !(await confirm({ title: "Apply battlegroup spec?", body: "The operator reconciles immediately. Invalid resources or memory limits can stop map servers from starting. A dry run is recommended first.", danger: true, confirmLabel: "Apply" })))
      return;
    setLoading(true);
    const r = await api.applySpec(inst, text, dry);
    setResult({ ok: r.code === 0, text: (r.stdout + "\n" + r.stderr).trim() });
    if (!dry && r.code === 0) {
      setOriginal(text);
      useStore.getState().log({ instanceId: inst.id, level: "info", kind: "config", message: "Battlegroup spec replaced" });
    }
    setLoading(false);
  };
  return (
    <Modal open={open} onClose={onClose} width={1000}>
      <div className="flex max-h-[88vh] flex-col p-6" onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <FileCode2 className="size-5 text-[var(--accent)]" />
          <div className="flex-1">
            <div className="font-display text-lg font-semibold">BattleGroup spec</div>
            <div className="font-mono text-[12px] text-sand-500">
              {ns}/{name}
            </div>
          </div>
          <Button size="sm" icon={RefreshCw} onClick={load} loading={loading}>
            {original ? "Reload" : "Load from cluster"}
          </Button>
        </div>
        <Callout kind="warn" icon={ShieldCheck} className="mt-4">
          Per-map server counts, resource limits and launch arguments live here. Changes in the Director web UI don’t persist; this spec does. Download a backup first. Backups include this YAML automatically.
        </Callout>
        <Textarea mono value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="mt-4 min-h-[380px] flex-1 text-[12px]" placeholder="Click “Load from cluster” to fetch the current spec" />
        {result && (
          <pre className={cx("mt-3 max-h-32 overflow-auto rounded-lg p-3 font-mono text-[11.5px] whitespace-pre-wrap", result.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-[#ff9e9b]")}>{result.text}</pre>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-[12px] text-sand-500">{text !== original ? "Unsaved changes" : ""}</span>
          <Button variant="ghost" onClick={() => setText(original)} disabled={text === original}>
            Revert
          </Button>
          <Button onClick={() => run(true)} disabled={!text || loading}>
            Dry run
          </Button>
          <Button variant="primary" onClick={() => run(false)} disabled={!text || text === original || loading}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
