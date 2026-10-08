import { useBusy } from "../../lib/jobs";
import {
  Archive,
  Bell,
  Clock,
  Cog,
  Download,
  ExternalLink,
  FileCog,
  Gauge,
  Globe,
  LayoutGrid,
  MoreHorizontal,
  Play,
  RotateCw,
  ScrollText,
  Square,
  SquareTerminal,
  Users,
  Workflow,
  Wrench,
  HardDrive,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore } from "../../lib/store";
import { health, healthScore, pickBattlegroup } from "../../lib/health";
import { restartInstance, startInstance, stopInstance, toggleMaintenance, updateInstance } from "../../lib/actions";
import * as api from "../../lib/api";
import { isTauri } from "../../lib/tauri";
import { duration, since } from "../../lib/format";
import { Badge, Button, cx, IconButton, Ring, StatusPill } from "../../components/ui";
import { openMenu } from "../../components/menu";
import type { Instance, InstanceTab } from "../../lib/types";
import { OverviewTab } from "./OverviewTab";
import { MapsTab } from "./MapsTab";
import { PlayersTab } from "./PlayersTab";
import { ConsoleTab } from "./ConsoleTab";
import { LogsTab } from "./LogsTab";
import { ConfigTab } from "./ConfigTab";
import { BackupsTab } from "./BackupsTab";
import { AutomationTab } from "./AutomationTab";
import { NetworkTab } from "./NetworkTab";
import { IntegrationsTab } from "./IntegrationsTab";
import { InstanceSettingsTab } from "./InstanceSettingsTab";

const TABS: { id: InstanceTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "maps", label: "Maps & Pods", icon: LayoutGrid },
  { id: "players", label: "Players", icon: Users },
  { id: "console", label: "Console", icon: SquareTerminal },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "config", label: "Game Settings", icon: FileCog },
  { id: "backups", label: "Backups", icon: Archive },
  { id: "automation", label: "Automation", icon: Workflow },
  { id: "network", label: "Network", icon: Globe },
  { id: "integrations", label: "Discord", icon: Bell },
  { id: "settings", label: "Instance", icon: Cog },
];

const buildCache = new Map<number, { at: number; id: string }>();
export function useRemoteBuild(appId: number) {
  const [id, setId] = useState<string | null>(buildCache.get(appId)?.id ?? null);
  useEffect(() => {
    const c = buildCache.get(appId);
    if (c && Date.now() - c.at < 10 * 60e3) return setId(c.id);
    api
      .remoteBuild(appId)
      .then((r) => {
        buildCache.set(appId, { at: Date.now(), id: r.buildId });
        setId(r.buildId);
      })
      .catch(() => {});
  }, [appId]);
  return id;
}

