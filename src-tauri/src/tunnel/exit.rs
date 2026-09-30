//! Where the tunnel comes out. The only network I/O in the crate besides
//! `download.rs`, and it always goes through the tunnel's probe inbound.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct ExitInfo {
    pub ip: String,
    pub city: String,
    pub region: String,
    pub country: String,
    pub org: String,
}

pub fn parse(body: &str) -> Result<ExitInfo, String> {
    let e: ExitInfo = serde_json::from_str(body).map_err(|_| "ipinfo.io sent something unreadable.".to_string())?;
    if e.ip.is_empty() {
        return Err("ipinfo.io did not say which address it saw.".into());
    }
    Ok(e)
}

pub async fn probe(port: u16) -> Result<ExitInfo, String> {
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{port}")).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let body = client
        .get("https://ipinfo.io/json")
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("ipinfo.io is not reachable through the tunnel: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    parse(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipinfo_json_is_read() {
        let body = r#"{"ip":"185.1.2.3","city":"Frankfurt am Main","region":"Hesse","country":"DE","org":"AS24940 Hetzner Online GmbH","readme":"x"}"#;
        let e = parse(body).unwrap();
        assert_eq!(e.ip, "185.1.2.3");
        assert_eq!(e.country, "DE");
        assert_eq!(e.org, "AS24940 Hetzner Online GmbH");
    }

    #[test]
    fn a_body_without_an_ip_is_an_error() {
        assert!(parse(r#"{"error":{"title":"Rate limit"}}"#).is_err());
        assert!(parse("<html>").is_err());
    }
}
