/**
 * Demo sandbox: a faithful in-memory simulation of a battlegroup VM so every screen is explorable
 * without Hyper-V (and so the UI can be previewed in a plain browser). Shapes match the Rust backend.
 */
import type { BackupEntry, Battlegroup, HyperVm, Instance, MapServer, Pod, ProcOutput, Snapshot } from "./types";
import { localBus } from "./tauri";

const NS = "funcom-seabass-sh-demo01-a";
const MAPS: { map: string; partition: number; weight: number }[] = [
  { map: "Overmap", partition: 0, weight: 0.05 },
  { map: "Survival_1", partition: 1, weight: 0.42 },
  { map: "Survival_1", partition: 2, weight: 0.2 },
  { map: "DeepDesert_1", partition: 3, weight: 0.2 },
  { map: "SH_Arrakeen", partition: 4, weight: 0.08 },
  { map: "SH_HarkoVillage", partition: 5, weight: 0.05 },
];

export const TEMPLATE_ENGINE = `; UserEngine.ini - applied to every game server in the battlegroup
[ConsoleVariables]
Bgd.ServerDisplayName="Arrakis Prime"
;Bgd.ServerLoginPassword="Sandworm"
Dune.GlobalMiningOutputMultiplier=1.0
Dune.GlobalVehicleMiningOutputMultiplier=1.0
Sandstorm.Enabled=1
sandworm.dune.Enabled=1

[URL]
Port=7777
IGWPort=7888
`;

export const TEMPLATE_GAME = `; UserGame.ini - gameplay rule overrides
[/Script/DuneSandbox.BuildingSettings]
m_MaxNumLandclaimSegments=6
m_bBuildingRestrictionLimitsEnabled=True

[/Script/DuneSandbox.PvpSettings]
;+m_PvpEnabledPartitions=3

[/Script/DuneSandbox.GuildSettings]
m_MaxGuildMembersAllowed=32
m_GuildCreationCost=1000

[/Script/DuneSandbox.CoriolisStormConfigMultiplayer]
m_bIsDbWipeEnabled=True

[/Script/DuneSandbox.InventorySystemSettings]
;m_DecayedDurabilityFloor=0.2
`;

export const TEMPLATE_CUSTOM = `; UserServerCustomSettings.ini (1.5.3.1+). DifficultyLevel=Custom must stay present.
[/Script/DuneSandbox.UserServerCustomSettings]
DifficultyLevel=Custom
;GatheringAmount=1.0
;bAllowSandstorms=True
;bAllowSandworms=True
FiefdomLimit=3
;BaseBackupToolTimeRestriction=16
`;

interface DemoState {
  stop: boolean;
  phase: string;
  startedAt: number;
  transitionUntil: number;
  players: number[];
  restarts: Record<string, number>;
  files: Record<string, string>;
  backups: BackupEntry[];
  build: string;
  vmState: string;
  vmStarted: number;
  rx: number;
  tx: number;
}

const states = new Map<string, DemoState>();

function st(id: string): DemoState {
  let s = states.get(id);
  if (!s) {
    s = {
      stop: false,
      phase: "Running",
      startedAt: Date.now() - (3 * 3600 + 1234) * 1000,
      transitionUntil: 0,
      players: MAPS.map((m) => Math.round(m.weight * 24)),
      restarts: {},
      files: {
        "UserEngine.ini": TEMPLATE_ENGINE,
        "UserGame.ini": TEMPLATE_GAME,
        "UserServerCustomSettings.ini": TEMPLATE_CUSTOM,
      },
      backups: [
        fakeBackup(id, "auto", Date.now() - 6 * 3600e3, false),
        fakeBackup(id, "pre-update-20419985", Date.now() - 2 * 86400e3, true),
      ],
      build: "20419985",
      vmState: "Running",
      vmStarted: Date.now() - 4 * 86400e3,
      rx: 0,
      tx: 0,
    };
    states.set(id, s);
  }
  return s;
}

