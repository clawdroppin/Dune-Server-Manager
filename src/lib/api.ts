/**
 * High-level API. Every call routes to the Rust backend for real instances and to the
 * simulator for demo instances (or when running in a plain browser).
 */
import * as demo from "./demo";
import { collectStream, invoke, isTauri, localBus, streamId } from "./tauri";
import type {
  BackupEntry,
  HostStats,
  HyperVm,
  InstallFound,
  Instance,
  LogEntry,
  ProcOutput,
  Snapshot,
  SshCfg,
  SystemReport,
  Webhook,
} from "./types";

export const DEFAULT_SETTINGS_DIR = "/home/dune/server/DuneSandbox/Saved/UserSettings";
export const APP_LIVE = 4754530;
export const APP_PTC = 3104830;

const isDemo = (i: Instance) => i.mode === "demo" || !isTauri;

export function sshTarget(i: Instance): SshCfg {
  return { host: i.ssh.host.trim(), port: i.ssh.port || 22, user: i.ssh.user || "dune", keyPath: i.ssh.keyPath || undefined };
}

/** POSIX single-quote. */
export const sq = (v: string) => `'${v.replace(/'/g, `'"'"'`)}'`;

// ---------------------------------------------------------------- host / system
let fakeHost = { cpu: 18, mem: 0.46 };
export async function hostStats(): Promise<HostStats> {
  if (isTauri) return invoke("host_stats");
  fakeHost.cpu = Math.max(3, Math.min(95, fakeHost.cpu + (Math.random() - 0.5) * 8));
  fakeHost.mem = Math.max(0.3, Math.min(0.9, fakeHost.mem + (Math.random() - 0.5) * 0.01));
  return {
    cpu: fakeHost.cpu,
    perCore: Array.from({ length: 16 }, () => Math.random() * fakeHost.cpu * 1.6),
    memTotal: 64 * 1024 ** 3,
    memUsed: 64 * 1024 ** 3 * fakeHost.mem,
    rxBps: 300_000 + Math.random() * 400_000,
    txBps: 600_000 + Math.random() * 700_000,
    uptime: 86400 * 3.4,
  };
}

export async function systemCheck(): Promise<SystemReport> {
  if (isTauri) return invoke("system_check");
  await new Promise((r) => setTimeout(r, 700));
  return {
    os: "Windows 11 Pro 26300",
    hostname: "SIETCH-TABR",
    cpuModel: "AMD Ryzen 9 7950X 16-Core Processor",
    cores: 16,
    threads: 32,
    avx2: true,
    virtualizationFirmware: true,
    ramTotal: 64 * 1024 ** 3,
    disks: [
      { mount: "C:\\", total: 1e12, free: 4.1e11 },
      { mount: "D:\\", total: 2e12, free: 1.2e12 },
    ],
    elevated: false,
    hypervAdmin: true,
    hypervService: "Running",
    hypervModule: true,
    windowsEdition: "Professional",
    sshAvailable: true,
    scpAvailable: true,
  };
}

export const relaunchElevated = () => invoke<void>("relaunch_elevated");
export const appPaths = () =>
  isTauri
    ? invoke<{ data: string; backups: string; keys: string; steamcmd: string; servers: string; portable: boolean; exeDir: string }>("app_paths")
    : Promise.resolve({ data: "%APPDATA%\\DuneServerManager", backups: "%APPDATA%\\DuneServerManager\\backups", keys: "", steamcmd: "%APPDATA%\\DuneServerManager\\steamcmd", servers: "%APPDATA%\\DuneServerManager\\servers", portable: false, exeDir: "" });

// ---------------------------------------------------------------- Hyper-V
export async function vmList(): Promise<HyperVm[]> {
  if (!isTauri) return [];
  return invoke("vm_list");
}
export async function vmAction(inst: Instance, action: string) {
  if (isDemo(inst)) return demo.demoVmAction(inst, action);
  return invoke<string>("vm_action", { name: inst.vmName, action });
}
export const vmSetResources = (name: string, memoryGb?: number, cpus?: number) => invoke<void>("vm_set_resources", { name, memoryGb, cpus });

