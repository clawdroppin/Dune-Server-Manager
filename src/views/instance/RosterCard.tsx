import { Coins, LogOut, RefreshCw, Search, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import * as players from "../../lib/players";
import type { RosterRow } from "../../lib/players";
import { ago } from "../../lib/format";
import { Badge, Button, Callout, Card, CardHeader, confirm, cx, Empty, Field, IconButton, Input, Modal, Segmented, Select, Spinner } from "../../components/ui";
import type { Instance } from "../../lib/types";

const MAP_NAMES: Record<string, string> = { survival_1: "Hagga Basin", overmap: "Overland Map", deepdesert_1: "Deep Desert", sh_arrakeen: "Arrakeen", sh_harkovillage: "Harko Village" };
const mapName = (m: string) => MAP_NAMES[m.toLowerCase()] ?? (m.replace(/_/g, " ") || "—");
// Anything that is not an offline-like state counts as connected (enum names are community-documented).
const isOnline = (s: string) => !!s && !/offline|logged|loggingout|disconnect|none|unknown/i.test(s);

type Action = { kind: "solari" | "xp"; player: RosterRow } | null;

export function RosterCard({ inst, ns }: { inst: Instance; ns: string }) {
  const [list, setList] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"online" | "all">("online");
  const [q, setQ] = useState("");
  const [action, setAction] = useState<Action>(null);

  const load = useCallback(async () => {
    if (!ns) return;
    setLoading(true);
    setError(null);
    try {
      setList(await players.fetchRoster(inst, ns));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [inst.id, ns]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (list ?? []).filter((p) => (filter === "all" || isOnline(p.status)) && (!f || p.name.toLowerCase().includes(f) || String(p.id).includes(f)));
  }, [list, filter, q]);
  const onlineCount = (list ?? []).filter((p) => isOnline(p.status)).length;

  const log = (message: string) => useStore.getState().log({ instanceId: inst.id, level: "info", kind: "admin", message });

  const kick = async (p: RosterRow) => {
    const ok = await confirm({ title: `Kick ${p.name}?`, body: "Sets their session to LoggingOut. The server disconnects them on its next heartbeat. Inventory and buildings are untouched. They can rejoin unless you change the join password.", danger: true, confirmLabel: "Kick" });
    if (!ok) return;
    try {
      await players.kickPlayer(inst, ns, p.id);
      useStore.getState().toast({ kind: "success", title: `${p.name} is being disconnected` });
      log(`Kicked ${p.name} (#${p.id})`);
      setTimeout(load, 4000);
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Kick failed", body: String(e) });
    }
  };

  return (
    <Card>
      <CardHeader
        icon={Users}
        title="Player roster"
        subtitle={list ? `${onlineCount} online · ${list.length} characters in this world` : "Read from the world database"}
        actions={
          <>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "online", label: "Online" },
                { value: "all", label: "Everyone" },
              ]}
            />
            <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or ID" className="w-44" />
            <IconButton icon={RefreshCw} label="Refresh" onClick={load} />
          </>
        }
      />
      <div className="px-2 pb-3">
        {error ? (
          <div className="px-3 pb-2">
            <Callout kind="error" title="Couldn't read the roster">
              <span className="font-mono text-[12px] break-all">{error}</span>
              <div className="mt-1.5">The roster uses the community-documented <span className="font-mono">dune</span> schema. If Funcom changed it, the SQL Explorer below still works.</div>
            </Callout>
          </div>
        ) : list == null || loading ? (
          <div className="grid h-24 place-items-center">
            <Spinner />
          </div>
        ) : shown.length === 0 ? (
          <Empty icon={Users} title={filter === "online" ? "Nobody online right now" : "No characters found"} />
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 z-10 bg-[#1d1814]">
                <tr className="text-left text-[11px] tracking-wider text-sand-500 uppercase">
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 font-medium">Map</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                  <th className="px-3 py-2 text-right font-medium">Buildings</th>
                  <th className="px-3 py-2 text-right font-medium">Solari</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="group border-t border-white/[0.04] hover:bg-white/[0.025]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={cx("size-2 rounded-full", isOnline(p.status) ? "bg-ok" : "bg-sand-600")} title={p.status} />
                        <span className="font-medium text-sand-100">{p.name}</span>
                        <span className="font-mono text-[10.5px] text-sand-600">#{p.id}</span>
                        {!isOnline(p.status) && !/offline/i.test(p.status) && <Badge>{p.status}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sand-300">{mapName(p.map)}</td>
                    <td className="px-3 py-2 text-sand-400">{isOnline(p.status) ? "now" : p.lastSeen ? ago(Date.parse(p.lastSeen)) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-sand-300 tabular-nums">{p.buildings ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-sand-300 tabular-nums">{p.solari?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        <IconButton icon={Coins} label="Give Solari" size="sm" onClick={() => setAction({ kind: "solari", player: p })} />
                        <IconButton icon={Sparkles} label="Award XP" size="sm" onClick={() => setAction({ kind: "xp", player: p })} />
                        <IconButton icon={LogOut} label="Kick" size="sm" disabled={!isOnline(p.status)} onClick={() => kick(p)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ActionModal inst={inst} ns={ns} action={action} onClose={() => setAction(null)} onDone={(msg) => (log(msg), load())} />
    </Card>
  );
}

function ActionModal({ inst, ns, action, onClose, onDone }: { inst: Instance; ns: string; action: Action; onClose: () => void; onDone: (msg: string) => void }) {
  const [amount, setAmount] = useState("1000");
  const [tracks, setTracks] = useState<{ track: string; xp: number; level: number }[] | null>(null);
  const [track, setTrack] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTracks(null);
    setAmount(action?.kind === "xp" ? "5000" : "1000");
    if (action?.kind === "xp")
      players
        .xpTracks(inst, ns, action.player.id)
        .then((t) => {
          setTracks(t);
          setTrack(t[0]?.track ?? "");
        })
        .catch((e) => useStore.getState().toast({ kind: "error", title: "Couldn't load XP tracks", body: String(e) }));
  }, [action]);

  if (!action) return <Modal open={false} onClose={onClose}>{null}</Modal>;
  const p = action.player;
  const n = Number(amount);
  const valid = Number.isInteger(n) && n !== 0 && Math.abs(n) <= 100_000_000 && (action.kind === "solari" || !!track);

  const run = async () => {
    setBusy(true);
    try {
      if (action.kind === "solari") {
        await players.giveSolari(inst, ns, p.id, n);
        onDone(`${n > 0 ? "Gave" : "Removed"} ${Math.abs(n).toLocaleString()} Solari ${n > 0 ? "to" : "from"} ${p.name} (#${p.id})`);
      } else {
        await players.awardXp(inst, ns, p.id, track, n);
        onDone(`Awarded ${n.toLocaleString()} ${track} XP to ${p.name} (#${p.id})`);
      }
      useStore.getState().toast({ kind: "success", title: "Done", body: "Players may need to relog to see the change." });
      onClose();
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Action failed", body: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width={480}>
      <div className="space-y-4 p-6">
        <div>
          <div className="font-display text-lg font-semibold">{action.kind === "solari" ? "Give Solari" : "Award XP"}</div>
          <div className="text-[13px] text-sand-400">
            {p.name} <span className="font-mono text-sand-600">#{p.id}</span>
          </div>
        </div>
        {action.kind === "xp" && (
          <Field label="Specialization track">
            {tracks == null ? (
              <Spinner />
            ) : (
              <Select value={track} onChange={setTrack} options={tracks.map((t) => ({ value: t.track, label: `${t.track}: ${t.xp.toLocaleString()} XP (level ${t.level})` }))} />
            )}
          </Field>
        )}
        <Field label="Amount" hint={action.kind === "solari" ? "Negative values remove Solari (the database refuses to go below zero)." : "Added to the track's XP total."}>
          <Input type="number" mono value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && run()} />
        </Field>
        <Callout kind="warn">
          This writes straight to the live world database. Safest while the player is offline. Take a database backup first if you’re unsure.
        </Callout>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={!valid}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