function fakeBackup(id: string, label: string, t: number, db: boolean): BackupEntry {
  const d = new Date(t);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;
  return {
    path: `demo://${id}/${stamp}-${label}.zip`,
    file: `${stamp}-${label}.zip`,
    size: db ? 412_000_000 + Math.random() * 4e7 : 9_400 + Math.random() * 2000,
    created: Math.floor(t / 1000),
    manifest: {
      label,
      created: d.toISOString(),
      vmBackupName: db ? `dsm-${stamp}` : null,
      files: [
        { name: "UserSettings/UserEngine.ini", size: 412 },
        { name: "UserSettings/UserGame.ini", size: 690 },
        { name: "battlegroup.yaml", size: 18_220 },
        ...(db ? [{ name: "database/dune.pgdump", size: 411_000_000 }] : []),
      ],
      warnings: [],
    },
  };
}

function targetPlayers(): number {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const curve = 0.35 + 0.65 * Math.max(0, Math.sin(((h - 9) / 24) * Math.PI * 2 - 0.2) * 0.5 + 0.5);
  return Math.round(36 * curve);
}

function tickPlayers(s: DemoState) {
  if (s.stop || s.phase !== "Running") {
    s.players = s.players.map(() => 0);
    return;
  }
  const total = s.players.reduce((a, b) => a + b, 0);
  const target = targetPlayers();
  s.players = s.players.map((p, i) => {
    const want = target * MAPS[i].weight;
    const drift = (want - p) * 0.15 + (Math.random() - 0.5) * 1.6 + (target > total ? 0.15 : -0.15);
    return Math.max(0, Math.min(40, Math.round(p + drift)));
  });
}

function phaseNow(s: DemoState) {
  if (s.transitionUntil && Date.now() >= s.transitionUntil) {
    s.transitionUntil = 0;
    s.phase = s.stop ? "Stopped" : "Running";
    if (!s.stop) s.startedAt = Date.now();
  }
}

export function demoSnapshot(inst: Instance): Snapshot {
  const s = st(inst.id);
  phaseNow(s);
  tickPlayers(s);
  if (Math.random() < 0.004) {
    const victim = "sg-deepdesert-1-0";
    s.restarts[victim] = (s.restarts[victim] ?? 0) + 1;
  }
  const running = !s.stop && s.phase === "Running";
  const starting = !s.stop && s.phase !== "Running";
  const elapsed = (Date.now() - (s.transitionUntil ? s.transitionUntil - 12000 : 0)) / 1000;
  const servers: MapServer[] = s.stop && s.phase === "Stopped"
    ? []
    : MAPS.map((m, i) => {
        const ready = running || (starting && elapsed > 2 + i * 1.6);
        return {
          map: m.map,
          label: `${friendly(m.map)} #${m.partition}`,
          partition: m.partition,
          phase: ready ? "Running" : s.stop ? "Terminating" : "Pending",
          ready: ready && !s.stop,
          players: running ? s.players[i] : 0,
          start: new Date(s.startedAt + i * 9000).toISOString(),
        };
      });
  const bg: Battlegroup = {
    namespace: NS,
    name: "sh-demo01",
    title: inst.name,
    stop: s.stop,
    phase: s.phase,
    databasePhase: "Ready",
    directorPhase: running ? "Healthy" : s.stop ? "Stopped" : "Progressing",
    gatewayPhase: running ? "Running" : s.stop ? "Stopped" : "Pending",
    serverGroupPhase: s.phase,
    start: new Date(s.startedAt).toISOString(),
    servers,
    players: servers.reduce((a, x) => a + (x.players ?? 0), 0),
  };
  const playersTotal = bg.players;
  const pods: Pod[] = [];
  const add = (ns: string, name: string, cpu: number, mem: number, on = true) =>
    pods.push({
      namespace: ns,
      name,
      phase: on ? "Running" : "Pending",
      ready: on ? "true" : "false",
      restarts: s.restarts[name] ?? 0,
      start: new Date(s.startedAt).toISOString(),
      reason: on ? "" : "ContainerCreating",
      cpuMilli: on ? cpu * (0.85 + Math.random() * 0.3) : null,
      memBytes: on ? mem * (0.97 + Math.random() * 0.06) : null,
    });
  add("kube-system", "coredns-7b98449c4-x2l7q", 4, 22e6);
  add("kube-system", "metrics-server-5985cbc9d7-qq4mv", 9, 31e6);
  add("funcom-operators", "battlegroup-operator-6d8f9b7c5d-4hz2k", 12, 88e6);
  add("funcom-operators", "server-operator-5c6f7d8b9-kk2p1", 8, 64e6);
  add(NS, "sh-demo01-db-0", 140 + playersTotal * 6, 1.4e9);
  add(NS, "sh-demo01-rmq-game-0", 60 + playersTotal * 2, 310e6);
  add(NS, "sh-demo01-rmq-admin-0", 20, 190e6);
  if (!s.stop || s.phase !== "Stopped") {
    add(NS, "sh-demo01-director-0", 30, 240e6, running);
    add(NS, "sh-demo01-gateway-0", 45 + playersTotal * 3, 280e6, running);
    add(NS, "sh-demo01-text-router-0", 10, 120e6, running);
    servers.forEach((sv, i) =>
      add(NS, `sg-${sv.map.toLowerCase().replace(/_/g, "-")}-${i}`, 350 + (sv.players ?? 0) * 70, (sv.map === "Survival_1" ? 7.8e9 : 1.3e9) + (sv.players ?? 0) * 6e7, sv.ready),
    );
  }
  const memTotal = 40 * 1024 ** 3;
  const used = pods.reduce((a, p) => a + (p.memBytes ?? 0), 0) + 2.1e9;
  const rx = running ? 18_000 * playersTotal + 40_000 + Math.random() * 30_000 : 4000;
  const tx = running ? 42_000 * playersTotal + 60_000 + Math.random() * 50_000 : 3000;
  s.rx = rx;
  s.tx = tx;
  return {
    ok: true,
    error: null,
    hostname: "duneawakening",
    battlegroups: [bg],
    pods,
    vm: {
      cpu: Math.min(100, (running ? 14 + playersTotal * 1.6 : 4) + Math.random() * 6),
      cores: 8,
      memTotal,
      memAvailable: Math.max(0, memTotal - used),
      load1: running ? 1.2 + playersTotal / 12 : 0.2,
      rxBps: rx,
      txBps: tx,
      diskTotal: 120 * 1024 ** 3,
      diskUsed: 61.4 * 1024 ** 3,
      uptime: (Date.now() - s.vmStarted) / 1000,
    },
    buildId: s.build,
    latencyMs: 12 + Math.round(Math.random() * 9),
  };
}

