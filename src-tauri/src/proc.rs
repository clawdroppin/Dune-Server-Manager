//! Process helpers: hidden-window spawning, captured runs and live line streaming.
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::oneshot;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Procs(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Serialize, Clone, Debug, Default)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
    pub fn combined(&self) -> String {
        if self.stderr.trim().is_empty() {
            self.stdout.clone()
        } else if self.stdout.trim().is_empty() {
            self.stderr.clone()
        } else {
            format!("{}\n{}", self.stdout, self.stderr)
        }
    }
}

#[derive(Serialize, Clone)]
struct LineEvent<'a> {
    id: &'a str,
    line: String,
    err: bool,
}

#[derive(Serialize, Clone)]
struct ExitEvent<'a> {
    id: &'a str,
    code: i32,
}

/// Build a command that never flashes a console window.
pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    c
}

pub async fn run(mut c: Command, stdin: Option<Vec<u8>>, timeout_secs: u64) -> Result<Output, String> {
    if stdin.is_some() {
        c.stdin(Stdio::piped());
    }
    let mut child = c.spawn().map_err(|e| format!("failed to start process: {e}"))?;
    if let Some(data) = stdin {
        if let Some(mut si) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = si.write_all(&data).await;
                let _ = si.shutdown().await;
            });
        }
    }
    let fut = child.wait_with_output();
    match tokio::time::timeout(Duration::from_secs(timeout_secs.max(1)), fut).await {
        Ok(Ok(out)) => Ok(Output {
            code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        }),
        Ok(Err(e)) => Err(format!("process error: {e}")),
        Err(_) => Err(format!("timed out after {timeout_secs}s")),
    }
}

pub fn powershell(script: &str) -> Command {
    let mut c = command("powershell.exe");
    c.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; {script}"),
    ]);
    c
}

pub async fn ps(script: &str, timeout_secs: u64) -> Result<Output, String> {
    run(powershell(script), None, timeout_secs).await
}

async fn pump<R: AsyncRead + Unpin>(app: AppHandle, id: String, mut r: R, err: bool) {
    let mut buf = vec![0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for &b in &buf[..n] {
                    if b == b'\n' || b == b'\r' {
                        if !pending.is_empty() {
                            let line = String::from_utf8_lossy(&pending).into_owned();
                            let _ = app.emit("proc://line", LineEvent { id: &id, line, err });
                            pending.clear();
                        }
                    } else {
                        pending.push(b);
                    }
                }
            }
        }
    }
    if !pending.is_empty() {
        let line = String::from_utf8_lossy(&pending).into_owned();
        let _ = app.emit("proc://line", LineEvent { id: &id, line, err });
    }
}

/// Spawn a process and emit `proc://line` for every output line and `proc://exit` at the end.
pub fn stream(app: AppHandle, id: String, mut c: Command, stdin: Option<Vec<u8>>) -> Result<(), String> {
    if stdin.is_some() {
        c.stdin(Stdio::piped());
    }
    let mut child = c.spawn().map_err(|e| format!("failed to start process: {e}"))?;
    if let Some(data) = stdin {
        if let Some(mut si) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = si.write_all(&data).await;
                let _ = si.shutdown().await;
            });
        }
    }
    let out = child.stdout.take();
    let errp = child.stderr.take();
    let (tx, rx) = oneshot::channel();
    app.state::<Procs>().0.lock().insert(id.clone(), tx);
    tauri::async_runtime::spawn(async move {
        let h1 = out.map(|o| tokio::spawn(pump(app.clone(), id.clone(), o, false)));
        let h2 = errp.map(|e| tokio::spawn(pump(app.clone(), id.clone(), e, true)));
        let code = tokio::select! {
            s = child.wait() => s.ok().and_then(|s| s.code()).unwrap_or(-1),
            _ = rx => { let _ = child.kill().await; -9 }
        };
        if let Some(h) = h1 {
            let _ = tokio::time::timeout(Duration::from_secs(3), h).await;
        }
        if let Some(h) = h2 {
            let _ = tokio::time::timeout(Duration::from_secs(3), h).await;
        }
        app.state::<Procs>().0.lock().remove(&id);
        let _ = app.emit("proc://exit", ExitEvent { id: &id, code });
    });
    Ok(())
}

#[tauri::command]
pub fn proc_kill(app: AppHandle, id: String) -> bool {
    if let Some(tx) = app.state::<Procs>().0.lock().remove(&id) {
        let _ = tx.send(());
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn run_powershell(script: String, timeout: Option<u64>) -> Result<Output, String> {
    ps(&script, timeout.unwrap_or(60)).await
}

#[tauri::command]
pub fn stream_powershell(app: AppHandle, id: String, script: String) -> Result<(), String> {
    stream(app, id, powershell(&script), None)
}

/// Open a visible, elevated console running the given command line (used for battlegroup.bat).
#[tauri::command]
pub async fn launch_elevated_console(working_dir: String, command_line: String) -> Result<(), String> {
    let wd = working_dir.replace('\'', "''");
    let cl = command_line.replace('\'', "''");
    let script = format!(
        "Start-Process -FilePath 'cmd.exe' -Verb RunAs -WorkingDirectory '{wd}' -ArgumentList '/k','{cl}'"
    );
    let out = ps(&script, 120).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.combined())
    }
}
