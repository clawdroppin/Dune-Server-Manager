//! Compressed, retention-managed backups: UserSettings INIs, BattleGroup spec and optional DB dump.
use crate::dune::{self, KUBECTL_PRELUDE};
use crate::ssh::{self, sq, SshTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub instance_id: String,
    pub instance_name: String,
    pub label: String,
    pub target: SshTarget,
    pub namespace: String,
    pub battlegroup: String,
    pub settings_dir: String,
    pub include_db: bool,
    pub dest_root: String,
    pub keep: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub file: String,
    pub size: u64,
    pub created: i64,
    pub manifest: Value,
}

fn emit(app: &AppHandle, id: &str, step: &str) {
    let _ = app.emit("backup://progress", json!({"instanceId": id, "step": step}));
}

fn safe(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

pub fn instance_dir(root: &str, id: &str) -> PathBuf {
    Path::new(root).join(safe(id))
}

pub async fn create(app: &AppHandle, req: BackupRequest) -> Result<BackupEntry, String> {
    let id = req.instance_id.clone();
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let dir = instance_dir(&req.dest_root, &id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip_path = dir.join(format!("{ts}-{}.zip", safe(&req.label)));
    let mut entries: Vec<(String, Vec<u8>)> = vec![];
    let mut warnings: Vec<String> = vec![];

    emit(app, &id, "Collecting UserSettings");
    match ssh::remote_ls(req.target.clone(), req.settings_dir.clone()).await {
        Ok(files) => {
            for f in files.iter().filter(|f| !f["dir"].as_bool().unwrap_or(false)) {
                let name = f["name"].as_str().unwrap_or("");
                if name.contains(".dsm-") || f["size"].as_u64().unwrap_or(0) > 4_000_000 {
                    continue;
                }
                let p = f["path"].as_str().unwrap_or("").to_string();
                match ssh::remote_read(req.target.clone(), p).await {
                    Ok(t) => entries.push((format!("UserSettings/{name}"), t.into_bytes())),
                    Err(e) => warnings.push(format!("{name}: {e}")),
                }
            }
        }
        Err(e) => warnings.push(format!("UserSettings: {e}")),
    }

    emit(app, &id, "Exporting BattleGroup spec");
    if !req.battlegroup.is_empty() {
        let script = format!(
            "{KUBECTL_PRELUDE}$K get battlegroup {} -n {} -o yaml\n",
            sq(&req.battlegroup),
            sq(&req.namespace)
        );
        match ssh::exec(&req.target, &script, 60).await {
            Ok(o) if o.ok() => entries.push(("battlegroup.yaml".into(), o.stdout.into_bytes())),
            Ok(o) => warnings.push(format!("spec: {}", o.combined().trim())),
            Err(e) => warnings.push(format!("spec: {e}")),
        }
    }

    let mut db_name = None;
    if req.include_db {
        emit(app, &id, "Dumping world database (battlegroup backup)");
        let name = format!("dsm-{ts}");
        let _ = ssh::exec(&req.target, "touch /tmp/.dsm-backup-marker", 15).await;
        match dune::wrapper_exec(&req.target, &req.namespace, &["backup".into(), name.clone()], 3600).await {
            Ok(o) => {
                db_name = Some(name.clone());
                entries.push(("db-backup.log".into(), o.combined().into_bytes()));
                emit(app, &id, "Locating dump file");
                let find = "find /home/dune /tmp /var/backups -newer /tmp/.dsm-backup-marker -type f \\( -name '*.sql*' -o -name '*.dump' -o -name '*.tar*' -o -name '*.gz' -o -name '*.zst' -o -name '*.backup' -o -name '*.pgdump' \\) 2>/dev/null | head -5";
                if let Ok(f) = ssh::exec(&req.target, find, 60).await {
                    for remote in f.stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
                        emit(app, &id, "Downloading dump");
                        let fname = remote.rsplit('/').next().unwrap_or("dump").to_string();
                        let local = dir.join(format!(".{ts}-{fname}"));
                        match ssh::scp_pull(&req.target, remote, &local.to_string_lossy()).await {
                            Ok(_) => {
                                if let Ok(b) = std::fs::read(&local) {
                                    entries.push((format!("database/{fname}"), b));
                                }
                                let _ = std::fs::remove_file(&local);
                            }
                            Err(e) => warnings.push(format!("download {fname}: {e}")),
                        }
                    }
                }
            }
            Err(e) => warnings.push(format!("database: {e}")),
        }
    }

    emit(app, &id, "Compressing archive");
    let manifest = json!({
        "app": "Dune Server Manager",
        "instanceId": req.instance_id,
        "instanceName": req.instance_name,
        "label": req.label,
        "created": chrono::Local::now().to_rfc3339(),
        "namespace": req.namespace,
        "battlegroup": req.battlegroup,
        "vmBackupName": db_name,
        "files": entries.iter().map(|(n, b)| json!({"name": n, "size": b.len()})).collect::<Vec<_>>(),
        "warnings": warnings,
    });
    let zp = zip_path.clone();
    let m = manifest.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let f = std::fs::File::create(&zp).map_err(|e| e.to_string())?;
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(9));
        z.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
        z.write_all(serde_json::to_string_pretty(&m).unwrap_or_default().as_bytes())
            .map_err(|e| e.to_string())?;
        for (name, bytes) in entries {
            z.start_file(name, opts).map_err(|e| e.to_string())?;
            z.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        z.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    prune(&dir, req.keep);
    emit(app, &id, "Done");
    let meta = std::fs::metadata(&zip_path).map_err(|e| e.to_string())?;
    Ok(BackupEntry {
        file: zip_path.file_name().unwrap().to_string_lossy().into_owned(),
        path: zip_path.to_string_lossy().into_owned(),
        size: meta.len(),
        created: chrono::Local::now().timestamp(),
        manifest,
    })
}

fn prune(dir: &Path, keep: usize) {
    if keep == 0 {
        return;
    }
    let mut zips: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("zip"))
        .filter(|e| !e.file_name().to_string_lossy().contains("-pinned"))
        .collect();
    zips.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
    for e in zips.into_iter().skip(keep) {
        let _ = std::fs::remove_file(e.path());
    }
}

