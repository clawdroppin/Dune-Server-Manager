import { create } from "zustand";
import { invoke, isTauri } from "./tauri";
import { uid } from "./format";
import type { Automation, Folder, HostStats, HyperVm, Instance, InstanceTab, LogEntry, Sample, Settings, Snapshot } from "./types";
import { APP_LIVE, DEFAULT_SETTINGS_DIR } from "./api";

export const FOLDER_COLORS = ["#f08a24", "#3987e5", "#2fb67c", "#e5484d", "#9b7bf0", "#e8b02b", "#22b8cf", "#a3a3a3"];

export function defaultAutomation(): Automation {
  return {
    watchdog: true,
    watchdogVm: true,
    crashAlerts: true,
    restarts: [{ id: uid(), time: "05:00", days: [], enabled: false }],
    warnMinutes: [30, 15, 5, 1],
    backupEnabled: true,
    backupIntervalHours: 6,
    backupKeep: 20,
    backupIncludeDb: false,
    updateCheck: true,
    updateIntervalMinutes: 30,
    autoUpdate: false,
    ddns: { enabled: false, provider: "duckdns", domain: "", token: "" },
  };
}

export function newInstance(partial: Partial<Instance> = {}): Instance {
  return {
    id: uid("i-"),
    name: "New Battlegroup",
    description: "",
    folderId: null,
    tags: [],
    color: FOLDER_COLORS[0],
    mode: "real",
    branch: "live",
    appId: APP_LIVE,
    installDir: "",
    batPath: "",
    vmName: "dune-awakening",
    ssh: { host: "", port: 22, user: "dune", keyPath: "" },
    namespace: "",
    battlegroup: "",
    settingsDir: DEFAULT_SETTINGS_DIR,
    desiredRunning: true,
    maintenance: false,
    automation: defaultAutomation(),
    webhooks: [],
    notes: "",
    favorite: false,
    createdAt: Date.now(),
    sqlQueries: [],
    ...partial,
  };
}

const defaultSettings: Settings = {
  backupRoot: "",
  steamcmdDir: "",
  serversDir: "",
  steamUser: "",
  closeBehavior: "ask",
  trayHintShown: false,
  pollSeconds: 5,
  confirmDangerous: true,
  accent: "spice",
  reduceMotion: false,
  webhooks: [],
  onboarded: false,
  desktopNotifications: true,
};

export interface Telemetry {
  snapshot: Snapshot | null;
  history: Sample[];
  error: string | null;
  updated: number;
  connected: boolean;
  peakPlayers: number;
}

export interface Toast {
  id: string;
  kind: "info" | "success" | "error" | "warn";
  title: string;
  body?: string;
}

export type View = { kind: "home" } | { kind: "instance"; id: string } | { kind: "settings" } | { kind: "system" };

interface State {
  loaded: boolean;
  instances: Instance[];
  folders: Folder[];
  settings: Settings;
  openTabs: string[];
  view: View;
  instanceTab: Record<string, InstanceTab>;
  activity: LogEntry[];
  unread: number;

  telemetry: Record<string, Telemetry>;
  host: HostStats | null;
  hostHistory: Sample[];
  vms: HyperVm[];
  busy: string[];
  toasts: Toast[];
  wizardOpen: boolean;
  paletteOpen: boolean;
  activityOpen: boolean;

  load: () => Promise<void>;
  setView: (v: View) => void;
  openInstance: (id: string, tab?: InstanceTab) => void;
  closeTab: (id: string) => void;
  reorderTabs: (ids: string[]) => void;
  setInstanceTab: (id: string, tab: InstanceTab) => void;

  addInstance: (i: Instance) => void;
  updateInstance: (id: string, patch: Partial<Instance> | ((i: Instance) => Partial<Instance>)) => void;
  removeInstance: (id: string) => void;
  duplicateInstance: (id: string) => void;

  addFolder: (name: string, color?: string) => string;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  removeFolder: (id: string) => void;
  moveInstance: (id: string, folderId: string | null) => void;

  updateSettings: (patch: Partial<Settings>) => void;

  setTelemetry: (id: string, t: Partial<Telemetry>, sample?: Sample) => void;
  setHost: (h: HostStats) => void;
  setVms: (v: HyperVm[]) => void;
  setBusy: (b: string[]) => void;
  log: (e: Omit<LogEntry, "ts"> & { ts?: number }) => void;
  markRead: () => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setWizard: (o: boolean) => void;
  setPalette: (o: boolean) => void;
  setActivityOpen: (o: boolean) => void;
  importConfig: (json: any) => void;
}

