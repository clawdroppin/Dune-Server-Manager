//! JSON persistence for the whole frontend state (instances, folders, settings),
//! plus data-directory resolution for installed vs portable mode.
//!
//! Portable mode: if a file or folder named `portable` (or `portable.txt`) sits next to the exe,
//! or the exe name contains "portable", all data lives in `<exe dir>\data` instead of %APPDATA%.
use once_cell::sync::Lazy;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub struct DataLocation {
    pub dir: PathBuf,
    pub portable: bool,
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

fn detect() -> DataLocation {
    if let Some(dir) = exe_dir() {
        let exe_name = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()))
            .unwrap_or_default();
        let marked = ["portable", "portable.txt"].iter().any(|m| dir.join(m).exists()) || exe_name.contains("portable");
        if marked {
            let data = dir.join("data");
            // Fall back to %APPDATA% if the folder isn't writable (e.g. extracted into Program Files).
            if std::fs::create_dir_all(&data).is_ok() && std::fs::write(data.join(".write-test"), b"").is_ok() {
                let _ = std::fs::remove_file(data.join(".write-test"));
                return DataLocation { dir: data, portable: true };
            }
        }
    }
    DataLocation {
        dir: dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("DuneServerManager"),
        portable: false,
    }
}

pub static LOCATION: Lazy<DataLocation> = Lazy::new(detect);

pub fn data_dir() -> PathBuf {
    let dir = LOCATION.dir.clone();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn is_portable() -> bool {
    LOCATION.portable
}

/// A stored path may point into an old data folder (portable copy moved to another drive/USB letter).
/// Re-anchor `...\data\<sub>\file` / `...\DuneServerManager\<sub>\file` onto the current data dir.
pub fn rebase(path: &str) -> String {
    let p = Path::new(path);
    if path.is_empty() || p.exists() {
        return path.to_string();
    }
    let norm = path.replace('/', "\\");
    for anchor in ["\\data\\", "\\DuneServerManager\\"] {
        if let Some(idx) = norm.rfind(anchor) {
            let candidate = data_dir().join(&norm[idx + anchor.len()..]);
            if candidate.exists() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    path.to_string()
}

fn state_path() -> PathBuf {
    data_dir().join("state.json")
}

pub fn read_state() -> Value {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

#[tauri::command]
pub fn state_load() -> Value {
    read_state()
}

#[tauri::command]
pub fn state_save(state: Value) -> Result<(), String> {
    let path = state_path();
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_paths() -> Value {
    let d = data_dir();
    serde_json::json!({
        "data": d.to_string_lossy(),
        "backups": d.join("backups").to_string_lossy(),
        "keys": d.join("keys").to_string_lossy(),
        "steamcmd": d.join("steamcmd").to_string_lossy(),
        "servers": d.join("servers").to_string_lossy(),
        "portable": is_portable(),
        "exeDir": exe_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
    })
}
