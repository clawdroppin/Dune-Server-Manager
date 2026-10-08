//! Networking: public IP, UPnP/IGD port mapping, reachability probes, DDNS and webhooks.
use crate::steam::http;
use igd_next::aio::tokio::search_gateway;
use igd_next::{PortMappingProtocol, SearchOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

#[tauri::command]
pub async fn public_ip() -> Result<String, String> {
    for url in ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"] {
        if let Ok(r) = http().get(url).timeout(Duration::from_secs(6)).send().await {
            if let Ok(t) = r.text().await {
                let t = t.trim().to_string();
                if t.parse::<IpAddr>().is_ok() {
                    return Ok(t);
                }
            }
        }
    }
    Err("could not determine public IP".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpnpMapping {
    protocol: String,
    external_port: u16,
    internal_client: String,
    internal_port: u16,
    description: String,
    enabled: bool,
    lease: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpnpStatus {
    gateway: String,
    external_ip: Option<String>,
    mappings: Vec<UpnpMapping>,
    cgnat: bool,
}

fn is_cgnat(ip: &str) -> bool {
    match ip.parse::<IpAddr>() {
        Ok(IpAddr::V4(v)) => {
            let o = v.octets();
            (o[0] == 100 && (64..=127).contains(&o[1])) || v.is_private()
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn upnp_status() -> Result<UpnpStatus, String> {
    let gw = search_gateway(SearchOptions {
        timeout: Some(Duration::from_secs(4)),
        ..Default::default()
    })
    .await
    .map_err(|e| format!("No UPnP gateway found: {e}"))?;
    let ext = gw.get_external_ip().await.ok().map(|i| i.to_string());
    let mut mappings = vec![];
    for i in 0..256u32 {
        match gw.get_generic_port_mapping_entry(i).await {
            Ok(e) => mappings.push(UpnpMapping {
                protocol: format!("{:?}", e.protocol),
                external_port: e.external_port,
                internal_client: e.internal_client,
                internal_port: e.internal_port,
                description: e.port_mapping_description,
                enabled: e.enabled,
                lease: e.lease_duration,
            }),
            Err(_) => break,
        }
    }
    Ok(UpnpStatus {
        gateway: gw.addr.to_string(),
        cgnat: ext.as_deref().map(is_cgnat).unwrap_or(false),
        external_ip: ext,
        mappings,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRule {
    protocol: String,
    from: u16,
    to: u16,
}

#[derive(Serialize)]
pub struct MapResult {
    ok: u32,
    failed: Vec<String>,
}

#[tauri::command]
pub async fn upnp_apply(target_ip: String, rules: Vec<PortRule>, description: String, remove: bool) -> Result<MapResult, String> {
    let gw = search_gateway(SearchOptions {
        timeout: Some(Duration::from_secs(4)),
        ..Default::default()
    })
    .await
    .map_err(|e| format!("No UPnP gateway found: {e}"))?;
    let ip: IpAddr = target_ip.parse().map_err(|_| format!("invalid target IP {target_ip}"))?;
    let mut res = MapResult { ok: 0, failed: vec![] };
    for r in rules {
        let proto = if r.protocol.eq_ignore_ascii_case("tcp") {
            PortMappingProtocol::TCP
        } else {
            PortMappingProtocol::UDP
        };
        for port in r.from..=r.to.max(r.from) {
            let result = if remove {
                gw.remove_port(proto, port).await.map_err(|e| e.to_string())
            } else {
                gw.add_port(proto, port, SocketAddr::new(ip, port), 0, &description)
                    .await
                    .map_err(|e| e.to_string())
            };
            match result {
                Ok(_) => res.ok += 1,
                Err(e) => res.failed.push(format!("{:?} {port}: {e}", proto)),
            }
        }
    }
    Ok(res)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    open: bool,
    latency_ms: Option<u64>,
    error: Option<String>,
}

#[tauri::command]
pub async fn tcp_probe(host: String, port: u16, timeout_ms: Option<u64>) -> Probe {
    let start = Instant::now();
    let fut = tokio::net::TcpStream::connect((host.as_str(), port));
    match tokio::time::timeout(Duration::from_millis(timeout_ms.unwrap_or(2500)), fut).await {
        Ok(Ok(_)) => Probe { open: true, latency_ms: Some(start.elapsed().as_millis() as u64), error: None },
        Ok(Err(e)) => Probe { open: false, latency_ms: None, error: Some(e.to_string()) },
        Err(_) => Probe { open: false, latency_ms: None, error: Some("timed out".into()) },
    }
}

/// ICMP-free reachability + latency estimate using TCP connect against SSH.
#[tauri::command]
pub async fn host_ping(host: String, port: Option<u16>) -> Probe {
    tcp_probe(host, port.unwrap_or(22), Some(1500)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdnsConfig {
    provider: String,
    domain: String,
    token: String,
    zone_id: Option<String>,
    custom_url: Option<String>,
}

#[tauri::command]
pub async fn ddns_update(cfg: DdnsConfig, ip: String) -> Result<String, String> {
    let c = http();
    match cfg.provider.as_str() {
        "duckdns" => {
            let sub = cfg.domain.trim_end_matches(".duckdns.org");
            let r = c
                .get("https://www.duckdns.org/update")
                .query(&[("domains", sub), ("token", cfg.token.as_str()), ("ip", ip.as_str())])
                .send()
                .await
                .map_err(|e| e.to_string())?
                .text()
                .await
                .map_err(|e| e.to_string())?;
            if r.trim() == "OK" {
                Ok(format!("DuckDNS {} -> {ip}", cfg.domain))
            } else {
                Err(format!("DuckDNS responded: {r}"))
            }
        }
        "cloudflare" => {
            let zone = cfg.zone_id.ok_or("Cloudflare zone ID required")?;
            let base = format!("https://api.cloudflare.com/client/v4/zones/{zone}/dns_records");
            let list: Value = c
                .get(&base)
                .bearer_auth(&cfg.token)
                .query(&[("type", "A"), ("name", cfg.domain.as_str())])
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let body = serde_json::json!({"type":"A","name":cfg.domain,"content":ip,"ttl":60,"proxied":false});
            let resp: Value = if let Some(id) = list["result"][0]["id"].as_str() {
                c.patch(format!("{base}/{id}")).bearer_auth(&cfg.token).json(&body).send().await
            } else {
                c.post(&base).bearer_auth(&cfg.token).json(&body).send().await
            }
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
            if resp["success"].as_bool() == Some(true) {
                Ok(format!("Cloudflare {} -> {ip}", cfg.domain))
            } else {
                Err(format!("Cloudflare error: {}", resp["errors"]))
            }
        }
        "custom" => {
            let url = cfg
                .custom_url
                .ok_or("custom URL required")?
                .replace("{ip}", &ip)
                .replace("{domain}", &cfg.domain)
                .replace("{token}", &cfg.token);
            let r = c.get(url).send().await.map_err(|e| e.to_string())?;
            let status = r.status();
            let t = r.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(format!("{status}: {}", t.trim()))
            } else {
                Err(format!("{status}: {}", t.trim()))
            }
        }
        p => Err(format!("unknown DDNS provider {p}")),
    }
}

pub async fn post_webhook(url: &str, body: &Value) -> Result<(), String> {
    let r = http()
        .post(url)
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if r.status().is_success() {
        Ok(())
    } else {
        let s = r.status();
        Err(format!("{s}: {}", r.text().await.unwrap_or_default()))
    }
}

#[tauri::command]
pub async fn webhook_send(url: String, body: Value) -> Result<(), String> {
    post_webhook(&url, &body).await
}