function friendly(map: string) {
  const m = map.toLowerCase();
  if (m === "survival_1") return "Hagga Basin";
  if (m.includes("overmap")) return "Overland Map";
  if (m.includes("deepdesert")) return "Deep Desert";
  if (m.includes("arrakeen")) return "Arrakeen";
  if (m.includes("harko")) return "Harko Village";
  return map;
}

export function demoVm(inst: Instance): HyperVm {
  const s = st(inst.id);
  return {
    name: inst.vmName || "dune-awakening",
    id: "demo-vm",
    state: s.vmState,
    status: "Operating normally",
    cpuUsage: s.vmState === "Running" ? Math.round(10 + Math.random() * 20) : 0,
    processorCount: 8,
    memoryAssigned: s.vmState === "Running" ? 40 * 1024 ** 3 : 0,
    memoryDemand: s.vmState === "Running" ? 31 * 1024 ** 3 : 0,
    memoryStartup: 40 * 1024 ** 3,
    dynamicMemory: false,
    uptime: s.vmState === "Running" ? (Date.now() - s.vmStarted) / 1000 : 0,
    path: "C:\\ProgramData\\Microsoft\\Windows\\Hyper-V",
    disks: ["D:\\DuneServer\\Virtual Hard Disks\\dune-server.vhdx"],
    ips: ["192.168.1.60"],
    switches: ["DuneAwakeningServerSwitch"],
    macs: ["00155D0A1B2C"],
    duneConfidence: "high",
  };
}

export function demoVmAction(inst: Instance, action: string) {
  const s = st(inst.id);
  if (action === "start") {
    s.vmState = "Running";
    s.vmStarted = Date.now();
  } else if (action === "stop" || action === "turnoff") {
    s.vmState = "Off";
    s.stop = true;
    s.phase = "Stopped";
  }
}

