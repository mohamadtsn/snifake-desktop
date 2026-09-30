//! The privileged half of Snifake.
//!
//! Usage: `snifake-engine <socket-path> <token>`
//!
//! Connects back to the socket the unprivileged GUI is listening on, sends
//! the token as its first line, then speaks NDJSON: commands in, events out.
//! It stays alive for the whole GUI session so the user is only asked to
//! authenticate once.

use snifake_engine::capture;
use snifake_engine::forward::{discover_egress, Forwarder};
use snifake_engine::killswitch::Allowlist;
use snifake_engine::proto::{Command, Event, LogLevel, Profile, TunnelSpec};
use snifake_engine::sniffer::{self, LogFn, PortTable};
use snifake_engine::transport::Stream;
use snifake_engine::tun::{self, TunGuard};
use snifake_engine::tunnel::{ExitFn, TunnelSupervisor};
use snifake_engine::tunpin;
use snifake_engine::validate::{spec_matches_link, validate, validate_tun, validate_upstream};

use std::io::{BufRead, BufReader, Write};
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Serialises writes so log lines from many connection threads cannot
/// interleave mid-line on the socket.
#[derive(Clone)]
struct Out(Arc<Mutex<Stream>>);

impl Out {
    fn send(&self, ev: &Event) {
        let Ok(mut line) = serde_json::to_string(ev) else {
            return;
        };
        line.push('\n');
        let mut guard = self.0.lock().unwrap();
        let _ = guard.write_all(line.as_bytes());
        let _ = guard.flush();
    }
}

fn tunnel_state(out: &Out, state: &str, detail: Option<String>, blocking: bool) {
    out.send(&Event::TunnelState {
        state: state.into(),
        detail,
        blocking,
    });
}

/// One active run. The sniff thread owns the raw capture socket, so stopping
/// means signalling *and* joining it — dropping the handle would leak a
/// thread and a packet socket on every start/stop cycle.
struct Running {
    forwarder: Forwarder,
    stop: Arc<AtomicBool>,
    sniffer: std::thread::JoinHandle<()>,
    /// Stops the traffic ticker. Owned by the run so the ticker cannot
    /// outlive the counters it reads, and so a stopped stage emits nothing.
    traffic_stop: Arc<AtomicBool>,
    traffic: std::thread::JoinHandle<()>,
    /// What this run is dialling. A `TunnelStart` is checked against it,
    /// not trusted to name it (`validate::spec_matches_link`).
    profile: Profile,
}

impl Running {
    fn stop(self) {
        // Listener first: no new connections while the sniffer is winding down.
        self.forwarder.stop();
        self.stop.store(true, Ordering::Relaxed);
        self.traffic_stop.store(true, Ordering::Relaxed);
        let _ = self.traffic.join();
        // Worst case one capture::RECV_TIMEOUT.
        let _ = self.sniffer.join();
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(endpoint), Some(token)) = (args.next(), args.next()) else {
        eprintln!("usage: snifake-engine <endpoint> <token>");
        std::process::exit(2);
    };

