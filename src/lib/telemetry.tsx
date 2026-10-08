import { useEffect, useRef } from "react";
import { hostStats, snapshot, vmList, automationLog } from "./api";
import { useStore } from "./store";
import { isTauri, listen } from "./tauri";
import { pickBattlegroup } from "./health";
import type { LogEntry } from "./types";

/**
 * Headless component that drives all polling:
 *  - host stats every 2s
 *  - per-instance battlegroup snapshots (fast for the visible instance, slower for background ones)
 *  - Hyper-V inventory every 10s (only when a real instance references a VM)
 *  - automation engine events from Rust
 */
export function TelemetryManager() {
  const inflight = useRef(new Set<string>());
  const lastPoll = useRef(new Map<string, number>());

  // Host
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const h = await hostStats();
        if (alive) useStore.getState().setHost(h);
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Instances
  useEffect(() => {
    const t = setInterval(() => {
      const s = useStore.getState();
      // Hidden window (tray): the Rust automation engine keeps watching; skip UI polling.
      if (document.hidden) return;
      const base = Math.max(2, s.settings.pollSeconds) * 1000;
      const visible = s.view.kind === "instance" ? s.view.id : null;
      for (const inst of s.instances) {
        const interval = inst.id === visible || s.view.kind === "home" ? base : base * 3;
        const last = lastPoll.current.get(inst.id) ?? 0;
        if (Date.now() - last < interval || inflight.current.has(inst.id)) continue;
        if (inst.mode === "real" && !inst.ssh.host) continue;
        inflight.current.add(inst.id);
        lastPoll.current.set(inst.id, Date.now());
        snapshot(inst)
          .then((snap) => {
            const st = useStore.getState();
            const tel = { snapshot: snap, error: snap.ok ? null : snap.error ?? "Incomplete snapshot", updated: Date.now(), connected: true };
            const bg = pickBattlegroup(inst, { ...tel, history: [], peakPlayers: 0 });
            const memPct = snap.vm.memTotal ? (1 - snap.vm.memAvailable / snap.vm.memTotal) * 100 : null;
            st.setTelemetry(inst.id, tel, { t: Date.now(), cpu: snap.vm.cpu, mem: memPct, rx: snap.vm.rxBps, tx: snap.vm.txBps, players: bg ? bg.players : null });
            // Learn namespace / battlegroup name automatically on first contact.
            if (bg && (!inst.namespace || !inst.battlegroup)) st.updateInstance(inst.id, { namespace: bg.namespace, battlegroup: bg.name });
          })
          .catch((e) => {
            useStore.getState().setTelemetry(inst.id, { error: String(e), updated: Date.now(), connected: false });
          })
          .finally(() => inflight.current.delete(inst.id));
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Hyper-V inventory
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const tick = async () => {
      const s = useStore.getState();
      if (!s.instances.some((i) => i.mode === "real" && i.vmName)) return;
      try {
        const v = await vmList();
        if (alive) useStore.getState().setVms(v);
      } catch {
        /* Hyper-V module unavailable or not elevated */
      }
    };
    tick();
    const t = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Automation engine events
  useEffect(() => {
    if (!isTauri) return;
    const uns: (() => void)[] = [];
    let alive = true;
    automationLog().then((l) => {
      const st = useStore.getState();
      const seen = new Set(st.activity.map((a) => `${a.ts}${a.message}`));
      l.filter((e) => !seen.has(`${e.ts}${e.message}`)).forEach((e) => st.log(e));
    });
    listen<LogEntry>("automation://log", (e) => {
      const st = useStore.getState();
      st.log(e.payload);
      if (e.payload.level === "error") {
        const inst = st.instances.find((i) => i.id === e.payload.instanceId);
        st.toast({ kind: "error", title: inst?.name ?? "Automation", body: e.payload.message });
      }
    }).then((u) => (alive ? uns.push(u) : u()));
    listen<string[]>("automation://busy", (e) => useStore.getState().setBusy(e.payload)).then((u) => (alive ? uns.push(u) : u()));
    return () => {
      alive = false;
      uns.forEach((u) => u());
    };
  }, []);

  return null;
}
