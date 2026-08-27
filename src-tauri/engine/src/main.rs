//! The privileged half of sni-fake.
//!
//! Usage: `sni-fake-engine <socket-path> <token>`
//!
//! Connects back to the socket the unprivileged GUI is listening on, sends
//! the token as its first line, then speaks NDJSON: commands in, events out.
//! It stays alive for the whole GUI session so the user is only asked to
//! authenticate once.

use sni_fake_engine::capture;
use sni_fake_engine::forward::{discover_egress, Forwarder};
use sni_fake_engine::proto::{Command, Event, LogLevel, Profile};
use sni_fake_engine::sniffer::{self, LogFn, PortTable};
use sni_fake_engine::transport::Stream;
use sni_fake_engine::validate::validate;

use std::io::{BufRead, BufReader, Write};
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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

/// One active run. The sniff thread owns the raw capture socket, so stopping
/// means signalling *and* joining it — dropping the handle would leak a
/// thread and a packet socket on every start/stop cycle.
struct Running {
    forwarder: Forwarder,
    stop: Arc<AtomicBool>,
    sniffer: std::thread::JoinHandle<()>,
}

impl Running {
    fn stop(self) {
        // Listener first: no new connections while the sniffer is winding down.
        self.forwarder.stop();
        self.stop.store(true, Ordering::Relaxed);
        // Worst case one capture::RECV_TIMEOUT.
        let _ = self.sniffer.join();
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(endpoint), Some(token)) = (args.next(), args.next()) else {
        eprintln!("usage: sni-fake-engine <endpoint> <token>");
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

    let verbose = Arc::new(AtomicBool::new(false));
    let mut running: Option<Running> = None;

    for line in reader.lines() {
        let Ok(line) = line else { break };
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
        }
    }

    if let Some(r) = running.take() {
        r.stop();
    }
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

    Ok(Running {
        forwarder,
        stop,
        sniffer,
    })
}
