import { Cpu, ExternalLink, HardDrive, Loader2, MemoryStick, MonitorCog, RefreshCw, ShieldCheck, Network } from "lucide-react";
import { useStore } from "../lib/store";
import * as api from "../lib/api";
import { isTauri } from "../lib/tauri";
import { bytes, duration, rate } from "../lib/format";
import { AreaChart } from "../components/charts";
import { Badge, Button, Card, CardHeader, Meter } from "../components/ui";
import { CheckList, checks, useSystemReport } from "./Wizard";

export function SystemView() {
  const { r, loading, run } = useSystemReport();
  const host = useStore((s) => s.host);
  const hist = useStore((s) => s.hostHistory);
  const vms = useStore((s) => s.vms);
  const passed = r ? checks(r).filter((c) => c.ok).length : 0;
  const total = r ? checks(r).length : 0;
  const tool = (cmd: string) => api.runPowershell(`Start-Process ${cmd}`).catch((e) => useStore.getState().toast({ kind: "error", title: "Couldn't open", body: String(e) }));

  return (
    <div className="mx-auto max-w-[1300px] space-y-5 p-7">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-tight">Host & prerequisites</h1>
          <div className="mt-1 text-[13px] text-sand-400">{r ? `${r.hostname} · ${r.os}` : "Inspecting this machine…"}</div>
        </div>
        <Button icon={RefreshCw} onClick={run} loading={loading}>
          Re-check
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader icon={ShieldCheck} title="Self-hosting readiness" subtitle={r ? `${passed}/${total} checks passed` : undefined} actions={r && <Badge color={passed === total ? "#34d399" : "#f5b83d"}>{passed === total ? "Ready" : "Attention"}</Badge>} />
          <div className="px-5 pb-5">{r ? <CheckList r={r} /> : <Loader2 className="size-6 animate-spin text-sand-400" />}</div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader icon={Cpu} title="Processor" subtitle={r?.cpuModel} />
            <div className="px-5 pb-5">
              <div className="grid grid-cols-8 gap-1.5">
                {(host?.perCore ?? []).map((c, i) => (
                  <div key={i} className="h-12 overflow-hidden rounded-md bg-white/[0.05]" title={`Core ${i}: ${c.toFixed(0)}%`}>
                    <div className="mt-auto h-full origin-bottom rounded-md bg-[var(--accent)] transition-transform duration-500" style={{ transform: `scaleY(${Math.max(0.02, c / 100)})` }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[12px] text-sand-400">
                {r?.cores} cores / {r?.threads} threads · AVX2 {r?.avx2 ? "yes" : "no"} · up {duration(host?.uptime)}
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader icon={MemoryStick} title="Memory" subtitle={host ? `${bytes(host.memUsed)} of ${bytes(host.memTotal, 0)} in use` : undefined} />
            <div className="px-5 pb-5">
              <Meter value={host ? (host.memUsed / host.memTotal) * 100 : 0} className="h-2" />
            </div>
          </Card>
          <Card>
            <CardHeader icon={HardDrive} title="Disks" />
            <div className="space-y-3 px-5 pb-5">
              {r?.disks.map((d) => (
                <div key={d.mount}>
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="font-mono text-sand-200">{d.mount}</span>
                    <span className="text-sand-400">
                      {bytes(d.free, 0)} free of {bytes(d.total, 0)}
                    </span>
                  </div>
                  <Meter value={((d.total - d.free) / d.total) * 100} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Network} title="Host network throughput" />
          <div className="px-5 pb-5">
            <AreaChart
              times={hist.map((s) => s.t)}
              series={[
                { key: "rx", label: "Download", color: "var(--series-rx)", values: hist.map((s) => s.rx) },
                { key: "tx", label: "Upload", color: "var(--series-tx)", values: hist.map((s) => s.tx) },
              ]}
              format={rate}
              height={150}
            />
          </div>
        </Card>
        <Card>
          <CardHeader icon={MonitorCog} title="Hyper-V" subtitle={`${vms.length} virtual machine${vms.length === 1 ? "" : "s"} visible`} />
          <div className="space-y-2 px-5 pb-5">
            {vms.map((v) => (
              <div key={v.name} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2 text-[13px]">
                <span className="flex-1 font-medium">{v.name}</span>
                {v.duneConfidence === "high" && <Badge color="#f08a24">Dune</Badge>}
                <Badge color={v.state === "Running" ? "#34d399" : "#8b7d70"}>{v.state}</Badge>
                <span className="w-20 text-right font-mono text-[12px] text-sand-400">{bytes(v.memoryAssigned, 0)}</span>
              </div>
            ))}
            {vms.length === 0 && <div className="text-[12.5px] text-sand-500">{isTauri ? "None visible (Hyper-V off, or app not elevated)." : "Desktop app only."}</div>}
            {isTauri && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" icon={ExternalLink} onClick={() => tool("virtmgmt.msc")}>
                  Hyper-V Manager
                </Button>
                <Button size="sm" icon={ExternalLink} onClick={() => tool("optionalfeatures.exe")}>
                  Windows Features
                </Button>
                <Button size="sm" icon={ExternalLink} onClick={() => tool("taskmgr.exe")}>
                  Task Manager
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