    let stream = match Stream::connect(&endpoint) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("connect {endpoint}: {e}");
            std::process::exit(1);
        }
    };
    let reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clone socket: {e}");
            std::process::exit(1);
        }
    });
    let out = Out(Arc::new(Mutex::new(stream)));

    {
        let mut guard = out.0.lock().unwrap();
        if writeln!(guard, "{token}").is_err() {
            std::process::exit(1);
        }
        let _ = guard.flush();
    }
    out.send(&Event::Ready {
        version: env!("CARGO_PKG_VERSION").to_string(),
    });

    // Before anything else, every time: a previous run that crashed with
    // TUN up left the machine closed, and this is what opens it. The event
    // is what lets the GUI delete its crash marker (spec §12.7).
    match tun::purge_leftovers() {
        Ok(()) => tunnel_state(&out, "offline", None, false),
        Err(e) => out.send(&Event::Error {
            code: "purge_failed".into(),
            msg: format!("could not remove a previous session's firewall rules: {e}"),
        }),
    }

    let verbose = Arc::new(AtomicBool::new(false));
    let mut running: Option<Running> = None;
    let mut tunnel: Option<TunnelSupervisor> = None;
    // Outlives `tunnel` on purpose: it is raised before a TUN core starts,
    // lowered after it stops, and kept across a core crash.
    let mut guard: Option<TunGuard> = None;

    enum Input {
        Line(String),
        Tick,
        Closed,
    }
    let (tx, rx) = std::sync::mpsc::channel::<Input>();
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if tx.send(Input::Line(line)).is_err() {
                    return;
                }
            }
            let _ = tx.send(Input::Closed);
        });
    }
    // ponytail: a fixed 5 s poll of `ip`/`wg`, only while a TUN guard with
    // named VPNs exists. Netlink monitoring would be instant but linked.
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if tx.send(Input::Tick).is_err() {
            return;
        }
    });

    for input in rx {
        let line = match input {
            Input::Closed => break,
            Input::Tick => {
                if let Some(g) = guard.as_mut() {
                    refresh_passthrough(g, &out, false);
                }
                continue;
            }
            Input::Line(line) => line,
        };
        if line.trim().is_empty() {
            continue;
        }
        let cmd: Command = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(e) => {
                out.send(&Event::Error {
                    code: "bad_command".into(),
                    msg: e.to_string(),
                });
                continue;
            }
        };
        match cmd {
            Command::Start { profile } => {
                // The tunnel dials this stage's listener, and in TUN the
                // guard permits this stage's upstream; both are about to
                // change. The core stops, the guard follows the new upstream
                // *before* the link needs it, and the GUI restarts the core
                // once the link is back (spec §12.6).
                let had_tunnel = tunnel.is_some();
                if let Some(t) = tunnel.take() {
                    t.stop();
                }
                if let Some(g) = guard.as_mut() {
                    // Held to the TunnelStart bar: this moves the kill
                    // switch's one hole. An invalid profile leaves the old
                    // upstream permitted, and `start` refuses it below.
                    let moved = validate_upstream(&profile.connect_ip, profile.connect_port)
                        .map(|ip| g.allow().retarget(ip, profile.connect_port))
                        .and_then(|next| g.retarget(next));
                    if let Err(e) = moved {
                        out.send(&Event::Log {
                            level: LogLevel::Error,
                            msg: format!("[tunnel] the kill switch could not follow the new profile: {e}"),
                        });
                    }
                }
                if had_tunnel {
                    tunnel_state(&out, "holding", Some("the SNI link is restarting".into()), guard.is_some());
                }
                if let Some(r) = running.take() {
                    r.stop();
                }
                out.send(&Event::State {
                    state: "starting".into(),
                });
                match start(&profile, &out, verbose.clone()) {
                    Ok(r) => {
                        running = Some(r);
                        out.send(&Event::State {
                            state: "running".into(),
                        });
                    }
                    Err((code, msg)) => {
                        out.send(&Event::Error { code, msg });
                        out.send(&Event::State {
                            state: "error".into(),
                        });
                    }
                }
            }
            Command::Stop => {
                let had_tunnel = tunnel.is_some();
                if let Some(t) = tunnel.take() {
                    t.stop();
                }
                if had_tunnel {
                    tunnel_state(&out, "holding", Some("the SNI link is stopped".into()), guard.is_some());
                }
                if let Some(r) = running.take() {
                    r.stop();
                }
                out.send(&Event::Log {
                    level: LogLevel::Info,
                    msg: "proxy stopped".into(),
                });
                out.send(&Event::State {
                    state: "stopped".into(),
                });
            }
            Command::Verbose { on } => verbose.store(on, Ordering::Relaxed),
            Command::Shutdown => break,
            Command::TunnelStart { spec } => {
                // The dependency is enforced here as well as in the UI:
                // this process is the trust boundary, and a tunnel whose
                // outbound has nothing to dial is worse than no tunnel.
                let Some(link) = running.as_ref() else {
                    tunnel_state(&out, "fault", Some("the SNI stage is not running".into()), guard.is_some());
                    continue;
                };
                if let Err(e) = spec_matches_link(&spec, &link.profile) {
                    tunnel_state(&out, "fault", Some(e), guard.is_some());
                    continue;
                }
                // A start while a tunnel runs replaces it: the core goes
                // first, and a guard that is already up stays up across the
                // swap (spec §12.5).
                if let Some(t) = tunnel.take() {
                    t.stop();
                }
                let raised_here = spec.tun.is_some() && guard.is_none();
                if spec.tun.is_some() {
                    if let Err(e) = raise_or_retarget(&mut guard, &spec) {
                        tunnel_state(&out, "fault", Some(e), guard.is_some());
                        continue;
                    }
                } else if let Some(g) = guard.as_mut() {
                    // TUN to a proxy mode: the drop has to go, or the new
                    // mode's traffic has nowhere to leave.
                    if let Err(e) = g.lower() {
                        tunnel_state(&out, "fault", Some(format!("the firewall rules could not be removed: {e}")), true);
                        continue;
                    }
                    guard = None;
                }
                // After the guard, never before it: the GUI deletes its
                // crash marker on an event that says the guard is down.
                tunnel_state(&out, "starting", None, guard.is_some());
                let enforced = guard.as_ref().is_some_and(|g| g.allow().enforce);
                let started = start_tunnel(&spec, &out, verbose.clone(), guard.is_some(), enforced).and_then(|t| {
                    if let Some(g) = guard.as_mut() {
                        if let Err(e) = g.permit_interface(tunpin::INTERFACE_NAME) {
                            t.stop();
                            return Err(format!("the tunnel interface could not be permitted: {e}"));
                        }
                    }
                    Ok(t)
                });
                match started {
                    Ok(t) => {
                        tunnel = Some(t);
                        if let Some(g) = guard.as_mut() {
                            refresh_passthrough(g, &out, true);
                        }
                        tunnel_state(&out, "active", None, guard.is_some());
                    }
                    Err(e) => {
                        // Roll back only what this start raised. A user who
                        // was not protected before pressing Start is not left
                        // offline by a start that never succeeded; one who
                        // was stays protected (spec §12.8).
                        if raised_here {
                            if let Some(g) = guard.as_mut() {
                                if g.lower().is_ok() {
                                    guard = None;
                                }
                            }
                        }
                        tunnel_state(&out, "fault", Some(e), guard.is_some());
                    }
                }
            }
            Command::TunnelStop => {
                if let Some(t) = tunnel.take() {
                    t.stop();
                }
                match guard.as_mut().map(|g| g.lower()) {
                    Some(Err(e)) => {
                        // Still in force, as far as anyone can tell, so the
                        // guard is kept for the next Stop to retry and the
                        // event says so.
                        tunnel_state(&out, "fault", Some(format!("the firewall rules could not be removed: {e}")), true);
                    }
                    _ => {
                        guard = None;
                        tunnel_state(&out, "offline", None, false);
                    }
                }
            }
            Command::TunnelReconcile { link: _ } => {
                // Unused since TUN: a link Start retargets the guard itself,
                // and the GUI restarts the core with a `TunnelStart`
                // (spec §12.5). Kept so an older GUI's line still parses.
                out.send(&Event::Log {
                    level: LogLevel::Debug,
                    msg: "[tunnel] reconcile: handled by link start".into(),
                });
            }
        }
    }

    // Order matters: the tunnel's outbound dials the SNI listener, so
    // tearing the listener down first would give the core a window of
    // failing connections to log noisily about.
    if let Some(t) = tunnel.take() {
        t.stop();
    }
    // A guard still here means no TunnelStop arrived: the GUI went away
    // without saying so. It is deliberately not lowered — `TunGuard` has no
    // `Drop` — so the machine stays closed, and the GUI's marker brings the
    // user to Restore network on the next launch.
    drop(guard);
    if let Some(r) = running.take() {
        r.stop();
    }
}

