/**
 * Player administration through the battlegroup's PostgreSQL world database.
 *
 * Funcom ships no RCON. These queries use the schema documented by the community `dune-admin` tool
 * (github.com/Icehunter/dune-awakening-truenas): schema `dune`, tables player_state, actors,
 * specialization_tracks, player_virtual_currency_balances, buildings, totems.
 * Kick works by setting player_state.online_status = 'LoggingOut'; the game server reads it on its
 * next heartbeat and disconnects the session without touching game data.
 * If Funcom changes the schema, update the SQL here (see AGENTS.md → "Player admin").
 */
import { isTauri } from "./tauri";
import { parsePsql, sqlQuery } from "./api";
import type { Instance } from "./types";

export interface RosterRow {
  id: number;
  name: string;
  map: string;
  status: string;
  lastSeen: string;
  accountId: number;
  buildings: number | null;
  totems: number | null;
  solari: number | null;
}

const int = (v: number) => {
  if (!Number.isFinite(v) || !Number.isInteger(v)) throw new Error(`Invalid number: ${v}`);
  return v;
};
const ident = (v: string) => {
  if (!/^[A-Za-z0-9_]+$/.test(v)) throw new Error(`Invalid identifier: ${v}`);
  return v;
};

const isDemo = (i: Instance) => i.mode === "demo" || !isTauri;

async function rows(inst: Instance, ns: string, sql: string, readOnly = true) {
  const out = await sqlQuery(inst, ns, sql, readOnly);
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim() || `psql exited ${out.code}`);
  return parsePsql(out.stdout);
}

// ---------------------------------------------------------------- demo data
const DEMO_NAMES = ["Muad'Dib", "Chani", "Stilgar", "Jamis", "Liet", "Shishakli", "Otheym", "Harah", "Korba", "Farok", "Idaho", "Gurney"];
const demoRoster: RosterRow[] = DEMO_NAMES.map((name, i) => ({
  id: 4100 + i,
  name,
  map: ["Survival_1", "DeepDesert_1", "SH_Arrakeen", "Survival_1", "Overmap"][i % 5],
  status: i < 7 ? "Online" : "Offline",
  lastSeen: new Date(Date.now() - (i < 7 ? 0 : i * 7200e3)).toISOString(),
  accountId: 900 + i,
  buildings: (i * 37) % 260,
  totems: i % 3,
  solari: 1500 + i * 2311,
}));
const demoXp: Record<number, Record<string, number>> = {};

// ---------------------------------------------------------------- queries
export async function fetchRoster(inst: Instance, ns: string): Promise<RosterRow[]> {
  if (isDemo(inst)) {
    await new Promise((r) => setTimeout(r, 250));
    return demoRoster.map((r) => ({ ...r }));
  }
  const base = await rows(
    inst,
    ns,
    `SELECT ps.player_controller_id AS id,
            replace(COALESCE(ps.character_name, ''), '|', '/') AS name,
            COALESCE(a.map, '') AS map,
            ps.online_status::text AS status,
            COALESCE(to_char(ps.last_avatar_activity AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') AS last_seen,
            COALESCE(ps.account_id, 0) AS account
       FROM dune.player_state ps
       LEFT JOIN dune.actors a ON a.id = ps.player_controller_id
      ORDER BY ps.last_avatar_activity DESC NULLS LAST`,
  );
  const list: RosterRow[] = (base?.rows ?? []).map((r) => ({
    id: Number(r[0]),
    name: r[1] || `#${r[0]}`,
    map: r[2],
    status: r[3],
    lastSeen: r[4],
    accountId: Number(r[5]),
    buildings: null,
    totems: null,
    solari: null,
  }));
  // Enrichment queries are best-effort: a schema drift there must not break the roster.
  await Promise.all([
    rows(
      inst,
      ns,
      `SELECT a.owner_account_id, count(b.id), count(t.id)
         FROM dune.actors a
         LEFT JOIN dune.buildings b ON b.id = a.id
         LEFT JOIN dune.totems t ON t.id = a.id
        WHERE a.owner_account_id IS NOT NULL AND (b.id IS NOT NULL OR t.id IS NOT NULL)
        GROUP BY a.owner_account_id`,
    )
      .then((t) => {
        const m = new Map((t?.rows ?? []).map((r) => [Number(r[0]), [Number(r[1]), Number(r[2])]]));
        for (const p of list) {
          const c = m.get(p.accountId);
          p.buildings = c?.[0] ?? 0;
          p.totems = c?.[1] ?? 0;
        }
      })
      .catch(() => {}),
    rows(inst, ns, `SELECT player_controller_id, balance FROM dune.player_virtual_currency_balances WHERE currency_id = dune.get_solaris_id()`)
      .then((t) => {
        const m = new Map((t?.rows ?? []).map((r) => [Number(r[0]), Number(r[1])]));
        for (const p of list) p.solari = m.get(p.id) ?? 0;
      })
      .catch(() => {}),
  ]);
  return list;
}

