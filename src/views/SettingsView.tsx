import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostart } from "@tauri-apps/plugin-autostart";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Bell, Download, FolderOpen, FolderSearch, Keyboard, Palette, Settings2, Upload, Wrench, HardDrive, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import * as api from "../lib/api";
import { isTauri } from "../lib/tauri";
import { Badge, Button, Card, CardHeader, cx, Field, Input, Kbd, Segmented, Slider, Toggle } from "../components/ui";
import { WebhookEditor } from "./instance/IntegrationsTab";
import type { Accent } from "../lib/types";

const ACCENTS: { id: Accent; name: string; color: string }[] = [
  { id: "spice", name: "Spice", color: "#f08a24" },
  { id: "ibad", name: "Ibad blue", color: "#3f8fe8" },
  { id: "sietch", name: "Sietch", color: "#2fb67c" },
  { id: "harkonnen", name: "Harkonnen", color: "#e5484d" },
  { id: "bene", name: "Bene Gesserit", color: "#9b7bf0" },
];

function PathField({ label, value, placeholder, onChange, hint }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <Input mono value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="flex-1" />
        {isTauri && (
          <Button
            icon={FolderSearch}
            onClick={async () => {
              const p = await openDialog({ directory: true });
              if (typeof p === "string") onChange(p);
            }}
          >
            Browse
          </Button>
        )}
      </div>
    </Field>
  );
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const importConfig = useStore((s) => s.importConfig);
  const [paths, setPaths] = useState<Awaited<ReturnType<typeof api.appPaths>> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    api.appPaths().then(setPaths);
    if (isTauri) isAutostart().then(setAutostart).catch(() => {});
  }, []);

  const exportAll = () => {
    const s = useStore.getState();
    const data = { version: 1, exported: new Date().toISOString(), instances: s.instances, folders: s.folders, settings: s.settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dune-server-manager-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-7">
      <h1 className="font-display text-[26px] font-semibold tracking-tight">Settings</h1>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={Settings2} title="General" />
          <div className="divide-y divide-white/[0.05] px-5 pb-3">
            <Field inline label="When I close the window" hint="Tray keeps automation running. Right-click the tray icon to quit.">
              <Segmented
                value={settings.closeBehavior}
                onChange={(v) => update({ closeBehavior: v })}
                options={[
                  { value: "ask", label: "Ask" },
                  { value: "tray", label: "Tray" },
                  { value: "quit", label: "Quit" },
                ]}
              />
            </Field>
            <Field inline label="Start with Windows" hint="Launches minimized to the tray at sign-in so the watchdog and schedules survive reboots.">
              <Toggle
                checked={autostart}
                disabled={!isTauri}
                onChange={async (v) => {
                  try {
                    v ? await enableAutostart() : await disableAutostart();
                    setAutostart(await isAutostart());
                  } catch (e) {
                    useStore.getState().toast({ kind: "error", title: "Couldn't change autostart", body: String(e) });
                  }
                }}
              />
            </Field>
            <Field inline label="Desktop notifications" hint="Windows toasts for crashes, failures and available updates (even while in the tray).">
              <Toggle checked={settings.desktopNotifications} onChange={(v) => update({ desktopNotifications: v })} />
            </Field>
            <Field inline label="Confirm dangerous actions" hint="Stop, restart, update, import, deletes.">
              <Toggle checked={settings.confirmDangerous} onChange={(v) => update({ confirmDangerous: v })} />
            </Field>
            <div className="py-3">
              <div className="mb-2 text-[13px] font-medium">Telemetry interval: {settings.pollSeconds}s</div>
              <Slider value={settings.pollSeconds} min={2} max={30} step={1} onChange={(v) => update({ pollSeconds: v })} />
              <div className="mt-1 text-[12px] text-sand-400">Visible server. Background servers poll at 3× this interval, and polling pauses while the window is hidden.</div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Palette} title="Appearance" />
          <div className="space-y-4 px-5 pb-5">
            <div>
              <div className="mb-2 text-[12px] font-medium text-sand-300">Accent</div>
              <div className="grid grid-cols-5 gap-2">
                {ACCENTS.map((a) => (
                  <button key={a.id} onClick={() => update({ accent: a.id })} className={cx("rounded-xl border p-2.5 text-center transition", settings.accent === a.id ? "border-white/30 bg-white/[0.06]" : "border-white/[0.06] hover:border-white/[0.15]")}>
                    <div className="mx-auto size-7 rounded-full shadow-lg" style={{ background: `radial-gradient(circle at 30% 30%, white -40%, ${a.color} 60%)`, boxShadow: `0 4px 18px -4px ${a.color}` }} />
                    <div className="mt-1.5 text-[11px] text-sand-300">{a.name}</div>
                  </button>
                ))}
              </div>
            </div>
            <Field inline label="Reduce motion" hint="Turns off animations and transitions.">
              <Toggle checked={settings.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={HardDrive} title="Storage locations" />
          <div className="space-y-4 px-5 pb-5">
            <PathField label="Backups" value={settings.backupRoot} placeholder={paths?.backups ?? ""} onChange={(v) => update({ backupRoot: v })} hint="Point at a different physical disk or a synced folder for real disaster recovery." />
            <PathField label="SteamCMD" value={settings.steamcmdDir} placeholder={paths?.steamcmd ?? ""} onChange={(v) => update({ steamcmdDir: v })} />
            <PathField label="Server tool installs" value={settings.serversDir} placeholder={paths?.servers ?? ""} onChange={(v) => update({ serversDir: v })} />
            <Field label="Steam username for SteamCMD" hint="Blank = anonymous.">
              <Input value={settings.steamUser} onChange={(e) => update({ steamUser: e.target.value.trim() })} placeholder="anonymous" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={Wrench}
            title="Data"
            subtitle="Instances, folders and settings"
            actions={paths && <Badge color={paths.portable ? "#34d399" : "#60a5fa"}>{paths.portable ? "Portable mode" : "Installed mode"}</Badge>}
          />
          <div className="space-y-3 px-5 pb-5">
            {paths?.portable ? (
              <div className="rounded-xl bg-black/20 px-3 py-2.5 text-[12px] leading-relaxed text-sand-400">
                All data (config, backups, SSH keys, SteamCMD, server files, WebView cache) lives in the <span className="font-mono text-sand-200">data</span> folder next to the exe. Move or copy the whole folder to take everything with you. If you move it, turn “Start with Windows” off and on again so the new path is registered.
              </div>
            ) : (
              <div className="rounded-xl bg-black/20 px-3 py-2.5 text-[12px] leading-relaxed text-sand-400">
                Data lives in your user profile. For a portable copy, use the portable .zip build, or put an empty file named <span className="font-mono text-sand-200">portable</span> next to the exe. Export your configuration here and import it there.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button icon={Download} onClick={exportAll}>
                Export configuration
              </Button>
              <Button icon={Upload} onClick={() => fileRef.current?.click()}>
                Import…
              </Button>
              {isTauri && paths && (
                <Button icon={FolderOpen} onClick={() => revealItemInDir(`${paths.data}\\state.json`).catch(() => {})}>
                  Open data folder
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    importConfig(JSON.parse(await f.text()));
                    useStore.getState().toast({ kind: "success", title: "Configuration imported" });
                  } catch (err) {
                    useStore.getState().toast({ kind: "error", title: "Import failed", body: String(err) });
                  }
                  e.target.value = "";
                }}
              />
            </div>
            <div className="text-[12px] leading-relaxed text-sand-500">Exports include webhook URLs and DDNS tokens. Treat the file as a secret. Per-instance exports (Instance tab) strip them.</div>
            <div className="font-mono text-[11px] text-sand-600">{paths?.data}</div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={Bell} title="Global webhooks" subtitle="Receive events from every server, e.g. a staff #alerts channel" />
        <div className="px-5 pb-5">
          <WebhookEditor hooks={settings.webhooks} onChange={(h) => update({ webhooks: h })} scope="all servers" />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={Keyboard} title="Keyboard shortcuts" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 px-5 pb-5 text-[13px]">
            {[
              ["Command palette", "Ctrl K"],
              ["New battlegroup", "Ctrl N"],
              ["Close tab", "Ctrl W"],
              ["Next / previous tab", "Ctrl Tab"],
              ["Jump to tab 1-9", "Ctrl 1-9"],
              ["Settings", "Ctrl ,"],
              ["Close tab", "Middle click"],
              ["Context menu", "Right click"],
            ].map(([l, k], i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sand-300">{l}</span>
                <Kbd>{k}</Kbd>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader icon={Info} title="About" />
          <div className="space-y-2 px-5 pb-5 text-[13px] leading-relaxed text-sand-300">
            <div>
              <span className="font-display font-semibold text-sand-50">Dune Server Manager</span> {__APP_VERSION__} · Tauri 2 · Rust · React
            </div>
            <div className="text-sand-400">Unofficial tool. Not affiliated with Funcom. It drives Funcom’s self-hosted server tooling (battlegroup.bat, the in-VM battlegroup CLI and its Kubernetes resources) and never modifies game binaries.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
