//! Battlegroup knowledge: snapshot collection over SSH, BattleGroup/ServerStats CR parsing,
//! vendor `battlegroup` wrapper driving and direct kubectl lifecycle patches.
use crate::ssh::{self, sq, SshTarget};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;
use tauri::AppHandle;

pub const WRAPPER: &str = "/home/dune/.dune/bin/battlegroup";

/// Picks `sudo -n kubectl` when passwordless sudo works, otherwise plain kubectl.
pub const KUBECTL_PRELUDE: &str = "K='sudo -n kubectl'; $K version --client >/dev/null 2>&1 || K='kubectl'\n";

const SNAPSHOT_SCRIPT: &str = r#"
echo '@@BG'; $K get battlegroups,serverstats -A -o json 2>/dev/null || $K get battlegroups -A -o json 2>&1
echo '@@PODS'; $K get pods -A --no-headers -o 'custom-columns=NS:.metadata.namespace,NAME:.metadata.name,PHASE:.status.phase,READY:.status.containerStatuses[*].ready,RESTARTS:.status.containerStatuses[*].restartCount,START:.status.startTime,REASON:.status.containerStatuses[*].state.waiting.reason' 2>/dev/null
echo '@@TOP'; $K top pods -A --no-headers 2>/dev/null
echo '@@MEM'; head -5 /proc/meminfo
echo '@@STAT'; head -1 /proc/stat
echo '@@NCPU'; grep -c ^processor /proc/cpuinfo
echo '@@LOAD'; cat /proc/loadavg
echo '@@NET'; cat /proc/net/dev
echo '@@DF'; df -P -k / 2>/dev/null | tail -1
echo '@@UP'; cat /proc/uptime
echo '@@BUILD'; for f in /home/dune/.dune/download/steamapps/appmanifest_*.acf; do [ -f "$f" ] && awk -F'"' '$2=="buildid"{print $4; exit}' "$f"; done
echo '@@HOST'; hostname
echo '@@END'
"#;

#[derive(Default)]
pub struct Samples {
    prev: Mutex<HashMap<String, Sample>>,
    /// Short-lived cache so the UI poll and the automation engine share one SSH round-trip.
    cache: Mutex<HashMap<String, (Instant, Snapshot)>>,
}

