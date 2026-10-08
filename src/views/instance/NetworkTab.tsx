import { CheckCircle2, ClipboardCopy, Globe, Loader2, Network, Plug, RefreshCw, Router, ShieldHalf, Wifi, XCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import * as api from "../../lib/api";
import { isTauri } from "../../lib/tauri";
import { Badge, Button, Callout, Card, CardHeader, cx, Field, Input, Segmented, Toggle, useCopy } from "../../components/ui";
import type { Ddns, Instance } from "../../lib/types";

const RULES = [
  { protocol: "UDP", from: 7777, to: 7810, purpose: "Game servers (one port per map partition)", required: true },
  { protocol: "TCP", from: 31982, to: 31982, purpose: "RabbitMQ game queue (TLS)", required: true },
];

type Probe = { open: boolean; latencyMs: number | null; error: string | null } | "pending" | null;

export function NetworkTab({ inst }: { inst: Instance }) {
  const update = useStore((s) => s.updateInstance);
  const [pub, setPub] = useState<string | null>(null);
  const [upnp, setUpnp] = useState<api.UpnpStatus | null>(null);
  const [upnpErr, setUpnpErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const { copied, copy } = useCopy();
  const vmIp = inst.ssh.host;

  const refresh = async () => {
    setLoading(true);
    setUpnpErr(null);
    api.publicIp().then(setPub).catch(() => setPub(null));
    try {
      setUpnp(await api.upnpStatus());
    } catch (e) {
      setUpnp(null);
      setUpnpErr(String(e));
    }
    setLoading(false);
  };
  useEffect(() => {
    refresh();
  }, []);

  const mapped = (proto: string, port: number) => upnp?.mappings.find((m) => m.protocol.toUpperCase() === proto && m.externalPort === port);
  const ruleStatus = (r: (typeof RULES)[number]) => {
    let ok = 0;
    let wrong = 0;
    for (let p = r.from; p <= r.to; p++) {
      const m = mapped(r.protocol, p);
      if (m && m.internalClient === vmIp) ok++;
      else if (m) wrong++;
    }
    return { ok, wrong, total: r.to - r.from + 1 };
  };
  const doubleNat = !!(upnp?.externalIp && pub && upnp.externalIp !== pub) || !!upnp?.cgnat;

  const apply = async (remove: boolean) => {
    if (!vmIp) return;
    setApplying(true);
    try {
      const r = await api.upnpApply(vmIp, RULES.map(({ protocol, from, to }) => ({ protocol, from, to })), remove);
      useStore.getState().toast({ kind: r.failed.length ? "warn" : "success", title: remove ? "UPnP mappings removed" : "Ports forwarded via UPnP", body: `${r.ok} ok${r.failed.length ? `, ${r.failed.length} failed: ${r.failed.slice(0, 3).join("; ")}` : ""}` });
      await refresh();
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "UPnP failed", body: String(e) });
    } finally {
      setApplying(false);
    }
  };

  const probe = async (key: string, host: string, port: number) => {
    setProbes((p) => ({ ...p, [key]: "pending" }));
    const r = await api.tcpProbe(host, port, 3000);
    setProbes((p) => ({ ...p, [key]: r }));
  };

  const sheet = [`Dune: Awakening port forwards -> ${vmIp || "<VM IP>"}`, ...RULES.map((r) => `${r.protocol} ${r.from}${r.to !== r.from ? `-${r.to}` : ""}  ${r.purpose}`), "Do NOT expose: 22 (SSH), 15432 (Postgres), 32445 (RMQ admin), Director/k3s NodePorts"].join("\n");

  const ddns = inst.automation.ddns;
  const setDdns = (p: Partial<Ddns>) => update(inst.id, (i) => ({ automation: { ...i.automation, ddns: { ...i.automation.ddns, ...p } } }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold tracking-wider text-sand-400 uppercase">
            <Globe className="size-3.5" /> Public IP
          </div>
          <div className="mt-2 font-mono text-xl text-sand-50 selectable">{pub ?? "—"}</div>
          {doubleNat ? <Badge color="#ef5350">CGNAT / double NAT suspected</Badge> : pub && <Badge color="#34d399">Direct public IPv4</Badge>}
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold tracking-wider text-sand-400 uppercase">
            <Router className="size-3.5" /> Router (UPnP)
          </div>
          <div className="mt-2 font-mono text-[15px] text-sand-50">{upnp ? upnp.gateway : upnpErr ? "unavailable" : "…"}</div>
          <div className="text-[12px] text-sand-400">{upnp ? `WAN ${upnp.externalIp ?? "?"} · ${upnp.mappings.length} mappings` : upnpErr ?? ""}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold tracking-wider text-sand-400 uppercase">
            <Network className="size-3.5" /> Battlegroup VM
          </div>
          <div className="mt-2 font-mono text-xl text-sand-50">{vmIp || "—"}</div>
          <div className="text-[12px] text-sand-400">Reserve this IP by MAC in your router’s DHCP</div>
        </Card>
      </div>

      {doubleNat && (
        <Callout kind="error" icon={XCircle} title="Your router's WAN address differs from your public IP">
          You’re probably behind carrier-grade NAT or a second router. Port forwarding won’t reach you from the internet. Options: ask your ISP for a public IPv4, bridge the ISP modem, or relay through a VPS (WireGuard + UDP forwarding; see the security section below).
        </Callout>
      )}

      <Card>
        <CardHeader
          icon={Plug}
          title="Port forwarding"
          subtitle="Forward these to the VM, never to the Windows host"
          actions={
            <>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>
                Refresh
              </Button>
              <Button size="sm" variant="ghost" icon={ClipboardCopy} onClick={() => copy(sheet, "sheet")}>
                {copied === "sheet" ? "Copied!" : "Copy cheat sheet"}
              </Button>
              <Button size="sm" icon={XCircle} onClick={() => apply(true)} disabled={!upnp || !vmIp || applying}>
                Remove
              </Button>
              <Button size="sm" variant="primary" icon={Zap} onClick={() => apply(false)} loading={applying} disabled={!upnp || !vmIp}>
                Open via UPnP
              </Button>
            </>
          }
        />
        <div className="px-5 pb-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wider text-sand-500 uppercase">
                <th className="py-2 font-medium">Protocol</th>
                <th className="py-2 font-medium">Ports</th>
                <th className="py-2 font-medium">Purpose</th>
                <th className="py-2 font-medium">UPnP status</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const s = ruleStatus(r);
                return (
                  <tr key={r.from} className="border-t border-white/[0.05]">
                    <td className="py-3">
                      <Badge color={r.protocol === "UDP" ? "#60a5fa" : "#f08a24"}>{r.protocol}</Badge>
                    </td>
                    <td className="py-3 font-mono">
                      {r.from}
                      {r.to !== r.from && `–${r.to}`}
                    </td>
                    <td className="py-3 text-sand-300">{r.purpose}</td>
                    <td className="py-3">
                      {!upnp ? (
                        <span className="text-sand-500">unknown</span>
                      ) : s.ok === s.total ? (
                        <span className="flex items-center gap-1.5 text-ok">
                          <CheckCircle2 className="size-4" /> mapped to VM
                        </span>
                      ) : s.ok + s.wrong === 0 ? (
                        <span className="text-sand-400">not mapped (manual forward?)</span>
                      ) : (
                        <span className="text-warn">
                          {s.ok}/{s.total} to VM{s.wrong ? `, ${s.wrong} point elsewhere` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/[0.05] opacity-70">
                <td className="py-3">
                  <Badge>UDP</Badge>
                </td>
                <td className="py-3 font-mono">7888–7941</td>
                <td className="py-3 text-sand-400">Inter-server gateway (VM-internal, don’t forward)</td>
                <td className="py-3 text-sand-500">n/a</td>
              </tr>
            </tbody>
          </table>
          {!isTauri && <div className="mt-2 text-[12px] text-sand-500">UPnP and probes need the desktop app.</div>}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Wifi} title="Reachability tests" subtitle="TCP connect probes from this PC" />
          <div className="space-y-2 px-5 pb-5">
            {[
              { k: "ssh", label: "SSH on VM (LAN)", host: vmIp, port: inst.ssh.port || 22 },
              { k: "rmq-lan", label: "RabbitMQ 31982 on VM (LAN)", host: vmIp, port: 31982 },
              { k: "rmq-wan", label: "RabbitMQ 31982 via public IP", host: pub ?? "", port: 31982 },
            ].map((t) => {
              const p = probes[t.k];
              return (
                <div key={t.k} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2.5">
                  <span className="flex-1 text-[13px] text-sand-200">{t.label}</span>
                  <span className="font-mono text-[11.5px] text-sand-500">
                    {t.host || "?"}:{t.port}
                  </span>
                  <span className="w-28 text-right text-[12px]">
                    {p === "pending" ? (
                      <Loader2 className="ml-auto size-4 animate-spin text-sand-400" />
                    ) : p ? (
                      p.open ? (
                        <span className="text-ok">open · {p.latencyMs}ms</span>
                      ) : (
                        <span className="text-[#ff8a87]" title={p.error ?? ""}>
                          closed
                        </span>
                      )
                    ) : null}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => probe(t.k, t.host, t.port)} disabled={!t.host}>
                    Test
                  </Button>
                </div>
              );
            })}
            <div className="pt-1 text-[11.5px] leading-relaxed text-sand-500">
              Public-IP tests from inside your LAN depend on NAT hairpinning. “Closed” there doesn’t always mean the internet can’t reach you. UDP game ports can’t be probed with TCP; verify by joining from the server browser (Experimental tab).
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader icon={Globe} title="Dynamic DNS" subtitle="Keep a hostname pointed at your changing home IP (checked every 10 min)" actions={<Toggle checked={ddns.enabled} onChange={(v) => setDdns({ enabled: v })} />} />
          <div className={cx("space-y-3 px-5 pb-5", !ddns.enabled && "opacity-60")}>
            <Segmented
              value={ddns.provider}
              onChange={(v) => setDdns({ provider: v })}
              options={[
                { value: "duckdns", label: "DuckDNS" },
                { value: "cloudflare", label: "Cloudflare" },
                { value: "custom", label: "Custom URL" },
              ]}
            />
            <Field label={ddns.provider === "duckdns" ? "Subdomain (e.g. mysietch)" : "Hostname (e.g. dune.example.com)"}>
              <Input mono value={ddns.domain} onChange={(e) => setDdns({ domain: e.target.value.trim() })} />
            </Field>
            <Field label={ddns.provider === "cloudflare" ? "API token (Zone.DNS edit)" : "Token"}>
              <Input mono type="password" value={ddns.token} onChange={(e) => setDdns({ token: e.target.value.trim() })} />
            </Field>
            {ddns.provider === "cloudflare" && (
              <Field label="Zone ID">
                <Input mono value={ddns.zoneId ?? ""} onChange={(e) => setDdns({ zoneId: e.target.value.trim() })} />
              </Field>
            )}
            {ddns.provider === "custom" && (
              <Field label="Update URL" hint="Placeholders: {ip} {domain} {token}">
                <Input mono value={ddns.customUrl ?? ""} onChange={(e) => setDdns({ customUrl: e.target.value.trim() })} />
              </Field>
            )}
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const ip = pub ?? (await api.publicIp());
                  const r = await api.ddnsUpdate(ddns, ip);
                  useStore.getState().toast({ kind: "success", title: "DDNS updated", body: r });
                } catch (e) {
                  useStore.getState().toast({ kind: "error", title: "DDNS update failed", body: String(e) });
                }
              }}
              disabled={!ddns.domain || !ddns.token || !isTauri}
            >
              Update now
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={ShieldHalf} title="Security & DDoS posture" subtitle="What to expose, and how to hide your home IP" />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-3">
          <Callout kind="success" title="Minimal exposure">
            Forward only UDP 7777–7810 and TCP 31982. Never forward SSH, PostgreSQL (15432), RabbitMQ admin (32445), the Director UI or any k3s NodePort. The Director has no authentication.
          </Callout>
          <Callout kind="info" title="Hide your IP with a relay">
            A cheap VPS with DDoS filtering (e.g. OVH Game, Path.net-backed hosts) running WireGuard back to your LAN can DNAT the UDP/TCP ports to the VM. Players only ever see the VPS address.
          </Callout>
          <Callout kind="warn" title="Proxy caveats">
            HTTP/TCP-only proxies (Cloudflare proxy, TCPShield, Tailscale Funnel) can’t carry the UDP game traffic. Only full L3/L4 tunnels (GRE, WireGuard) or UDP-capable Spectrum plans work.
          </Callout>
        </div>
      </Card>
    </div>
  );
}