// ---------------------------------------------------------------- battlegroup
export async function snapshot(inst: Instance): Promise<Snapshot> {
  if (isDemo(inst)) {
    await new Promise((r) => setTimeout(r, 40));
    return demo.demoSnapshot(inst);
  }
  return invoke("bg_snapshot", { target: sshTarget(inst) });
}

export async function setStop(inst: Instance, ns: string, name: string, stop: boolean) {
  if (isDemo(inst)) return demo.demoSetStop(inst, stop);
  return invoke<string>("bg_set_stop", { target: sshTarget(inst), namespace: ns, name, stop });
}

/** Start a vendor-wrapper action as a live stream; returns the stream id. */
export async function wrapperStream(inst: Instance, ns: string, args: string[], id = streamId("bg")) {
  if (isDemo(inst)) await demo.demoWrapper(inst, id, args);
  else await invoke("bg_wrapper_stream", { id, target: sshTarget(inst), namespace: ns, args });
  return id;
}

export async function shellStream(inst: Instance, script: string, id = streamId("sh")) {
  if (isDemo(inst)) await demo.demoShell(inst, id, script.replace(/^K=.*\n/, "").replace(/^\$K\s+/, "kubectl "));
  else await invoke("ssh_stream", { id, target: sshTarget(inst), script });
  return id;
}

const KPRE = "K='sudo -n kubectl'; $K version --client >/dev/null 2>&1 || K='kubectl'\n";

export async function kubectl(inst: Instance, args: string, stdin?: string, timeout = 60): Promise<ProcOutput> {
  if (isDemo(inst)) return { code: 0, stdout: `(demo) kubectl ${args}`, stderr: "" };
  const stdinB64 = stdin != null ? btoa(unescape(encodeURIComponent(stdin))) : undefined;
  return invoke("kubectl", { target: sshTarget(inst), args, stdinB64, timeout });
}

const demoLogStops = new Map<string, () => void>();
export async function logsStream(inst: Instance, ns: string, pod: string, tail = 400, follow = true, id = streamId("log")) {
  if (isDemo(inst)) {
    demoLogStops.set(id, demo.demoLogs(id, pod));
    return id;
  }
  const args = `logs -n ${sq(ns)} ${sq(pod)} --all-containers --timestamps --tail=${tail}${follow ? " -f" : ""}`;
  await invoke("kubectl_stream", { id, target: sshTarget(inst), args });
  return id;
}

export async function killStream(id: string) {
  const d = demoLogStops.get(id);
  if (d) {
    demoLogStops.delete(id);
    d();
    return;
  }
  if (isTauri) await invoke("proc_kill", { id });
}

export async function sshExec(inst: Instance, script: string, timeout = 60): Promise<ProcOutput> {
  if (isDemo(inst)) {
    const r = await collectStream((id) => demo.demoShell(inst, id, script));
    return { code: r.code, stdout: r.output.join("\n"), stderr: "" };
  }
  return invoke("ssh_exec", { target: sshTarget(inst), script, timeout });
}

export async function sshTest(inst: Instance): Promise<string> {
  if (isDemo(inst)) return "dune@duneawakening | Linux 6.6.58-0-virt (demo)\nbattlegroup CLI: found";
  return invoke("ssh_test", { target: sshTarget(inst) });
}

