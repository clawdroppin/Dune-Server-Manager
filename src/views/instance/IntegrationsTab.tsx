import { BellRing, Megaphone, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useState } from "react";
import { useStore } from "../../lib/store";
import * as api from "../../lib/api";
import { uid } from "../../lib/format";
import { Badge, Button, Callout, Card, CardHeader, cx, Empty, Field, IconButton, Input, Textarea, Toggle } from "../../components/ui";
import type { Instance, Webhook, WebhookEvent } from "../../lib/types";

export const EVENTS: { id: WebhookEvent; label: string; color: string; hint: string }[] = [
  { id: "state", label: "State changes", color: "#f08a24", hint: "Start / stop / VM reachable again" },
  { id: "crash", label: "Crashes", color: "#ef5350", hint: "Pod restarts, unreachable VM, watchdog actions" },
  { id: "restart", label: "Restarts", color: "#f5b83d", hint: "Scheduled restart begin / done" },
  { id: "warning", label: "Restart warnings", color: "#f5b83d", hint: "Countdown messages before restarts" },
  { id: "update", label: "Updates", color: "#60a5fa", hint: "New Steam build, auto-update progress" },
  { id: "backup", label: "Backups", color: "#34d399", hint: "Backup complete / failed" },
  { id: "players", label: "Player count", color: "#a78bfa", hint: "Player joins and leaves (count deltas)" },
];

export function WebhookEditor({ hooks, onChange, scope }: { hooks: Webhook[]; onChange: (h: Webhook[]) => void; scope: string }) {
  const [testing, setTesting] = useState<string | null>(null);
  const set = (id: string, p: Partial<Webhook>) => onChange(hooks.map((h) => (h.id === id ? { ...h, ...p } : h)));
  return (
    <div className="space-y-3">
      {hooks.length === 0 && <Empty icon={WebhookIcon} title="No webhooks" body="Paste a Discord channel webhook URL (Channel settings → Integrations → Webhooks). Any service that accepts Discord-style JSON works too." />}
      {hooks.map((h) => (
        <div key={h.id} className={cx("rounded-2xl border border-white/[0.06] bg-black/20 p-4", !h.enabled && "opacity-60")}>
          <div className="flex items-center gap-3">
            <Toggle checked={h.enabled} onChange={(v) => set(h.id, { enabled: v })} />
            <input value={h.name} onChange={(e) => set(h.id, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent font-medium text-sand-50 outline-none" />
            <Button
              size="sm"
              variant="ghost"
              icon={Send}
              loading={testing === h.id}
              disabled={!h.url}
              onClick={async () => {
                setTesting(h.id);
                try {
                  await api.webhookSend(h, "✅ Test from Dune Server Manager", `Webhook **${h.name}** for ${scope} is wired up correctly.`, 0x34d399);
                  useStore.getState().toast({ kind: "success", title: "Test message sent" });
                } catch (e) {
                  useStore.getState().toast({ kind: "error", title: "Webhook failed", body: String(e) });
                } finally {
                  setTesting(null);
                }
              }}
            >
              Test
            </Button>
            <IconButton icon={Trash2} label="Remove" size="sm" onClick={() => onChange(hooks.filter((x) => x.id !== h.id))} />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_200px]">
            <Input mono type="password" placeholder="https://discord.com/api/webhooks/…" value={h.url} onChange={(e) => set(h.id, { url: e.target.value.trim() })} />
            <Input placeholder="Mention on crash, e.g. <@&roleId>" value={h.mention ?? ""} onChange={(e) => set(h.id, { mention: e.target.value })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EVENTS.map((ev) => {
              const on = h.events.length === 0 || h.events.includes(ev.id);
              return (
                <button
                  key={ev.id}
                  title={ev.hint}
                  onClick={() => {
                    const all = h.events.length === 0 ? EVENTS.map((e) => e.id) : h.events;
                    const next = all.includes(ev.id) ? all.filter((x) => x !== ev.id) : [...all, ev.id];
                    set(h.id, { events: next.length === EVENTS.length ? [] : next });
                  }}
                  className={cx("rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition", on ? "text-sand-50" : "border-white/[0.06] text-sand-500")}
                  style={on ? { borderColor: `${ev.color}55`, background: `${ev.color}1a` } : undefined}
                >
                  {ev.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <Button icon={Plus} onClick={() => onChange([...hooks, { id: uid(), name: "Discord #server-status", url: "", enabled: true, events: EVENTS.filter((e) => e.id !== "players").map((e) => e.id) }])}>
        Add webhook
      </Button>
    </div>
  );
}

export function IntegrationsTab({ inst }: { inst: Instance }) {
  const update = useStore((s) => s.updateInstance);
  const globals = useStore((s) => s.settings.webhooks);
  const setView = useStore((s) => s.setView);
  const [title, setTitle] = useState("📣 Server announcement");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const all = [...inst.webhooks, ...globals].filter((h) => h.enabled && h.url);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardHeader icon={WebhookIcon} title="Discord & webhooks" subtitle="Per-server notifications. Global webhooks (Settings) receive events from every server." />
        <div className="px-5 pb-5">
          <WebhookEditor hooks={inst.webhooks} onChange={(h) => update(inst.id, { webhooks: h })} scope={inst.name} />
          {globals.length > 0 && (
            <Callout kind="info" icon={BellRing} className="mt-4">
              Also delivering to {globals.length} global webhook{globals.length > 1 ? "s" : ""}.{" "}
              <button className="underline" onClick={() => setView({ kind: "settings" })}>
                Manage
              </button>
            </Callout>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader icon={Megaphone} title="Announcement" subtitle="Post a one-off message: wipe dates, events, maintenance windows" />
          <div className="space-y-3 px-5 pb-5">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Message (Discord markdown)">
              <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Coriolis wipe this **Tuesday 05:00**. Get your bases out of the Deep Desert!"} />
            </Field>
            <Button
              variant="primary"
              icon={Send}
              loading={sending}
              disabled={!body || all.length === 0}
              onClick={async () => {
                setSending(true);
                const res = await Promise.allSettled(all.map((h) => api.webhookSend(h, title, `${body}\n\n— *${inst.name}*`, 0xf08a24)));
                const failed = res.filter((r) => r.status === "rejected").length;
                useStore.getState().toast({ kind: failed ? "warn" : "success", title: `Sent to ${all.length - failed}/${all.length} webhooks` });
                setSending(false);
                if (!failed) setBody("");
              }}
            >
              Send to {all.length} webhook{all.length === 1 ? "" : "s"}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Preview" subtitle="How alerts render in Discord" />
          <div className="px-5 pb-5">
            <div className="rounded-lg bg-[#313338] p-3">
              <div className="flex gap-3">
                <div className="size-9 shrink-0 rounded-full accent-bg" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-white">
                    Dune Server Manager <span className="ml-1 rounded bg-[#5865f2] px-1 text-[10px]">APP</span>
                  </div>
                  <div className="mt-1 rounded border-l-4 border-[#ef4444] bg-[#2b2d31] p-3">
                    <div className="text-[13px] font-semibold text-white">Server process crashed</div>
                    <div className="mt-1 text-[12.5px] text-[#dbdee1]">`sg-deepdesert-1-0` restarted 1x (OOMKilled). Kubernetes restarted it automatically.</div>
                    <div className="mt-2 text-[11px] text-[#949ba4]">{inst.name} • crash</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EVENTS.map((e) => (
                <Badge key={e.id} color={e.color}>
                  {e.label}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
