import { useBusy } from "../lib/jobs";
import {
  Activity,
  ChevronRight,
  Copy,
  Cpu,
  FlaskConical,
  Folder as FolderIcon,
  FolderPlus,
  LayoutDashboard,
  MemoryStick,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Server,
  Settings,
  Square,
  Star,
  Swords,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { FOLDER_COLORS, useStore } from "../lib/store";
import { health, HEALTH_META, pickBattlegroup } from "../lib/health";
import { restartInstance, startInstance, stopInstance, toggleMaintenance } from "../lib/actions";
import type { Folder, Instance } from "../lib/types";
import { openMenu, type MenuItem } from "./menu";
import { confirm, cx, IconButton, Meter, StatusDot } from "./ui";
import { pct } from "../lib/format";

const FOLDER_ICONS: Record<string, React.ElementType> = { server: Server, flask: FlaskConical, swords: Swords, folder: FolderIcon, star: Star };

export function instanceMenu(inst: Instance): MenuItem[] {
  const s = useStore.getState();
  return [
    { header: inst.name },
    { label: "Open", icon: LayoutDashboard, onClick: () => s.openInstance(inst.id) },
    { label: "Start", icon: Play, onClick: () => startInstance(inst) },
    { label: "Stop", icon: Square, onClick: () => stopInstance(inst) },
    { label: "Restart", icon: RotateCw, onClick: () => restartInstance(inst) },
    { label: inst.maintenance ? "End maintenance" : "Maintenance mode", icon: Wrench, onClick: () => toggleMaintenance(inst) },
    { separator: true },
    { label: inst.favorite ? "Unpin from top" : "Pin to top", icon: Star, onClick: () => s.updateInstance(inst.id, { favorite: !inst.favorite }) },
    { label: "Duplicate settings", icon: Copy, onClick: () => s.duplicateInstance(inst.id) },
    { header: "Move to folder" },
    ...s.folders.map((f) => ({ label: f.name, icon: FolderIcon, onClick: () => s.moveInstance(inst.id, f.id), disabled: inst.folderId === f.id })),
    { label: "Ungrouped", icon: FolderIcon, onClick: () => s.moveInstance(inst.id, null), disabled: inst.folderId == null },
    { separator: true },
    {
      label: "Remove from manager",
      icon: Trash2,
      danger: true,
      onClick: async () => {
        if (await confirm({ title: `Remove ${inst.name}?`, body: "Only removes it from this app. The VM, server files and backups stay untouched.", danger: true, confirmLabel: "Remove" })) s.removeInstance(inst.id);
      },
    },
  ];
}

function InstanceRow({ inst, active }: { inst: Instance; active: boolean }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const busy = useBusy(inst.id);
  const openInstance = useStore((s) => s.openInstance);
  const h = health(inst, tel, busy);
  const bg = pickBattlegroup(inst, tel);
  const m = HEALTH_META[h];
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/dsm-instance", inst.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => openInstance(inst.id)}
      onContextMenu={(e) => openMenu(e, instanceMenu(inst))}
      className={cx(
        "group relative flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-3 text-left transition-colors",
        active ? "bg-white/[0.08] text-sand-50" : "text-sand-300 hover:bg-white/[0.045] hover:text-sand-100",
      )}
    >
      {active && <motion.span layoutId="side-active" className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-[var(--accent)]" />}
      <StatusDot color={m.color} pulse={h === "online" || h === "starting" || h === "busy"} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{inst.name}</span>
      {inst.maintenance && <Wrench className="size-3 text-warn" />}
      {inst.mode === "demo" && <span className="rounded bg-info/15 px-1 text-[9.5px] font-semibold text-info">DEMO</span>}
      {bg && !bg.stop && (
        <span className="flex items-center gap-0.5 font-mono text-[11px] text-sand-400 tabular-nums">
          <Users className="size-3" />
          {bg.players}
        </span>
      )}
    </button>
  );
}

function FolderSection({ folder, instances, activeId }: { folder: Folder | null; instances: Instance[]; activeId: string | null }) {
  const telemetry = useStore((st) => st.telemetry);
  const updateFolder = useStore((st) => st.updateFolder);
  const moveInstance = useStore((st) => st.moveInstance);
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const collapsed = folder?.collapsed ?? false;
  const Icon = folder ? FOLDER_ICONS[folder.icon] ?? FolderIcon : FolderIcon;
  const online = instances.reduce((a, i) => {
    const bg = pickBattlegroup(i, telemetry[i.id]);
    return a + (bg && !bg.stop ? bg.players : 0);
  }, 0);

  const menu = (): MenuItem[] =>
    folder
      ? [
          { header: folder.name },
          { label: "Start all", icon: Play, onClick: () => instances.forEach((i) => startInstance(i)) },
          {
            label: "Stop all",
            icon: Square,
            onClick: async () => {
              if (await confirm({ title: `Stop all servers in ${folder.name}?`, danger: true, confirmLabel: "Stop all" })) instances.forEach((i) => stopInstance(i, true));
            },
          },
          { separator: true },
          { label: "Rename", icon: Pencil, onClick: () => setEditing(true) },
          { swatches: FOLDER_COLORS, value: folder.color, onPick: (c) => updateFolder(folder.id, { color: c }) },
          { header: "Icon" },
          ...Object.entries(FOLDER_ICONS).map(([k, I]) => ({ label: k[0].toUpperCase() + k.slice(1), icon: I, onClick: () => updateFolder(folder.id, { icon: k }), disabled: folder.icon === k })),
          { separator: true },
          {
            label: "Delete folder",
            icon: Trash2,
            danger: true,
            onClick: async () => {
              if (await confirm({ title: `Delete folder ${folder.name}?`, body: "Servers inside move to Ungrouped.", danger: true, confirmLabel: "Delete" })) useStore.getState().removeFolder(folder.id);
            },
          },
        ]
      : [];

  if (!folder && instances.length === 0) return null;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/dsm-instance")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/dsm-instance");
        if (id) moveInstance(id, folder?.id ?? null);
      }}
      className={cx("rounded-xl transition-colors", over && "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/40")}
    >
      <div className="group flex items-center gap-1.5 px-1.5 py-1" onContextMenu={(e) => folder && openMenu(e, menu())}>
        <div role="button" tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && folder && updateFolder(folder.id, { collapsed: !collapsed })} onClick={() => folder && updateFolder(folder.id, { collapsed: !collapsed })} className="flex min-w-0 flex-1 items-center gap-1.5 cursor-pointer text-left">
          <ChevronRight className={cx("size-3.5 shrink-0 text-sand-500 transition-transform", !collapsed && "rotate-90", !folder && "invisible")} />
          <Icon className="size-3.5 shrink-0" style={{ color: folder?.color ?? "#8b7d70" }} />
          {editing && folder ? (
            <input
              autoFocus
              defaultValue={folder.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                updateFolder(folder.id, { name: e.target.value.trim() || folder.name });
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  (e.target as HTMLInputElement).value = folder.name;
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 flex-1 rounded border border-[var(--accent)]/50 bg-black/40 px-1 text-[11.5px] text-sand-50 outline-none"
            />
          ) : (
            <span className="truncate text-[11.5px] font-semibold tracking-[0.06em] text-sand-400 uppercase">{folder?.name ?? "Ungrouped"}</span>
          )}
          <span className="ml-1 text-[10.5px] text-sand-600">{instances.length}</span>
        </div>
        {online > 0 && <span className="text-[10.5px] text-sand-500 tabular-nums">{online} online</span>}
        {folder && <IconButton icon={MoreHorizontal} label="Folder options" size="sm" className="opacity-0 group-hover:opacity-100" onClick={(e) => openMenu(e, menu())} />}
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="space-y-0.5 pb-1.5 pl-2">
              {instances.map((i) => (
                <InstanceRow key={i.id} inst={i} active={i.id === activeId} />
              ))}
              {instances.length === 0 && <div className="py-1.5 pl-3 text-[11.5px] text-sand-600 italic">Drop servers here</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar() {
  const instances = useStore((s) => s.instances);
  const folders = useStore((s) => s.folders);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setWizard = useStore((s) => s.setWizard);
  const addFolder = useStore((s) => s.addFolder);
  const host = useStore((s) => s.host);
  const [filter, setFilter] = useState("");
  const activeId = view.kind === "instance" ? view.id : null;

  const sorted = useMemo(() => {
    const f = filter.trim().toLowerCase().replace(/^#/, "");
    return [...instances]
      .filter((i) => !f || i.name.toLowerCase().includes(f) || i.tags.some((t) => t.toLowerCase().includes(f)))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  }, [instances, filter]);

  const nav = (kind: "home" | "settings" | "system", label: string, Icon: React.ElementType) => (
    <button
      onClick={() => setView({ kind } as any)}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        view.kind === kind ? "bg-white/[0.08] text-sand-50" : "text-sand-300 hover:bg-white/[0.045] hover:text-sand-100",
      )}
    >
      <Icon className={cx("size-4", view.kind === kind && "text-[var(--accent)]")} />
      {label}
    </button>
  );

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r hairline bg-black/[0.12]">
      <div className="space-y-0.5 p-3 pb-2">
        {nav("home", "Fleet overview", LayoutDashboard)}
        {nav("system", "Host & prerequisites", Activity)}
      </div>

      <div className="flex items-center gap-1.5 px-3 pb-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter servers or #tags"
          className="h-7 min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 text-[12px] text-sand-100 placeholder:text-sand-600 outline-none focus:border-[var(--accent)]/50"
        />
        <IconButton icon={FolderPlus} label="New folder" size="sm" onClick={() => addFolder("New folder")} />
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {folders.map((f) => (
          <FolderSection key={f.id} folder={f} instances={sorted.filter((i) => i.folderId === f.id)} activeId={activeId} />
        ))}
        <FolderSection folder={null} instances={sorted.filter((i) => !i.folderId || !folders.some((f) => f.id === i.folderId))} activeId={activeId} />

        <button
          onClick={() => setWizard(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.1] py-2.5 text-[12.5px] font-medium text-sand-400 transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-2)]"
        >
          <Plus className="size-4" /> New battlegroup
        </button>
      </div>

      <div className="border-t hairline p-3">
        {host && (
          <div className="mb-2 space-y-2 rounded-xl bg-black/20 px-3 py-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-sand-400">
                <span className="flex items-center gap-1.5">
                  <Cpu className="size-3" /> Host CPU
                </span>
                <span className="font-mono tabular-nums text-sand-300">{pct(host.cpu)}</span>
              </div>
              <Meter value={host.cpu} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-sand-400">
                <span className="flex items-center gap-1.5">
                  <MemoryStick className="size-3" /> Host RAM
                </span>
                <span className="font-mono tabular-nums text-sand-300">{pct((host.memUsed / host.memTotal) * 100)}</span>
              </div>
              <Meter value={(host.memUsed / host.memTotal) * 100} />
            </div>
          </div>
        )}
        {nav("settings", "Settings", Settings)}
      </div>
    </aside>
  );
}