export async function xpTracks(inst: Instance, ns: string, playerId: number): Promise<{ track: string; xp: number; level: number }[]> {
  if (isDemo(inst)) {
    const x = (demoXp[playerId] ??= { Combat: 12000, Gathering: 8400, Crafting: 5100, Exploration: 2300 });
    return Object.entries(x).map(([track, xp]) => ({ track, xp, level: Math.floor(xp / 4000) }));
  }
  const [all, mine] = await Promise.all([
    rows(inst, ns, `SELECT unnest(enum_range(NULL::dune.specializationtracktype))::text AS track, 0 AS z`).catch(() => null),
    rows(inst, ns, `SELECT track_type::text, xp_amount, level FROM dune.specialization_tracks WHERE player_id = ${int(playerId)}`),
  ]);
  const have = new Map((mine?.rows ?? []).map((r) => [r[0], { xp: Number(r[1]), level: Number(r[2]) }]));
  const names = new Set<string>([...(all?.rows ?? []).map((r) => r[0]), ...have.keys()]);
  return [...names].map((track) => ({ track, xp: have.get(track)?.xp ?? 0, level: have.get(track)?.level ?? 0 }));
}

// ---------------------------------------------------------------- actions (writes)
export async function kickPlayer(inst: Instance, ns: string, playerId: number) {
  if (isDemo(inst)) {
    const p = demoRoster.find((r) => r.id === playerId);
    if (p) p.status = "Offline";
    return;
  }
  const out = await sqlQuery(inst, ns, `UPDATE dune.player_state SET online_status = 'LoggingOut'::dune.playerconnectionstatus WHERE player_controller_id = ${int(playerId)}`, false);
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim());
  if (/UPDATE 0/.test(out.stdout)) throw new Error("No player_state row for that player");
}

export async function giveSolari(inst: Instance, ns: string, playerId: number, amount: number) {
  if (isDemo(inst)) {
    const p = demoRoster.find((r) => r.id === playerId);
    if (p) p.solari = (p.solari ?? 0) + amount;
    return;
  }
  // The DB function enforces negative-balance guards and audit logging.
  const out = await sqlQuery(inst, ns, `SELECT dune.adjust_player_virtual_currency_balance(${int(playerId)}::bigint, dune.get_solaris_id(), ${int(amount)}::bigint)`, false);
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim());
}

export async function awardXp(inst: Instance, ns: string, playerId: number, track: string, amount: number) {
  if (isDemo(inst)) {
    const x = (demoXp[playerId] ??= {});
    x[track] = (x[track] ?? 0) + amount;
    return;
  }
  const id = int(playerId);
  const t = ident(track);
  const n = int(amount);
  const out = await sqlQuery(
    inst,
    ns,
    `WITH u AS (
       UPDATE dune.specialization_tracks SET xp_amount = xp_amount + ${n}
        WHERE player_id = ${id} AND track_type::text = '${t}' RETURNING 1)
     INSERT INTO dune.specialization_tracks (player_id, track_type, xp_amount, level)
     SELECT ${id}, '${t}'::dune.specializationtracktype, ${n}, 0 WHERE NOT EXISTS (SELECT 1 FROM u)`,
    false,
  );
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim());
}
