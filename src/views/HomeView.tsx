import { useBusy } from "../lib/jobs";
import { motion } from "motion/react";
import { Activity, AlertTriangle, ArrowRight, Cpu, MemoryStick, MoreHorizontal, Network, Play, Plus, Server, Square, Users, Wrench } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "../lib/store";
import { health, healthScore, pickBattlegroup } from "../lib/health";
import { startInstance, stopInstance, toggleMaintenance } from "../lib/actions";
import { AreaChart, Sparkline } from "../components/charts";
import { Badge, Button, Card, CardHeader, confirm, cx, Empty, IconButton, Meter, Ring, SectionTitle, Stat, StatusPill } from "../components/ui";
import { openMenu } from "../components/menu";
import { instanceMenu } from "../components/Sidebar";
import { ago, bytes, pct, rate } from "../lib/format";
import type { Instance } from "../lib/types";

function ServerCard({ inst, i }: { inst: Instance; i: number }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const busy = useBusy(inst.id);
  const openInstance = useStore((s) => s.openInstance);
  const folder = useStore((s) => s.folders.find((f) => f.id === inst.folderId));
  const h = health(inst, tel, busy);
  const bg = pickBattlegroup(inst, tel);
  const vm = tel?.snapshot?.vm;
  const memPct = vm?.memTotal ? (1 - vm.memAvailable / vm.memTotal) * 100 : null;
  const ready = bg?.servers.filter((s) => s.ready).length ?? 0;
  const score = healthScore(inst, tel);
  const players = tel?.history.map((s) => s.players) ?? [];
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <Card className="group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:border-white/[0.14]" onContextMenu={(e) => openMenu(e, instanceMenu(inst))}>
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${folder?.color ?? inst.color}, transparent)` }} />
        <div role="button" tabIndex={0} className="block w-full cursor-pointer p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50" onClick={() => openInstance(inst.id)} onKeyDown={(e) => e.key === "Enter" && openInstance(inst.id)}>
          <div className="flex items-start gap-3">
            <Ring value={score} size={46} stroke={4.5}>
              <span className="font-mono text-[11px] font-semibold text-sand-100">{tel?.snapshot ? score : "–"}</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="truncate font-display text-[15px] font-semibold text-sand-50">{inst.name}</div>
                {inst.mode === "demo" && <Badge color="#60a5fa">DEMO</Badge>}
                {inst.maintenance && <Wrench className="size-3.5 text-warn" />}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <StatusPill health={h} compact />
                <span className="truncate text-[11.5px] text-sand-500">{bg?.title || inst.ssh.host || "not connected"}</span>
              </div>
            </div>
            <IconButton
              icon={MoreHorizontal}
              label="More"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openMenu(e, instanceMenu(inst));
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10.5px] tracking-wider text-sand-500 uppercase">Players</div>
              <div className="font-display text-xl font-semibold tabular-nums">{bg && !bg.stop ? bg.players : "—"}</div>
            </div>
            <div>
              <div className="text-[10.5px] tracking-wider text-sand-500 uppercase">Maps</div>
              <div className="font-display text-xl font-semibold tabular-nums">
                {bg ? ready : "—"}
                <span className="text-sm text-sand-500">/{bg?.servers.length ?? 0}</span>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] tracking-wider text-sand-500 uppercase">Build</div>
              <div className="truncate pt-1 font-mono text-[12.5px] text-sand-300">{tel?.snapshot?.buildId ?? "—"}</div>
            </div>
          </div>

          <div className="mt-3 h-8">
            <Sparkline values={players.slice(-60)} color="var(--accent)" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-sand-400">
            <div>
              <div className="mb-1 flex justify-between">
                <span>VM CPU</span>
                <span className="font-mono text-sand-300">{pct(vm?.cpu)}</span>
              </div>
              <Meter value={vm?.cpu} />
            </div>
            <div>
              <div className="mb-1 flex justify-between">
                <span>VM RAM</span>
                <span className="font-mono text-sand-300">{memPct != null ? `${bytes(vm!.memTotal - vm!.memAvailable, 0)}` : "—"}</span>
              </div>
              <Meter value={memPct} />
            </div>
          </div>
          {tel?.error && <div className="mt-3 truncate rounded-lg bg-bad/10 px-2.5 py-1.5 text-[11.5px] text-[#ff9e9b]" title={tel.error}>{tel.error}</div>}
        </div>
        <div className="flex items-center gap-1.5 border-t hairline px-3 py-2">
          {inst.tags.slice(0, 3).map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
          <div className="flex-1" />
          {bg && !bg.stop ? (
            <Button size="sm" variant="ghost" icon={Square} onClick={() => stopInstance(inst)}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="subtle" icon={Play} onClick={() => startInstance(inst)}>
              Start
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => openInstance(inst.id)}>
            Open <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

export function HomeView() {
  const instances = useStore((s) => s.instances);
  const folders = useStore((s) => s.folders);
  const telemetry = useStore((s) => s.telemetry);
  const busy = useStore((s) => s.busy);
  const host = useStore((s) => s.host);
  const hostHistory = useStore((s) => s.hostHistory);
  const activity = useStore((s) => s.activity);
  const setWizard = useStore((s) => s.setWizard);
  const setActivityOpen = useStore((s) => s.setActivityOpen);

  const stats = useMemo(() => {
    let online = 0;
    let players = 0;
    let peak = 0;
    for (const i of instances) {
      const h = health(i, telemetry[i.id], busy.includes(i.id));
      if (h === "online" || h === "degraded") online++;
      players += pickBattlegroup(i, telemetry[i.id])?.players ?? 0;
      peak += telemetry[i.id]?.peakPlayers ?? 0;
    }
    const day = Date.now() - 86400e3;
    const alerts = activity.filter((a) => a.level === "error" && a.ts > day).length;
    return { online, players, peak, alerts };
  }, [instances, telemetry, busy, activity]);

  const groups = useMemo(() => {
    const g = folders.map((f) => ({ folder: f, items: instances.filter((i) => i.folderId === f.id) })).filter((x) => x.items.length);
    const loose = instances.filter((i) => !i.folderId || !folders.some((f) => f.id === i.folderId));
    if (loose.length) g.push({ folder: { id: "_", name: "Ungrouped", color: "#8b7d70", icon: "folder", collapsed: false }, items: loose });
    return g;
  }, [instances, folders]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Night watch" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const times = hostHistory.map((s) => s.t);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-sand-400">{greeting}, Planetologist</div>
          <h1 className="mt-0.5 font-display text-[28px] font-semibold tracking-tight">
            Fleet <span className="accent-text">overview</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            icon={MoreHorizontal}
            disabled={instances.length === 0}
            onClick={(e) =>
              openMenu(e, [
                { header: "Fleet actions" },
                { label: "Start all", icon: Play, onClick: () => instances.forEach((i) => startInstance(i)) },
                {
                  label: "Stop all",
                  icon: Square,
                  danger: true,
                  onClick: async () => {
                    if (await confirm({ title: `Stop all ${instances.length} battlegroups?`, body: "Every player on every server gets disconnected.", danger: true, confirmLabel: "Stop all" })) instances.forEach((i) => stopInstance(i, true));
                  },
                },
                { label: "Maintenance mode on all", icon: Wrench, onClick: () => instances.filter((i) => !i.maintenance).forEach((i) => toggleMaintenance(i)) },
                { label: "End maintenance on all", icon: Wrench, onClick: () => instances.filter((i) => i.maintenance).forEach((i) => toggleMaintenance(i)) },
              ])
            }
          >
            Fleet actions
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setWizard(true)}>
            New battlegroup
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "Servers online", value: `${stats.online}/${instances.length}`, icon: Server, sub: `${instances.length - stats.online} idle or offline` },
          { label: "Players online", value: stats.players, icon: Users, sub: `session peak ${stats.peak}` },
          { label: "Host CPU", value: pct(host?.cpu), icon: Cpu, sub: `${host?.perCore.length ?? 0} logical cores` },
          { label: "Host memory", value: host ? bytes(host.memUsed, 1) : "—", icon: MemoryStick, sub: host ? `of ${bytes(host.memTotal, 0)}` : "" },
          { label: "Alerts (24h)", value: stats.alerts, icon: AlertTriangle, sub: stats.alerts ? "click to review" : "all quiet on Arrakis" },
        ].map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Card className={cx("p-4", k.label.startsWith("Alerts") && "cursor-pointer")} onClick={() => k.label.startsWith("Alerts") && setActivityOpen(true)}>
              <Stat label={k.label} value={k.value} sub={k.sub} icon={k.icon} accent={k.label.startsWith("Alerts") && stats.alerts ? "#ef5350" : "var(--accent)"} />
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader icon={Cpu} title="Host CPU" subtitle="Hypervisor load, last 8 minutes" />
          <div className="px-4 pb-4">
            <AreaChart times={times} series={[{ key: "cpu", label: "CPU", color: "var(--accent)", values: hostHistory.map((s) => s.cpu) }]} max={100} format={(v) => `${v.toFixed(0)}%`} height={140} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={MemoryStick} title="Host memory" subtitle="RAM is the #1 bottleneck for battlegroups" />
          <div className="px-4 pb-4">
            <AreaChart times={times} series={[{ key: "mem", label: "Memory", color: "var(--accent)", values: hostHistory.map((s) => s.mem) }]} max={100} format={(v) => `${v.toFixed(0)}%`} height={140} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={Network} title="Host network" subtitle="All adapters, including the Hyper-V switch" />
          <div className="px-4 pb-4">
            <AreaChart
              times={times}
              series={[
                { key: "rx", label: "Download", color: "var(--series-rx)", values: hostHistory.map((s) => s.rx) },
                { key: "tx", label: "Upload", color: "var(--series-tx)", values: hostHistory.map((s) => s.tx) },
              ]}
              format={rate}
              height={116}
            />
          </div>
        </Card>
      </div>

      {instances.length === 0 ? (
        <Card>
          <Empty
            icon={Server}
            title="No battlegroups yet"
            body="Create your first self-hosted Dune: Awakening world. The wizard installs the server tool with SteamCMD, runs Funcom's Hyper-V setup and connects everything up."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setWizard(true)}>
                Create battlegroup
              </Button>
            }
          />
        </Card>
      ) : (
        groups.map(({ folder, items }) => (
          <div key={folder.id}>
            <SectionTitle>
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: folder.color }} />
                {folder.name}
              </span>
            </SectionTitle>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {items.map((inst, i) => (
                <ServerCard key={inst.id} inst={inst} i={i} />
              ))}
            </div>
          </div>
        ))
      )}

      <Card>
        <CardHeader
          icon={Activity}
          title="Recent activity"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setActivityOpen(true)}>
              View all
            </Button>
          }
        />
        <div className="divide-y divide-white/[0.05] px-5 pb-3">
          {activity.length === 0 && <div className="py-6 text-center text-[13px] text-sand-500">Nothing yet. Actions, crashes, backups and automation show up here.</div>}
          {[...activity]
            .reverse()
            .slice(0, 8)
            .map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className="size-1.5 rounded-full" style={{ background: a.level === "error" ? "#ef5350" : a.level === "warn" ? "#f5b83d" : "#60a5fa" }} />
                <span className="w-36 shrink-0 truncate text-sand-400">{instances.find((x) => x.id === a.instanceId)?.name ?? "System"}</span>
                <span className="min-w-0 flex-1 truncate text-sand-200">{a.message}</span>
                <span className="shrink-0 text-[11.5px] text-sand-500">{ago(a.ts)}</span>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
