//! TUN kill-switch integration tests. Real nftables, real routes, real
//! sing-box, in a container's network namespace: `docker compose run --rm
//! tunnel-it`. Ignored by `cargo test` everywhere else.
//!
//! `killing_the_core_leaves_the_machine_closed` is the test that protects a
//! user. If only one of these ever runs, it is that one.
#![cfg(target_os = "linux")]

use serde_json::json;
use snifake_engine::killswitch::Allowlist;
use snifake_engine::proto::{ReadyProbe, TunSpec, TunnelSpec};
use snifake_engine::sniffer::LogFn;
use snifake_engine::tun::{purge_leftovers, TunGuard};
use snifake_engine::tunnel::TunnelSupervisor;
use snifake_engine::tunpin;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

/// Stands in for the SNI upstream: the one address the kill switch permits.
const UPSTREAM: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 1);
/// Anything else on the internet.
const OTHER: Ipv4Addr = Ipv4Addr::new(1, 0, 0, 1);
/// Routed `direct` by the test config: the Bypass-list case. Answers plain
/// HTTP, like `OTHER`, which `answers` needs.
const BYPASS: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 2);

/// A TCP handshake on 443. Only meaningful where no core is running, or for
/// an address `route_exclude_address` keeps out of the TUN: with the core up,
/// the `system` stack completes every handshake locally on the TUN before a
/// route rule decides, so a connect succeeds even to a rejected destination.
fn reaches(ip: Ipv4Addr) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from((ip, 443)), Duration::from_secs(3)).is_ok()
}

/// The remote end actually replied: an HTTP request on port 80 got bytes
/// back. This is what "traffic got out" means with a core running.
fn answers(ip: Ipv4Addr) -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&SocketAddr::from((ip, 80)), Duration::from_secs(3)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    if s.write_all(b"GET / HTTP/1.0\r\nHost: probe\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    matches!(s.read(&mut buf), Ok(n) if n > 0)
}

fn allow(upstream: Ipv4Addr) -> Allowlist {
    Allowlist { connect: (upstream, 443), allow_lan: true }
}

fn quiet() -> LogFn {
    Arc::new(|_, _| {})
}

