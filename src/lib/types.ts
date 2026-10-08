export type Mode = "real" | "demo";
export type Branch = "live" | "ptc";

export interface SshCfg {
  host: string;
  port?: number;
  user: string;
  keyPath?: string;
}

export interface Schedule {
  id: string;
  time: string; // HH:MM local
  days: number[]; // 0 = Sunday; empty = every day
  enabled: boolean;
}

export type WebhookEvent = "state" | "crash" | "restart" | "warning" | "update" | "backup" | "players";

export interface Webhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: WebhookEvent[];
  mention?: string;
}

export interface Ddns {
  enabled: boolean;
  provider: "duckdns" | "cloudflare" | "custom";
  domain: string;
  token: string;
  zoneId?: string;
  customUrl?: string;
}

export interface Automation {
  watchdog: boolean;
  watchdogVm: boolean;
  crashAlerts: boolean;
  restarts: Schedule[];
  warnMinutes: number[];
  backupEnabled: boolean;
  backupIntervalHours: number;
  backupKeep: number;
  backupIncludeDb: boolean;
  updateCheck: boolean;
  updateIntervalMinutes: number;
  autoUpdate: boolean;
  ddns: Ddns;
}

export interface Instance {
  id: string;
  name: string;
  description: string;
  folderId: string | null;
  tags: string[];
  color: string;
  mode: Mode;
  branch: Branch;
  appId: number;
  installDir: string;
  batPath: string;
  vmName: string;
  ssh: SshCfg;
  namespace: string;
  battlegroup: string;
  settingsDir: string;
  desiredRunning: boolean;
  maintenance: boolean;
  automation: Automation;
  webhooks: Webhook[];
  notes: string;
  favorite: boolean;
  createdAt: number;
  sqlQueries?: { name: string; sql: string }[];
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  icon: string;
  collapsed: boolean;
}

export type Accent = "spice" | "ibad" | "sietch" | "harkonnen" | "bene";

export interface Settings {
  backupRoot: string;
  steamcmdDir: string;
  serversDir: string;
  steamUser: string;
  closeBehavior: "ask" | "tray" | "quit";
  trayHintShown: boolean;
  pollSeconds: number;
  confirmDangerous: boolean;
  accent: Accent;
  reduceMotion: boolean;
  webhooks: Webhook[];
  onboarded: boolean;
  desktopNotifications: boolean;
}

export interface MapServer {
  map: string;
  label: string;
  partition: number | null;
  phase: string;
  ready: boolean;
  players: number | null;
  start: string | null;
}

export interface Battlegroup {
  namespace: string;
  name: string;
  title: string;
  stop: boolean;
  phase: string;
  databasePhase: string;
  directorPhase: string;
  gatewayPhase: string;
  serverGroupPhase: string;
  start: string | null;
  servers: MapServer[];
  players: number;
}

export interface Pod {
  namespace: string;
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  start: string;
  reason: string;
  cpuMilli: number | null;
  memBytes: number | null;
}

export interface VmStats {
  cpu: number | null;
  cores: number;
  memTotal: number;
  memAvailable: number;
  load1: number;
  rxBps: number | null;
  txBps: number | null;
  diskTotal: number;
  diskUsed: number;
  uptime: number;
}

export interface Snapshot {
  ok: boolean;
  error: string | null;
  hostname: string;
  battlegroups: Battlegroup[];
  pods: Pod[];
  vm: VmStats;
  buildId: string | null;
  latencyMs: number;
}

export interface HyperVm {
  name: string;
  id: string;
  state: string;
  status: string;
  cpuUsage: number;
  processorCount: number;
  memoryAssigned: number;
  memoryDemand: number;
  memoryStartup: number;
  dynamicMemory: boolean;
  uptime: number;
  path: string;
  disks: string[];
  ips: string[];
  switches: string[];
  macs: string[];
  duneConfidence: "high" | "medium" | "none";
}

export interface HostStats {
  cpu: number;
  perCore: number[];
  memUsed: number;
  memTotal: number;
  rxBps: number;
  txBps: number;
  uptime: number;
}

export interface SystemReport {
  os: string;
  hostname: string;
  cpuModel: string;
  cores: number;
  threads: number;
  avx2: boolean;
  virtualizationFirmware: boolean | null;
  ramTotal: number;
  disks: { mount: string; total: number; free: number }[];
  elevated: boolean;
  hypervAdmin: boolean;
  hypervService: string;
  hypervModule: boolean;
  windowsEdition: string;
  sshAvailable: boolean;
  scpAvailable: boolean;
}

export interface ProcOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface BackupEntry {
  path: string;
  file: string;
  size: number;
  created: number;
  manifest: any;
}

export interface LogEntry {
  ts: number;
  instanceId: string;
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
}

export interface Sample {
  t: number;
  cpu: number | null;
  mem: number | null;
  rx: number | null;
  tx: number | null;
  players: number | null;
}

export interface InstallFound {
  appId: number;
  branch: string;
  path: string;
  buildId: string | null;
  battlegroupBat: string | null;
  source: string;
}

export type InstanceTab =
  | "overview"
  | "maps"
  | "players"
  | "console"
  | "logs"
  | "config"
  | "backups"
  | "automation"
  | "network"
  | "integrations"
  | "settings";

/** Derived, display-level health of an instance. */
export type Health = "online" | "starting" | "degraded" | "stopped" | "offline" | "unknown" | "busy";