/// Mirrors `start` for the tunnel: builds the log sink the supervisor
/// writes through, and the exit report, which differs by whether a kill
/// switch is holding the machine.
fn start_tunnel(
    spec: &TunnelSpec,
    out: &Out,
    verbose: Arc<AtomicBool>,
    guarded: bool,
    enforced: bool,
) -> Result<TunnelSupervisor, String> {
    let sink = out.clone();
    let log: LogFn = Arc::new(move |level, msg| {
        if level == LogLevel::Debug && !verbose.load(Ordering::Relaxed) {
            return;
        }
        sink.send(&Event::Log { level, msg });
    });
    let exit_out = out.clone();
    let on_exit: ExitFn = Box::new(move || {
        let detail = if enforced {
            "The core exited. Traffic stays blocked until you stop or restart the tunnel."
        } else {
            "The core exited."
        };
        // `guarded`, not `enforced`: `strict_route` rules can outlive a
        // killed core, so Restore network is still the way out.
        tunnel_state(&exit_out, "fault", Some(detail.into()), guarded);
    });
    TunnelSupervisor::start(spec, log, on_exit)
}

/// Re-discovers coexisting VPNs and reports what changed (or everything,
/// when `force`d).
fn refresh_passthrough(g: &mut TunGuard, out: &Out, force: bool) {
    match g.refresh(force) {
        Ok(Some(items)) => out.send(&Event::Passthrough { items }),
        Ok(None) => {}
        Err(e) => out.send(&Event::Log {
            level: LogLevel::Warn,
            msg: format!("[tunnel] coexisting VPNs: {e}"),
        }),
    }
}

