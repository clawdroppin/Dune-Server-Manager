//! Background automation engine. Runs independently of the UI (keeps going while minimised to tray):
//! crash watchdog, pod-restart crash alerts, scheduled restarts with countdown warnings,
//! interval backups with retention, Steam build polling + auto-update, DDNS refresh and
//! player-count notifications, all fanned out to Discord-compatible webhooks.
use crate::backup::{self, BackupRequest};
use crate::dune::{self, Samples, Snapshot};
use crate::net;
use crate::ssh::SshTarget;
use crate::{hyperv, steam, store};
use chrono::{Datelike, Local, Timelike};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Schedule {
    time: String,
    days: Vec<u32>,
    enabled: bool,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Ddns {
    enabled: bool,
    provider: String,
    domain: String,
    token: String,
    zone_id: Option<String>,
    custom_url: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Automation {
    watchdog: bool,
    watchdog_vm: bool,
    crash_alerts: bool,
    restarts: Vec<Schedule>,
    warn_minutes: Vec<i64>,
    backup_enabled: bool,
    backup_interval_hours: f64,
    backup_keep: usize,
    backup_include_db: bool,
    update_check: bool,
    update_interval_minutes: u64,
    auto_update: bool,
    ddns: Ddns,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Webhook {
    url: String,
    enabled: bool,
    events: Vec<String>,
    mention: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct SshCfg {
    host: String,
    port: Option<u16>,
    user: String,
    key_path: Option<String>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Instance {
    id: String,
    name: String,
    mode: String,
    app_id: u32,
    vm_name: String,
    ssh: SshCfg,
    namespace: String,
    battlegroup: String,
    settings_dir: String,
    desired_running: bool,
    maintenance: bool,
    automation: Automation,
    webhooks: Vec<Webhook>,
}

#[derive(Default)]
struct Runtime {
    fail_count: u32,
    unhealthy_count: u32,
    last_players: Option<i64>,
    pod_restarts: HashMap<String, i64>,
    done_keys: HashSet<String>,
    last_backup: Option<Instant>,
    backup_seeded: bool,
    last_update_check: Option<Instant>,
    notified_build: Option<String>,
    last_ddns: Option<Instant>,
    last_ip: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    ts: i64,
    instance_id: String,
    level: String,
    kind: String,
    message: String,
}

#[derive(Default)]
pub struct Engine {
    runtime: Mutex<HashMap<String, Runtime>>,
    busy: Mutex<HashSet<String>>,
    log: Mutex<VecDeque<LogEntry>>,
    ticking: Mutex<HashSet<String>>,
}

pub type EngineRef = Arc<Engine>;

fn target(i: &Instance) -> SshTarget {
    SshTarget {
        host: i.ssh.host.clone(),
        port: i.ssh.port,
        user: if i.ssh.user.is_empty() { "dune".into() } else { i.ssh.user.clone() },
        key_path: i.ssh.key_path.clone(),
    }
}

fn color(kind: &str) -> u32 {
    match kind {
        "crash" => 0xef4444,
        "warning" | "restart" => 0xf59e0b,
        "update" => 0x60a5fa,
        "backup" => 0x34d399,
        "players" => 0xa78bfa,
        "state" => 0xf08a24,
        _ => 0x9ca3af,
    }
}

struct Ctx {
    app: AppHandle,
    engine: EngineRef,
    global_hooks: Vec<Webhook>,
    desktop_notify: bool,
}

impl Ctx {
    fn log(&self, inst: &Instance, level: &str, kind: &str, message: String) {
        let entry = LogEntry {
            ts: Local::now().timestamp_millis(),
            instance_id: inst.id.clone(),
            level: level.into(),
            kind: kind.into(),
            message,
        };
        {
            let mut l = self.engine.log.lock();
            l.push_back(entry.clone());
            while l.len() > 500 {
                l.pop_front();
            }
        }
        let _ = self.app.emit("automation://log", entry);
    }

    /// Log + fan out to every webhook subscribed to `kind`.
    async fn notify(&self, inst: &Instance, level: &str, kind: &str, title: &str, message: String) {
        self.log(inst, level, kind, format!("{title}: {message}"));
        if self.desktop_notify && (level == "error" || kind == "update") {
            use tauri_plugin_notification::NotificationExt;
            let _ = self
                .app
                .notification()
                .builder()
                .title(format!("{} · {title}", inst.name))
                .body(message.replace('`', ""))
                .show();
        }
        let hooks: Vec<Webhook> = inst
            .webhooks
            .iter()
            .chain(self.global_hooks.iter())
            .filter(|w| w.enabled && !w.url.is_empty() && (w.events.is_empty() || w.events.iter().any(|e| e == kind)))
            .cloned()
            .collect();
        for w in hooks {
            let content = w.mention.clone().filter(|m| !m.is_empty() && (kind == "crash" || kind == "update"));
            let body = json!({
                "username": "Dune Server Manager",
                "content": content,
                "embeds": [{
                    "title": title,
                    "description": message,
                    "color": color(kind),
                    "footer": {"text": format!("{} • {}", inst.name, kind)},
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                }]
            });
            if let Err(e) = net::post_webhook(&w.url, &body).await {
                self.log(inst, "error", "webhook", format!("Webhook delivery failed: {e}"));
            }
        }
    }
}

fn load_instances() -> (Vec<Instance>, Vec<Webhook>, String, bool) {
    let st = store::read_state();
    let instances: Vec<Instance> = st["instances"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
        .unwrap_or_default();
    let hooks: Vec<Webhook> = serde_json::from_value(st["settings"]["webhooks"].clone()).unwrap_or_default();
    let root = st["settings"]["backupRoot"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| store::data_dir().join("backups").to_string_lossy().into_owned());
    let desktop_notify = st["settings"]["desktopNotifications"].as_bool().unwrap_or(true);
    (instances, hooks, root, desktop_notify)
}

fn needs_tick(a: &Automation, i: &Instance) -> bool {
    a.watchdog
        || a.crash_alerts
        || a.backup_enabled
        || a.update_check
        || a.ddns.enabled
        || a.restarts.iter().any(|r| r.enabled)
        || i.webhooks.iter().any(|w| w.enabled)
}

pub fn spawn(app: AppHandle) {
    let engine: EngineRef = app.state::<EngineRef>().inner().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            let (instances, global_hooks, backup_root, desktop_notify) = load_instances();
            let has_globals = global_hooks.iter().any(|w| w.enabled);
            let ctx = Arc::new(Ctx { app: app.clone(), engine: engine.clone(), global_hooks, desktop_notify });
            for inst in instances.into_iter().filter(|i| i.mode == "real" && !i.ssh.host.is_empty() && (has_globals || needs_tick(&i.automation, i))) {
                // Never run two ticks for the same instance at once (a slow SSH call can outlive the interval).
                if !ctx.engine.ticking.lock().insert(inst.id.clone()) {
                    continue;
                }
                let ctx = ctx.clone();
                let root = backup_root.clone();
                // Each instance ticks concurrently; a hung SSH call never stalls the others.
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(90), tick(&ctx, &inst, &root)).await;
                    ctx.engine.ticking.lock().remove(&inst.id);
                });
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

fn is_busy(ctx: &Ctx, id: &str) -> bool {
    ctx.engine.busy.lock().contains(id)
}

fn emit_busy(ctx: &Ctx) {
    let list: Vec<String> = ctx.engine.busy.lock().iter().cloned().collect();
    let _ = ctx.app.emit("automation://busy", list);
}

/// Run a long task (restart/backup/update) detached, guarded by a per-instance busy flag.
fn run_exclusive<F>(ctx: &Arc<Ctx>, inst: &Instance, fut: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    if !ctx.engine.busy.lock().insert(inst.id.clone()) {
        return;
    }
    emit_busy(ctx);
    let ctx = ctx.clone();
    let id = inst.id.clone();
    tauri::async_runtime::spawn(async move {
        fut.await;
        ctx.engine.busy.lock().remove(&id);
        emit_busy(&ctx);
    });
}

async fn tick(ctx: &Arc<Ctx>, inst: &Instance, backup_root: &str) {
    let a = &inst.automation;
    let t = target(inst);
    let samples = ctx.app.state::<Samples>();
    let snap: Result<Snapshot, String> = dune::snapshot(&samples, &t).await;
    let busy = is_busy(ctx, &inst.id);

    let (ns, bgname) = match &snap {
        Ok(s) => {
            let bg = s
                .battlegroups
                .iter()
                .find(|b| b.namespace == inst.namespace || inst.namespace.is_empty())
                .or(s.battlegroups.first());
            (
                bg.map(|b| b.namespace.clone()).unwrap_or_else(|| inst.namespace.clone()),
                bg.map(|b| b.name.clone()).unwrap_or_else(|| inst.battlegroup.clone()),
            )
        }
        Err(_) => (inst.namespace.clone(), inst.battlegroup.clone()),
    };

    // ---- Health / watchdog ------------------------------------------------------------
    match &snap {
        Err(e) => {
            let fails = {
                let mut rt = ctx.engine.runtime.lock();
                let r = rt.entry(inst.id.clone()).or_default();
                r.fail_count += 1;
                r.fail_count
            };
            if fails == 3 {
                ctx.notify(inst, "error", "crash", "Battlegroup VM unreachable", format!("SSH failed 3 times in a row: {e}")).await;
            }
            if a.watchdog && !inst.maintenance && a.watchdog_vm && inst.desired_running && fails >= 3 && fails % 3 == 0 && !inst.vm_name.is_empty() && !busy {
                if let Ok(list) = hyperv::vm_list().await {
                    let state = list
                        .as_array()
                        .and_then(|l| l.iter().find(|v| v["name"].as_str() == Some(inst.vm_name.as_str())))
                        .and_then(|v| v["state"].as_str().map(String::from))
                        .unwrap_or_default();
                    if state == "Off" || state == "Saved" || state == "Paused" {
                        ctx.notify(inst, "warn", "crash", "Watchdog: starting VM", format!("VM '{}' was {state}; starting it.", inst.vm_name)).await;
                        if let Err(e) = hyperv::vm_action(inst.vm_name.clone(), "start".into()).await {
                            ctx.log(inst, "error", "watchdog", format!("Start-VM failed: {e}"));
                        }
                    }
                }
            }
            return;
        }
        Ok(s) => {
            let (prev_fail, prev_players, restarts_delta, unhealthy) = {
                let mut rt = ctx.engine.runtime.lock();
                let r = rt.entry(inst.id.clone()).or_default();
                let pf = r.fail_count;
                r.fail_count = 0;
                let bg = s.battlegroups.iter().find(|b| b.namespace == ns);
                let total = bg.map(|b| b.players);
                let pp = r.last_players;
                r.last_players = total;
                let mut deltas = vec![];
                for p in s.pods.iter().filter(|p| p.namespace == ns) {
                    let key = p.name.clone();
                    if let Some(old) = r.pod_restarts.get(&key) {
                        if p.restarts > *old {
                            deltas.push((p.name.clone(), p.restarts - old, p.reason.clone()));
                        }
                    }
                    r.pod_restarts.insert(key, p.restarts);
                }
                let unhealthy_now = match bg {
                    Some(b) => !b.stop && !b.servers.is_empty() && b.servers.iter().all(|x| !x.ready),
                    None => false,
                };
                r.unhealthy_count = if unhealthy_now { r.unhealthy_count + 1 } else { 0 };
                (pf, (pp, total), deltas, r.unhealthy_count)
            };
            if prev_fail >= 3 {
                ctx.notify(inst, "info", "state", "Battlegroup VM reachable again", format!("Connection restored after {prev_fail} failed checks.")).await;
            }
            if a.crash_alerts {
                for (pod, n, reason) in restarts_delta {
                    let why = if reason.is_empty() { String::new() } else { format!(" ({reason})") };
                    ctx.notify(inst, "error", "crash", "Server process crashed", format!("`{pod}` restarted {n}x{why}. Kubernetes restarted it automatically.")).await;
                }
            }
            if let (Some(old), Some(new)) = prev_players {
                if old != new {
                    let diff = new - old;
                    let sign = if diff > 0 { "+" } else { "" };
                    ctx.notify(inst, "info", "players", "Player count changed", format!("{new} online ({sign}{diff})")).await;
                }
            }
            let bg = s.battlegroups.iter().find(|b| b.namespace == ns);
            if a.watchdog && !inst.maintenance && inst.desired_running && !busy {
                if let Some(b) = bg {
                    if b.stop {
                        ctx.notify(inst, "warn", "crash", "Watchdog: battlegroup stopped unexpectedly", "Desired state is running; starting it again.".into()).await;
                        let _ = dune::bg_set_stop(t.clone(), ns.clone(), bgname.clone(), false).await;
                    } else if unhealthy == 10 {
                        // ~5 minutes with zero ready map servers.
                        let inst2 = inst.clone();
                        let ctx2 = ctx.clone();
                        let (t2, ns2) = (t.clone(), ns.clone());
                        ctx.notify(inst, "error", "crash", "Watchdog: no map server ready for 5 minutes", "Restarting the battlegroup.".into()).await;
                        run_exclusive(ctx, inst, async move {
                            match dune::wrapper_exec(&t2, &ns2, &["restart".into()], 900).await {
                                Ok(o) if o.ok() => ctx2.log(&inst2, "info", "watchdog", "Watchdog restart completed".into()),
                                Ok(o) => ctx2.log(&inst2, "error", "watchdog", o.combined()),
                                Err(e) => ctx2.log(&inst2, "error", "watchdog", e),
                            }
                        });
                    }
                }
            }
        }
    }

    // ---- Scheduled restarts with countdown warnings -------------------------------------
    let now = Local::now();
    let weekday = now.weekday().num_days_from_sunday();
    let now_min = (now.hour() * 60 + now.minute()) as i64;
    let date = now.format("%Y-%m-%d").to_string();
    {
        // Keep the de-duplication set bounded: only today's keys matter.
        let mut rt = ctx.engine.runtime.lock();
        let r = rt.entry(inst.id.clone()).or_default();
        if r.done_keys.len() > 200 {
            r.done_keys.retain(|k| k.contains(&date));
        }
    }
    for sch in a.restarts.iter().filter(|s| s.enabled && !inst.maintenance) {
        if !sch.days.is_empty() && !sch.days.contains(&weekday) {
            continue;
        }
        let Some((h, m)) = sch.time.split_once(':') else { continue };
        let (Ok(h), Ok(m)) = (h.trim().parse::<i64>(), m.trim().parse::<i64>()) else { continue };
        let target_min = h * 60 + m;
        let until = target_min - now_min;
        for w in &a.warn_minutes {
            let key = format!("warn-{date}-{}-{w}", sch.time);
            if until == *w && ctx.engine.runtime.lock().entry(inst.id.clone()).or_default().done_keys.insert(key) {
                ctx.notify(inst, "warn", "warning", "Scheduled restart", format!("Server restarts in **{w} minute{}** ({}).", if *w == 1 { "" } else { "s" }, sch.time)).await;
            }
        }
        if (0..=1).contains(&(now_min - target_min)) {
            let key = format!("restart-{date}-{}", sch.time);
            let first = ctx.engine.runtime.lock().entry(inst.id.clone()).or_default().done_keys.insert(key);
            if first && !busy {
                ctx.notify(inst, "warn", "restart", "Scheduled restart", "Restarting battlegroup now.".into()).await;
                let (ctx2, inst2, t2, ns2) = (ctx.clone(), inst.clone(), t.clone(), ns.clone());
                run_exclusive(ctx, inst, async move {
                    let res = dune::wrapper_exec(&t2, &ns2, &["restart".into()], 900).await;
                    match res {
                        Ok(o) if o.ok() => ctx2.notify(&inst2, "info", "restart", "Restart complete", "Battlegroup is coming back online.".into()).await,
                        Ok(o) => ctx2.notify(&inst2, "error", "restart", "Restart failed", o.combined().chars().take(1500).collect()).await,
                        Err(e) => ctx2.notify(&inst2, "error", "restart", "Restart failed", e).await,
                    }
                });
            }
        }
    }

    // ---- Interval backups -------------------------------------------------------------
    if a.backup_enabled && a.backup_interval_hours > 0.0 && !is_busy(ctx, &inst.id) {
        let due = {
            let mut rt = ctx.engine.runtime.lock();
            let r = rt.entry(inst.id.clone()).or_default();
            if !r.backup_seeded {
                // Seed from newest archive on disk so app restarts don't trigger an immediate backup.
                r.backup_seeded = true;
                let newest_age = std::fs::read_dir(backup::instance_dir(backup_root, &inst.id))
                    .into_iter()
                    .flatten()
                    .filter_map(Result::ok)
                    .filter_map(|e| e.metadata().ok()?.modified().ok())
                    .max()
                    .and_then(|t| t.elapsed().ok());
                r.last_backup = newest_age.and_then(|age| Instant::now().checked_sub(age));
            }
            match r.last_backup {
                None => true,
                Some(t) => t.elapsed() >= Duration::from_secs_f64(a.backup_interval_hours * 3600.0),
            }
        };
        if due {
            ctx.engine.runtime.lock().entry(inst.id.clone()).or_default().last_backup = Some(Instant::now());
            let req = BackupRequest {
                instance_id: inst.id.clone(),
                instance_name: inst.name.clone(),
                label: "auto".into(),
                target: t.clone(),
                namespace: ns.clone(),
                battlegroup: bgname.clone(),
                settings_dir: if inst.settings_dir.is_empty() {
                    "/home/dune/server/DuneSandbox/Saved/UserSettings".into()
                } else {
                    inst.settings_dir.clone()
                },
                include_db: a.backup_include_db,
                dest_root: backup_root.to_string(),
                keep: if a.backup_keep == 0 { 14 } else { a.backup_keep },
            };
            let (ctx2, inst2) = (ctx.clone(), inst.clone());
            run_exclusive(ctx, inst, async move {
                match backup::create(&ctx2.app, req).await {
                    Ok(b) => {
                        let _ = ctx2.app.emit("backup://created", json!({"instanceId": inst2.id}));
                        ctx2.notify(&inst2, "info", "backup", "Backup complete", format!("`{}` ({:.1} MB)", b.file, b.size as f64 / 1_048_576.0)).await
                    }
                    Err(e) => ctx2.notify(&inst2, "error", "backup", "Backup failed", e).await,
                }
            });
        }
    }

    // ---- Update polling ---------------------------------------------------------------
    if a.update_check {
        let interval = Duration::from_secs(a.update_interval_minutes.max(5) * 60);
        let due = {
            let mut rt = ctx.engine.runtime.lock();
            let r = rt.entry(inst.id.clone()).or_default();
            let d = r.last_update_check.map(|t| t.elapsed() >= interval).unwrap_or(true);
            if d {
                r.last_update_check = Some(Instant::now());
            }
            d
        };
        if due {
            let app_id = if inst.app_id == 0 { steam::APP_LIVE } else { inst.app_id };
            let local = snap.as_ref().ok().and_then(|s| s.build_id.clone());
            if let (Ok(remote), Some(local)) = (steam::steam_remote_build(app_id, None).await, local) {
                let remote_id = remote.build_id.clone();
                if !remote_id.is_empty() && remote_id != local {
                    let first = {
                        let mut rt = ctx.engine.runtime.lock();
                        let r = rt.entry(inst.id.clone()).or_default();
                        let f = r.notified_build.as_deref() != Some(remote_id.as_str());
                        r.notified_build = Some(remote_id.clone());
                        f
                    };
                    if first {
                        ctx.notify(inst, "info", "update", "Server update available", format!("Build {local} → {remote_id}")).await;
                    }
                    if a.auto_update && !is_busy(ctx, &inst.id) {
                        let (ctx2, inst2, t2, ns2, bg2) = (ctx.clone(), inst.clone(), t.clone(), ns.clone(), bgname.clone());
                        let root = backup_root.to_string();
                        run_exclusive(ctx, inst, async move {
                            ctx2.notify(&inst2, "warn", "update", "Auto-update starting", format!("Updating to build {remote_id}. Taking a safety backup first.")).await;
                            let req = BackupRequest {
                                instance_id: inst2.id.clone(),
                                instance_name: inst2.name.clone(),
                                label: format!("pre-update-{remote_id}"),
                                target: t2.clone(),
                                namespace: ns2.clone(),
                                battlegroup: bg2,
                                settings_dir: if inst2.settings_dir.is_empty() { "/home/dune/server/DuneSandbox/Saved/UserSettings".into() } else { inst2.settings_dir.clone() },
                                include_db: false,
                                dest_root: root,
                                keep: 0,
                            };
                            let _ = backup::create(&ctx2.app, req).await;
                            match dune::wrapper_exec(&t2, &ns2, &["update".into()], 5400).await {
                                Ok(o) if o.ok() => ctx2.notify(&inst2, "info", "update", "Update installed", format!("Now on build {remote_id}.")).await,
                                Ok(o) => ctx2.notify(&inst2, "error", "update", "Update failed", o.combined().chars().rev().take(1500).collect::<String>().chars().rev().collect()).await,
                                Err(e) => ctx2.notify(&inst2, "error", "update", "Update failed", e).await,
                            }
                        });
                    }
                }
            }
        }
    }

    // ---- DDNS ---------------------------------------------------------------------------
    if a.ddns.enabled && !a.ddns.domain.is_empty() {
        let due = {
            let mut rt = ctx.engine.runtime.lock();
            let r = rt.entry(inst.id.clone()).or_default();
            let d = r.last_ddns.map(|t| t.elapsed() >= Duration::from_secs(600)).unwrap_or(true);
            if d {
                r.last_ddns = Some(Instant::now());
            }
            d
        };
        if due {
            if let Ok(ip) = net::public_ip().await {
                let changed = ctx.engine.runtime.lock().entry(inst.id.clone()).or_default().last_ip.as_deref() != Some(ip.as_str());
                if changed {
                    let cfg: net::DdnsConfig = serde_json::from_value(json!({
                        "provider": a.ddns.provider, "domain": a.ddns.domain, "token": a.ddns.token,
                        "zoneId": a.ddns.zone_id, "customUrl": a.ddns.custom_url,
                    }))
                    .unwrap();
                    match net::ddns_update(cfg, ip.clone()).await {
                        Ok(m) => {
                            ctx.engine.runtime.lock().entry(inst.id.clone()).or_default().last_ip = Some(ip);
                            ctx.log(inst, "info", "ddns", m)
                        }
                        Err(e) => ctx.log(inst, "error", "ddns", e),
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn automation_log(engine: tauri::State<'_, EngineRef>) -> Vec<LogEntry> {
    engine.log.lock().iter().cloned().collect()
}

#[tauri::command]
pub fn automation_busy(engine: tauri::State<'_, EngineRef>) -> Vec<String> {
    engine.busy.lock().iter().cloned().collect()
}

/// Lets the UI reuse the same notification pipeline (e.g. manual start/stop, test messages).
#[tauri::command]
pub async fn automation_notify(app: AppHandle, instance: Value, level: String, kind: String, title: String, message: String) -> Result<(), String> {
    let inst: Instance = serde_json::from_value(instance).map_err(|e| e.to_string())?;
    let (_, global_hooks, _, _) = load_instances();
    let ctx = Ctx { engine: app.state::<EngineRef>().inner().clone(), app: app.clone(), global_hooks, desktop_notify: false };
    ctx.notify(&inst, &level, &kind, &title, message).await;
    Ok(())
}
