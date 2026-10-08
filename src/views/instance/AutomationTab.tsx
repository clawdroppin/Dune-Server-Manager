import { useBusy } from "../../lib/jobs";
import { Archive, BellRing, CalendarClock, Download, HeartPulse, Plus, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { useStore } from "../../lib/store";
import { uid, WEEKDAYS, ago } from "../../lib/format";
import { isTauri } from "../../lib/tauri";
import { Badge, Callout, Card, CardHeader, cx, Field, IconButton, Input, Toggle, Button } from "../../components/ui";
import type { Automation, Instance } from "../../lib/types";

export function AutomationTab({ inst }: { inst: Instance }) {
  const update = useStore((s) => s.updateInstance);
  const activity = useStore((s) => s.activity);
  const busy = useBusy(inst.id);
  const a = inst.automation;
  const set = (p: Partial<Automation>) => update(inst.id, (i) => ({ automation: { ...i.automation, ...p } }));
  const log = activity.filter((x) => x.instanceId === inst.id).slice(-40).reverse();

  return (
    <div className="space-y-5">
      {!isTauri || inst.mode === "demo" ? (
        <Callout kind="info" icon={Workflow} title="Automation runs in the desktop engine">
          Schedules here are saved, but the background engine only acts on real instances in the desktop app. It keeps running while the window is closed to the tray.
        </Callout>
      ) : (
        <Callout kind="success" icon={Workflow} title="Background engine active">
          Checks every 30 seconds, even with the window closed to the tray. {busy && <Badge color="#60a5fa">task running</Badge>} {inst.maintenance && <Badge color="#f5b83d">paused: maintenance mode</Badge>}
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={HeartPulse} title="Watchdog & crash detection" subtitle="Self-healing based on live Kubernetes state" />
          <div className="divide-y divide-white/[0.05] px-5 pb-3">
            <Field inline label="Crash alerts" hint="Alert whenever a pod's restart counter goes up (map server crash, OOM kill…). Kubernetes restarts the pod itself.">
              <Toggle checked={a.crashAlerts} onChange={(v) => set({ crashAlerts: v })} />
            </Field>
            <Field inline label="Keep battlegroup running" hint="If it is stopped while desired state is running, start it again. After ~5 minutes with zero ready map servers, run a full restart.">
              <Toggle checked={a.watchdog} onChange={(v) => set({ watchdog: v })} />
            </Field>
            <Field inline label="Recover the Hyper-V VM" hint="After 3 failed SSH checks, start the VM if Hyper-V reports it Off, Saved or Paused. Needs admin rights.">
              <Toggle checked={a.watchdogVm} onChange={(v) => set({ watchdogVm: v })} disabled={!a.watchdog} />
            </Field>
            <Field inline label="Desired state" hint="Set automatically when you start or stop from this app.">
              <Badge color={inst.desiredRunning ? "#34d399" : "#8b7d70"}>{inst.desiredRunning ? "Running" : "Stopped"}</Badge>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={CalendarClock}
            title="Scheduled restarts"
            subtitle="Local time. Countdown warnings go to Discord."
            actions={
              <Button size="sm" icon={Plus} onClick={() => set({ restarts: [...a.restarts, { id: uid(), time: "06:00", days: [], enabled: true }] })}>
                Add
              </Button>
            }
          />
          <div className="space-y-2 px-5 pb-4">
            {a.restarts.length === 0 && <div className="py-4 text-center text-[12.5px] text-sand-500">No schedules</div>}
            {a.restarts.map((r) => (
              <div key={r.id} className={cx("flex flex-wrap items-center gap-3 rounded-xl bg-black/20 px-3 py-2.5", !r.enabled && "opacity-55")}>
                <Toggle size="sm" checked={r.enabled} onChange={(v) => set({ restarts: a.restarts.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} />
                <input
                  type="time"
                  value={r.time}
                  onChange={(e) => set({ restarts: a.restarts.map((x) => (x.id === r.id ? { ...x, time: e.target.value } : x)) })}
                  className="h-8 rounded-lg border border-white/[0.08] bg-black/30 px-2 font-mono text-[13px] text-sand-50 outline-none [color-scheme:dark]"
                />
                <div className="flex gap-1">
                  {WEEKDAYS.map((d, i) => {
                    const on = r.days.length === 0 || r.days.includes(i);
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const all = r.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : r.days;
                          const next = all.includes(i) ? all.filter((x) => x !== i) : [...all, i].sort();
                          set({ restarts: a.restarts.map((x) => (x.id === r.id ? { ...x, days: next.length === 7 ? [] : next } : x)) });
                        }}
                        className={cx("h-7 w-9 rounded-md text-[11px] font-medium", on ? "bg-[var(--accent-soft)] text-[var(--accent-2)]" : "bg-white/[0.04] text-sand-500")}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="flex-1" />
                <IconButton icon={Trash2} label="Remove" size="sm" onClick={() => set({ restarts: a.restarts.filter((x) => x.id !== r.id) })} />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <BellRing className="size-4 text-sand-400" />
              <span className="text-[12.5px] text-sand-300">Warn players</span>
              <Input
                mono
                className="w-48"
                defaultValue={a.warnMinutes.join(", ")}
                onBlur={(e) =>
                  set({
                    warnMinutes: e.target.value
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter((n) => n > 0 && n < 600)
                      .sort((x, y) => y - x),
                  })
                }
              />
              <span className="text-[12px] text-sand-500">minutes before</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Archive} title="Scheduled backups" subtitle="Compressed archives with retention" />
          <div className="divide-y divide-white/[0.05] px-5 pb-3">
            <Field inline label="Enabled">
              <Toggle checked={a.backupEnabled} onChange={(v) => set({ backupEnabled: v })} />
            </Field>
            <Field inline label="Every (hours)" hint="Interval between automatic backups.">
              <Input type="number" min={0.5} step={0.5} className="w-24" mono value={a.backupIntervalHours} onChange={(e) => set({ backupIntervalHours: Math.max(0.5, Number(e.target.value)) })} />
            </Field>
            <Field inline label="Keep newest" hint="Older archives are pruned. Pinned archives are never pruned.">
              <Input type="number" min={1} className="w-24" mono value={a.backupKeep} onChange={(e) => set({ backupKeep: Math.max(1, Number(e.target.value)) })} />
            </Field>
            <Field inline label="Include world database" hint="Full pg dump via Funcom's CLI. Heavier: prefer daily, off-peak.">
              <Toggle checked={a.backupIncludeDb} onChange={(v) => set({ backupIncludeDb: v })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Download} title="Updates" subtitle="Polls Steam (api.steamcmd.net) against the build installed in the VM" />
          <div className="divide-y divide-white/[0.05] px-5 pb-3">
            <Field inline label="Check for updates">
              <Toggle checked={a.updateCheck} onChange={(v) => set({ updateCheck: v })} />
            </Field>
            <Field inline label="Check every (minutes)">
              <Input type="number" min={5} className="w-24" mono value={a.updateIntervalMinutes} onChange={(e) => set({ updateIntervalMinutes: Math.max(5, Number(e.target.value)) })} />
            </Field>
            <Field inline label="Auto-install" hint="Takes a safety backup, then runs `battlegroup update`. Clients can’t join a mismatched build, so this keeps you joinable after patches.">
              <Toggle checked={a.autoUpdate} onChange={(v) => set({ autoUpdate: v })} disabled={!a.updateCheck} />
            </Field>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={ShieldCheck} title="Automation log" subtitle="Engine decisions and actions for this server" />
        <div className="max-h-[320px] divide-y divide-white/[0.04] overflow-y-auto px-5 pb-3">
          {log.length === 0 && <div className="py-6 text-center text-[12.5px] text-sand-500">No automation events yet.</div>}
          {log.map((e, i) => (
            <div key={i} className="flex items-start gap-3 py-2 text-[12.5px]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: e.level === "error" ? "#ef5350" : e.level === "warn" ? "#f5b83d" : "#60a5fa" }} />
              <span className="w-20 shrink-0 text-[11px] text-sand-500 uppercase">{e.kind}</span>
              <span className="min-w-0 flex-1 break-words text-sand-200">{e.message}</span>
              <span className="shrink-0 text-[11px] text-sand-500">{ago(e.ts)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