fn raise_or_retarget(guard: &mut Option<TunGuard>, spec: &TunnelSpec) -> Result<(), String> {
    validate_tun(spec)?;
    let allow = Allowlist::from_spec(spec)?;
    if let Some(g) = guard.as_mut() {
        return g
            .retarget(allow)
            .map_err(|e| format!("the kill switch could not be moved: {e}"));
    }
    *guard = Some(
        TunGuard::raise(allow).map_err(|e| format!("the kill switch could not be raised: {e}"))?,
    );
    Ok(())
}

fn start(
    profile: &Profile,
    out: &Out,
    verbose: Arc<AtomicBool>,
) -> Result<Running, (String, String)> {
    validate(profile).map_err(|m| ("invalid_profile".to_string(), m))?;

    let connect_ip: Ipv4Addr = profile.connect_ip.parse().expect("validated above");
    let egress = discover_egress(connect_ip).map_err(|m| ("no_route".to_string(), m))?;

    let out_for_log = out.clone();
    let log: LogFn = Arc::new(move |level, msg| {
        // Per-packet chatter only leaves the process when the user has the
        // Activity section open with Verbose on. Everything else is
        // per-connection and always emitted.
        if level == LogLevel::Debug && !verbose.load(Ordering::Relaxed) {
            return;
        }
        out_for_log.send(&Event::Log { level, msg });
    });

    let cap = capture::open(
        &egress.iface_name,
        egress.iface_index,
        connect_ip.octets(),
        profile.connect_port,
    )
    .map_err(|e| ("capture_open_failed".to_string(), e.to_string()))?;

    let table = Arc::new(PortTable::default());
    let forwarder = Forwarder::start(profile, table.clone(), log.clone())
        .map_err(|m| ("listen_failed".to_string(), m))?;

    log(
        LogLevel::Info,
        format!(
            "listening on {} → {}:{} via {} (fake sni {})",
            forwarder
                .local_addr()
                .map(|a| a.to_string())
                .unwrap_or_else(|_| format!("{}:{}", profile.listen_host, profile.listen_port)),
            profile.connect_ip,
            profile.connect_port,
            egress.iface_name,
            profile.fake_sni
        ),
    );

    let stop = Arc::new(AtomicBool::new(false));
    let sni = profile.fake_sni.clone();
    let local_ip = egress.local_ip;
    let target = connect_ip.octets();
    let connect_port = profile.connect_port;
    let stop_for_thread = stop.clone();
    let sniffer = std::thread::spawn(move || {
        sniffer::run(
            cap,
            table,
            local_ip,
            target,
            connect_port,
            sni,
            stop_for_thread,
            log,
        )
    });

    // One line a second while the stage runs, and nothing at all when it
    // does not. CLAUDE.md records that one event per log line pegged the
    // CPU during a download; this is fixed-rate and does not grow with
    // load. It does not go through the log buffer - that is the log path.
    let counters = forwarder.counters();
    let traffic_stop = Arc::new(AtomicBool::new(false));
    let ticker_stop = traffic_stop.clone();
    let ticker_out = out.clone();
    let traffic = std::thread::spawn(move || {
        let mut tick = 0u64;
        while !ticker_stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(250));
            if ticker_stop.load(Ordering::Relaxed) {
                return;
            }
            // Four 250ms naps rather than one 1s nap, so stopping the stage
            // is not held up for most of a second by a sleeping thread.
            // `tick` is a local, declared above the loop: a `static` would
            // be shared by every run in the process.
            tick += 1;
            if tick % 4 != 0 {
                continue;
            }
            ticker_out.send(&Event::Traffic {
                up: counters.up.load(Ordering::Relaxed),
                down: counters.down.load(Ordering::Relaxed),
            });
        }
    });

    Ok(Running {
        forwarder,
        stop,
        sniffer,
        traffic_stop,
        traffic,
        profile: profile.clone(),
    })
}
