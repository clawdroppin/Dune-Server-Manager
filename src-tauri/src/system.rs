//! Host capability checks and live host telemetry.
use crate::proc;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::time::Instant;
use sysinfo::{Disks, Networks, System};

pub struct HostSampler {
    sys: System,
    nets: Networks,
    last: Instant,
}

impl Default for HostSampler {
    fn default() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        Self {
            sys,
            nets: Networks::new_with_refreshed_list(),
            last: Instant::now(),
        }
    }
}

pub struct Host(pub Mutex<HostSampler>);
impl Default for Host {
    fn default() -> Self {
        Host(Mutex::new(HostSampler::default()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    mount: String,
    total: u64,
    free: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStats {
    cpu: f32,
    per_core: Vec<f32>,
    mem_used: u64,
    mem_total: u64,
    rx_bps: f64,
    tx_bps: f64,
    uptime: u64,
}

#[tauri::command]
pub fn host_stats(host: tauri::State<'_, Host>) -> HostStats {
    let mut h = host.0.lock();
    h.sys.refresh_cpu_usage();
    h.sys.refresh_memory();
    h.nets.refresh(true);
    let dt = h.last.elapsed().as_secs_f64().max(0.001);
    h.last = Instant::now();
    let (mut rx, mut tx) = (0u64, 0u64);
    for (_, d) in h.nets.iter() {
        rx += d.received();
        tx += d.transmitted();
    }
    HostStats {
        cpu: h.sys.global_cpu_usage(),
        per_core: h.sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        mem_used: h.sys.used_memory(),
        mem_total: h.sys.total_memory(),
        rx_bps: rx as f64 / dt,
        tx_bps: tx as f64 / dt,
        uptime: System::uptime(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemReport {
    os: String,
    hostname: String,
    cpu_model: String,
    cores: usize,
    threads: usize,
    avx2: bool,
    virtualization_firmware: Option<bool>,
    ram_total: u64,
    disks: Vec<DiskInfo>,
    elevated: bool,
    hyperv_admin: bool,
    hyperv_service: String,
    hyperv_module: bool,
    windows_edition: String,
    ssh_available: bool,
    scp_available: bool,
}

#[tauri::command]
pub async fn system_check() -> SystemReport {
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu_model = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();
    #[cfg(target_arch = "x86_64")]
    let avx2 = std::arch::is_x86_feature_detected!("avx2");
    #[cfg(not(target_arch = "x86_64"))]
    let avx2 = false;
    let disks = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskInfo {
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            free: d.available_space(),
        })
        .collect();

    let script = r#"
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$p=New-Object Security.Principal.WindowsPrincipal($id)
$adm=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$hva=[bool]($id.Groups | Where-Object { $_.Value -eq 'S-1-5-32-578' })
$svc=(Get-Service vmms -ErrorAction SilentlyContinue).Status
$mod=[bool](Get-Module -ListAvailable -Name Hyper-V)
$ed=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
$fw=$null; try { $fw=(Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled } catch {}
[pscustomobject]@{admin=$adm;hvAdmin=$hva;svc=[string]$svc;mod=$mod;edition=[string]$ed;fw=$fw} | ConvertTo-Json -Compress
"#;
    let info: Value = proc::ps(script, 30)
        .await
        .ok()
        .and_then(|o| serde_json::from_str(o.stdout.trim()).ok())
        .unwrap_or(Value::Null);
    let ssh = std::path::Path::new(r"C:\Windows\System32\OpenSSH\ssh.exe").exists();
    let scp = std::path::Path::new(r"C:\Windows\System32\OpenSSH\scp.exe").exists();
    SystemReport {
        os: System::long_os_version().unwrap_or_default(),
        hostname: System::host_name().unwrap_or_default(),
        cpu_model,
        cores: System::physical_core_count().unwrap_or(0),
        threads: sys.cpus().len(),
        avx2,
        virtualization_firmware: info["fw"].as_bool(),
        ram_total: sys.total_memory(),
        disks,
        elevated: info["admin"].as_bool().unwrap_or(false),
        hyperv_admin: info["hvAdmin"].as_bool().unwrap_or(false),
        hyperv_service: info["svc"].as_str().unwrap_or("").to_string(),
        hyperv_module: info["mod"].as_bool().unwrap_or(false),
        windows_edition: info["edition"].as_str().unwrap_or("").to_string(),
        ssh_available: ssh,
        scp_available: scp,
    }
}

/// Relaunch this executable elevated, then exit the current process.
#[tauri::command]
pub async fn relaunch_elevated(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().replace('\'', "");
    // Delay the elevated launch so the single-instance guard no longer sees this process.
    let script = format!(
        "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep -Milliseconds 900; Start-Process -FilePath ''{exe}'' -Verb RunAs'"
    );
    let out = proc::ps(&script, 30).await?;
    if !out.ok() {
        return Err(out.combined());
    }
    app.exit(0);
    Ok(())
}
