//! Assembling the complete sing-box configuration.
//!
//! Everything the engine runs is built here, in the unprivileged process,
//! so it is a pure function of (tunnel, store, active SNI profile) and can
//! be tested without root, without a network and without a core.
//!
//! The guard rules at the head of `route.rules` are not user-editable.
//! Three of them are what stop the tunnel from swallowing the SNI engine's
//! own upstream connection; see the design spec §6.

use super::model::{DefaultRoute, Protocol, TunnelMode, TunnelProfile, TunnelStore};
use super::rules::{parse_list, rule_set_source, to_rule_objects, RuleAction, RuleEntry, RuleKind};
use serde_json::{json, Map, Value};
use snifake_engine::proto::Profile;
use snifake_engine::tunpin;

pub fn generate(
    tunnel: &TunnelProfile,
    store: &TunnelStore,
    link: &Profile,
) -> Result<Value, String> {
    let block = parse_named(&store.routing.block, "Block")?;
    let bypass = parse_named(&store.routing.bypass, "Bypass")?;
    let proxy = parse_named(&store.routing.proxy, "Proxy")?;

    let mut rules = guards(store, link);

    if let Some(raw) = &store.routing.raw {
        let arr = raw
            .as_array()
            .ok_or("Raw rules must be a JSON array of rule objects.")?;
        rules.extend(arr.iter().cloned());
    }

    rules.extend(to_rule_objects(&block, RuleAction::Reject));
    rules.extend(to_rule_objects(&bypass, RuleAction::Direct));
    rules.extend(to_rule_objects(&proxy, RuleAction::Proxy));

    let mut route = Map::new();
    route.insert("rules".into(), Value::Array(rules));
    route.insert(
        "final".into(),
        json!(match store.routing.default_route {
            DefaultRoute::Proxy => "proxy",
            DefaultRoute::Direct => "direct",
        }),
    );
    route.insert("auto_detect_interface".into(), json!(true));
    // The kill switch accepts packets carrying this mark, which is how the
    // core's own direct traffic — the Bypass list, LAN, its resolver — gets
    // out while everything else is dropped (spec §3.4). SO_MARK is Linux's.
    #[cfg(target_os = "linux")]
    if store.mode == TunnelMode::Tun {
        route.insert("default_mark".into(), json!(tunpin::ROUTING_MARK));
    }
    // Replaces the pre-1.12 `{"outbound":"any","server":"local"}` DNS rule,
    // which is fatal on the pinned core. Names that a direct outbound has to
    // resolve are resolved locally, not through the tunnel.
    route.insert(
        "default_domain_resolver".into(),
        json!({ "server": "local" }),
    );
    if let Some(sets) = rule_sets(&[&block, &bypass, &proxy]) {
        route.insert("rule_set".into(), sets);
    }

    Ok(json!({
        "log": { "level": "warn", "timestamp": false },
        "dns": dns(&block, &bypass),
        "inbounds": inbounds(store, link)?,
        "outbounds": [ outbound(tunnel, link), { "type": "direct", "tag": "direct" } ],
        "route": Value::Object(route),
    }))
}

fn parse_named(lines: &[String], list: &str) -> Result<Vec<RuleEntry>, String> {
    parse_list(lines).map_err(|errs| {
        let (i, msg) = &errs[0];
        format!("{list} list, line {}: {msg}", i + 1)
    })
}

