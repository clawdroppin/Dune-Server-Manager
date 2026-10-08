import { RosterCard } from "./RosterCard";
import { BookmarkPlus, Database, KeyRound, Lock, Play, ShieldAlert, Table2, Trash2, TrendingUp, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { AreaChart } from "../../components/charts";
import { Badge, Button, Callout, Card, CardHeader, confirm, Empty, IconButton, Input, Stat, Textarea, Toggle } from "../../components/ui";
import type { Instance } from "../../lib/types";

const PRESETS = [
  { name: "List tables (with row estimates)", sql: "select schemaname as table_schema, relname as table_name, n_live_tup as rows from pg_stat_user_tables order by n_live_tup desc" },
  { name: "Largest tables on disk", sql: "select relname as table, pg_size_pretty(pg_total_relation_size(relid)) as size from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 25" },
  { name: "Columns of a table", sql: "select column_name, data_type from information_schema.columns where table_name = 'REPLACE_ME' order by ordinal_position" },
  { name: "Players & online status", sql: "select ps.player_controller_id as id, ps.character_name, ps.online_status::text as status, a.map, ps.last_avatar_activity from dune.player_state ps left join dune.actors a on a.id = ps.player_controller_id order by ps.last_avatar_activity desc nulls last" },
  { name: "Richest players (Solari)", sql: "select ps.character_name, b.balance from dune.player_virtual_currency_balances b join dune.player_state ps on ps.player_controller_id = b.player_controller_id where b.currency_id = dune.get_solaris_id() order by b.balance desc limit 25" },
  { name: "Top builders", sql: "select ps.character_name, count(b.id) as buildings from dune.actors a join dune.buildings b on b.id = a.id left join dune.player_state ps on ps.account_id = a.owner_account_id group by ps.character_name order by buildings desc limit 25" },
  { name: "XP by track", sql: "select ps.character_name, st.track_type::text as track, st.xp_amount, st.level from dune.specialization_tracks st left join dune.player_state ps on ps.player_controller_id = st.player_id order by st.xp_amount desc limit 50" },
  { name: "Most common items", sql: "select template_id, count(*) as stacks, sum(stack_size) as total from dune.items group by template_id order by total desc limit 30" },
  { name: "Active DB sessions", sql: "select pid, usename, application_name, state, now()-query_start as running_for from pg_stat_activity where state is not null order by query_start" },
];

const parseTable = api.parsePsql;

export function PlayersTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const update = useStore((s) => s.updateInstance);
  const setTab = useStore((s) => s.setInstanceTab);
  const bg = pickBattlegroup(inst, tel);
  const h = tel?.history ?? [];
  const avg = useMemo(() => {
    const v = h.map((s) => s.players).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  }, [h]);
  const maps = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const s of bg?.servers ?? []) {
      const k = s.label.replace(/ #\d+$/, "");
      agg[k] = (agg[k] ?? 0) + (s.players ?? 0);
    }
    return Object.entries(agg).sort((a, b) => b[1] - a[1]);
  }, [bg]);
  const maxMap = Math.max(1, ...maps.map((m) => m[1]));

  const [sql, setSql] = useState(PRESETS[0].sql);
  const [out, setOut] = useState<{ code: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [writes, setWrites] = useState(false);
  const [saveName, setSaveName] = useState("");
  const table = out ? parseTable(out.text) : null;

  const runSql = async () => {
    if (!bg) return;
    setBusy(true);
    try {
      const r = await api.sqlQuery(inst, bg.namespace, sql, !writes);
      setOut({ code: r.code, text: (r.stdout || r.stderr).trim() });
    } catch (e) {
      setOut({ code: 1, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <Stat label="Online now" icon={Users} value={bg && !bg.stop ? bg.players : "—"} />
        </Card>
        <Card className="p-4">
          <Stat label="Session peak" icon={TrendingUp} value={tel?.peakPlayers ?? 0} />
        </Card>
        <Card className="p-4">
          <Stat label="Average (window)" icon={Users} value={avg.toFixed(1)} />
        </Card>
        <Card className="p-4">
          <Stat label="Busiest map" icon={TrendingUp} value={maps[0]?.[1] ? maps[0][0] : "—"} sub={maps[0]?.[1] ? `${maps[0][1]} players` : undefined} />
        </Card>
      </div>

      <RosterCard inst={inst} ns={bg?.namespace || inst.namespace} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader icon={Users} title="Players over time" subtitle="Sampled from ServerStats on every poll" />
          <div className="px-4 pb-4">
            <AreaChart times={h.map((s) => s.t)} series={[{ key: "p", label: "Players", color: "var(--accent)", values: h.map((s) => s.players) }]} height={200} />
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader icon={TrendingUp} title="Distribution by map" subtitle="Players per map (all partitions summed)" />
          <div className="space-y-2.5 px-5 pb-5">
            {maps.length === 0 && <div className="py-6 text-center text-[13px] text-sand-500">No map data</div>}
            {maps.map(([name, n]) => (
              <div key={name} className="group" title={`${name}: ${n}`}>
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span className="text-sand-200">{name}</span>
                  <span className="font-mono text-sand-300 tabular-nums">{n}</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.05]">
                  <div className="h-2 rounded-r-[4px] rounded-l-full bg-[var(--accent)] transition-all group-hover:brightness-125" style={{ width: `${(n / maxMap) * 100}%`, minWidth: n ? 4 : 0 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={KeyRound} title="Access control" subtitle="How you gate who can join a self-hosted world" />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
          <Callout kind="info" icon={Lock} title="Join password = whitelist">
            Funcom’s self-host build has no RCON. Access is controlled with <span className="font-mono">Bgd.ServerLoginPassword</span> in UserEngine.ini. Set it in Game Settings → Server, then restart. Test with a second account before going public: an edited INI alone has been reported not to block unauthenticated joins in some builds.
            <div className="mt-2">
              <Button size="sm" onClick={() => setTab(inst.id, "config")}>
                Open game settings
              </Button>
            </div>
          </Callout>
          <Callout kind="warn" icon={ShieldAlert} title="Kick / ban">
            Kick is in the roster above (it flags the session as LoggingOut in the world DB). There’s no ban list: to keep someone out, rotate the join password and restart. Funcom has said official admin commands are planned; experimental in-game GM settings are in Game Settings → Admin.
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={Database}
          title="World database explorer"
          subtitle="Runs psql inside the battlegroup's PostgreSQL pod. Read-only transaction unless you enable writes."
          actions={
            <div className="flex items-center gap-2 text-[12px] text-sand-400">
              Allow writes
              <Toggle
                size="sm"
                checked={writes}
                onChange={async (v) => {
                  if (v && !(await confirm({ title: "Enable database writes?", body: "Writes go straight to the live world database. Stop the battlegroup and take a DB backup first. Mistakes can corrupt characters and bases.", danger: true, typeToConfirm: "I have a backup", confirmLabel: "Enable writes" })))
                    return;
                  setWrites(v);
                }}
              />
            </div>
          }
        />
        <div className="grid gap-4 px-5 pb-5 xl:grid-cols-[260px_1fr]">
          <div className="space-y-1">
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-sand-500 uppercase">Snippets</div>
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setSql(p.sql)} className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-sand-300 hover:bg-white/[0.05] hover:text-sand-50">
                {p.name}
              </button>
            ))}
            {(inst.sqlQueries ?? []).length > 0 && <div className="mt-3 mb-1 text-[11px] font-semibold tracking-wider text-sand-500 uppercase">Saved</div>}
            {(inst.sqlQueries ?? []).map((p, i) => (
              <div key={i} className="group flex items-center">
                <button onClick={() => setSql(p.sql)} className="flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-sand-300 hover:bg-white/[0.05] hover:text-sand-50">
                  {p.name}
                </button>
                <IconButton icon={Trash2} label="Delete" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => update(inst.id, { sqlQueries: (inst.sqlQueries ?? []).filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
          <div className="min-w-0 space-y-3">
            <Textarea mono rows={5} value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} onKeyDown={(e) => e.ctrlKey && e.key === "Enter" && runSql()} />
            <div className="flex items-center gap-2">
              <Button variant="primary" icon={Play} onClick={runSql} loading={busy} disabled={!bg}>
                Run query
              </Button>
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Query name" className="w-40" />
              <Button
                variant="ghost"
                icon={BookmarkPlus}
                disabled={!saveName.trim()}
                onClick={() => {
                  update(inst.id, { sqlQueries: [...(inst.sqlQueries ?? []), { name: saveName.trim(), sql }] });
                  setSaveName("");
                }}
              >
                Save
              </Button>
              <span className="text-[11.5px] text-sand-500">Ctrl+Enter to run</span>
              {writes && <Badge color="#ef5350">WRITES ENABLED</Badge>}
            </div>
            {out &&
              (table ? (
                <div className="max-h-[420px] overflow-auto rounded-xl border border-white/[0.06]">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-[#1d1814]">
                      <tr>
                        {table.head.map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-mono font-medium text-sand-300">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="selectable">
                      {table.rows.map((r, i) => (
                        <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.025]">
                          {r.map((c, j) => (
                            <td key={j} className="max-w-[340px] truncate px-3 py-1.5 font-mono text-sand-200" title={c}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t border-white/[0.05] px-3 py-1.5 text-[11px] text-sand-500">{table.rows.length} rows</div>
                </div>
              ) : (
                <pre className={`max-h-[300px] overflow-auto rounded-xl p-3 font-mono text-[12px] whitespace-pre-wrap selectable ${out.code === 0 ? "bg-black/40 text-sand-200" : "bg-bad/10 text-[#ff9e9b]"}`}>{out.text || "(no output)"}</pre>
              ))}
            {!out && <Empty icon={Table2} title="Explore your world" body="Table names and schemas aren't documented by Funcom. Start with “List tables”, then inspect columns." />}
          </div>
        </div>
      </Card>
    </div>
  );
}
