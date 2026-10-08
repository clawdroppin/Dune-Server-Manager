//! SteamCMD bootstrap, app updates with live progress, build-id polling and Steam library detection.
use crate::proc;
use serde::Serialize;
use serde_json::Value;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub const APP_LIVE: u32 = 4754530;
pub const APP_PTC: u32 = 3104830;
const STEAMCMD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

pub fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("DuneServerManager/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("http client")
}

#[tauri::command]
pub async fn steamcmd_ensure(dir: String) -> Result<String, String> {
    let exe = Path::new(&dir).join("steamcmd.exe");
    if exe.exists() {
        return Ok(exe.to_string_lossy().into_owned());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bytes = http()
        .get(STEAMCMD_URL)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let target = PathBuf::from(&dir);
    tauri::async_runtime::spawn_blocking(move || {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        zip.extract(&target).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if exe.exists() {
        Ok(exe.to_string_lossy().into_owned())
    } else {
        Err("steamcmd.exe missing after extraction".into())
    }
}

/// Streams `steamcmd +app_update` output. Lines carry `progress: NN.NN` that the UI parses.
#[tauri::command]
pub fn steamcmd_update(
    app: AppHandle,
    id: String,
    steamcmd: String,
    install_dir: String,
    app_id: u32,
    beta: Option<String>,
    username: Option<String>,
    validate: bool,
) -> Result<(), String> {
    std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    let mut c = proc::command(&steamcmd);
    c.current_dir(Path::new(&steamcmd).parent().unwrap_or(Path::new(".")));
    c.args(["+@ShutdownOnFailedCommand", "1", "+@NoPromptForPassword", "1"]);
    c.args(["+@sSteamCmdForcePlatformType", "windows"]);
    c.args(["+force_install_dir", &install_dir]);
    match username.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => c.args(["+login", u]),
        None => c.args(["+login", "anonymous"]),
    };
    let mut upd = vec!["+app_update".to_string(), app_id.to_string()];
    if let Some(b) = beta.filter(|b| !b.trim().is_empty()) {
        upd.push("-beta".into());
        upd.push(b);
    }
    if validate {
        upd.push("validate".into());
    }
    c.args(&upd);
    c.arg("+quit");
    proc::stream(app, id, c, None)
}

/// Authenticated SteamCMD login needs Steam Guard, so it runs in a visible console.
#[tauri::command]
pub async fn steamcmd_interactive_login(steamcmd: String, username: String) -> Result<(), String> {
    let dir = Path::new(&steamcmd)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
        .replace('\'', "''");
    let exe = steamcmd.replace('\'', "''");
    let user = username.replace(['\'', '"', ' '], "");
    let script = format!(
        "Start-Process -FilePath '{exe}' -WorkingDirectory '{dir}' -ArgumentList '+login','{user}'"
    );
    let out = proc::ps(&script, 30).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.combined())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBuild {
    pub build_id: String,
    time_updated: Option<i64>,
    branches: Value,
}

#[tauri::command]
pub async fn steam_remote_build(app_id: u32, branch: Option<String>) -> Result<RemoteBuild, String> {
    let v: Value = http()
        .get(format!("https://api.steamcmd.net/v1/info/{app_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let branches = v["data"][app_id.to_string()]["depots"]["branches"].clone();
    let b = branch.unwrap_or_else(|| "public".into());
    let node = &branches[&b];
    let build_id = node["buildid"].as_str().map(String::from).ok_or("build id not found in Steam app info")?;
    Ok(RemoteBuild {
        build_id,
        time_updated: node["timeupdated"].as_str().and_then(|t| t.parse().ok()),
        branches,
    })
}

fn acf_value(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    text.lines().find_map(|l| {
        let l = l.trim();
        l.strip_prefix(&needle)
            .map(|rest| rest.trim().trim_matches('"').to_string())
    })
}

#[tauri::command]
pub fn steam_local_build(install_dir: String, app_id: u32) -> Option<String> {
    let p = Path::new(&install_dir)
        .join("steamapps")
        .join(format!("appmanifest_{app_id}.acf"));
    std::fs::read_to_string(p).ok().and_then(|t| acf_value(&t, "buildid"))
}

fn find_file(root: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(depth)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| e.file_type().is_file() && e.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .map(|e| e.path().to_path_buf())
}

#[tauri::command]
pub async fn find_battlegroup_bat(dir: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        find_file(Path::new(&dir), "battlegroup.bat", 4).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallFound {
    app_id: u32,
    branch: String,
    path: String,
    build_id: Option<String>,
    battlegroup_bat: Option<String>,
    source: String,
}

async fn steam_root() -> Option<PathBuf> {
    let out = proc::ps("(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath", 15)
        .await
        .ok()?;
    let p = out.stdout.trim().replace('/', "\\");
    if p.is_empty() {
        let fallback = PathBuf::from(r"C:\Program Files (x86)\Steam");
        return fallback.exists().then_some(fallback);
    }
    Some(PathBuf::from(p))
}

/// Find self-hosted server tool installs in Steam libraries and the app's own server folder.
#[tauri::command]
pub async fn detect_installs(extra_dirs: Vec<String>) -> Vec<InstallFound> {
    let root = steam_root().await;
    tauri::async_runtime::spawn_blocking(move || {
        let mut libs: Vec<PathBuf> = vec![];
        if let Some(r) = &root {
            libs.push(r.clone());
            if let Ok(t) = std::fs::read_to_string(r.join("steamapps").join("libraryfolders.vdf")) {
                for l in t.lines() {
                    let l = l.trim();
                    if let Some(rest) = l.strip_prefix("\"path\"") {
                        let p = rest.trim().trim_matches('"').replace("\\\\", "\\");
                        let pb = PathBuf::from(p);
                        if !libs.contains(&pb) {
                            libs.push(pb);
                        }
                    }
                }
            }
        }
        let mut found = vec![];
        for lib in &libs {
            for (app, branch) in [(APP_LIVE, "Live"), (APP_PTC, "PTC")] {
                let m = lib.join("steamapps").join(format!("appmanifest_{app}.acf"));
                let Ok(t) = std::fs::read_to_string(&m) else { continue };
                let Some(dir) = acf_value(&t, "installdir") else { continue };
                let path = lib.join("steamapps").join("common").join(dir);
                found.push(InstallFound {
                    app_id: app,
                    branch: branch.into(),
                    battlegroup_bat: find_file(&path, "battlegroup.bat", 4).map(|p| p.to_string_lossy().into_owned()),
                    path: path.to_string_lossy().into_owned(),
                    build_id: acf_value(&t, "buildid"),
                    source: "Steam library".into(),
                });
            }
        }
        for d in extra_dirs {
            let base = PathBuf::from(&d);
            let Ok(rd) = std::fs::read_dir(&base) else { continue };
            for e in rd.filter_map(Result::ok) {
                let path = e.path();
                for (app, branch) in [(APP_LIVE, "Live"), (APP_PTC, "PTC")] {
                    let m = path.join("steamapps").join(format!("appmanifest_{app}.acf"));
                    if let Ok(t) = std::fs::read_to_string(&m) {
                        found.push(InstallFound {
                            app_id: app,
                            branch: branch.into(),
                            battlegroup_bat: find_file(&path, "battlegroup.bat", 4).map(|p| p.to_string_lossy().into_owned()),
                            path: path.to_string_lossy().into_owned(),
                            build_id: acf_value(&t, "buildid"),
                            source: "SteamCMD (managed)".into(),
                        });
                    }
                }
            }
        }
        found
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn dir_size(path: String) -> u64 {
    tauri::async_runtime::spawn_blocking(move || {
        walkdir::WalkDir::new(path)
            .into_iter()
            .filter_map(Result::ok)
            .filter_map(|e| e.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum()
    })
    .await
    .unwrap_or(0)
}

#[tauri::command]
pub fn read_local_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