/// Generated, non-overridable, always first.
fn guards(store: &TunnelStore, link: &Profile) -> Vec<Value> {
    // Sniffing is the first thing that happens, and it has to be a rule:
    // the inbound `sniff` field was removed in 1.13.0. Without it a
    // connection carries only an address, so every domain rule below —
    // the user's lists included — would silently never match.
    //
    // Deliberately no `{"action": "resolve"}` after it: rewriting the
    // destination to a resolved address is what the old
    // `sniff_override_destination` did, and this pipeline wants the name
    // to survive all the way to the outbound.
    let mut out = vec![json!({ "action": "sniff" })];
    if store.mode == TunnelMode::Tun {
        // `auto_route` delivers every port-53 packet to the TUN. This hands
        // the DNS ones to the resolver instead of routing them as traffic,
        // which is what pulls hard-coded resolvers into the tunnel too.
        out.push(json!({ "protocol": "dns", "action": "hijack-dns" }));
    }
    out.push(json!({ "ip_cidr": [format!("{}/32", link.connect_ip)], "outbound": "direct" }));

    // A loopback listener is never routed into the tunnel, so it needs no
    // guard; a LAN-facing one does.
    if !link.listen_host.starts_with("127.") && link.listen_host != "localhost" {
        out.push(json!({
            "ip_cidr": [format!("{}/32", link.listen_host)],
            "outbound": "direct"
        }));
    }

    out.push(json!({
        "process_name": ["snifake", "snifake-engine", "sing-box"],
        "outbound": "direct"
    }));

    if store.routing.allow_lan {
        out.push(json!({ "ip_is_private": true, "outbound": "direct" }));
    }

    // The SNI engine rejects an IPv6 egress outright, so anything that
    // travelled over IPv6 travelled outside the tunnel.
    out.push(json!({ "ip_version": 6, "action": "reject" }));

    if store.routing.block_quic {
        out.push(json!({ "network": ["udp"], "port": [443], "action": "reject" }));
    }

    out
}

fn rule_sets(lists: &[&Vec<RuleEntry>]) -> Option<Value> {
    let mut tags: Vec<String> = lists
        .iter()
        .flat_map(|l| l.iter())
        .filter(|e| e.kind == RuleKind::RuleSet)
        .map(|e| e.value.clone())
        .collect();
    tags.sort();
    tags.dedup();
    if tags.is_empty() {
        return None;
    }
    Some(Value::Array(
        tags.iter().filter_map(|t| rule_set_source(t)).collect(),
    ))
}

/// Only domain-shaped entries can be decided at DNS time; a port or a
/// process name has no meaning before a connection exists.
/// `outcome` is either `("server", "local")` to answer from the system
/// resolver, or `("action", "reject")` to refuse the name outright. The
/// pre-1.12 way of blocking — a third DNS server answering `rcode://success`
/// — no longer exists; rejection is a rule action, exactly as it is on the
/// route side.
fn dns_domain_rule(entries: &[RuleEntry], outcome: (&str, &str)) -> Option<Value> {
    let mut rule = Map::new();
    for kind in [
        RuleKind::Domain,
        RuleKind::DomainSuffix,
        RuleKind::DomainKeyword,
        RuleKind::DomainRegex,
    ] {
        let values: Vec<Value> = entries
            .iter()
            .filter(|e| e.kind == kind)
            .map(|e| json!(e.value))
            .collect();
        if !values.is_empty() {
            let field = match kind {
                RuleKind::Domain => "domain",
                RuleKind::DomainSuffix => "domain_suffix",
                RuleKind::DomainKeyword => "domain_keyword",
                _ => "domain_regex",
            };
            rule.insert(field.into(), Value::Array(values));
        }
    }
    if rule.is_empty() {
        return None;
    }
    rule.insert(outcome.0.into(), json!(outcome.1));
    Some(Value::Object(rule))
}

fn dns(block: &[RuleEntry], bypass: &[RuleEntry]) -> Value {
    let mut rules = Vec::new();
    if let Some(r) = dns_domain_rule(bypass, ("server", "local")) {
        rules.push(r);
    }
    if let Some(r) = dns_domain_rule(block, ("action", "reject")) {
        rules.push(r);
    }
    json!({
        // Post-1.12 server format: `type` + `server`, never `address`. The
        // legacy spelling is a fatal error on the pinned core, not a warning.
        "servers": [
            // `domain_resolver` is what lets the remote server bootstrap its
            // own name; without it it cannot resolve itself.
            { "tag": "remote", "type": "tls", "server": "1.1.1.1",
              "detour": "proxy", "domain_resolver": "local" },
            { "tag": "local", "type": "local" }
        ],
        "rules": rules,
        "final": "remote",
        // The SNI engine is IPv4-only; asking for AAAA records would only
        // produce addresses nothing can reach.
        "strategy": "ipv4_only"
    })
}

