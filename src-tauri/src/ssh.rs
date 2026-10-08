//! OpenSSH (Windows built-in) transport to the battlegroup VM.
use crate::{proc, store};
use base64::Engine;
use serde::Deserialize;
use std::path::Path;
use tauri::AppHandle;
use tokio::process::Command;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub key_path: Option<String>,
}

fn bin(name: &str) -> String {
    let p = format!(r"C:\Windows\System32\OpenSSH\{name}.exe");
    if Path::new(&p).exists() {
        p
    } else {
        name.to_string()
    }
}

fn known_hosts() -> String {
    store::data_dir().join("known_hosts").to_string_lossy().into_owned()
}

fn common_opts(t: &SshTarget, c: &mut Command, port_flag: &str) {
    c.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        &format!("UserKnownHostsFile={}", known_hosts()),
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-o",
        "LogLevel=ERROR",
    ]);
    c.args([port_flag, &t.port.unwrap_or(22).to_string()]);
    if let Some(k) = t.key_path.as_ref().filter(|k| !k.trim().is_empty()) {
        let key = store::rebase(k.trim());
        c.args(["-i", key.as_str(), "-o", "IdentitiesOnly=yes"]);
    }
}

/// `ssh user@host sh -s`: the script is fed through stdin so no remote quoting is needed.
pub fn script_command(t: &SshTarget) -> Command {
    let mut c = proc::command(&bin("ssh"));
    common_opts(t, &mut c, "-p");
    c.arg(format!("{}@{}", t.user, t.host));
    c.arg("sh -s");
    c
}

pub async fn exec(t: &SshTarget, script: &str, timeout: u64) -> Result<proc::Output, String> {
    if t.host.trim().is_empty() {
        return Err("No VM host/IP configured for this instance".into());
    }
    let out = proc::run(script_command(t), Some(script.as_bytes().to_vec()), timeout).await?;
    if out.code == 255 {
        return Err(format!("SSH connection failed: {}", out.stderr.trim()));
    }
    Ok(out)
}

/// POSIX single-quote a value.
pub fn sq(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[tauri::command]
pub async fn ssh_exec(target: SshTarget, script: String, timeout: Option<u64>) -> Result<proc::Output, String> {
    exec(&target, &script, timeout.unwrap_or(60)).await
}

#[tauri::command]
pub fn ssh_stream(app: AppHandle, id: String, target: SshTarget, script: String) -> Result<(), String> {
    if target.host.trim().is_empty() {
        return Err("No VM host/IP configured for this instance".into());
    }
    proc::stream(app, id, script_command(&target), Some(script.into_bytes()))
}

#[tauri::command]
pub async fn ssh_test(target: SshTarget) -> Result<String, String> {
    let script = "echo \"$(whoami)@$(hostname) | $(uname -sr)\"\n[ -x /home/dune/.dune/bin/battlegroup ] && echo 'battlegroup CLI: found' || echo 'battlegroup CLI: missing'\n";
    let out = exec(&target, script, 20).await?;
    if out.ok() {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(out.combined().trim().to_string())
    }
}

#[tauri::command]
pub async fn remote_read(target: SshTarget, path: String) -> Result<String, String> {
    let out = exec(&target, &format!("cat -- {}", sq(&path)), 30).await?;
    if out.ok() {
        Ok(out.stdout)
    } else {
        Err(out.combined().trim().to_string())
    }
}

#[tauri::command]
pub async fn remote_write(target: SshTarget, path: String, content: String, backup: Option<bool>) -> Result<(), String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(content.as_bytes());
    let p = sq(&path);
    let bk = if backup.unwrap_or(true) {
        format!("if [ -f {p} ]; then cp -p {p} {p}.dsm-$(date +%Y%m%d%H%M%S).bak; fi\n")
    } else {
        String::new()
    };
    let script = format!(
        "set -e\nmkdir -p \"$(dirname {p})\"\n{bk}base64 -d > {p}.dsm-tmp <<'DSM_B64_END'\n{b64}\nDSM_B64_END\nmv {p}.dsm-tmp {p}\n"
    );
    let out = exec(&target, &script, 30).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.combined().trim().to_string())
    }
}

