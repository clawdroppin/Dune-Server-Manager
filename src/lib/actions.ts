import * as api from "./api";
import { pickBattlegroup } from "./health";
import { runJob } from "./jobs";
import { useStore } from "./store";
import { confirm } from "../components/ui";
import type { Instance } from "./types";

function ctx(inst: Instance) {
  const s = useStore.getState();
  const tel = s.telemetry[inst.id];
  const bg = pickBattlegroup(inst, tel);
  return { s, tel, bg, ns: bg?.namespace || inst.namespace, name: bg?.name || inst.battlegroup };
}

function fail(inst: Instance, what: string, e: unknown) {
  const s = useStore.getState();
  s.toast({ kind: "error", title: `${what} failed`, body: String(e) });
  s.log({ instanceId: inst.id, level: "error", kind: "action", message: `${what} failed: ${e}` });
}

async function ensureVm(inst: Instance) {
  if (inst.mode !== "real" || !inst.vmName) return;
  const vm = useStore.getState().vms.find((v) => v.name === inst.vmName);
  if (vm && vm.state !== "Running") {
    useStore.getState().toast({ kind: "info", title: "Starting VM", body: `${inst.vmName} was ${vm.state}. Booting it first…` });
    await api.vmAction(inst, "start");
    // Give k3s + operators time to come up before patching the CR.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const snap = await api.snapshot(inst);
        if (snap.battlegroups.length) return;
      } catch {
        /* still booting */
      }
    }
  }
}

export async function startInstance(inst: Instance) {
  const { s, ns, name } = ctx(inst);
  try {
    await ensureVm(inst);
    const fresh = ctx(inst);
    if (!(fresh.ns || ns) || !(fresh.name || name)) throw new Error("Battlegroup not discovered yet. Check the connection settings.");
    await api.setStop(inst, fresh.ns || ns, fresh.name || name, false);
    s.updateInstance(inst.id, { desiredRunning: true, maintenance: false });
    s.toast({ kind: "success", title: `${inst.name}: starting`, body: "Map servers will come online over the next few minutes." });
    s.log({ instanceId: inst.id, level: "info", kind: "state", message: "Battlegroup start requested" });
    api.notify(inst, "info", "state", "Battlegroup starting", "Start requested from Dune Server Manager.");
  } catch (e) {
    fail(inst, "Start", e);
  }
}

export async function stopInstance(inst: Instance, skipConfirm = false) {
  const { s, bg, ns, name } = ctx(inst);
  if (!skipConfirm && s.settings.confirmDangerous) {
    const players = bg?.players ?? 0;
    const ok = await confirm({
      title: `Stop ${inst.name}?`,
      body: players > 0 ? `${players} player${players === 1 ? " is" : "s are"} online and will be disconnected. The watchdog will not restart it.` : "All map servers will shut down. The watchdog will not restart it.",
      confirmLabel: "Stop battlegroup",
      danger: true,
    });
    if (!ok) return;
  }
  try {
    s.updateInstance(inst.id, { desiredRunning: false });
    await api.setStop(inst, ns, name, true);
    s.toast({ kind: "info", title: `${inst.name}: stopping` });
    s.log({ instanceId: inst.id, level: "info", kind: "state", message: "Battlegroup stop requested" });
    api.notify(inst, "warn", "state", "Battlegroup stopping", "Stop requested from Dune Server Manager.");
  } catch (e) {
    fail(inst, "Stop", e);
  }
}

export async function wrapperAction(inst: Instance, args: string[], title: string, opts: { confirmText?: string; danger?: boolean; typeToConfirm?: string } = {}) {
  const { s, ns } = ctx(inst);
  if (opts.confirmText && s.settings.confirmDangerous) {
    const ok = await confirm({ title, body: opts.confirmText, danger: opts.danger, confirmLabel: title, typeToConfirm: opts.typeToConfirm });
    if (!ok) return null;
  }
  s.log({ instanceId: inst.id, level: "info", kind: "action", message: `${title} started` });
  const code = await runJob(`${inst.name} · ${title}`, inst.id, (sid) => api.wrapperStream(inst, ns, args, sid), { open: true });
  const ok = code === 0;
  s.toast({ kind: ok ? "success" : "error", title: `${title} ${ok ? "finished" : "failed"}`, body: inst.name });
  s.log({ instanceId: inst.id, level: ok ? "info" : "error", kind: "action", message: `${title} ${ok ? "finished" : `failed (exit ${code})`}` });
  return code;
}

export const restartInstance = (inst: Instance) =>
  wrapperAction(inst, ["restart"], "Restart battlegroup", {
    confirmText: "Stops every map server, waits, then starts the battlegroup again. Players will be disconnected for a few minutes.",
  });

export const updateInstance = (inst: Instance) =>
  wrapperAction(inst, ["update"], "Update server", {
    confirmText: "Pulls the latest Steam build inside the VM and rolls every pod. Take a backup first. Players will be disconnected.",
  });

export async function toggleMaintenance(inst: Instance) {
  const s = useStore.getState();
  const on = !inst.maintenance;
  s.updateInstance(inst.id, { maintenance: on });
  s.toast({ kind: "info", title: on ? "Maintenance mode on" : "Maintenance mode off", body: on ? "Watchdog and scheduled restarts are paused." : "Watchdog and schedules resumed." });
  s.log({ instanceId: inst.id, level: "info", kind: "state", message: on ? "Maintenance mode enabled" : "Maintenance mode disabled" });
}
