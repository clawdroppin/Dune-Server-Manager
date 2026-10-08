import type { Battlegroup, Health, Instance } from "./types";
import type { Telemetry } from "./store";

export function pickBattlegroup(inst: Instance, tel?: Telemetry): Battlegroup | undefined {
  const bgs = tel?.snapshot?.battlegroups ?? [];
  return bgs.find((b) => b.namespace === inst.namespace && (!inst.battlegroup || b.name === inst.battlegroup)) ?? bgs.find((b) => b.namespace === inst.namespace) ?? bgs[0];
}

export function health(inst: Instance, tel: Telemetry | undefined, busy: boolean): Health {
  if (busy) return "busy";
  if (!tel || (!tel.snapshot && !tel.error)) return "unknown";
  if (!tel.snapshot || tel.error) return "offline";
  const bg = pickBattlegroup(inst, tel);
  if (!bg) return "offline";
  if (bg.stop) return bg.servers.length === 0 || bg.phase === "Stopped" ? "stopped" : "starting";
  const n = bg.servers.length;
  const ready = bg.servers.filter((s) => s.ready).length;
  if (n > 0 && ready === n) return "online";
  // Operator phases like Starting/Progressing/Reconciling/Pending mean a rollout is underway.
  if (/start|progress|pending|reconcil|creat|updat|init/i.test(`${bg.phase} ${bg.serverGroupPhase}`)) return "starting";
  const crashing = tel.snapshot.pods.some((p) => p.namespace === bg.namespace && /crash|backoff|error|oom/i.test(p.reason));
  if (crashing) return "degraded";
  // Map servers start on demand; a recently (re)started world is still "starting".
  const newest = Math.max(bg.start ? Date.parse(bg.start) : 0, ...bg.servers.map((s) => (s.start ? Date.parse(s.start) : 0)));
  const age = newest ? (Date.now() - newest) / 1000 : Infinity;
  return age > 600 ? "degraded" : "starting";
}

export const HEALTH_META: Record<Health, { label: string; color: string; pulse: boolean }> = {
  online: { label: "Online", color: "#34d399", pulse: true },
  starting: { label: "Starting", color: "#f5b83d", pulse: true },
  degraded: { label: "Degraded", color: "#f97316", pulse: true },
  stopped: { label: "Stopped", color: "#8b7d70", pulse: false },
  offline: { label: "Unreachable", color: "#ef5350", pulse: false },
  unknown: { label: "Connecting", color: "#6b7280", pulse: true },
  busy: { label: "Working", color: "#60a5fa", pulse: true },
};

/** 0-100 composite score used by the health ring. */
export function healthScore(inst: Instance, tel?: Telemetry): number {
  const s = tel?.snapshot;
  if (!s) return 0;
  const bg = pickBattlegroup(inst, tel);
  let score = 100;
  if (!bg) return 10;
  if (bg.stop) return 0;
  const n = bg.servers.length || 1;
  score -= (1 - bg.servers.filter((x) => x.ready).length / n) * 45;
  if (!/ready|running|healthy/i.test(bg.databasePhase)) score -= 15;
  if (bg.directorPhase && !/healthy|running/i.test(bg.directorPhase)) score -= 10;
  const crashing = s.pods.filter((p) => p.reason && /crash|error|backoff/i.test(p.reason)).length;
  score -= Math.min(20, crashing * 10);
  const memPct = s.vm.memTotal ? (1 - s.vm.memAvailable / s.vm.memTotal) * 100 : 0;
  if (memPct > 92) score -= 10;
  if ((s.vm.cpu ?? 0) > 92) score -= 5;
  return Math.max(0, Math.round(score));
}