export function demoSetStop(inst: Instance, stop: boolean) {
  const s = st(inst.id);
  s.stop = stop;
  s.phase = stop ? "Stopping" : "Starting";
  s.transitionUntil = Date.now() + (stop ? 5000 : 12000);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated `battlegroup <action>` with realistic output, driven through the shared stream bus. */
export async function demoWrapper(inst: Instance, id: string, args: string[]) {
  const s = st(inst.id);
  const say = async (l: string, ms = 260) => {
    await wait(ms);
    localBus.line(id, l, false);
  };
  const action = args[0];
  (async () => {
    await say(`[battlegroup] Selected battlegroup: ${NS}`, 120);
    switch (action) {
      case "status": {
        const snap = demoSnapshot(inst);
        const bg = snap.battlegroups[0];
        await say(`World: ${inst.name}   Phase: ${bg.phase}   Stop: ${bg.stop}`);
        await say(`Database: ${bg.databasePhase}   Director: ${bg.directorPhase}   Gateway: ${bg.gatewayPhase}`);
        for (const sv of bg.servers) await say(`  ${sv.label.padEnd(22)} ${sv.phase.padEnd(10)} players=${sv.players ?? 0}`, 90);
        break;
      }
      case "stop":
        await say("Setting spec.stop=true …");
        demoSetStop(inst, true);
        await say("Waiting for game servers to drain", 900);
        await say("Battlegroup stopped.", 1500);
        break;
      case "start":
        await say("Clearing spec.stop …");
        demoSetStop(inst, false);
        for (const m of MAPS) await say(`  waiting for ${friendly(m.map)} #${m.partition} … ready`, 900);
        await say("Battlegroup started.");
        break;
      case "restart":
        await say("Stopping battlegroup …");
        demoSetStop(inst, true);
        await say("Stopped. Sleeping 5s", 2200);
        await say("Starting battlegroup …", 1200);
        demoSetStop(inst, false);
        for (const m of MAPS) await say(`  ${friendly(m.map)} #${m.partition} ready`, 700);
        await say("Restart complete.");
        break;
      case "update": {
        await say("Checking Steam for app 4754530 …");
        await say("Update state (0x3) reconfiguring, progress: 0.00 (0 / 0)", 500);
        for (let p = 0; p <= 100; p += 12.5) await say(`Update state (0x61) downloading, progress: ${p.toFixed(2)} (${Math.round(p * 51e6)} / 5100000000)`, 380);
        await say("Success! App '4754530' fully installed.");
        await say("Loading images into containerd (seabass-server, igw-server, bg-director) …", 900);
        await say("Patching BattleGroup spec images → rolling pods", 900);
        s.build = String(Number(s.build) + 7);
        await say(`Updated to build ${s.build}.`);
        break;
      }
      case "backup": {
        const name = args[1] ?? "manual";
        await say(`Creating database backup '${name}' (pg_dump, custom format)`);
        for (let i = 1; i <= 5; i++) await say(`  dumping schema part ${i}/5 …`, 500);
        await say(`Backup written to /home/dune/.dune/backups/${name}.pgdump`);
        break;
      }
      case "import":
        await say(`Restoring database from '${args[1]}' …`);
        await say("  dropping & recreating schema", 1200);
        await say("  restoring data …", 1800);
        await say("Import finished.");
        break;
      case "apply-default-usersettings":
        await say("Copying UserSettings to file broker …");
        await say("Done. Restart the battlegroup to apply.", 700);
        break;
      default:
        await say(`(demo) battlegroup ${args.join(" ")} — ok`);
    }
    await wait(200);
    localBus.exit(id, 0);
  })();
}

export async function demoShell(inst: Instance, id: string, cmd: string) {
  const say = (l: string) => localBus.line(id, l, false);
  await wait(150);
  const c = cmd.trim();
  if (c.startsWith("kubectl get pods") || c.startsWith("get pods")) {
    const snap = demoSnapshot(inst);
    say("NAMESPACE".padEnd(32) + "NAME".padEnd(42) + "READY  STATUS    RESTARTS");
    snap.pods.forEach((p) => say(p.namespace.padEnd(32) + p.name.padEnd(42) + (p.ready === "true" ? "1/1    " : "0/1    ") + p.phase.padEnd(10) + p.restarts));
  } else if (c.startsWith("free")) {
    say("              total        used        free      shared  buff/cache   available");
    say("Mem:       41943040    23110212     2311428       12044    16521400    18832828");
  } else if (c.startsWith("uptime")) {
    say(" 14:02:11 up 4 days,  3:11,  1 user,  load average: 1.82, 1.64, 1.51");
  } else if (c === "help" || c === "") {
    say("Demo shell — try: kubectl get pods -A · free -k · uptime · df -h · battlegroup status");
  } else if (c.startsWith("df")) {
    say("Filesystem                Size      Used Available Use% Mounted on");
    say("/dev/mapper/vg0-lv_root  120.0G     61.4G     58.6G  51% /");
  } else if (c.startsWith("battlegroup")) {
    return demoWrapper(inst, id, c.split(/\s+/).slice(1));
  } else {
    say(`sh: ${c.split(" ")[0]}: simulated in demo mode`);
  }
  await wait(100);
  localBus.exit(id, 0);
}

const LOG_LINES = [
  "LogNet: Join succeeded: {player}",
  "LogDune: Spice field spawned at grid {n} (yield {y})",
  "LogSandworm: Worm threat threshold reached near {player}, spawning sandworm",
  "LogTravel: {player} requested travel Overmap -> Survival_1",
  "LogDatabase: Flushed {n} dirty actors in {y}ms",
  "LogNet: UChannel::Close: connection closed for {player}",
  "LogBuilding: {player} placed Sietch foundation (claims {n}/6)",
  "LogCoriolis: Storm cycle at {y}% — next shift in {n}h",
  "LogRMQ: Published {n} messages to game exchange",
  "Warning: LogPhysics: Actor penetration resolved after {n} iterations",
];
const NAMES = ["Muad'Dib", "Chani", "Stilgar", "Jamis", "Liet", "Shishakli", "Otheym", "Harah", "Korba", "Farok"];

export function demoLogs(id: string, pod: string): () => void {
  let n = 0;
  const gen = () => {
    const t = LOG_LINES[Math.floor(Math.random() * LOG_LINES.length)]
      .replace("{player}", NAMES[Math.floor(Math.random() * NAMES.length)])
      .replace("{n}", String(Math.floor(Math.random() * 90) + 1))
      .replace("{y}", String(Math.floor(Math.random() * 100)));
    localBus.line(id, `${new Date().toISOString()} [${pod}] ${t}`, false);
  };
  for (; n < 40; n++) gen();
  const h = setInterval(gen, 650 + Math.random() * 600);
  return () => {
    clearInterval(h);
    localBus.exit(id, -9);
  };
}

export function demoFiles(inst: Instance) {
  return st(inst.id).files;
}

export function demoBackups(inst: Instance) {
  return st(inst.id).backups;
}

export async function demoCreateBackup(inst: Instance, label: string, includeDb: boolean, step: (s: string) => void): Promise<BackupEntry> {
  const steps = ["Collecting UserSettings", "Exporting BattleGroup spec", ...(includeDb ? ["Dumping world database (battlegroup backup)", "Downloading dump"] : []), "Compressing archive"];
  for (const s of steps) {
    step(s);
    await wait(includeDb ? 900 : 450);
  }
  const b = fakeBackup(inst.id, label, Date.now(), includeDb);
  st(inst.id).backups.unshift(b);
  return b;
}

export function demoSql(sql: string): ProcOutput {
  const q = sql.toLowerCase();
  if (q.includes("information_schema.tables") || q.includes("\\dt")) {
    return {
      code: 0,
      stdout: "table_schema|table_name|rows\npublic|accounts|184\npublic|characters|212\npublic|guilds|19\npublic|landclaims|77\npublic|inventory_items|48211\npublic|event_log_p1|902114",
      stderr: "",
    };
  }
  const rows = NAMES.map((n, i) => `${1000 + i}|${n}|${["Atreides", "Harkonnen", "Unaligned"][i % 3]}|${Math.floor(Math.random() * 60) + 1}|${new Date(Date.now() - Math.random() * 6e8).toISOString()}`);
  return { code: 0, stdout: ["id|name|faction|level|last_seen", ...rows].join("\n"), stderr: "" };
}

export function demoUpdateAvailable(inst: Instance) {
  return String(Number(st(inst.id).build) + 7);
}
