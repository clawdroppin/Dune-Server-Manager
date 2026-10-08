//! Hyper-V control through the PowerShell Hyper-V module.
use crate::proc;
use serde_json::Value;

const VM_QUERY: &str = r#"
$vms = @(Get-VM -ErrorAction Stop | ForEach-Object {
  $vm = $_
  [pscustomobject]@{
    name = $vm.Name
    id = [string]$vm.Id
    state = [string]$vm.State
    status = [string]$vm.Status
    cpuUsage = $vm.CPUUsage
    processorCount = $vm.ProcessorCount
    memoryAssigned = $vm.MemoryAssigned
    memoryDemand = $vm.MemoryDemand
    memoryStartup = $vm.MemoryStartup
    dynamicMemory = $vm.DynamicMemoryEnabled
    uptime = [math]::Round($vm.Uptime.TotalSeconds)
    path = $vm.Path
    generation = $vm.Generation
    disks = @($vm.HardDrives | ForEach-Object { $_.Path })
    ips = @($vm.NetworkAdapters | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
    switches = @($vm.NetworkAdapters | ForEach-Object { $_.SwitchName })
    macs = @($vm.NetworkAdapters | ForEach-Object { $_.MacAddress })
  }
})
ConvertTo-Json -InputObject $vms -Depth 4 -Compress
"#;

fn annotate(mut v: Value) -> Value {
    if let Some(arr) = v.as_array_mut() {
        for vm in arr.iter_mut() {
            let name = vm["name"].as_str().unwrap_or("").to_ascii_lowercase();
            let path = vm["path"].as_str().unwrap_or("").to_ascii_lowercase();
            let disk_hit = vm["disks"]
                .as_array()
                .map(|d| {
                    d.iter().any(|p| {
                        p.as_str()
                            .unwrap_or("")
                            .to_ascii_lowercase()
                            .ends_with("dune-server.vhdx")
                    })
                })
                .unwrap_or(false);
            let confidence = if disk_hit {
                "high"
            } else if name.contains("dune") || path.contains("dune") || path.contains("awakening") {
                "medium"
            } else {
                "none"
            };
            vm["duneConfidence"] = Value::String(confidence.into());
        }
    }
    v
}

#[tauri::command]
pub async fn vm_list() -> Result<Value, String> {
    let out = proc::ps(VM_QUERY, 45).await?;
    if !out.ok() {
        return Err(out.combined().trim().to_string());
    }
    let text = out.stdout.trim();
    if text.is_empty() {
        return Ok(Value::Array(vec![]));
    }
    let v: Value = serde_json::from_str(text).map_err(|e| format!("bad Get-VM json: {e}"))?;
    Ok(annotate(v))
}

#[tauri::command]
pub async fn vm_action(name: String, action: String) -> Result<String, String> {
    let n = name.replace('\'', "''");
    let script = match action.as_str() {
        "start" => format!("Start-VM -Name '{n}' -ErrorAction Stop"),
        "stop" => format!("Stop-VM -Name '{n}' -Force -ErrorAction Stop"),
        "turnoff" => format!("Stop-VM -Name '{n}' -TurnOff -Force -ErrorAction Stop"),
        "save" => format!("Save-VM -Name '{n}' -ErrorAction Stop"),
        "restart" => format!("Restart-VM -Name '{n}' -Force -ErrorAction Stop"),
        "checkpoint" => format!(
            "Checkpoint-VM -Name '{n}' -SnapshotName ('DSM-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -ErrorAction Stop"
        ),
        _ => return Err(format!("unknown VM action {action}")),
    };
    let out = proc::ps(&script, 600).await?;
    if out.ok() {
        Ok(out.stdout)
    } else {
        Err(out.combined().trim().to_string())
    }
}

#[tauri::command]
pub async fn vm_set_resources(name: String, memory_gb: Option<u32>, cpus: Option<u32>) -> Result<(), String> {
    let n = name.replace('\'', "''");
    let mut parts = vec![];
    if let Some(m) = memory_gb {
        parts.push(format!("Set-VMMemory -VMName '{n}' -StartupBytes {}GB -ErrorAction Stop", m));
    }
    if let Some(c) = cpus {
        parts.push(format!("Set-VMProcessor -VMName '{n}' -Count {c} -ErrorAction Stop"));
    }
    if parts.is_empty() {
        return Ok(());
    }
    let out = proc::ps(&parts.join("; "), 120).await?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.combined().trim().to_string())
    }
}
