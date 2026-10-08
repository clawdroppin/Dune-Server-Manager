import { InviteCard } from "./InviteCard";
import { CheckCircle2, CircleDashed, Cpu, Database, Download, HardDrive, MemoryStick, Monitor, Network, Power, Radar, Route, ServerCog, StickyNote, Users, XCircle } from "lucide-react";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { demoVm } from "../../lib/demo";
import { updateInstance } from "../../lib/actions";
import { AreaChart } from "../../components/charts";
import { Badge, Button, Callout, Card, CardHeader, cx, Meter, Stat, Textarea } from "../../components/ui";
import { bytes, duration, pct, rate } from "../../lib/format";
import type { Instance } from "../../lib/types";
import { useRemoteBuild } from "./InstanceView";
import { confirm } from "../../components/ui";

function phaseTone(p: string): "ok" | "warn" | "bad" | "idle" {
  if (!p) return "idle";
  if (/ready|running|healthy|available|succeeded/i.test(p)) return "ok";
  if (/fail|error|crash|degraded/i.test(p)) return "bad";
  if (/stop/i.test(p)) return "idle";
  return "warn";
}

export function ComponentRow({ icon: Icon, label, phase }: { icon: React.ElementType; label: string; phase: string }) {
  const t = phaseTone(phase);
  const col = { ok: "#34d399", warn: "#f5b83d", bad: "#ef5350", idle: "#8b7d70" }[t];
  const I = t === "ok" ? CheckCircle2 : t === "bad" ? XCircle : CircleDashed;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2.5">
      <Icon className="size-4 text-sand-400" />
      <span className="flex-1 text-[13px] text-sand-200">{label}</span>
      <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: col }}>
        <I className="size-3.5" />
        {phase || "—"}
      </span>
    </div>
  );
}