#[derive(Clone, Copy)]
pub struct Sample {
    total: u64,
    idle: u64,
    rx: u64,
    tx: u64,
    at: Instant,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MapServer {
    pub map: String,
    pub label: String,
    pub partition: Option<i64>,
    pub phase: String,
    pub ready: bool,
    pub players: Option<i64>,
    pub start: Option<String>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Battlegroup {
    pub namespace: String,
    pub name: String,
    pub title: String,
    pub stop: bool,
    pub phase: String,
    pub database_phase: String,
    pub director_phase: String,
    pub gateway_phase: String,
    pub server_group_phase: String,
    pub start: Option<String>,
    pub servers: Vec<MapServer>,
    pub players: i64,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pod {
    pub namespace: String,
    pub name: String,
    pub phase: String,
    pub ready: String,
    pub restarts: i64,
    pub start: String,
    pub reason: String,
    pub cpu_milli: Option<f64>,
    pub mem_bytes: Option<f64>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VmStats {
    pub cpu: Option<f64>,
    pub cores: u32,
    pub mem_total: u64,
    pub mem_available: u64,
    pub load1: f64,
    pub rx_bps: Option<f64>,
    pub tx_bps: Option<f64>,
    pub disk_total: u64,
    pub disk_used: u64,
    pub uptime: f64,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub ok: bool,
    pub error: Option<String>,
    pub hostname: String,
    pub battlegroups: Vec<Battlegroup>,
    pub pods: Vec<Pod>,
    pub vm: VmStats,
    pub build_id: Option<String>,
    pub latency_ms: u64,
}

fn sections(text: &str) -> HashMap<&str, String> {
    let mut map: HashMap<&str, String> = HashMap::new();
    let mut cur: Option<&str> = None;
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("@@") {
            let name = name.trim();
            map.entry(name).or_default();
            cur = Some(name);
            continue;
        }
        if let Some(c) = cur {
            let e = map.entry(c).or_default();
            e.push_str(line);
            e.push('\n');
        }
    }
    map
}

fn s(v: &Value, k: &str) -> String {
    match v.get(k) {
        Some(Value::String(x)) => x.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

pub fn friendly_map(map: &str) -> String {
    let m = map.to_ascii_lowercase();
    if m == "survival_1" || m.contains("survival-1") {
        "Hagga Basin".into()
    } else if m.contains("overmap") {
        "Overland Map".into()
    } else if m.contains("deepdesert") || m.contains("deep-desert") {
        "Deep Desert".into()
    } else if m.contains("arrakeen") {
        "Arrakeen".into()
    } else if m.contains("harko") {
        "Harko Village".into()
    } else if map.is_empty() {
        "Game Server".into()
    } else {
        map.replace('_', " ")
    }
}

fn parse_bgs(bg: &Value, ss: &Value) -> Vec<Battlegroup> {
    let mut players: HashMap<(String, i64), i64> = HashMap::new();
    if let Some(items) = ss.get("items").and_then(Value::as_array) {
        for it in items {
            let ns = it["metadata"]["namespace"].as_str().unwrap_or("").to_string();
            if let (Some(p), Some(n)) = (
                it["spec"]["area"]["partition"].as_i64(),
                it["status"]["runtime"]["players"].as_i64(),
            ) {
                players.insert((ns, p), n);
            }
        }
    }
    let mut out = vec![];
    let Some(items) = bg.get("items").and_then(Value::as_array) else {
        return out;
    };
    for it in items {
        let ns = it["metadata"]["namespace"].as_str().unwrap_or("").to_string();
        let spec = &it["spec"];
        let st = &it["status"];
        let servers: Vec<MapServer> = st
            .get("servers")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .map(|sv| {
                        let raw = sv
                            .get("partitionMap")
                            .or_else(|| sv.get("map"))
                            .or_else(|| sv.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let part = sv
                            .get("partitionIndex")
                            .or_else(|| sv.get("ordinalIndex"))
                            .and_then(Value::as_i64);
                        let ready = match sv.get("ready") {
                            Some(Value::Bool(b)) => *b,
                            Some(Value::String(x)) => x.eq_ignore_ascii_case("true"),
                            _ => false,
                        };
                        let friendly = friendly_map(raw);
                        MapServer {
                            map: raw.to_string(),
                            label: match part {
                                Some(p) => format!("{friendly} #{p}"),
                                None => friendly,
                            },
                            partition: part,
                            phase: s(sv, "phase"),
                            ready,
                            players: part.and_then(|p| players.get(&(ns.clone(), p)).copied()),
                            start: sv.get("startTimestamp").and_then(Value::as_str).map(String::from),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        let total = servers.iter().filter_map(|x| x.players).sum();
        let title = ["title", "displayName", "worldName", "serverName"]
            .iter()
            .map(|k| s(spec, k))
            .find(|v| !v.is_empty())
            .unwrap_or_default();
        out.push(Battlegroup {
            name: it["metadata"]["name"].as_str().unwrap_or("").to_string(),
            namespace: ns,
            title,
            stop: spec["stop"].as_bool().or_else(|| st["stop"].as_bool()).unwrap_or(false),
            phase: s(st, "phase"),
            database_phase: st["database"]["phase"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| s(st, "databasePhase")),
            director_phase: st["utilities"]["director"]["phase"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| s(st, "directorPhase")),
            gateway_phase: st["utilities"]["serverGateway"]["phase"]
                .as_str()
                .map(String::from)
                .unwrap_or_default(),
            server_group_phase: s(st, "serverGroupPhase"),
            start: st.get("startTimestamp").and_then(Value::as_str).map(String::from),
            servers,
            players: total,
        });
    }
    out
}

fn parse_quantity_cpu(q: &str) -> Option<f64> {
    if let Some(m) = q.strip_suffix('m') {
        m.parse().ok()
    } else if let Some(n) = q.strip_suffix('n') {
        n.parse::<f64>().ok().map(|v| v / 1_000_000.0)
    } else {
        q.parse::<f64>().ok().map(|v| v * 1000.0)
    }
}

fn parse_quantity_mem(q: &str) -> Option<f64> {
    let units = [
        ("Ki", 1024f64),
        ("Mi", 1024f64.powi(2)),
        ("Gi", 1024f64.powi(3)),
        ("Ti", 1024f64.powi(4)),
        ("k", 1e3),
        ("M", 1e6),
        ("G", 1e9),
    ];
    for (u, mul) in units {
        if let Some(n) = q.strip_suffix(u) {
            return n.parse::<f64>().ok().map(|v| v * mul);
        }
    }
    q.parse().ok()
}

pub fn parse_snapshot(text: &str, prev: Option<Sample>) -> (Snapshot, Option<Sample>) {
    let sec = sections(text);
    let mut snap = Snapshot::default();
    let bg_text = sec.get("BG").map(String::as_str).unwrap_or("");
    let list: Value = serde_json::from_str(bg_text.trim()).unwrap_or(Value::Null);
    if list.is_null() && !bg_text.trim().is_empty() {
        snap.error = Some(bg_text.trim().lines().take(3).collect::<Vec<_>>().join(" "));
    }
    // One `kubectl get battlegroups,serverstats` returns a mixed List; split it by kind.
    let (mut bg_items, mut ss_items) = (vec![], vec![]);
    for it in list.get("items").and_then(Value::as_array).cloned().unwrap_or_default() {
        if it["kind"].as_str().is_some_and(|k| k.eq_ignore_ascii_case("ServerStats")) {
            ss_items.push(it);
        } else {
            bg_items.push(it);
        }
    }
    if let Some(ss_text) = sec.get("SS") {
        if let Ok(Value::Object(o)) = serde_json::from_str::<Value>(ss_text.trim()) {
            ss_items.extend(o.get("items").and_then(Value::as_array).cloned().unwrap_or_default());
        }
    }
    let bg = serde_json::json!({ "items": bg_items });
    let ss = serde_json::json!({ "items": ss_items });
    snap.battlegroups = parse_bgs(&bg, &ss);

    let mut top: HashMap<(String, String), (Option<f64>, Option<f64>)> = HashMap::new();
    for line in sec.get("TOP").map(String::as_str).unwrap_or("").lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() >= 4 {
            top.insert(
                (f[0].to_string(), f[1].to_string()),
                (parse_quantity_cpu(f[2]), parse_quantity_mem(f[3])),
            );
        }
    }
    for line in sec.get("PODS").map(String::as_str).unwrap_or("").lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 6 {
            continue;
        }
        let (cpu, mem) = top
            .get(&(f[0].to_string(), f[1].to_string()))
            .copied()
            .unwrap_or((None, None));
        let restarts = f[4]
            .split(',')
            .filter_map(|x| x.parse::<i64>().ok())
            .sum();
        snap.pods.push(Pod {
            namespace: f[0].into(),
            name: f[1].into(),
            phase: f[2].into(),
            ready: f[3].into(),
            restarts,
            start: f[5].into(),
            reason: f.get(6).map(|x| x.to_string()).filter(|x| x != "<none>").unwrap_or_default(),
            cpu_milli: cpu,
            mem_bytes: mem,
        });
    }

    // VM-level stats
    let mut vm = VmStats::default();
    for line in sec.get("MEM").map(String::as_str).unwrap_or("").lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() >= 2 {
            let kb: u64 = f[1].parse().unwrap_or(0);
            match f[0] {
                "MemTotal:" => vm.mem_total = kb * 1024,
                "MemAvailable:" => vm.mem_available = kb * 1024,
                _ => {}
            }
        }
    }
    vm.cores = sec.get("NCPU").and_then(|t| t.trim().parse().ok()).unwrap_or(0);
    vm.load1 = sec
        .get("LOAD")
        .and_then(|t| t.split_whitespace().next().and_then(|x| x.parse().ok()))
        .unwrap_or(0.0);
    vm.uptime = sec
        .get("UP")
        .and_then(|t| t.split_whitespace().next().and_then(|x| x.parse().ok()))
        .unwrap_or(0.0);
    if let Some(df) = sec.get("DF") {
        let f: Vec<&str> = df.split_whitespace().collect();
        if f.len() >= 4 {
            vm.disk_total = f[1].parse::<u64>().unwrap_or(0) * 1024;
            vm.disk_used = f[2].parse::<u64>().unwrap_or(0) * 1024;
        }
    }
    let (mut total, mut idle) = (0u64, 0u64);
    if let Some(stat) = sec.get("STAT") {
        let nums: Vec<u64> = stat
            .split_whitespace()
            .skip(1)
            .filter_map(|x| x.parse().ok())
            .collect();
        total = nums.iter().sum();
        idle = nums.get(3).copied().unwrap_or(0) + nums.get(4).copied().unwrap_or(0);
    }
    let (mut rx, mut tx) = (0u64, 0u64);
    for line in sec.get("NET").map(String::as_str).unwrap_or("").lines().skip(2) {
        let Some((iface, rest)) = line.split_once(':') else { continue };
        let iface = iface.trim();
        if iface == "lo" || iface.starts_with("veth") || iface.starts_with("cni") || iface.starts_with("flannel") {
            continue;
        }
        let f: Vec<u64> = rest.split_whitespace().filter_map(|x| x.parse().ok()).collect();
        if f.len() >= 9 {
            rx += f[0];
            tx += f[8];
        }
    }
    let now = Sample { total, idle, rx, tx, at: Instant::now() };
    if let Some(p) = prev {
        let dt = now.at.duration_since(p.at).as_secs_f64().max(0.001);
        let dtot = total.saturating_sub(p.total) as f64;
        let didle = idle.saturating_sub(p.idle) as f64;
        if dtot > 0.0 {
            vm.cpu = Some(((dtot - didle) / dtot * 100.0).clamp(0.0, 100.0));
        }
        vm.rx_bps = Some(rx.saturating_sub(p.rx) as f64 / dt);
        vm.tx_bps = Some(tx.saturating_sub(p.tx) as f64 / dt);
    }
    snap.vm = vm;
    snap.build_id = sec
        .get("BUILD")
        .and_then(|t| t.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from));
    snap.hostname = sec.get("HOST").map(|h| h.trim().to_string()).unwrap_or_default();
    snap.ok = sec.contains_key("END");
    (snap, if total > 0 { Some(now) } else { prev })
}

pub async fn snapshot(samples: &Samples, target: &SshTarget) -> Result<Snapshot, String> {
    let key = format!("{}@{}:{}", target.user, target.host, target.port.unwrap_or(22));
    if let Some((at, snap)) = samples.cache.lock().get(&key) {
        if at.elapsed() < std::time::Duration::from_millis(2500) {
            return Ok(snap.clone());
        }
    }
    let started = Instant::now();
    let script = format!("{KUBECTL_PRELUDE}{SNAPSHOT_SCRIPT}");
    let out = ssh::exec(target, &script, 40).await?;
    let prev = samples.prev.lock().get(&key).copied();
    let (mut snap, next) = parse_snapshot(&out.stdout, prev);
    if let Some(n) = next {
        samples.prev.lock().insert(key.clone(), n);
    }
    snap.latency_ms = started.elapsed().as_millis() as u64;
    if !snap.ok && snap.error.is_none() {
        snap.error = Some(out.combined().trim().chars().take(400).collect());
    }
    samples.cache.lock().insert(key, (Instant::now(), snap.clone()));
    Ok(snap)
}

#[tauri::command]
pub async fn bg_snapshot(samples: tauri::State<'_, Samples>, target: SshTarget) -> Result<Snapshot, String> {
    snapshot(&samples, &target).await
}

/// Build a script that drives the interactive vendor wrapper non-interactively
/// by piping the battlegroup index (and a "N" for retry prompts) on stdin.
pub fn wrapper_script(namespace: &str, args: &[String]) -> String {
    let argv = args.iter().map(|a| sq(a)).collect::<Vec<_>>().join(" ");
    format!(
        r#"{KUBECTL_PRELUDE}WRAPPER={wrapper}
TARGET_NS={ns}
if [ ! -x "$WRAPPER" ]; then echo "battlegroup CLI not found at $WRAPPER" >&2; exit 1; fi
idx=$($K get ns --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null | grep '^funcom-seabass-' | awk -v t="$TARGET_NS" '{{ i++; if ($1==t) {{ print i; exit }} }}')
[ -z "$idx" ] && idx=1
if [ "$(whoami)" = "dune" ]; then
  printf '%s\nN\nN\n' "$idx" | "$WRAPPER" {argv}
else
  printf '%s\nN\nN\n' "$idx" | sudo -n -u dune -H "$WRAPPER" {argv}
fi
"#,
        wrapper = sq(WRAPPER),
        ns = sq(namespace),
    )
}

#[tauri::command]
pub fn bg_wrapper_stream(app: AppHandle, id: String, target: SshTarget, namespace: String, args: Vec<String>) -> Result<(), String> {
    ssh::ssh_stream(app, id, target, wrapper_script(&namespace, &args))
}

pub async fn wrapper_exec(target: &SshTarget, namespace: &str, args: &[String], timeout: u64) -> Result<crate::proc::Output, String> {
    ssh::exec(target, &wrapper_script(namespace, args), timeout).await
}

pub fn patch_stop_script(namespace: &str, name: &str, stop: bool) -> String {
    format!(
        "{KUBECTL_PRELUDE}$K patch battlegroup {} -n {} --type=merge -p '{{\"spec\":{{\"stop\":{}}}}}'\n",
        sq(name),
        sq(namespace),
        stop
    )
}

/// Fast start/stop by flipping `spec.stop` on the BattleGroup CR (same thing the wrapper does).
#[tauri::command]
pub async fn bg_set_stop(target: SshTarget, namespace: String, name: String, stop: bool) -> Result<String, String> {
    let out = ssh::exec(&target, &patch_stop_script(&namespace, &name, stop), 60).await?;
    if out.ok() {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(out.combined().trim().to_string())
    }
}

/// Run an arbitrary kubectl invocation (args are appended after the resolved kubectl prefix).
#[tauri::command]
pub async fn kubectl(target: SshTarget, args: String, stdin_b64: Option<String>, timeout: Option<u64>) -> Result<crate::proc::Output, String> {
    let script = match stdin_b64 {
        Some(b) => format!("{KUBECTL_PRELUDE}base64 -d <<'DSM_B64_END' | $K {args}\n{b}\nDSM_B64_END\n"),
        None => format!("{KUBECTL_PRELUDE}$K {args}\n"),
    };
    ssh::exec(&target, &script, timeout.unwrap_or(60)).await
}

#[tauri::command]
pub fn kubectl_stream(app: AppHandle, id: String, target: SshTarget, args: String) -> Result<(), String> {
    ssh::ssh_stream(app, id, target, format!("{KUBECTL_PRELUDE}exec $K {args}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_snapshot() {
        let text = r#"@@BG
{"items":[{"metadata":{"name":"bg1","namespace":"funcom-seabass-sh-abc"},"spec":{"stop":false,"title":"Arrakis Prime"},"status":{"phase":"Running","database":{"phase":"Ready"},"utilities":{"director":{"phase":"Healthy"}},"servers":[{"partitionMap":"Survival_1","partitionIndex":1,"phase":"Running","ready":true}]}}]}
@@SS
{"items":[{"metadata":{"namespace":"funcom-seabass-sh-abc"},"spec":{"area":{"partition":1}},"status":{"runtime":{"players":7}}}]}
@@PODS
funcom-seabass-sh-abc  bg1-sg-survival-1-0  Running  true  2  2026-10-01T10:00:00Z  <none>
@@TOP
funcom-seabass-sh-abc  bg1-sg-survival-1-0  1250m  9Gi
@@MEM
MemTotal:       41943040 kB
MemFree:         1000000 kB
MemAvailable:   20971520 kB
@@STAT
cpu  100 0 100 800 0 0 0 0 0 0
@@NCPU
6
@@END
"#;
        let (snap, sample) = parse_snapshot(text, None);
        assert!(snap.ok);
        assert_eq!(snap.battlegroups[0].players, 7);
        assert_eq!(snap.battlegroups[0].title, "Arrakis Prime");
        assert_eq!(snap.battlegroups[0].servers[0].label, "Hagga Basin #1");
        assert_eq!(snap.pods[0].restarts, 2);
        assert_eq!(snap.pods[0].cpu_milli, Some(1250.0));
        assert_eq!(snap.vm.cores, 6);
        assert!(sample.is_some());
    }

    #[test]
    fn parses_combined_kubectl_list() {
        let text = r#"@@BG
{"kind":"List","items":[
 {"kind":"BattleGroup","metadata":{"name":"bg1","namespace":"ns1"},"spec":{"stop":false},"status":{"phase":"Running","servers":[{"partitionMap":"DeepDesert_1","partitionIndex":3,"ready":true}]}},
 {"kind":"ServerStats","metadata":{"namespace":"ns1"},"spec":{"area":{"partition":3}},"status":{"runtime":{"players":11}}}
]}
@@END
"#;
        let (snap, _) = parse_snapshot(text, None);
        assert_eq!(snap.battlegroups.len(), 1);
        assert_eq!(snap.battlegroups[0].players, 11);
        assert_eq!(snap.battlegroups[0].servers[0].label, "Deep Desert #3");
    }
}