export async function directorUrl(inst: Instance, ns: string): Promise<string | null> {
  if (isDemo(inst)) return null;
  const out = await kubectl(inst, `get svc -n ${sq(ns)} -o json`);
  try {
    const j = JSON.parse(out.stdout);
    for (const svc of j.items ?? []) {
      const name: string = svc.metadata?.name ?? "";
      if (!/director|bgd/i.test(name)) continue;
      for (const p of svc.spec?.ports ?? []) if (p.nodePort) return `http://${inst.ssh.host}:${p.nodePort}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getSpec(inst: Instance, ns: string, name: string): Promise<string> {
  if (isDemo(inst))
    return `apiVersion: seabass.funcom.com/v1\nkind: BattleGroup\nmetadata:\n  name: ${name}\n  namespace: ${ns}\nspec:\n  stop: false\n  title: ${inst.name}\n  servers:\n    - map: Survival_1\n      replicas: 2\n      resources:\n        limits:\n          memory: 20Gi\n    - map: DeepDesert_1\n      replicas: 1\n`;
  const out = await kubectl(inst, `get battlegroup ${sq(name)} -n ${sq(ns)} -o yaml`);
  if (out.code !== 0) throw new Error(out.stderr || out.stdout);
  return out.stdout;
}

export async function applySpec(inst: Instance, yaml: string, dryRun = false): Promise<ProcOutput> {
  if (isDemo(inst)) return { code: 0, stdout: dryRun ? "battlegroup.seabass.funcom.com/sh-demo01 configured (server dry run)" : "battlegroup.seabass.funcom.com/sh-demo01 replaced", stderr: "" };
  return kubectl(inst, dryRun ? "replace --dry-run=server -f -" : "replace -f -", yaml, 120);
}

export async function deletePod(inst: Instance, ns: string, pod: string) {
  if (isDemo(inst)) return { code: 0, stdout: `pod "${pod}" deleted`, stderr: "" };
  return kubectl(inst, `delete pod -n ${sq(ns)} ${sq(pod)} --wait=false`);
}

export async function describePod(inst: Instance, ns: string, pod: string) {
  if (isDemo(inst)) return { code: 0, stdout: `Name:         ${pod}\nNamespace:    ${ns}\nStatus:       Running\nQoS Class:    Burstable\nEvents:       <none>`, stderr: "" };
  return kubectl(inst, `describe pod -n ${sq(ns)} ${sq(pod)}`);
}

/** Read-only SQL against the battlegroup Postgres pod (runs inside a READ ONLY transaction). */
export async function sqlQuery(inst: Instance, ns: string, sql: string, readOnly = true): Promise<ProcOutput> {
  if (isDemo(inst)) {
    await new Promise((r) => setTimeout(r, 300));
    return demo.demoSql(sql);
  }
  const body = sql.trim().replace(/;\s*$/, "");
  // Read-only mode wraps one statement in a READ ONLY transaction; a second statement could COMMIT out of it.
  if (readOnly && body.replace(/'[^']*'/g, "").includes(";"))
    return { code: 1, stdout: "", stderr: "Multiple statements need write mode (toggle “Allow writes”). Run one query at a time in read-only mode." };
  const wrapped = readOnly ? `BEGIN READ ONLY; ${body}; COMMIT;` : sql;
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  // Runs inside the Postgres pod. Funcom's world DB: database "dune", schema "dune", user dune/dune on
  // port 15432 (community-documented); falls back to the postgres superuser from the pod env.
  const inPod = `for port in 15432 5432; do
  for cred in "dune:dune" "postgres:\${POSTGRES_PASSWORD:-}"; do
    u=\${cred%%:*}; p=\${cred#*:}
    if PGPASSWORD="$p" psql -h 127.0.0.1 -p $port -U "$u" -d dune -Atc "select 1" >/dev/null 2>&1; then
      PGPASSWORD="$p" exec psql -h 127.0.0.1 -p $port -U "$u" -d dune -P pager=off -A -F '|' -v ON_ERROR_STOP=1
    fi
  done
done
echo "Could not authenticate to PostgreSQL (tried dune/dune and postgres on ports 15432 and 5432)" >&2
exit 2
`;
  const script = `${KPRE}LINE=$($K get pods -A --no-headers -o custom-columns=NS:.metadata.namespace,N:.metadata.name 2>/dev/null | grep db-dbdepl-sts | head -1)
[ -z "$LINE" ] && LINE=$($K get pods -n ${sq(ns)} --no-headers -o custom-columns=NS:.metadata.namespace,N:.metadata.name 2>/dev/null | grep -iE 'db|postgres' | grep -viE 'util|job' | head -1)
[ -z "$LINE" ] && { echo "No database pod found" >&2; exit 2; }
PNS=$(echo "$LINE" | awk '{print $1}'); POD=$(echo "$LINE" | awk '{print $2}')
echo ${b64(wrapped)} | base64 -d | $K exec -i -n "$PNS" "$POD" -- sh -c "$(echo ${b64(inPod)} | base64 -d)" 2>&1
`;
  return invoke("ssh_exec", { target: sshTarget(inst), script, timeout: 60 });
}

/** Parse psql -A -F '|' output into rows (drops BEGIN/COMMIT and the "(n rows)" footer). */
export function parsePsql(out: string): { head: string[]; rows: string[][] } | null {
  const lines = out
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !/^(BEGIN|COMMIT|ROLLBACK|SET|UPDATE \d+|INSERT \d+ \d+|DELETE \d+)$/.test(l.trim()) && !/^\(\d+ rows?\)$/.test(l.trim()));
  if (lines.length === 0 || !lines[0].includes("|")) return null;
  return { head: lines[0].split("|"), rows: lines.slice(1).map((l) => l.split("|")) };
}

// ---------------------------------------------------------------- files
export async function remoteRead(inst: Instance, path: string): Promise<string> {
  if (isDemo(inst)) {
    const f = demo.demoFiles(inst)[path.split("/").pop()!];
    if (f == null) throw new Error("No such file");
    return f;
  }
  return invoke("remote_read", { target: sshTarget(inst), path });
}
export async function remoteWrite(inst: Instance, path: string, content: string) {
  if (isDemo(inst)) {
    demo.demoFiles(inst)[path.split("/").pop()!] = content;
    return;
  }
  return invoke<void>("remote_write", { target: sshTarget(inst), path, content, backup: true });
}
export async function remoteLs(inst: Instance, dir: string): Promise<{ dir: boolean; size: number; mtime: number; path: string; name: string }[]> {
  if (isDemo(inst))
    return Object.entries(demo.demoFiles(inst)).map(([name, c]) => ({ dir: false, size: c.length, mtime: Date.now() / 1000, path: `${dir}/${name}`, name }));
  return invoke("remote_ls", { target: sshTarget(inst), dir });
}

// ---------------------------------------------------------------- backups
export async function backupList(inst: Instance, root: string): Promise<BackupEntry[]> {
  if (isDemo(inst)) return [...demo.demoBackups(inst)];
  return invoke("backup_list", { destRoot: root, instanceId: inst.id });
}
export async function backupCreate(inst: Instance, root: string, ns: string, bg: string, label: string, includeDb: boolean, keep: number, onStep: (s: string) => void): Promise<BackupEntry> {
  if (isDemo(inst)) return demo.demoCreateBackup(inst, label, includeDb, onStep);
  return invoke("backup_create", {
    req: {
      instanceId: inst.id,
      instanceName: inst.name,
      label,
      target: sshTarget(inst),
      namespace: ns,
      battlegroup: bg,
      settingsDir: inst.settingsDir || DEFAULT_SETTINGS_DIR,
      includeDb,
      destRoot: root,
      keep,
    },
  });
}
export async function backupDelete(inst: Instance, path: string) {
  if (isDemo(inst)) {
    const list = demo.demoBackups(inst);
    const i = list.findIndex((b) => b.path === path);
    if (i >= 0) list.splice(i, 1);
    return;
  }
  return invoke<void>("backup_delete", { path });
}
export async function backupPin(inst: Instance, path: string, pinned: boolean): Promise<string> {
  if (isDemo(inst)) {
    const b = demo.demoBackups(inst).find((x) => x.path === path);
    if (b) {
      const stem = b.file.replace("-pinned", "").replace(/\.zip$/, "");
      b.file = pinned ? `${stem}-pinned.zip` : `${stem}.zip`;
      b.path = `demo://${inst.id}/${b.file}`;
      return b.path;
    }
    return path;
  }
  return invoke("backup_pin", { path, pinned });
}
export async function backupReadSettings(inst: Instance, path: string): Promise<[string, string][]> {
  if (isDemo(inst)) return Object.entries(demo.demoFiles(inst));
  return invoke("backup_read_settings", { path });
}

// ---------------------------------------------------------------- steam
export const steamcmdEnsure = (dir: string) => invoke<string>("steamcmd_ensure", { dir });
export async function steamcmdUpdate(id: string, steamcmd: string, installDir: string, appId: number, username?: string, validate = true) {
  if (!isTauri) {
    (async () => {
      const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
      localBus.line(id, "Redirecting stderr to 'logs\\stderr.txt'", false);
      localBus.line(id, "[  0%] Checking for available updates...", false);
      await w(500);
      localBus.line(id, "Logging in user 'anonymous' to Steam Public...OK", false);
      for (let p = 0; p <= 100; p += 4) {
        await w(140);
        localBus.line(id, ` Update state (0x61) downloading, progress: ${p.toFixed(2)} (${Math.round(p * 4.2e7)} / 4200000000)`, false);
      }
      localBus.line(id, `Success! App '${appId}' fully installed.`, false);
      localBus.exit(id, 0);
    })();
    return;
  }
  return invoke<void>("steamcmd_update", { id, steamcmd, installDir, appId, beta: null, username: username || null, validate });
}
export const steamcmdInteractiveLogin = (steamcmd: string, username: string) => invoke<void>("steamcmd_interactive_login", { steamcmd, username });

export async function remoteBuild(appId: number): Promise<{ buildId: string; timeUpdated: number | null }> {
  if (!isTauri) return { buildId: "20419992", timeUpdated: Date.now() / 1000 - 7200 };
  return invoke("steam_remote_build", { appId, branch: null });
}
export const detectInstalls = (extraDirs: string[]) => (isTauri ? invoke<InstallFound[]>("detect_installs", { extraDirs }) : Promise.resolve([]));
export const findBattlegroupBat = (dir: string) => (isTauri ? invoke<string | null>("find_battlegroup_bat", { dir }) : Promise.resolve(null));
export const launchElevatedConsole = (workingDir: string, commandLine: string) => invoke<void>("launch_elevated_console", { workingDir, commandLine });
export const discoverKeys = (dirs: string[]) => (isTauri ? invoke<string[]>("discover_keys", { dirs }) : Promise.resolve(["C:\\Users\\you\\.ssh\\id_ed25519"]));
export const importKey = (source: string, name: string) => invoke<string>("import_key", { source, name });
export const forgetHost = (host: string) => invoke<void>("ssh_forget_host", { host });

// ---------------------------------------------------------------- network
export async function publicIp(): Promise<string> {
  if (!isTauri) return "203.0.113.42";
  return invoke("public_ip");
}
export interface UpnpStatus {
  gateway: string;
  externalIp: string | null;
  cgnat: boolean;
  mappings: { protocol: string; externalPort: number; internalClient: string; internalPort: number; description: string; enabled: boolean; lease: number }[];
}
export async function upnpStatus(): Promise<UpnpStatus> {
  if (!isTauri) return { gateway: "192.168.1.1:5000", externalIp: "203.0.113.42", cgnat: false, mappings: [] };
  return invoke("upnp_status");
}
export const upnpApply = (targetIp: string, rules: { protocol: string; from: number; to: number }[], remove: boolean) =>
  invoke<{ ok: number; failed: string[] }>("upnp_apply", { targetIp, rules, description: "Dune Awakening (DSM)", remove });
export async function tcpProbe(host: string, port: number, timeoutMs = 2500): Promise<{ open: boolean; latencyMs: number | null; error: string | null }> {
  if (!isTauri) return { open: Math.random() > 0.2, latencyMs: 3, error: null };
  return invoke("tcp_probe", { host, port, timeoutMs });
}
export const ddnsUpdate = (cfg: object, ip: string) => invoke<string>("ddns_update", { cfg, ip });

export async function webhookSend(hook: Webhook, title: string, description: string, color = 0xf08a24) {
  const body = {
    username: "Dune Server Manager",
    embeds: [{ title, description, color, timestamp: new Date().toISOString(), footer: { text: "Dune Server Manager" } }],
  };
  if (!isTauri) {
    const r = await fetch(hook.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${r.status}`);
    return;
  }
  return invoke<void>("webhook_send", { url: hook.url, body });
}

export async function notify(inst: Instance, level: string, kind: string, title: string, message: string) {
  if (!isTauri) return;
  return invoke<void>("automation_notify", { instance: inst, level, kind, title, message }).catch(() => {});
}

export const automationLog = () => (isTauri ? invoke<LogEntry[]>("automation_log") : Promise.resolve([] as LogEntry[]));
export const runPowershell = (script: string, timeout = 60) => invoke<ProcOutput>("run_powershell", { script, timeout });
export const pathExists = (path: string) => (isTauri ? invoke<boolean>("path_exists", { path }) : Promise.resolve(false));
export const steamLocalBuild = (installDir: string, appId: number) => (isTauri ? invoke<string | null>("steam_local_build", { installDir, appId }) : Promise.resolve(null));
