import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useStore } from "./lib/store";
import { TelemetryManager } from "./lib/telemetry";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { TabStrip } from "./components/TabStrip";
import { ActivityPanel, CommandPalette, JobsDrawer, Toasts } from "./components/Overlays";
import { MenuHost } from "./components/menu";
import { ConfirmHost } from "./components/ui";
import { HomeView } from "./views/HomeView";
import { InstanceView } from "./views/instance/InstanceView";
import { SettingsView } from "./views/SettingsView";
import { SystemView } from "./views/SystemView";
import { Wizard } from "./views/Wizard";
import { systemCheck } from "./lib/api";
import { isTauri, listen } from "./lib/tauri";
import { requestClose } from "./lib/close";
import { CloseDialog } from "./components/CloseDialog";
import { Logo } from "./components/TitleBar";

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const view = useStore((s) => s.view);
  const [elevated, setElevated] = useState<boolean | null>(null);

  useEffect(() => {
    useStore.getState().load();
    if (isTauri) systemCheck().then((r) => setElevated(r.elevated || r.hypervAdmin)).catch(() => {});
    // Alt+F4 / taskbar "Close window" are intercepted in Rust and routed here, same as the X button.
    let alive = true;
    let un: (() => void) | undefined;
    if (isTauri) listen("app://close-requested", () => requestClose()).then((f) => (alive ? (un = f) : f()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
      } else if (ctrl && e.key.toLowerCase() === "n") {
        e.preventDefault();
        s.setWizard(true);
      } else if (ctrl && e.key.toLowerCase() === "w" && s.view.kind === "instance") {
        e.preventDefault();
        s.closeTab(s.view.id);
      } else if (ctrl && e.key === "Tab" && s.openTabs.length) {
        e.preventDefault();
        const cur = s.view.kind === "instance" ? s.openTabs.indexOf(s.view.id) : -1;
        const next = (cur + (e.shiftKey ? -1 : 1) + s.openTabs.length) % s.openTabs.length;
        s.openInstance(s.openTabs[next]);
      } else if (ctrl && /^[1-9]$/.test(e.key)) {
        const id = s.openTabs[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          s.openInstance(id);
        }
      } else if (ctrl && e.key === ",") {
        e.preventDefault();
        s.setView({ kind: "settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!loaded)
    return (
      <div className="app-bg grid h-full place-items-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <Logo size={64} />
        </motion.div>
      </div>
    );

  const key = view.kind === "instance" ? `i-${view.id}` : view.kind;

  return (
    <div className="app-bg relative flex h-full flex-col overflow-hidden rounded-[inherit]">
      <div className="dunes" />
      <TelemetryManager />
      <TitleBar elevated={elevated} />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabStrip />
          <div className="relative min-h-0 flex-1">
            {/* CSS-only page transition: can never wedge if animation frames pause (window hidden to tray). */}
            <div key={key} className="page-enter absolute inset-0 overflow-y-auto">
              {view.kind === "home" && <HomeView />}
              {view.kind === "instance" && <InstanceView id={view.id} />}
              {view.kind === "settings" && <SettingsView />}
              {view.kind === "system" && <SystemView />}
            </div>
          </div>
        </main>
      </div>
      <Wizard />
      <CommandPalette />
      <ActivityPanel />
      <JobsDrawer />
      <Toasts />
      <MenuHost />
      <ConfirmHost />
      <CloseDialog />
    </div>
  );
}
