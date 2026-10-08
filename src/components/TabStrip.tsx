import { useBusy } from "../lib/jobs";
import { LayoutDashboard, Plus, X } from "lucide-react";
import { Reorder } from "motion/react";
import { useStore } from "../lib/store";
import { health, HEALTH_META } from "../lib/health";
import { openMenu } from "./menu";
import { instanceMenu } from "./Sidebar";
import { cx, StatusDot } from "./ui";

function Tab({ id }: { id: string }) {
  const inst = useStore((s) => s.instances.find((i) => i.id === id));
  const tel = useStore((s) => s.telemetry[id]);
  const busy = useBusy(id);
  const active = useStore((s) => s.view.kind === "instance" && s.view.id === id);
  const openInstance = useStore((s) => s.openInstance);
  const closeTab = useStore((s) => s.closeTab);
  if (!inst) return null;
  const h = health(inst, tel, busy);
  return (
    <Reorder.Item
      value={id}
      as="div"
      onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeTab(id))}
      onClick={() => openInstance(id)}
      onContextMenu={(e) => openMenu(e, instanceMenu(inst))}
      className={cx(
        "group relative flex h-9 max-w-[220px] min-w-[140px] cursor-default items-center gap-2 rounded-t-xl px-3 text-[12.5px] transition-colors",
        active ? "bg-white/[0.07] text-sand-50" : "text-sand-400 hover:bg-white/[0.035] hover:text-sand-200",
      )}
      whileDrag={{ scale: 1.03, zIndex: 10 }}
    >
      {active && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent-glow)]" />}
      <StatusDot color={HEALTH_META[h].color} pulse={h === "starting" || h === "busy"} />
      <span className="min-w-0 flex-1 truncate">{inst.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeTab(id);
        }}
        className={cx("grid size-5 place-items-center rounded-md text-sand-500 hover:bg-white/10 hover:text-sand-100", !active && "opacity-0 group-hover:opacity-100")}
        aria-label={`Close ${inst.name}`}
      >
        <X className="size-3.5" />
      </button>
    </Reorder.Item>
  );
}

export function TabStrip() {
  const openTabs = useStore((s) => s.openTabs);
  const reorder = useStore((s) => s.reorderTabs);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setWizard = useStore((s) => s.setWizard);
  return (
    <div className="flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b hairline px-3 pt-2">
      <button
        onClick={() => setView({ kind: "home" })}
        className={cx("flex h-9 items-center gap-2 rounded-t-xl px-3 text-[12.5px]", view.kind === "home" ? "bg-white/[0.07] text-sand-50" : "text-sand-400 hover:text-sand-200")}
        title="Fleet overview"
      >
        <LayoutDashboard className="size-4" />
      </button>
      <Reorder.Group axis="x" values={openTabs} onReorder={reorder} as="div" className="flex items-end gap-1">
        {openTabs.map((id) => (
          <Tab key={id} id={id} />
        ))}
      </Reorder.Group>
      <button onClick={() => setWizard(true)} className="mb-1 grid size-7 shrink-0 place-items-center rounded-lg text-sand-500 hover:bg-white/[0.07] hover:text-sand-100" title="New battlegroup (Ctrl+N)">
        <Plus className="size-4" />
      </button>
    </div>
  );
}