export function InstanceView({ id }: { id: string }) {
  const inst = useStore((s) => s.instances.find((i) => i.id === id));
  const tab = useStore((s) => s.instanceTab[id] ?? "overview");
  const setTab = useStore((s) => s.setInstanceTab);
  if (!inst) return null;
  return (
    <div className="flex min-h-full flex-col">
      <Header inst={inst} />
      <div className="sticky top-0 z-20 border-b hairline bg-[#120f0d]/80 px-7 backdrop-blur-xl">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(id, t.id)}
              className={cx("relative flex h-10 shrink-0 items-center gap-2 px-3 text-[12.5px] font-medium transition-colors", tab === t.id ? "text-sand-50" : "text-sand-400 hover:text-sand-200")}
            >
              <t.icon className={cx("size-3.5", tab === t.id && "text-[var(--accent)]")} />
              {t.label}
              {tab === t.id && <motion.span layoutId={`it-${id}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1500px] flex-1 p-7">
        {tab === "overview" && <OverviewTab inst={inst} />}
        {tab === "maps" && <MapsTab inst={inst} />}
        {tab === "players" && <PlayersTab inst={inst} />}
        {tab === "console" && <ConsoleTab inst={inst} />}
        {tab === "logs" && <LogsTab inst={inst} />}
        {tab === "config" && <ConfigTab inst={inst} />}
        {tab === "backups" && <BackupsTab inst={inst} />}
        {tab === "automation" && <AutomationTab inst={inst} />}
        {tab === "network" && <NetworkTab inst={inst} />}
        {tab === "integrations" && <IntegrationsTab inst={inst} />}
        {tab === "settings" && <InstanceSettingsTab inst={inst} />}
      </div>
    </div>
  );
}

function Header({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const busy = useBusy(inst.id);
  const folder = useStore((s) => s.folders.find((f) => f.id === inst.folderId));
  const setTab = useStore((s) => s.setInstanceTab);
  const h = health(inst, tel, busy);
  const bg = pickBattlegroup(inst, tel);
  const score = healthScore(inst, tel);
  const remote = useRemoteBuild(inst.appId);
  const local = tel?.snapshot?.buildId;
  const updateAvail = !!(remote && local && remote !== local);
  const running = bg && !bg.stop;

  const more = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: inst.maintenance ? "End maintenance mode" : "Enter maintenance mode", icon: Wrench, onClick: () => toggleMaintenance(inst) },
      {
        label: "Open Battlegroup Director",
        icon: ExternalLink,
        onClick: async () => {
          const url = await api.directorUrl(inst, bg?.namespace || inst.namespace);
          if (url) isTauri ? openUrl(url) : window.open(url);
          else useStore.getState().toast({ kind: "warn", title: "Director not found", body: "No director NodePort service was found in the battlegroup namespace." });
        },
      },
      {
        label: "Open battlegroup.bat (elevated)",
        icon: SquareTerminal,
        disabled: !inst.batPath || !isTauri,
        onClick: () => api.launchElevatedConsole(inst.batPath.replace(/\\[^\\]+$/, ""), `"${inst.batPath}"`).catch((e) => useStore.getState().toast({ kind: "error", title: "Launch failed", body: String(e) })),
      },
      { label: "Check for update", icon: Download, onClick: () => setTab(inst.id, "overview") },
      { separator: true },
      { label: "Database backup + download", icon: Archive, onClick: () => setTab(inst.id, "backups") },
      { label: "Hyper-V checkpoint", icon: HardDrive, disabled: inst.mode !== "real" || !inst.vmName, onClick: () => api.vmAction(inst, "checkpoint").then(() => useStore.getState().toast({ kind: "success", title: "Checkpoint created" })) },
    ]);

  return (
    <div className="relative overflow-hidden px-7 pt-6 pb-5">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(600px 160px at 0% 0%, ${folder?.color ?? inst.color}22, transparent 70%)` }} />
      <div className="relative flex flex-wrap items-center gap-5">
        <Ring value={score} size={64} stroke={5}>
          <div className="text-center leading-none">
            <div className="font-display text-[17px] font-semibold">{tel?.snapshot ? score : "–"}</div>
            <div className="mt-0.5 text-[8.5px] tracking-widest text-sand-500 uppercase">health</div>
          </div>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate font-display text-[24px] font-semibold tracking-tight">{inst.name}</h1>
            <StatusPill health={h} />
            {inst.mode === "demo" && <Badge color="#60a5fa">DEMO SANDBOX</Badge>}
            {inst.branch === "ptc" && <Badge color="#9b7bf0">PTC</Badge>}
            {inst.maintenance && <Badge color="#f5b83d">MAINTENANCE</Badge>}
            {updateAvail && (
              <button onClick={() => updateInstance(inst)}>
                <Badge color="#60a5fa">
                  <Download className="size-3" /> Update {remote}
                </Badge>
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-sand-400">
            {folder && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: folder.color }} />
                {folder.name}
              </span>
            )}
            <span className="font-mono">
              {inst.ssh.user}@{inst.ssh.host || "unset"}
            </span>
            {bg && <span className="font-mono">{bg.namespace}</span>}
            {bg?.start && running && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> up {since(bg.start)}
              </span>
            )}
            {tel?.snapshot && <span>VM up {duration(tel.snapshot.vm.uptime)}</span>}
            {tel?.snapshot && <span>{tel.snapshot.latencyMs} ms</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <Button icon={Square} onClick={() => stopInstance(inst)} disabled={busy}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={Play} onClick={() => startInstance(inst)} disabled={busy}>
              Start
            </Button>
          )}
          <Button icon={RotateCw} onClick={() => restartInstance(inst)} disabled={busy}>
            Restart
          </Button>
          <Button icon={Download} onClick={() => updateInstance(inst)} disabled={busy} variant={updateAvail ? "subtle" : "secondary"}>
            Update
          </Button>
          <IconButton icon={MoreHorizontal} label="More actions" onClick={more} />
        </div>
      </div>
    </div>
  );
}
