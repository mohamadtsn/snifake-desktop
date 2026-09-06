//! Ingesting a configuration the user pasted, and emitting one they can
//! share. The accepted surface is closed — VLESS or Trojan, over
//! WebSocket, with standard TLS — and the validation pipeline here is the
//! one written out in `ACCEPTED_V2_CONFIG.md §7`.
//!
//! Note what is *not* carried across: the incoming address and port. They
//! belong to the SNI listener at generation time, so they are reported
//! back to the caller for a sanity check and then dropped.

use super::model::{Protocol, TunnelProfile};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde_json::Value;
use url::Url;

/// Everything reserved in a query value or fragment, so a password
/// containing `&` or `#` survives a round trip.
const ESCAPE: &AsciiSet = &CONTROLS
    .add(b' ').add(b'"').add(b'#').add(b'<').add(b'>')
    .add(b'?').add(b'&').add(b'=').add(b'/').add(b'%')
    .add(b'+').add(b',').add(b':').add(b'@');

#[derive(Clone, Debug, PartialEq)]
pub struct Imported {
    pub profile: TunnelProfile,
    /// Non-blocking notes. A non-443 remote port is the only one today.
    pub warnings: Vec<String>,
    /// The address the pasted configuration named. Kept out of the profile
    /// on purpose; the UI compares it against the active SNI profile's
    /// CONNECT_IP and offers to reconcile them.
    pub source_address: String,
    pub source_port: u16,
}

pub fn import(text: &str) -> Result<Imported, String> {
    let text = text.trim();
    if text.starts_with('{') {
        return import_json(text);
    }
    if text.starts_with("vless://") || text.starts_with("trojan://") {
        return import_uri(text);
    }
    if let Some((scheme, _)) = text.split_once("://") {
        return Err(unsupported_protocol(scheme));
    }
    Err("Paste a vless:// or trojan:// link, or an Xray outbound in JSON.".into())
}

fn unsupported_protocol(p: &str) -> String {
    format!("Unsupported protocol \"{p}\". Only VLESS and Trojan are permitted.")
}

fn unsupported_network(n: &str) -> String {
    format!("Unsupported transport network \"{n}\". Only WebSocket (ws) is supported.")
}

fn unsupported_security(s: &str) -> String {
    format!("Unsupported security mode \"{s}\". Standard TLS is required.")
}

fn import_uri(text: &str) -> Result<Imported, String> {
    let url = Url::parse(text).map_err(|e| format!("This is not a valid link: {e}"))?;

    let protocol = match url.scheme() {
        "vless" => Protocol::Vless,
        "trojan" => Protocol::Trojan,
        other => return Err(unsupported_protocol(other)),
    };

    let q: std::collections::HashMap<String, String> =
        url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();

    let network = q.get("type").map(String::as_str).unwrap_or("tcp");
    if network != "ws" {
        return Err(unsupported_network(network));
    }
    let security = q.get("security").map(String::as_str).unwrap_or("none");
    if security != "tls" {
        return Err(unsupported_security(security));
    }

    let credential = percent_decode(url.username());
    if credential.is_empty() {
        return Err("This link carries no UUID or password.".into());
    }

    let source_address = url
        .host_str()
        .ok_or("This link names no server address.")?
        .to_string();
    let source_port = url.port().unwrap_or(443);

    let remote_host = q.get("host").cloned().unwrap_or_else(|| source_address.clone());
    let sni = q.get("sni").cloned().unwrap_or_else(|| remote_host.clone());
    let name = url
        .fragment()
        .map(percent_decode)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| remote_host.clone());

    let mut profile = TunnelProfile::new(&name, protocol);
    profile.credential = credential;
    profile.remote_host = remote_host;
    profile.sni = sni;
    profile.path = normalise_path(q.get("path").map(String::as_str));
    if let Some(alpn) = q.get("alpn") {
        profile.alpn = split_alpn(alpn);
    }
    if let Some(fp) = q.get("fp") {
        if !fp.is_empty() {
            profile.fingerprint = fp.clone();
        }
    }
    profile.allow_insecure = matches!(
        q.get("allowInsecure").map(String::as_str),
        Some("1") | Some("true")
    );

    Ok(Imported {
        profile,
        warnings: port_warning(source_port),
        source_address,
        source_port,
    })
}