fn inbounds(store: &TunnelStore, link: &Profile) -> Result<Value, String> {
    match store.mode {
        // Every value here is a `tunpin` constant, because the engine builds
        // its kill switch from the same constants and the two must agree.
        TunnelMode::Tun => Ok(json!([{
            "type": "tun",
            "tag": "tun-in",
            "interface_name": tunpin::INTERFACE_NAME,
            "address": [tunpin::ADDRESS_V4, tunpin::ADDRESS_V6],
            "mtu": tunpin::MTU,
            "auto_route": true,
            "strict_route": true,
            "stack": "system",
            // Pinned so the engine's startup purge can find the policy rules
            // `strict_route` leaves behind a killed core (tunpin).
            "iproute2_table_index": tunpin::IPROUTE2_TABLE,
            "iproute2_rule_index": tunpin::IPROUTE2_RULE,
            // Layer 1 of the four loop guards (design §6).
            "route_exclude_address": [format!("{}/32", link.connect_ip)]
        }])),
        // No `sniff` / `sniff_override_destination` here: those inbound
        // fields were *removed* in sing-box 1.13.0, not merely deprecated,
        // and the config is refused outright if they appear. Sniffing is a
        // route action now — see the head of `guards()`.
        TunnelMode::SystemProxy | TunnelMode::Manual => Ok(json!([{
            "type": "mixed",
            "tag": "mixed-in",
            "listen": store.proxy_host,
            "listen_port": store.proxy_port
        }])),
    }
}