#[tauri::command]
pub async fn backup_create(app: AppHandle, req: BackupRequest) -> Result<BackupEntry, String> {
    create(&app, req).await
}

fn read_manifest(path: &Path) -> Value {
    (|| -> Option<Value> {
        let f = std::fs::File::open(path).ok()?;
        let mut z = zip::ZipArchive::new(f).ok()?;
        let mut m = z.by_name("manifest.json").ok()?;
        let mut s = String::new();
        m.read_to_string(&mut s).ok()?;
        serde_json::from_str(&s).ok()
    })()
    .unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn backup_list(dest_root: String, instance_id: String) -> Vec<BackupEntry> {
    let dir = instance_dir(&dest_root, &instance_id);
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<BackupEntry> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("zip"))
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                let created = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                Some(BackupEntry {
                    path: e.path().to_string_lossy().into_owned(),
                    file: e.file_name().to_string_lossy().into_owned(),
                    size: meta.len(),
                    created,
                    manifest: read_manifest(&e.path()),
                })
            })
            .collect();
        out.sort_by_key(|b| std::cmp::Reverse(b.created));
        out
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn backup_delete(path: String) -> Result<(), String> {
    if !path.to_ascii_lowercase().ends_with(".zip") {
        return Err("refusing to delete non-zip file".into());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn backup_pin(path: String, pinned: bool) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy().replace("-pinned", "");
    let name = if pinned { format!("{stem}-pinned.zip") } else { format!("{stem}.zip") };
    let dest = p.with_file_name(name);
    std::fs::rename(&p, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Read the UserSettings INIs out of a backup archive (for diff/restore).
#[tauri::command]
pub fn backup_read_settings(path: String) -> Result<Vec<(String, String)>, String> {
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut out = vec![];
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| e.to_string())?;
        let name = e.name().to_string();
        if let Some(n) = name.strip_prefix("UserSettings/") {
            let mut s = String::new();
            if e.read_to_string(&mut s).is_ok() {
                out.push((n.to_string(), s));
            }
        }
    }
    Ok(out)
}