fn import_json(text: &str) -> Result<Imported, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("This is not valid JSON: {e}"))?;

    let protocol = match v["protocol"].as_str().unwrap_or("") {
        "vless" => Protocol::Vless,
        "trojan" => Protocol::Trojan,
        other => return Err(unsupported_protocol(other)),
    };

    let stream = &v["streamSettings"];
    let network = stream["network"].as_str().unwrap_or("tcp");
    if network != "ws" {
        return Err(unsupported_network(network));
    }
    let security = stream["security"].as_str().unwrap_or("none");
    if security != "tls" {
        return Err(unsupported_security(security));
    }

    // VLESS keeps its servers under `vnext` with a `users` array; Trojan
    // keeps them under `servers` with the password on the server itself.
    let (server, credential) = match protocol {
        Protocol::Vless => {
            let s = &v["settings"]["vnext"][0];
            let id = s["users"][0]["id"].as_str().unwrap_or("").to_string();
            (s, id)
        }
        Protocol::Trojan => {
            let s = &v["settings"]["servers"][0];
            let pw = s["password"].as_str().unwrap_or("").to_string();
            (s, pw)
        }
    };
    if credential.is_empty() {
        return Err("This outbound carries no UUID or password.".into());
    }

    let source_address = server["address"].as_str().unwrap_or("").to_string();
    if source_address.is_empty() {
        return Err("This outbound names no server address.".into());
    }
    let source_port = server["port"].as_u64().unwrap_or(443) as u16;

    let ws = &stream["wsSettings"];
    let tls = &stream["tlsSettings"];
    let remote_host = ws["headers"]["Host"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(&source_address)
        .to_string();
    let sni = tls["serverName"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(&remote_host)
        .to_string();

    let mut profile = TunnelProfile::new(&remote_host, protocol);
    profile.credential = credential;
    profile.remote_host = remote_host;
    profile.sni = sni;
    profile.path = normalise_path(ws["path"].as_str());
    if let Some(alpn) = tls["alpn"].as_array() {
        let list: Vec<String> = alpn
            .iter()
            .filter_map(|a| a.as_str().map(str::to_string))
            .collect();
        if !list.is_empty() {
            profile.alpn = list;
        }
    }
    if let Some(fp) = tls["fingerprint"].as_str().filter(|s| !s.is_empty()) {
        profile.fingerprint = fp.to_string();
    }
    profile.allow_insecure = tls["allowInsecure"].as_bool().unwrap_or(false);

    Ok(Imported {
        profile,
        warnings: port_warning(source_port),
        source_address,
        source_port,
    })
}

/// A leading slash is added rather than demanded: it is a typo, not a
/// disagreement about what the user meant.
fn normalise_path(path: Option<&str>) -> String {
    match path.map(str::trim).filter(|p| !p.is_empty()) {
        None => "/".into(),
        Some(p) if p.starts_with('/') => p.to_string(),
        Some(p) => format!("/{p}"),
    }
}

fn split_alpn(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn port_warning(port: u16) -> Vec<String> {
    if port == 443 {
        Vec::new()
    } else {
        vec![format!(
            "This configuration names port {port}. Snifake expects a standard TLS destination on 443."
        )]
    }
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .into_owned()
}

fn enc(s: &str) -> String {
    utf8_percent_encode(s, ESCAPE).to_string()
}

/// The Snifake-shaped share link: the authority is the SNI listener, and
/// the real destination has moved into the WebSocket `Host` header.
pub fn export_uri(t: &TunnelProfile, listen_host: &str, listen_port: u16) -> String {
    let scheme = match t.protocol {
        Protocol::Vless => "vless",
        Protocol::Trojan => "trojan",
    };
    let mut q = Vec::new();
    if t.protocol == Protocol::Vless {
        q.push("encryption=none".to_string());
    }
    q.push("security=tls".to_string());
    q.push("type=ws".to_string());
    q.push(format!("host={}", enc(&t.remote_host)));
    q.push(format!("path={}", enc(&t.path)));
    q.push(format!("sni={}", enc(&t.sni)));
    if !t.alpn.is_empty() {
        q.push(format!("alpn={}", enc(&t.alpn.join(","))));
    }
    q.push(format!("fp={}", enc(&t.fingerprint)));
    q.push(format!("allowInsecure={}", u8::from(t.allow_insecure)));

    format!(
        "{scheme}://{cred}@{listen_host}:{listen_port}?{query}#{name}",
        cred = enc(&t.credential),
        query = q.join("&"),
        name = enc(&t.name),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const VLESS: &str = "vless://9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d@104.18.4.130:443?encryption=none&security=tls&type=ws&host=origin.cdn-domain.com&path=%2Fwebsocket&sni=origin.cdn-domain.com&alpn=h3%2Ch2%2Chttp%2F1.1&fp=chrome&allowInsecure=0#Berlin%2001";

    const TROJAN: &str = "trojan://secret-password-123@cdn.example.net:443?security=tls&type=ws&host=origin.cdn-domain.com&path=%2Ftrojan-ws&sni=origin.cdn-domain.com&fp=firefox#Trojan";

    #[test]
    fn a_vless_link_maps_every_field() {
        let got = import(VLESS).unwrap();
        assert_eq!(got.profile.protocol, Protocol::Vless);
        assert_eq!(got.profile.credential, "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
        assert_eq!(got.profile.remote_host, "origin.cdn-domain.com");
        assert_eq!(got.profile.path, "/websocket");
        assert_eq!(got.profile.sni, "origin.cdn-domain.com");
        assert_eq!(got.profile.alpn, vec!["h3", "h2", "http/1.1"]);
        assert_eq!(got.profile.fingerprint, "chrome");
        assert!(!got.profile.allow_insecure);
        assert_eq!(got.profile.name, "Berlin 01");
        assert!(got.warnings.is_empty());
    }

    #[test]
    fn the_links_own_address_is_reported_but_never_stored() {
        let got = import(VLESS).unwrap();
        assert_eq!(got.source_address, "104.18.4.130");
        assert_eq!(got.source_port, 443);
        // The UI uses it to notice a mismatch with the active SNI profile;
        // TunnelProfile has nowhere to put it, and that is the point.
    }

    #[test]
    fn a_trojan_link_maps_its_password_and_fingerprint() {
        let got = import(TROJAN).unwrap();
        assert_eq!(got.profile.protocol, Protocol::Trojan);
        assert_eq!(got.profile.credential, "secret-password-123");
        assert_eq!(got.profile.fingerprint, "firefox");
        assert_eq!(got.profile.path, "/trojan-ws");
    }

    #[test]
    fn a_link_without_a_host_param_falls_back_to_its_authority() {
        let link = "vless://uuid-1@real.example.com:443?security=tls&type=ws#X";
        let got = import(link).unwrap();
        assert_eq!(got.profile.remote_host, "real.example.com");
        assert_eq!(got.profile.sni, "real.example.com");
    }

    #[test]
    fn a_link_without_a_remark_is_named_after_its_host() {
        let link = "vless://uuid-1@real.example.com:443?security=tls&type=ws";
        assert_eq!(import(link).unwrap().profile.name, "real.example.com");
    }

    #[test]
    fn a_missing_path_defaults_to_root() {
        let link = "vless://uuid-1@real.example.com:443?security=tls&type=ws";
        assert_eq!(import(link).unwrap().profile.path, "/");
    }

    #[test]
    fn a_path_without_a_leading_slash_is_corrected_not_rejected() {
        let link = "vless://uuid-1@h.com:443?security=tls&type=ws&path=api%2Fws";
        assert_eq!(import(link).unwrap().profile.path, "/api/ws");
    }

    #[test]
    fn allow_insecure_accepts_both_spellings() {
        for v in ["allowInsecure=1", "allowInsecure=true"] {
            let link = format!("vless://u@h.com:443?security=tls&type=ws&{v}");
            assert!(import(&link).unwrap().profile.allow_insecure, "{v}");
        }
    }

    #[test]
    fn an_unsupported_protocol_is_rejected_by_name() {
        let err = import("vmess://abcdef").unwrap_err();
        assert!(err.contains("vmess"), "{err}");
        assert!(err.contains("VLESS and Trojan"), "{err}");
    }

    #[test]
    fn an_unsupported_transport_is_rejected_by_name() {
        let err = import("vless://u@h.com:443?security=tls&type=grpc").unwrap_err();
        assert!(err.contains("grpc"), "{err}");
        assert!(err.contains("WebSocket"), "{err}");
    }

    #[test]
    fn an_unsupported_security_mode_is_rejected_by_name() {
        let err = import("vless://u@h.com:443?security=reality&type=ws").unwrap_err();
        assert!(err.contains("reality"), "{err}");
        assert!(err.contains("TLS"), "{err}");
    }

    #[test]
    fn a_missing_security_parameter_is_rejected() {
        // `security` absent means plaintext, which this application cannot use.
        assert!(import("vless://u@h.com:443?type=ws").is_err());
    }

    #[test]
    fn an_empty_credential_is_rejected() {
        assert!(import("vless://@h.com:443?security=tls&type=ws").is_err());
    }

    #[test]
    fn a_non_443_remote_port_warns_but_still_imports() {
        let link = "vless://u@h.com:8443?security=tls&type=ws";
        let got = import(link).unwrap();
        assert_eq!(got.source_port, 8443);
        assert_eq!(got.warnings.len(), 1);
        assert!(got.warnings[0].contains("8443"), "{:?}", got.warnings);
    }

    #[test]
    fn garbage_is_rejected_with_a_message_a_human_can_act_on() {
        let err = import("hello world").unwrap_err();
        assert!(err.contains("vless://"), "{err}");
    }

    #[test]
    fn an_xray_json_outbound_imports() {
        let json = r#"{
          "protocol": "vless",
          "settings": { "vnext": [ {
            "address": "104.18.4.130", "port": 443,
            "users": [ { "id": "uuid-9", "encryption": "none" } ]
          } ] },
          "streamSettings": {
            "network": "ws", "security": "tls",
            "tlsSettings": {
              "serverName": "sni.example.com", "allowInsecure": true,
              "alpn": ["h2","http/1.1"], "fingerprint": "safari"
            },
            "wsSettings": { "path": "/ws", "headers": { "Host": "host.example.com" } }
          }
        }"#;
        let got = import(json).unwrap();
        assert_eq!(got.profile.protocol, Protocol::Vless);
        assert_eq!(got.profile.credential, "uuid-9");
        assert_eq!(got.profile.remote_host, "host.example.com");
        assert_eq!(got.profile.sni, "sni.example.com");
        assert_eq!(got.profile.path, "/ws");
        assert_eq!(got.profile.alpn, vec!["h2", "http/1.1"]);
        assert_eq!(got.profile.fingerprint, "safari");
        assert!(got.profile.allow_insecure);
        assert_eq!(got.source_address, "104.18.4.130");
    }

    #[test]
    fn a_trojan_json_outbound_reads_its_password_from_servers() {
        let json = r#"{
          "protocol": "trojan",
          "settings": { "servers": [
            { "address": "cdn.example.net", "port": 443, "password": "pw-1" }
          ] },
          "streamSettings": {
            "network": "ws", "security": "tls",
            "wsSettings": { "path": "/t", "headers": { "Host": "h.example.com" } }
          }
        }"#;
        let got = import(json).unwrap();
        assert_eq!(got.profile.protocol, Protocol::Trojan);
        assert_eq!(got.profile.credential, "pw-1");
        assert_eq!(got.profile.remote_host, "h.example.com");
    }

    #[test]
    fn a_json_outbound_with_the_wrong_network_is_rejected_by_name() {
        let json = r#"{"protocol":"vless","settings":{"vnext":[{"address":"a","port":443,
          "users":[{"id":"u"}]}]},"streamSettings":{"network":"tcp","security":"tls"}}"#;
        let err = import(json).unwrap_err();
        assert!(err.contains("tcp"), "{err}");
    }

    #[test]
    fn export_produces_a_link_pointing_at_the_sni_listener() {
        let profile = import(VLESS).unwrap().profile;
        let uri = export_uri(&profile, "127.0.0.1", 40443);
        assert!(uri.starts_with("vless://9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d@127.0.0.1:40443?"));
        assert!(uri.contains("type=ws"));
        assert!(uri.contains("security=tls"));
        assert!(uri.contains("host=origin.cdn-domain.com"));
        assert!(uri.contains("path=%2Fwebsocket"));
        assert!(uri.contains("alpn=h3%2Ch2%2Chttp%2F1.1"));
        assert!(uri.ends_with("#Berlin%2001"));
    }

    #[test]
    fn export_marks_trojan_without_an_encryption_parameter() {
        let profile = import(TROJAN).unwrap().profile;
        let uri = export_uri(&profile, "127.0.0.1", 40443);
        assert!(uri.starts_with("trojan://"));
        assert!(!uri.contains("encryption="));
    }

    #[test]
    fn an_exported_link_imports_back_to_the_same_profile() {
        let original = import(VLESS).unwrap().profile;
        let uri = export_uri(&original, "127.0.0.1", 40443);
        let back = import(&uri).unwrap().profile;
        assert_eq!(back.credential, original.credential);
        assert_eq!(back.remote_host, original.remote_host);
        assert_eq!(back.path, original.path);
        assert_eq!(back.sni, original.sni);
        assert_eq!(back.alpn, original.alpn);
        assert_eq!(back.fingerprint, original.fingerprint);
        assert_eq!(back.name, original.name);
    }
}