/// The one place the SNI listener's address is written. It is read from the
/// live profile and never from the tunnel, which stores no address at all.
fn outbound(t: &TunnelProfile, link: &Profile) -> Value {
    let mut out = Map::new();
    out.insert(
        "type".into(),
        json!(match t.protocol {
            Protocol::Vless => "vless",
            Protocol::Trojan => "trojan",
        }),
    );
    out.insert("tag".into(), json!("proxy"));
    out.insert("server".into(), json!(link.listen_host));
    out.insert("server_port".into(), json!(link.listen_port));
    match t.protocol {
        Protocol::Vless => {
            out.insert("uuid".into(), json!(t.credential));
            out.insert("packet_encoding".into(), json!("xudp"));
        }
        Protocol::Trojan => {
            out.insert("password".into(), json!(t.credential));
        }
    }
    out.insert(
        "tls".into(),
        json!({
            "enabled": true,
            "server_name": t.sni,
            "insecure": t.allow_insecure,
            "alpn": t.alpn,
            "utls": { "enabled": true, "fingerprint": t.fingerprint }
        }),
    );
    out.insert(
        "transport".into(),
        json!({
            "type": "ws",
            "path": t.path,
            "headers": { "Host": t.remote_host }
        }),
    );
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tunnel::model::{DefaultRoute, Protocol, TunnelProfile, TunnelStore};
    use serde_json::json;

    fn link() -> Profile {
        Profile {
            id: "p1".into(),
            name: "cloudflare".into(),
            listen_host: "127.0.0.1".into(),
            listen_port: 40443,
            connect_ip: "103.160.204.34".into(),
            connect_port: 443,
            fake_sni: "chatgpt.com".into(),
        }
    }

    fn tunnel() -> TunnelProfile {
        let mut t = TunnelProfile::new("de-01", Protocol::Vless);
        t.id = "t1".into();
        t.credential = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d".into();
        t.remote_host = "origin.cdn-domain.com".into();
        t.sni = "origin.cdn-domain.com".into();
        t.path = "/websocket".into();
        t
    }

    fn rules(cfg: &serde_json::Value) -> &Vec<serde_json::Value> {
        cfg["route"]["rules"].as_array().unwrap()
    }

    #[test]
    fn the_outbound_dials_the_sni_listener_never_the_real_destination() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let out = &cfg["outbounds"][0];
        assert_eq!(out["server"], json!("127.0.0.1"));
        assert_eq!(out["server_port"], json!(40443));
        // The real destination survives only in the WebSocket Host header.
        assert_eq!(out["transport"]["headers"]["Host"], json!("origin.cdn-domain.com"));
        assert_eq!(out["tls"]["server_name"], json!("origin.cdn-domain.com"));
    }

    #[test]
    fn a_vless_outbound_carries_a_uuid_and_no_encryption() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], json!("vless"));
        assert_eq!(out["uuid"], json!("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"));
        assert!(out.get("password").is_none());
    }

    #[test]
    fn a_trojan_outbound_carries_a_password_and_no_uuid() {
        let mut t = tunnel();
        t.protocol = Protocol::Trojan;
        t.credential = "pw-1".into();
        let cfg = generate(&t, &TunnelStore::default(), &link()).unwrap();
        let out = &cfg["outbounds"][0];
        assert_eq!(out["type"], json!("trojan"));
        assert_eq!(out["password"], json!("pw-1"));
        assert!(out.get("uuid").is_none());
    }

    #[test]
    fn the_transport_is_websocket_with_the_configured_path() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let t = &cfg["outbounds"][0]["transport"];
        assert_eq!(t["type"], json!("ws"));
        assert_eq!(t["path"], json!("/websocket"));
    }

    #[test]
    fn tls_carries_alpn_and_the_utls_fingerprint() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let tls = &cfg["outbounds"][0]["tls"];
        assert_eq!(tls["enabled"], json!(true));
        assert_eq!(tls["insecure"], json!(false));
        assert_eq!(tls["alpn"], json!(["h3", "h2", "http/1.1"]));
        assert_eq!(tls["utls"], json!({ "enabled": true, "fingerprint": "chrome" }));
    }

    #[test]
    fn sniffing_happens_before_any_rule_that_needs_a_domain() {
        // The inbound `sniff` field was removed in sing-box 1.13.0, so this
        // is a rule now, and it has to be the first one: without a sniffed
        // host every domain rule below — the user's lists included — would
        // silently never match.
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert_eq!(rules(&cfg)[0], json!({ "action": "sniff" }));
        // Not followed by a resolve: the name must survive to the outbound.
        assert!(rules(&cfg).iter().all(|r| r["action"] != json!("resolve")));
    }

    #[test]
    fn the_first_guard_sends_the_sni_upstream_straight_out() {
        // This single rule is what stops the tunnel swallowing the SNI
        // engine's own connection and looping.
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert_eq!(
            rules(&cfg)[1],
            json!({ "ip_cidr": ["103.160.204.34/32"], "outbound": "direct" })
        );
    }

    #[test]
    fn the_process_guard_names_all_three_of_our_binaries() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let guard = rules(&cfg)
            .iter()
            .find(|r| r.get("process_name").is_some())
            .expect("a process guard must exist");
        assert_eq!(
            guard["process_name"],
            json!(["snifake", "snifake-engine", "sing-box"])
        );
        assert_eq!(guard["outbound"], json!("direct"));
    }

    #[test]
    fn a_loopback_listen_host_gets_no_extra_guard_but_a_lan_one_does() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let count = rules(&cfg)
            .iter()
            .filter(|r| r.get("ip_cidr").is_some())
            .count();
        assert_eq!(count, 1, "127.0.0.1 needs no guard of its own");

        let mut lan = link();
        lan.listen_host = "192.168.1.20".into();
        let cfg = generate(&tunnel(), &TunnelStore::default(), &lan).unwrap();
        assert!(rules(&cfg)
            .iter()
            .any(|r| r["ip_cidr"] == json!(["192.168.1.20/32"])));
    }

    #[test]
    fn ipv6_is_blocked_because_the_sni_engine_is_ipv4_only() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        let guard = rules(&cfg)
            .iter()
            .find(|r| r.get("ip_version").is_some())
            .expect("an IPv6 guard must exist");
        assert_eq!(guard["ip_version"], json!(6));
        assert_eq!(guard["action"], json!("reject"));
    }

    #[test]
    fn quic_is_blocked_by_default_and_the_toggle_removes_the_rule() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert!(rules(&cfg).iter().any(|r| r["port"] == json!([443])
            && r["network"] == json!(["udp"])
            && r["action"] == json!("reject")));

        let mut store = TunnelStore::default();
        store.routing.block_quic = false;
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        assert!(!rules(&cfg).iter().any(|r| r["network"] == json!(["udp"])));
    }

    #[test]
    fn the_lan_guard_follows_its_toggle() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert!(rules(&cfg).iter().any(|r| r["ip_is_private"] == json!(true)));

        let mut store = TunnelStore::default();
        store.routing.allow_lan = false;
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        assert!(!rules(&cfg).iter().any(|r| r.get("ip_is_private").is_some()));
    }

    #[test]
    fn user_lists_are_ordered_block_then_bypass_then_proxy_after_the_guards() {
        let mut store = TunnelStore::default();
        store.routing.block = vec!["ads.example".into()];
        store.routing.bypass = vec!["local.example".into()];
        store.routing.proxy = vec!["remote.example".into()];
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        let rules = rules(&cfg);

        let idx = |needle: &str| {
            rules
                .iter()
                .position(|r| r["domain_suffix"] == json!([needle]))
                .unwrap_or_else(|| panic!("{needle} missing"))
        };
        let (b, y, p) = (idx("ads.example"), idx("local.example"), idx("remote.example"));
        assert!(b < y && y < p, "block {b} < bypass {y} < proxy {p}");

        // and all three sit after every guard
        let last_guard = rules
            .iter()
            .rposition(|r| r.get("process_name").is_some() || r.get("ip_version").is_some())
            .unwrap();
        assert!(b > last_guard);
    }

    #[test]
    fn raw_rules_are_merged_verbatim_after_the_guards_and_before_the_lists() {
        let mut store = TunnelStore::default();
        store.routing.raw = Some(json!([{ "domain": ["raw.example"], "outbound": "direct" }]));
        store.routing.block = vec!["ads.example".into()];
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        let rules = rules(&cfg);
        let raw = rules.iter().position(|r| r["domain"] == json!(["raw.example"])).unwrap();
        let block = rules.iter().position(|r| r["domain_suffix"] == json!(["ads.example"])).unwrap();
        let guard = rules.iter().position(|r| r.get("process_name").is_some()).unwrap();
        assert!(guard < raw && raw < block);
    }

    #[test]
    fn raw_rules_that_are_not_an_array_are_rejected() {
        let mut store = TunnelStore::default();
        store.routing.raw = Some(json!({ "not": "an array" }));
        assert!(generate(&tunnel(), &store, &link()).is_err());
    }

    #[test]
    fn an_invalid_rule_line_fails_generation_and_names_the_line() {
        let mut store = TunnelStore::default();
        store.routing.block = vec!["ok.example".into(), "banana:x".into()];
        let err = generate(&tunnel(), &store, &link()).unwrap_err();
        assert!(err.contains("Block"), "{err}");
        assert!(err.contains("line 2"), "{err}");
    }

    #[test]
    fn the_default_route_follows_its_setting() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert_eq!(cfg["route"]["final"], json!("proxy"));

        let mut store = TunnelStore::default();
        store.routing.default_route = DefaultRoute::Direct;
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        assert_eq!(cfg["route"]["final"], json!("direct"));
    }

    #[test]
    fn a_referenced_rule_set_is_declared_once_in_route_rule_set() {
        let mut store = TunnelStore::default();
        store.routing.block = vec!["ruleset:geosite-category-ads".into()];
        store.routing.proxy = vec!["ruleset:geosite-category-ads".into()];
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        let sets = cfg["route"]["rule_set"].as_array().unwrap();
        assert_eq!(sets.len(), 1, "declared once even though referenced twice");
        assert_eq!(sets[0]["tag"], json!("geosite-category-ads"));
    }

    #[test]
    fn no_rule_set_reference_means_no_rule_set_key_at_all() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert!(cfg["route"].get("rule_set").is_none());
    }

    #[test]
    fn manual_mode_exposes_one_mixed_inbound_on_the_configured_port() {
        let mut store = TunnelStore::default();
        store.proxy_port = 3128;
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        let inbounds = cfg["inbounds"].as_array().unwrap();
        assert_eq!(inbounds.len(), 1);
        assert_eq!(inbounds[0]["type"], json!("mixed"));
        assert_eq!(inbounds[0]["listen"], json!("127.0.0.1"));
        assert_eq!(inbounds[0]["listen_port"], json!(3128));
    }

    fn tun_store() -> TunnelStore {
        let mut s = TunnelStore::default();
        s.mode = crate::tunnel::model::TunnelMode::Tun;
        s
    }

    #[test]
    fn tun_mode_has_one_tun_inbound_and_no_proxy_port() {
        let cfg = generate(&tunnel(), &tun_store(), &link()).unwrap();
        let inbounds = cfg["inbounds"].as_array().unwrap();
        assert_eq!(inbounds.len(), 1);
        let i = &inbounds[0];
        assert_eq!(i["type"], json!("tun"));
        assert_eq!(i["interface_name"], json!(snifake_engine::tunpin::INTERFACE_NAME));
        assert_eq!(i["address"], json!(["172.19.83.1/30", "fdfe:dcba:534e::1/126"]));
        assert_eq!(i["auto_route"], json!(true));
        assert_eq!(i["strict_route"], json!(true));
        assert_eq!(i["stack"], json!("system"));
        assert_eq!(i["iproute2_table_index"], json!(5346));
        assert_eq!(i["iproute2_rule_index"], json!(5346));
    }

    #[test]
    fn the_sni_upstream_is_excluded_from_the_tun() {
        let cfg = generate(&tunnel(), &tun_store(), &link()).unwrap();
        assert_eq!(cfg["inbounds"][0]["route_exclude_address"], json!(["103.160.204.34/32"]));
    }

    #[test]
    fn tun_mode_hijacks_dns_right_after_sniffing() {
        let cfg = generate(&tunnel(), &tun_store(), &link()).unwrap();
        assert_eq!(rules(&cfg)[0], json!({ "action": "sniff" }));
        assert_eq!(rules(&cfg)[1], json!({ "protocol": "dns", "action": "hijack-dns" }));
    }

    #[test]
    fn proxy_modes_do_not_hijack_dns() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert!(!rules(&cfg).iter().any(|r| r["action"] == json!("hijack-dns")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn tun_mode_marks_the_cores_sockets_for_the_kill_switch() {
        let cfg = generate(&tunnel(), &tun_store(), &link()).unwrap();
        assert_eq!(cfg["route"]["default_mark"], json!(0x534e));
        let proxy = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert!(proxy["route"].get("default_mark").is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_tun_config_matches_its_golden_snapshot() {
        assert_golden("vless-tun.json", &generate(&tunnel(), &tun_store(), &link()).unwrap());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_trojan_tun_config_matches_its_golden_snapshot() {
        let mut t = tunnel();
        t.protocol = Protocol::Trojan;
        t.credential = "secret-password-123".into();
        assert_golden("trojan-tun.json", &generate(&t, &tun_store(), &link()).unwrap());
    }

    #[test]
    fn dns_resolves_remotely_through_the_proxy_and_only_ipv4() {
        let cfg = generate(&tunnel(), &TunnelStore::default(), &link()).unwrap();
        assert_eq!(cfg["dns"]["strategy"], json!("ipv4_only"));
        let servers = cfg["dns"]["servers"].as_array().unwrap();
        let remote = servers.iter().find(|s| s["tag"] == json!("remote")).unwrap();
        assert_eq!(remote["detour"], json!("proxy"));

        // Post-1.12 server format. The legacy `"address": "tls://1.1.1.1"`
        // spelling is a *fatal* error on the pinned core, not a warning, so
        // these assertions are what stop it coming back.
        assert_eq!(remote["type"], json!("tls"));
        assert_eq!(remote["server"], json!("1.1.1.1"));
        assert!(remote.get("address").is_none());
        // Without a resolver of its own the remote server cannot bootstrap.
        assert_eq!(remote["domain_resolver"], json!("local"));

        let local = servers.iter().find(|s| s["tag"] == json!("local")).unwrap();
        assert_eq!(local["type"], json!("local"));

        // Replaces the removed `{"outbound":"any","server":"local"}` rule.
        assert_eq!(cfg["route"]["default_domain_resolver"], json!({ "server": "local" }));
    }

    #[test]
    fn dns_rules_send_bypass_domains_local_and_reject_blocked_ones() {
        let mut store = TunnelStore::default();
        store.routing.bypass = vec!["intranet.example".into()];
        store.routing.block = vec!["ads.example".into()];
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        let dns = cfg["dns"]["rules"].as_array().unwrap();
        assert!(dns.iter().any(|r| r["domain_suffix"] == json!(["intranet.example"])
            && r["server"] == json!("local")));
        // Blocking used to mean a third DNS server answering `rcode://success`.
        // That server no longer exists: rejection is a rule action here, the
        // same as it is on the route side.
        assert!(dns.iter().any(|r| r["domain_suffix"] == json!(["ads.example"])
            && r["action"] == json!("reject")
            && r.get("server").is_none()));
    }

    #[test]
    fn dns_rules_ignore_non_domain_entries() {
        // A port or a process name cannot be matched at DNS time.
        let mut store = TunnelStore::default();
        store.routing.bypass = vec!["port:8080".into(), "process:curl".into()];
        let cfg = generate(&tunnel(), &store, &link()).unwrap();
        assert!(cfg["dns"]["rules"].as_array().unwrap().is_empty());
    }

    #[test]
    fn the_generated_config_matches_the_golden_snapshot() {
        assert_golden("vless-manual.json", &generate(&tunnel(), &TunnelStore::default(), &link()).unwrap());
    }

    #[test]
    fn the_trojan_config_matches_its_golden_snapshot() {
        let mut t = tunnel();
        t.protocol = Protocol::Trojan;
        t.credential = "secret-password-123".into();
        assert_golden("trojan-manual.json", &generate(&t, &TunnelStore::default(), &link()).unwrap());
    }

    #[test]
    fn a_config_using_every_feature_matches_its_golden_snapshot() {
        // The two snapshots above are both `TunnelStore::default()`: empty
        // lists, no rule sets, no raw block. Those are the paths a real user
        // is *least* likely to run. This one exercises every branch the
        // generator has, so that the `sing-box check` verification covers
        // what people actually configure and not just the empty case.
        let mut store = TunnelStore::default();
        store.proxy_port = 3128;
        store.routing.default_route = DefaultRoute::Direct;
        store.routing.block_quic = false;
        store.routing.allow_lan = false;
        store.routing.block = vec![
            "ads.example".into(),
            "keyword:doubleclick".into(),
            r"regex:^tracker[0-9]*\.".into(),
            "ruleset:geosite-category-ads-all".into(),
        ];
        store.routing.bypass = vec![
            "domain:intranet.example".into(),
            "ip:10.0.0.0/8".into(),
            "process:Telegram".into(),
            "path:/usr/bin/curl".into(),
            "ruleset:geoip-ir".into(),
        ];
        store.routing.proxy = vec![
            "openai.com".into(),
            "port:8080".into(),
            "network:tcp".into(),
        ];
        store.routing.raw = Some(json!([
            { "domain_suffix": ["hand-written.example"], "outbound": "direct" }
        ]));
        assert_golden(
            "vless-everything.json",
            &generate(&tunnel(), &store, &link()).unwrap(),
        );
    }

    /// Golden snapshots exist to make a sing-box schema change on a core
    /// upgrade fail loudly here rather than quietly at the user's machine.
    /// Regenerate deliberately with `UPDATE_GOLDEN=1`, then read the diff.
    fn assert_golden(name: &str, actual: &serde_json::Value) {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/tunnel/testdata")
            .join(name);
        let pretty = serde_json::to_string_pretty(actual).unwrap() + "\n";
        if std::env::var("UPDATE_GOLDEN").is_ok() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &pretty).unwrap();
            return;
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("missing golden {name}; run with UPDATE_GOLDEN=1"));
        assert_eq!(pretty, expected, "golden {name} differs");
    }
}