fn nft_has_our_table() -> bool {
    Command::new("nft")
        .args(["list", "table", "inet", "snifake"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn routes_with_our_proto() -> String {
    let out = Command::new("ip")
        .args(["route", "show", "proto", &tunpin::ROUTE_PROTO.to_string()])
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// The same inbound the generator writes, a direct outbound, and a
/// catch-all reject so nothing but the bypass address can succeed through
/// the tunnel.
fn spec(upstream: Ipv4Addr) -> TunnelSpec {
    TunnelSpec {
        config: json!({
            "log": { "level": "warn", "timestamp": false },
            "dns": { "servers": [{ "tag": "local", "type": "local" }], "final": "local", "strategy": "ipv4_only" },
            "inbounds": [{
                "type": "tun", "tag": "tun-in",
                "interface_name": tunpin::INTERFACE_NAME,
                "address": [tunpin::ADDRESS_V4, tunpin::ADDRESS_V6],
                "mtu": tunpin::MTU,
                "auto_route": true, "strict_route": true, "stack": "system",
                "iproute2_table_index": tunpin::IPROUTE2_TABLE,
                "iproute2_rule_index": tunpin::IPROUTE2_RULE,
                "route_exclude_address": [format!("{upstream}/32")]
            }],
            "outbounds": [{ "type": "direct", "tag": "direct" }],
            "route": {
                "auto_detect_interface": true,
                "default_mark": tunpin::ROUTING_MARK,
                "default_domain_resolver": { "server": "local" },
                "rules": [
                    { "action": "sniff" },
                    { "protocol": "dns", "action": "hijack-dns" },
                    { "ip_cidr": [format!("{BYPASS}/32")], "outbound": "direct" },
                    { "ip_version": 6, "action": "reject" },
                    { "ip_cidr": ["0.0.0.0/0"], "action": "reject" }
                ],
                "final": "direct"
            }
        }),
        core_path: std::env::var("SINGBOX_CORE").expect("set SINGBOX_CORE"),
        ready_probe: ReadyProbe::Interface { name: tunpin::INTERFACE_NAME.into() },
        connect_ip: upstream.to_string(),
        connect_port: 443,
        listen_host: "127.0.0.1".into(),
        tun: Some(TunSpec { allow_lan: true }),
    }
}

fn up(upstream: Ipv4Addr) -> (TunGuard, TunnelSupervisor) {
    purge_leftovers().unwrap();
    assert!(answers(OTHER), "precondition: the container has internet");
    let mut g = TunGuard::raise(allow(upstream)).expect("raise the guard");
    let sup = TunnelSupervisor::start(&spec(upstream), quiet(), Box::new(|| {})).expect("start the core");
    g.permit_interface(tunpin::INTERFACE_NAME).unwrap();
    (g, sup)
}

#[test]
#[ignore]
fn the_kill_switch_alone_drops_everything_but_the_upstream() {
    purge_leftovers().unwrap();
    assert!(answers(OTHER), "precondition: the container has internet");
    let mut g = TunGuard::raise(allow(UPSTREAM)).unwrap();
    assert!(reaches(UPSTREAM), "(b) the SNI upstream must stay reachable");
    assert!(!answers(OTHER), "(a) an unrelated address must be dropped");
    g.lower().unwrap();
    assert!(answers(OTHER), "lowering must open the network again");
    assert!(!nft_has_our_table(), "(c) the table must be gone");
    assert_eq!(routes_with_our_proto(), "", "(c) the pinned route must be gone");
}

#[test]
#[ignore]
fn killing_the_core_leaves_the_machine_closed() {
    let (mut g, sup) = up(UPSTREAM);
    Command::new("kill").args(["-9", &sup.pid().to_string()]).status().unwrap();
    std::thread::sleep(Duration::from_secs(1));
    assert!(!answers(OTHER), "(d) a dead core must not mean an open machine");
    assert!(!answers(BYPASS), "(d) nor for the core's own direct routes");
    assert!(reaches(UPSTREAM), "(d) the SNI upstream stays reachable");
    sup.stop();
    g.lower().unwrap();
}

#[test]
#[ignore]
fn a_bypass_destination_leaves_directly_through_the_mark() {
    let (mut g, sup) = up(UPSTREAM);
    assert!(answers(BYPASS), "(e) the core's direct traffic must pass the kill switch");
    assert!(!answers(OTHER), "(e) while everything else is still refused");
    sup.stop();
    g.lower().unwrap();
}

#[test]
#[ignore]
fn dns_resolves_under_the_tunnel() {
    let (mut g, sup) = up(UPSTREAM);
    let resolved = ("example.com", 443).to_socket_addrs();
    sup.stop();
    g.lower().unwrap();
    assert!(resolved.is_ok(), "(f) DNS must resolve with the TUN and kill switch up: {resolved:?}");
}

#[test]
#[ignore]
fn the_exit_watch_reports_a_killed_core() {
    purge_leftovers().unwrap();
    let mut g = TunGuard::raise(allow(UPSTREAM)).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let sup = TunnelSupervisor::start(&spec(UPSTREAM), quiet(), Box::new(move || tx.send(()).unwrap())).unwrap();
    Command::new("kill").args(["-9", &sup.pid().to_string()]).status().unwrap();
    assert!(rx.recv_timeout(Duration::from_secs(3)).is_ok(), "the crash was never reported");
    sup.stop();
    g.lower().unwrap();
}

#[test]
#[ignore]
fn a_profile_switch_retargets_before_the_link_needs_it() {
    // Review Focus 1: the new upstream is permitted and the old one is not,
    // without the drop ever lifting.
    purge_leftovers().unwrap();
    let mut g = TunGuard::raise(allow(UPSTREAM)).unwrap();
    g.retarget(allow(OTHER)).unwrap();
    assert!(reaches(OTHER), "the new upstream must be permitted");
    assert!(!reaches(UPSTREAM), "the old upstream must no longer be");
    assert!(nft_has_our_table(), "the drop never lifted");
    g.lower().unwrap();
}

#[test]
#[ignore]
fn leaving_tun_for_a_proxy_mode_lowers_the_guard() {
    // Review Focus 2, at the level the engine's TunnelStart arm uses: a
    // proxy-mode start lowers the guard it finds.
    let (mut g, sup) = up(UPSTREAM);
    sup.stop();
    g.lower().unwrap();
    assert!(answers(OTHER));
    assert!(!nft_has_our_table());
}

#[test]
#[ignore]
fn a_purge_opens_a_machine_a_crashed_run_left_closed() {
    // A crash with the core running: the guard is abandoned, not lowered,
    // and sing-box dies without removing its own policy rules.
    let (g, sup) = up(UPSTREAM);
    Command::new("kill").args(["-9", &sup.pid().to_string()]).status().unwrap();
    std::thread::sleep(Duration::from_secs(1));
    drop(sup);
    drop(g);
    assert!(!answers(OTHER));
    purge_leftovers().unwrap();
    assert!(answers(OTHER), "the startup purge must open the network");
    assert!(!nft_has_our_table());
    assert_eq!(routes_with_our_proto(), "");
    let rules = Command::new("ip").args(["rule", "show"]).output().unwrap();
    assert!(
        !String::from_utf8_lossy(&rules.stdout).contains("5346:"),
        "sing-box's policy rules must be purged too"
    );
}