const HISTORY = 240;

export const useStore = create<State>((set, get) => ({
  loaded: false,
  instances: [],
  folders: [],
  settings: defaultSettings,
  openTabs: [],
  view: { kind: "home" },
  instanceTab: {},
  activity: [],
  unread: 0,
  telemetry: {},
  host: null,
  hostHistory: [],
  vms: [],
  busy: [],
  toasts: [],
  wizardOpen: false,
  paletteOpen: false,
  activityOpen: false,

  load: async () => {
    let data: any = null;
    try {
      data = isTauri ? await invoke("state_load") : JSON.parse(localStorage.getItem("dsm-state") || "null");
    } catch {
      data = null;
    }
    if (data && Array.isArray(data.instances)) {
      const instances = (data.instances as Instance[]).map((i) => ({ ...newInstance(), ...i, automation: { ...defaultAutomation(), ...i.automation }, ssh: { ...newInstance().ssh, ...i.ssh } }));
      const ids = new Set(instances.map((i) => i.id));
      set({
        instances,
        folders: data.folders ?? [],
        settings: { ...defaultSettings, ...data.settings },
        openTabs: (data.openTabs ?? []).filter((t: string) => ids.has(t)),
        activity: (data.activity ?? []).slice(-300),
        loaded: true,
      });
    } else {
      // First run: seed folders and a demo sandbox so the app is explorable immediately.
      const prod = { id: uid("f-"), name: "Production", color: "#f08a24", icon: "server", collapsed: false };
      const test = { id: uid("f-"), name: "Testing", color: "#3987e5", icon: "flask", collapsed: false };
      const pvp = { id: uid("f-"), name: "Hardcore PvP", color: "#e5484d", icon: "swords", collapsed: false };
      const demoInst = newInstance({
        name: "Arrakis Sandbox",
        description: "Simulated battlegroup. Explore every feature safely.",
        mode: "demo",
        folderId: test.id,
        color: "#3987e5",
        tags: ["demo", "pve"],
        ssh: { host: "192.168.1.60", port: 22, user: "dune", keyPath: "" },
        vmName: "dune-awakening",
      });
      set({ folders: [prod, test, pvp], instances: [demoInst], openTabs: [demoInst.id], loaded: true });
    }
    get().settings.accent && applyAccent(get().settings.accent);
  },

  setView: (v) => set({ view: v }),
  openInstance: (id, tab) =>
    set((s) => ({
      view: { kind: "instance", id },
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      instanceTab: tab ? { ...s.instanceTab, [id]: tab } : s.instanceTab,
    })),
  closeTab: (id) =>
    set((s) => {
      const idx = s.openTabs.indexOf(id);
      const openTabs = s.openTabs.filter((t) => t !== id);
      let view = s.view;
      if (view.kind === "instance" && view.id === id) {
        const next = openTabs[Math.min(idx, openTabs.length - 1)];
        view = next ? { kind: "instance", id: next } : { kind: "home" };
      }
      return { openTabs, view };
    }),
  reorderTabs: (ids) => set({ openTabs: ids }),
  setInstanceTab: (id, tab) => set((s) => ({ instanceTab: { ...s.instanceTab, [id]: tab } })),

  addInstance: (i) => set((s) => ({ instances: [...s.instances, i] })),
  updateInstance: (id, patch) =>
    set((s) => ({
      instances: s.instances.map((i) => (i.id === id ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)),
    })),
  removeInstance: (id) =>
    set((s) => ({
      instances: s.instances.filter((i) => i.id !== id),
      openTabs: s.openTabs.filter((t) => t !== id),
      view: s.view.kind === "instance" && s.view.id === id ? { kind: "home" } : s.view,
    })),
  duplicateInstance: (id) => {
    const src = get().instances.find((i) => i.id === id);
    if (!src) return;
    const copy: Instance = JSON.parse(JSON.stringify(src));
    copy.id = uid("i-");
    copy.name = `${src.name} (copy)`;
    copy.createdAt = Date.now();
    set((s) => ({ instances: [...s.instances, copy] }));
  },

  addFolder: (name, color) => {
    const id = uid("f-");
    set((s) => ({ folders: [...s.folders, { id, name, color: color ?? FOLDER_COLORS[s.folders.length % FOLDER_COLORS.length], icon: "folder", collapsed: false }] }));
    return id;
  },
  updateFolder: (id, patch) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  removeFolder: (id) =>
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      instances: s.instances.map((i) => (i.folderId === id ? { ...i, folderId: null } : i)),
    })),
  moveInstance: (id, folderId) => set((s) => ({ instances: s.instances.map((i) => (i.id === id ? { ...i, folderId } : i)) })),

  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    if (patch.accent) applyAccent(patch.accent);
    if (patch.reduceMotion !== undefined) document.documentElement.classList.toggle("reduce-motion", patch.reduceMotion);
  },

  setTelemetry: (id, t, sample) =>
    set((s) => {
      const prev = s.telemetry[id] ?? { snapshot: null, history: [], error: null, updated: 0, connected: false, peakPlayers: 0 };
      const history = sample ? [...prev.history.slice(-(HISTORY - 1)), sample] : prev.history;
      const peakPlayers = Math.max(prev.peakPlayers, sample?.players ?? 0);
      return { telemetry: { ...s.telemetry, [id]: { ...prev, ...t, history, peakPlayers } } };
    }),
  setHost: (h) =>
    set((s) => ({
      host: h,
      hostHistory: [...s.hostHistory.slice(-(HISTORY - 1)), { t: Date.now(), cpu: h.cpu, mem: (h.memUsed / h.memTotal) * 100, rx: h.rxBps, tx: h.txBps, players: null }],
    })),
  setVms: (v) => set({ vms: v }),
  setBusy: (b) => set({ busy: b }),
  log: (e) =>
    set((s) => ({
      activity: [...s.activity.slice(-299), { ts: Date.now(), ...e } as LogEntry],
      unread: s.activityOpen ? 0 : s.unread + 1,
    })),
  markRead: () => set({ unread: 0 }),
  toast: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 4800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setWizard: (o) => set({ wizardOpen: o }),
  setPalette: (o) => set({ paletteOpen: o }),
  setActivityOpen: (o) => set({ activityOpen: o, unread: o ? 0 : get().unread }),
  importConfig: (json) => {
    if (!json || !Array.isArray(json.instances)) throw new Error("Not a Dune Server Manager export");
    const existing = new Set(get().instances.map((i) => i.id));
    const incoming: Instance[] = json.instances.map((i: Instance) => ({ ...newInstance(), ...i, id: existing.has(i.id) ? uid("i-") : i.id }));
    const folderIds = new Set(get().folders.map((f) => f.id));
    const folders: Folder[] = (json.folders ?? []).filter((f: Folder) => !folderIds.has(f.id));
    set((s) => ({ instances: [...s.instances, ...incoming], folders: [...s.folders, ...folders] }));
  },
}));