#[tauri::command]
pub async fn remote_ls(target: SshTarget, dir: String) -> Result<Vec<serde_json::Value>, String> {
    let script = format!(
        "find {} -mindepth 1 -maxdepth 1 -exec stat -c '%F|%s|%Y|%n' {{}} \\; 2>/dev/null",
        sq(&dir)
    );
    let out = exec(&target, &script, 30).await?;
    let mut items = vec![];
    for line in out.stdout.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            continue;
        }
        let path = parts[3];
        items.push(serde_json::json!({
            "dir": parts[0].contains("directory"),
            "size": parts[1].parse::<u64>().unwrap_or(0),
            "mtime": parts[2].parse::<i64>().unwrap_or(0),
            "path": path,
            "name": path.rsplit('/').next().unwrap_or(path),
        }));
    }
    Ok(items)
}

/// Pull a remote file down with scp.
pub async fn scp_pull(t: &SshTarget, remote: &str, local: &str) -> Result<(), String> {
    let mut c = proc::command(&bin("scp"));
    common_opts(t, &mut c, "-P");
    c.arg(format!("{}@{}:{}", t.user, t.host, remote));
    c.arg(local);
    let out = proc::run(c, None, 3600).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.combined().trim().to_string())
    }
}

#[tauri::command]
pub async fn ssh_pull(target: SshTarget, remote: String, local: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&local).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    scp_pull(&target, &remote, &local).await
}

#[tauri::command]
pub async fn ssh_forget_host(host: String) -> Result<(), String> {
    let mut c = proc::command(&bin("ssh-keygen"));
    c.args(["-R", &host, "-f", &known_hosts()]);
    proc::run(c, None, 15).await.map(|_| ())
}

/// Search folders for OpenSSH private keys (e.g. the key battlegroup.bat generates).
#[tauri::command]
pub async fn discover_keys(dirs: Vec<String>) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut roots: Vec<std::path::PathBuf> = dirs.into_iter().map(Into::into).collect();
        if let Some(h) = dirs::home_dir() {
            roots.push(h.join(".ssh"));
        }
        roots.push(store::data_dir().join("keys"));
        let mut found = vec![];
        for root in roots {
            for e in walkdir::WalkDir::new(&root)
                .max_depth(4)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_file())
            {
                let Ok(meta) = e.metadata() else { continue };
                if meta.len() > 16_384 || meta.len() < 64 {
                    continue;
                }
                if e.path().extension().and_then(|x| x.to_str()) == Some("pub") {
                    continue;
                }
                if let Ok(head) = std::fs::read_to_string(e.path()) {
                    if head.starts_with("-----BEGIN") && head.contains("PRIVATE KEY") {
                        let p = e.path().to_string_lossy().into_owned();
                        if !found.contains(&p) {
                            found.push(p);
                        }
                    }
                }
            }
        }
        found
    })
    .await
    .unwrap_or_default()
}

/// Copy a key into the app's key store and lock its ACL down so OpenSSH accepts it.
#[tauri::command]
pub async fn import_key(source: String, name: String) -> Result<String, String> {
    let dir = store::data_dir().join("keys");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    let dest = dir.join(format!("{safe}_id"));
    let content = std::fs::read(&source).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&dest);
    std::fs::write(&dest, content).map_err(|e| e.to_string())?;
    let d = dest.to_string_lossy().into_owned();
    let user = std::env::var("USERNAME").unwrap_or_default();
    let mut c = proc::command("icacls.exe");
    c.args([d.as_str(), "/inheritance:r", "/grant:r", &format!("{user}:F")]);
    let out = proc::run(c, None, 20).await?;
    if !out.ok() {
        return Err(out.combined());
    }
    Ok(d)
}