export function OverviewTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const vms = useStore((s) => s.vms);
  const updateInst = useStore((s) => s.updateInstance);
  const setTab = useStore((s) => s.setInstanceTab);
  const snap = tel?.snapshot;
  const bg = pickBattlegroup(inst, tel);
  const h = tel?.history ?? [];
  const times = h.map((s) => s.t);
  const vm = inst.mode === "demo" ? demoVm(inst) : vms.find((v) => v.name === inst.vmName);
  const remote = useRemoteBuild(inst.appId);
  const memUsed = snap ? snap.vm.memTotal - snap.vm.memAvailable : null;
  const memPct = snap?.vm.memTotal ? (memUsed! / snap.vm.memTotal) * 100 : null;
  const diskPct = snap?.vm.diskTotal ? (snap.vm.diskUsed / snap.vm.diskTotal) * 100 : null;

  const vmAct = async (action: string, label: string, danger = false) => {
    if (danger && !(await confirm({ title: `${label}?`, body: "Every map server inside the VM goes down with it.", danger: true, confirmLabel: label }))) return;
    try {
      await api.vmAction(inst, action);
      useStore.getState().toast({ kind: "success", title: `VM: ${label}` });
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: `VM ${label} failed`, body: String(e) });
    }
  };

  return (
    <div className="space-y-5">
      {tel?.error && (
        <Callout kind="error" icon={XCircle} title="Can't read battlegroup state">
          <span className="font-mono text-[12px] break-all">{tel.error}</span>
          <div className="mt-2">
            <Button size="sm" onClick={() => setTab(inst.id, "settings")}>
              Check connection settings
            </Button>
          </div>
        </Callout>
      )}
      {!inst.ssh.host && inst.mode === "real" && (
        <Callout kind="warn" icon={Radar} title="Not connected yet">
          Set the VM IP and SSH key under <b>Instance</b> to start monitoring this battlegroup.
        </Callout>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Stat label="Players online" icon={Users} value={bg && !bg.stop ? bg.players : "—"} sub={`peak this session ${tel?.peakPlayers ?? 0}`} />
        </Card>
        <Card className="p-4">
          <Stat label="VM CPU" icon={Cpu} value={pct(snap?.vm.cpu)} sub={snap ? `${snap.vm.cores} vCPU · load ${snap.vm.load1.toFixed(2)}` : "—"} />
          <Meter value={snap?.vm.cpu} className="mt-3" />
        </Card>
        <Card className="p-4">
          <Stat label="VM memory" icon={MemoryStick} value={memUsed != null ? bytes(memUsed) : "—"} sub={snap ? `of ${bytes(snap.vm.memTotal, 0)} · ${pct(memPct)}` : "—"} />
          <Meter value={memPct} className="mt-3" />
        </Card>
        <Card className="p-4">
          <Stat label="VM disk" icon={HardDrive} value={snap ? bytes(snap.vm.diskUsed, 0) : "—"} sub={snap ? `of ${bytes(snap.vm.diskTotal, 0)} · ${pct(diskPct)}` : "—"} />
          <Meter value={diskPct} className="mt-3" />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Users} title="Players" subtitle="Live count from the ServerStats resources, all partitions" />
          <div className="px-4 pb-4">
            <AreaChart times={times} series={[{ key: "p", label: "Players", color: "var(--accent)", values: h.map((s) => s.players) }]} format={(v) => v.toFixed(0)} height={160} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Cpu} title="VM CPU" subtitle="Whole battlegroup VM (all pods)" />
          <div className="px-4 pb-4">
            <AreaChart times={times} series={[{ key: "c", label: "CPU", color: "var(--accent)", values: h.map((s) => s.cpu) }]} max={100} format={(v) => `${v.toFixed(0)}%`} height={160} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={MemoryStick} title="VM memory" subtitle="Used = total minus MemAvailable" />
          <div className="px-4 pb-4">
            <AreaChart times={times} series={[{ key: "m", label: "Memory", color: "var(--accent)", values: h.map((s) => s.mem) }]} max={100} format={(v) => `${v.toFixed(0)}%`} height={160} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Network} title="VM bandwidth" subtitle="Physical interfaces (CNI/veth excluded)" />
          <div className="px-4 pb-4">
            <AreaChart
              times={times}
              series={[
                { key: "rx", label: "Inbound", color: "var(--series-rx)", values: h.map((s) => s.rx) },
                { key: "tx", label: "Outbound", color: "var(--series-tx)", values: h.map((s) => s.tx) },
              ]}
              format={rate}
              height={136}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader icon={ServerCog} title="Battlegroup components" subtitle={bg ? `${bg.name} · ${bg.phase || "unknown"}` : "No battlegroup discovered"} />
          <div className="space-y-2 px-4 pb-4">
            <ComponentRow icon={Database} label="World database (PostgreSQL)" phase={bg?.databasePhase ?? ""} />
            <ComponentRow icon={Radar} label="Battlegroup Director" phase={bg?.directorPhase ?? ""} />
            <ComponentRow icon={Route} label="Server gateway" phase={bg?.gatewayPhase ?? ""} />
            <ComponentRow icon={ServerCog} label="Server group" phase={bg?.serverGroupPhase || (bg ? (bg.stop ? "Stopped" : bg.phase) : "")} />
            <div className="grid grid-cols-3 gap-2 pt-1">
              {(bg?.servers ?? []).map((s) => (
                <div key={`${s.map}${s.partition}`} className={cx("rounded-lg border px-2 py-1.5 text-[11px]", s.ready ? "border-ok/25 bg-ok/[0.06]" : "border-white/[0.06] bg-black/20")}>
                  <div className="truncate font-medium text-sand-200">{s.label}</div>
                  <div className="flex justify-between text-sand-500">
                    <span>{s.ready ? "ready" : s.phase || "…"}</span>
                    <span className="tabular-nums">{s.players ?? 0}p</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={Monitor}
            title="Hyper-V virtual machine"
            subtitle={vm ? `${vm.name} · ${vm.processorCount} vCPU` : inst.vmName ? `"${inst.vmName}" not visible. Run as admin?` : "No VM linked"}
            actions={vm && <Badge color={vm.state === "Running" ? "#34d399" : "#8b7d70"}>{vm.state}</Badge>}
          />
          <div className="space-y-3 px-4 pb-4">
            {vm ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <div className="text-sand-500">Assigned RAM</div>
                    <div className="font-mono text-sand-100">{bytes(vm.memoryAssigned, 1)}</div>
                  </div>
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <div className="text-sand-500">Memory demand</div>
                    <div className="font-mono text-sand-100">{bytes(vm.memoryDemand, 1)}</div>
                  </div>
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <div className="text-sand-500">Host CPU share</div>
                    <div className="font-mono text-sand-100">{vm.cpuUsage}%</div>
                  </div>
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <div className="text-sand-500">Uptime</div>
                    <div className="font-mono text-sand-100">{duration(vm.uptime)}</div>
                  </div>
                </div>
                <div className="truncate text-[11.5px] text-sand-500" title={vm.disks.join("\n")}>
                  {vm.ips.join(", ") || "no IPv4 reported"} · {vm.switches.join(", ")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {vm.state !== "Running" ? (
                    <Button size="sm" variant="subtle" icon={Power} onClick={() => vmAct("start", "Start VM")}>
                      Start VM
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" icon={Power} onClick={() => vmAct("stop", "Shut down VM", true)}>
                        Shut down
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => vmAct("save", "Save state", true)}>
                        Save state
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => vmAct("checkpoint", "Checkpoint")}>
                    Checkpoint
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-[12.5px] leading-relaxed text-sand-400">Hyper-V data needs the app to run as Administrator or as a member of “Hyper-V Administrators”. Battlegroup monitoring over SSH works either way.</div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader icon={Download} title="Server build" subtitle={`Steam app ${inst.appId} (${inst.branch === "ptc" ? "PTC" : "Live"})`} />
          <div className="space-y-3 px-4 pb-4">
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="rounded-xl bg-black/20 px-3 py-2">
                <div className="text-sand-500">Installed in VM</div>
                <div className="font-mono text-sand-100">{snap?.buildId ?? "—"}</div>
              </div>
              <div className="rounded-xl bg-black/20 px-3 py-2">
                <div className="text-sand-500">Latest on Steam</div>
                <div className="font-mono text-sand-100">{remote ?? "—"}</div>
              </div>
            </div>
            {remote && snap?.buildId && remote !== snap.buildId ? (
              <Callout kind="info" icon={Download} title="Update available">
                Game clients update automatically, and mismatched builds can’t join. Update soon after Steam patches.
                <div className="mt-2">
                  <Button size="sm" variant="primary" icon={Download} onClick={() => updateInstance(inst)}>
                    Update now
                  </Button>
                </div>
              </Callout>
            ) : (
              <div className="text-[12.5px] text-sand-400">{snap?.buildId && remote ? "Up to date with Steam." : "Waiting for build information…"}</div>
            )}
            <div className="flex items-center gap-2 text-[12px] text-sand-500">
              <StickyNote className="size-3.5" /> Notes
            </div>
            <Textarea rows={3} value={inst.notes} onChange={(e) => updateInst(inst.id, { notes: e.target.value })} placeholder="Admin notes, wipe plans, Discord invite…" />
          </div>
        </Card>
      </div>
      <InviteCard inst={inst} />
    </div>
  );
}