export function applyAccent(a: string) {
  if (a === "spice") document.documentElement.removeAttribute("data-accent");
  else document.documentElement.setAttribute("data-accent", a);
}

/** Debounced persistence of the durable slice. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = "";
// Telemetry updates every few seconds; only serialize when a durable slice actually changed (cheap ref check).
useStore.subscribe((s, prev) => {
  if (!s.loaded) return;
  if (prev.loaded && s.instances === prev.instances && s.folders === prev.folders && s.settings === prev.settings && s.openTabs === prev.openTabs && s.activity === prev.activity) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistNow(), 400);
});

async function persistNow() {
  const st = useStore.getState();
  if (!st.loaded) return;
  const durable = { version: 1, instances: st.instances, folders: st.folders, settings: st.settings, openTabs: st.openTabs, activity: st.activity.slice(-300) };
  const text = JSON.stringify(durable);
  if (text === lastSaved) return;
  lastSaved = text;
  if (isTauri) await invoke("state_save", { state: durable }).catch(() => {});
  else
    try {
      localStorage.setItem("dsm-state", text);
    } catch {
      /* storage unavailable */
    }
}

/** Write pending state immediately (call before quitting so nothing in the debounce window is lost). */
export async function flushSave() {
  clearTimeout(saveTimer);
  await persistNow();
}

export const selectInstance = (id: string) => (s: State) => s.instances.find((i) => i.id === id);
