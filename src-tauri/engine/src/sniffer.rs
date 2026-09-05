//! Watches every TCP packet between us and the upstream, injects the fake
//! ClientHello the instant our own third-handshake ACK goes out, and
//! releases the forwarder once the server proves it ignored the fake.
//!
//! `classify` is deliberately a pure function: the interesting logic is
//! testable without a raw socket or root.

use crate::capture::{Capture, Captured};
use crate::hello::build_client_hello;
use crate::netpkt::{build_fake_packet, parse_ipv4_tcp, TcpView, ACK, FIN, RST, SYN};
use crate::proto::LogLevel;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

pub type LogFn = Arc<dyn Fn(LogLevel, String) + Send + Sync>;

#[derive(Debug, PartialEq)]
pub enum Action {
    Ignore,
    /// Our outbound SYN: a new connection begins, `isn` is its ISN.
    NewConnection { port: u16, isn: u32 },
    /// Our outbound third-handshake ACK: inject now.
    InjectFake { port: u16 },
    /// An inbound bare ACK that may prove the fake was ignored.
    ConfirmFake { port: u16, ack: u32 },
}

/// The upstream is matched as an **address and a port**, not an address alone:
/// any other process on this host talking to the same server would otherwise
/// be registered in the port table and — worse — have a spoofed segment
/// injected into its connection by a process running as root.
pub fn classify(
    v: &TcpView,
    local_ip: [u8; 4],
    connect_ip: [u8; 4],
    connect_port: u16,
) -> Action {
    let outbound = v.src_ip == local_ip && v.dst_ip == connect_ip && v.dst_port == connect_port;
    let inbound = v.src_ip == connect_ip && v.dst_ip == local_ip && v.src_port == connect_port;
    let bare_ack = v.flags & ACK != 0 && v.flags & (SYN | FIN | RST) == 0 && v.payload_len == 0;

    if outbound {
        if v.flags & SYN != 0 && v.flags & ACK == 0 {
            return Action::NewConnection {
                port: v.src_port,
                isn: v.seq,
            };
        }
        if bare_ack {
            return Action::InjectFake { port: v.src_port };
        }
    }
    if inbound && bare_ack {
        return Action::ConfirmFake {
            port: v.dst_port,
            ack: v.ack,
        };
    }
    Action::Ignore
}

/// A one-shot latch. Replaces the Go version's `chan struct{}` — the
/// forwarder blocks on it, the sniffer opens it.
#[derive(Default)]
pub struct Gate {
    open: Mutex<bool>,
    cv: Condvar,
}

impl Gate {
    pub fn open(&self) {
        let mut g = self.open.lock().unwrap();
        *g = true;
        self.cv.notify_all();
    }

    /// Returns true if the gate opened within `timeout`.
    pub fn wait(&self, timeout: Duration) -> bool {
        let g = self.open.lock().unwrap();
        let (g, _) = self
            .cv
            .wait_timeout_while(g, timeout, |open| !*open)
            .unwrap();
        *g
    }
}

struct PortState {
    isn: u32,
    fake: Option<Vec<u8>>,
    fake_sent: bool,
    gate: Arc<Gate>,
}

#[derive(Default)]
pub struct PortTable {
    inner: Mutex<HashMap<u16, PortState>>,
}

impl PortTable {
    pub fn register(&self, port: u16, isn: u32, fake: Vec<u8>) {
        self.inner.lock().unwrap().insert(
            port,
            PortState {
                isn,
                fake: Some(fake),
                fake_sent: false,
                gate: Arc::new(Gate::default()),
            },
        );
    }

    /// Hands the fake payload out exactly once per connection, together with
    /// the ISN it must be sequenced against.
    pub fn take_for_injection(&self, port: u16) -> Option<(u32, Vec<u8>)> {
        let mut map = self.inner.lock().unwrap();
        let st = map.get_mut(&port)?;
        if st.fake_sent {
            return None;
        }
        let fake = st.fake.take()?;
        st.fake_sent = true;
        Some((st.isn, fake))
    }

    /// True when this ACK proves the server ignored the fake and is still
    /// expecting the real byte stream. Opens the gate as a side effect.
    pub fn confirm(&self, port: u16, ack: u32) -> bool {
        let map = self.inner.lock().unwrap();
        let Some(st) = map.get(&port) else {
            return false;
        };
        if !st.fake_sent || ack != st.isn.wrapping_add(1) {
            return false;
        }
        st.gate.open();
        true
    }

    pub fn waiter(&self, port: u16) -> Option<Arc<Gate>> {
        Some(self.inner.lock().unwrap().get(&port)?.gate.clone())
    }

    pub fn remove(&self, port: u16) {
        self.inner.lock().unwrap().remove(&port);
    }
}

/// How long the fake must trail the real ACK that triggered it. The Go
/// original sleeps the same millisecond, for the same reason: a packet socket
/// sees an outbound frame before the driver transmits it, so injecting the
/// instant we see the ACK risks the two crossing on the wire.
const INJECT_DELAY: Duration = Duration::from_millis(1);

/// One fake ClientHello, built and waiting out [`INJECT_DELAY`].
struct Injection {
    port: u16,
    /// When the packet may go out — measured from the moment the ACK was
    /// *classified*, so the wait is not extended by the work of building it.
    due: Instant,
    packet: Captured,
}

/// Puts injections on the wire.
///
/// The delay is the whole reason this exists: waiting it out on the sniff
/// thread stops classification for every other connection, so a page opening
/// thirty connections at once pushes the last one's confirmation back by
/// thirty milliseconds. When the backend can hand out a transmit-only handle
/// ([`Capture::split_sender`]) the wait and the send move to a thread of their
/// own; otherwise this is the original inline path, unchanged.
enum Injector {
    OffThread {
        tx: mpsc::Sender<Injection>,
        thread: std::thread::JoinHandle<()>,
    },
    Inline,
}

impl Injector {
    fn start(sender: Option<Box<dyn Capture>>, sni: String, log: LogFn) -> Injector {
        let Some(mut cap) = sender else {
            return Injector::Inline;
        };
        let (tx, rx) = mpsc::channel::<Injection>();
        let thread = std::thread::spawn(move || {
            // Ends when the sniff loop drops its sender, after any queued
            // injection has gone out.
            for job in rx {
                send_fake(&mut *cap, job, &sni, &log);
            }
        });
        Injector::OffThread { tx, thread }
    }

    /// `cap` is the sniff loop's own handle and is touched only by the inline
    /// path — the off-thread path never borrows it, which is what keeps the
    /// loop free to go back to `recv`.
    fn submit(&self, cap: &mut dyn Capture, job: Injection, sni: &str, log: &LogFn) {
        match self {
            // A closed channel would mean the injector thread panicked; the
            // connection then times out on its own, as it does for any other
            // injection failure.
            Injector::OffThread { tx, .. } => {
                let _ = tx.send(job);
            }
            Injector::Inline => send_fake(cap, job, sni, log),
        }
    }

    /// Waits for the queue to drain, so the run's extra descriptor is closed
    /// and no injection outlives the capture handle it was built from.
    fn finish(self) {
        if let Injector::OffThread { tx, thread } = self {
            drop(tx);
            let _ = thread.join();
        }
    }
}

fn send_fake(cap: &mut dyn Capture, job: Injection, sni: &str, log: &LogFn) {
    let wait = job.due.saturating_duration_since(Instant::now());
    if !wait.is_zero() {
        std::thread::sleep(wait);
    }
    let port = job.port;
    match cap.send(&job.packet) {
        Ok(()) => log(
            LogLevel::Info,
            format!("conn #{port}  fake ClientHello injected (sni={sni})"),
        ),
        Err(e) => log(
            LogLevel::Error,
            format!("conn #{port}  injection failed: {e}"),
        ),
    }
}

/// Blocking sniff loop. Owns the capture handle for the life of a run and
/// returns once `stop` is set — the caller must keep the `JoinHandle` and
/// join it, or the thread outlives the run and keeps the capture socket.
///
/// `Capture::recv` is bounded by one read plus one
/// [`RECV_TIMEOUT`](crate::capture::RECV_TIMEOUT), which is the only reason
/// this loop is cancellable at all; that interval is also the worst-case
/// latency between a stop request and this function returning.
pub fn run(
    mut cap: Box<dyn Capture>,
    table: Arc<PortTable>,
    local_ip: [u8; 4],
    connect_ip: [u8; 4],
    connect_port: u16,
    sni: String,
    stop: Arc<AtomicBool>,
    log: LogFn,
) {
    let injector = Injector::start(cap.split_sender(), sni.clone(), log.clone());
    let mut pkt = Captured::default();
    while !stop.load(Ordering::Relaxed) {
        // Ok(false) is a timeout *or* a frame the backend filtered out. Both
        // just mean "nothing to classify"; neither says the link is idle.
        match cap.recv(&mut pkt) {
            Ok(true) => {}
            Ok(false) => continue,
            Err(e) => {
                log(LogLevel::Error, format!("capture read failed: {e}"));
                break;
            }
        }
        let Some(view) = parse_ipv4_tcp(&pkt.ip) else {
            continue;
        };
        let action = classify(&view, local_ip, connect_ip, connect_port);
        if matches!(action, Action::Ignore) {
            continue;
        }
        log(LogLevel::Debug, format!("{action:?}"));

        match action {
            Action::NewConnection { port, isn } => match build_client_hello(&sni) {
                Ok(fake) => table.register(port, isn, fake),
                Err(e) => log(LogLevel::Error, format!("conn #{port}  {e}")),
            },
            Action::InjectFake { port } => {
                // Taken before anything else can fail: the delay is counted
                // from the ACK, not from the end of the work below.
                let due = Instant::now() + INJECT_DELAY;
                let Some((isn, fake)) = table.take_for_injection(port) else {
                    continue;
                };
                // A template we cannot build from is not recoverable for this
                // connection: the fake is already spent, so the gate will never
                // open and the forwarder will time out. Say so loudly rather
                // than unwrapping — this process runs as root on wire bytes.
                let Some(ip) = build_fake_packet(&pkt.ip, isn, &fake) else {
                    log(
                        LogLevel::Error,
                        format!("conn #{port}  malformed ACK template, not injecting"),
                    );
                    continue;
                };
                let packet = Captured {
                    l2: pkt.l2,
                    ip,
                    #[cfg(windows)]
                    addr: pkt.addr,
                };
                injector.submit(&mut *cap, Injection { port, due, packet }, &sni, &log);
            }
            Action::ConfirmFake { port, ack } => {
                if table.confirm(port, ack) {
                    log(LogLevel::Info, format!("conn #{port}  confirmed, relaying"));
                }
            }
            Action::Ignore => unreachable!("filtered above"),
        }
    }
    injector.finish();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netpkt::{parse_ipv4_tcp, ACK, PSH, SYN};
    use std::time::Duration;

    const LOCAL: [u8; 4] = [192, 168, 1, 10];
    const REMOTE: [u8; 4] = [104, 18, 4, 130];

    fn packet(
        src: [u8; 4],
        dst: [u8; 4],
        sport: u16,
        dport: u16,
        seq: u32,
        ack: u32,
        flags: u8,
        payload: usize,
    ) -> Vec<u8> {
        let mut p = vec![0u8; 40 + payload];
        p[0] = 0x45;
        p[2..4].copy_from_slice(&((40 + payload) as u16).to_be_bytes());
        p[9] = 6;
        p[12..16].copy_from_slice(&src);
        p[16..20].copy_from_slice(&dst);
        p[20..22].copy_from_slice(&sport.to_be_bytes());
        p[22..24].copy_from_slice(&dport.to_be_bytes());
        p[24..28].copy_from_slice(&seq.to_be_bytes());
        p[28..32].copy_from_slice(&ack.to_be_bytes());
        p[32] = 5 << 4;
        p[33] = flags;
        p
    }

    #[test]
    fn outbound_syn_opens_a_connection() {
        let p = packet(LOCAL, REMOTE, 51000, 443, 900, 0, SYN, 0);
        let v = parse_ipv4_tcp(&p).unwrap();
        assert!(matches!(
            classify(&v, LOCAL, REMOTE, 443),
            Action::NewConnection {
                port: 51000,
                isn: 900
            }
        ));
    }

    #[test]
    fn outbound_bare_ack_triggers_injection() {
        let p = packet(LOCAL, REMOTE, 51000, 443, 901, 5, ACK, 0);
        let v = parse_ipv4_tcp(&p).unwrap();
        assert!(matches!(
            classify(&v, LOCAL, REMOTE, 443),
            Action::InjectFake { port: 51000 }
        ));
    }

    #[test]
    fn outbound_ack_with_payload_is_not_the_handshake_ack() {
        let p = packet(LOCAL, REMOTE, 51000, 443, 901, 5, ACK | PSH, 12);
        let v = parse_ipv4_tcp(&p).unwrap();
        assert!(matches!(classify(&v, LOCAL, REMOTE, 443), Action::Ignore));
    }

    #[test]
    fn inbound_bare_ack_is_a_confirmation_candidate() {
        let p = packet(REMOTE, LOCAL, 443, 51000, 5, 901, ACK, 0);
        let v = parse_ipv4_tcp(&p).unwrap();
        assert!(matches!(
            classify(&v, LOCAL, REMOTE, 443),
            Action::ConfirmFake {
                port: 51000,
                ack: 901
            }
        ));
    }

    #[test]
    fn traffic_to_an_unrelated_host_is_ignored() {
        let p = packet(LOCAL, [1, 1, 1, 1], 51000, 443, 900, 0, SYN, 0);
        let v = parse_ipv4_tcp(&p).unwrap();
        assert!(matches!(classify(&v, LOCAL, REMOTE, 443), Action::Ignore));
    }

    #[test]
    fn table_hands_out_the_fake_exactly_once() {
        let t = PortTable::default();
        t.register(51000, 900, vec![0xAA; 517]);
        assert!(t.take_for_injection(51000).is_some());
        assert!(
            t.take_for_injection(51000).is_none(),
            "injection must not repeat"
        );
    }

    #[test]
    fn confirmation_requires_the_fake_to_have_been_sent_and_the_right_ack() {
        let t = PortTable::default();
        t.register(51000, 900, vec![0xAA; 517]);
        assert!(!t.confirm(51000, 901), "not confirmed before the fake is sent");
        t.take_for_injection(51000);
        assert!(!t.confirm(51000, 12345), "wrong ack number must not confirm");
        assert!(t.confirm(51000, 901), "ack == isn + 1 confirms");
    }

    #[test]
    fn gate_times_out_when_never_opened() {
        let t = PortTable::default();
        t.register(51000, 900, vec![0xAA; 517]);
        let gate = t.waiter(51000).unwrap();
        assert!(!gate.wait(Duration::from_millis(30)));
    }

    #[test]
    fn gate_releases_once_confirmed() {
        let t = PortTable::default();
        t.register(51000, 900, vec![0xAA; 517]);
        t.take_for_injection(51000);
        let gate = t.waiter(51000).unwrap();
        t.confirm(51000, 901);
        assert!(gate.wait(Duration::from_millis(30)));
    }

    /// The sniff loop is the one thread that would otherwise outlive a run and
    /// keep the capture socket open, so its exit path is worth a check.
    /// `Ok(false)` (timeout or filtered frame) must not be mistaken for an end
    /// of stream, and the stop flag must still be honoured through it.
    struct Idle {
        calls: Arc<std::sync::atomic::AtomicU32>,
        stop: Arc<std::sync::atomic::AtomicBool>,
    }

    impl crate::capture::Capture for Idle {
        fn recv(&mut self, _out: &mut Captured) -> std::io::Result<bool> {
            let n = self.calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if n == 3 {
                self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            Ok(false)
        }
        fn send(&mut self, _pkt: &Captured) -> std::io::Result<()> {
            unreachable!("nothing was ever classified")
        }
    }

    #[test]
    fn sniff_loop_returns_when_stopped() {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let calls = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let cap = Box::new(Idle {
            calls: calls.clone(),
            stop: stop.clone(),
        });
        run(
            cap,
            Arc::new(PortTable::default()),
            LOCAL,
            REMOTE,
            443,
            "example.com".into(),
            stop,
            Arc::new(|_, _| {}),
        );
        // Exactly three: fewer means an Ok(false) ended the loop, more means
        // the stop flag was not honoured. Termination alone proves neither.
        assert_eq!(
            calls.load(std::sync::atomic::Ordering::Relaxed),
            3,
            "Ok(false) must not end the loop, and stop must end it at once"
        );
    }

    #[test]
    fn the_upstream_port_must_match_in_both_directions() {
        // Another process on this host talking to the same server on a
        // different port is none of our business — registering it would leak a
        // table entry, and injecting into it would corrupt someone else's TCP
        // stream from a root process.
        let out = packet(LOCAL, REMOTE, 51000, 8443, 900, 0, SYN, 0);
        let v = parse_ipv4_tcp(&out).unwrap();
        assert!(matches!(classify(&v, LOCAL, REMOTE, 443), Action::Ignore));

        let out_ack = packet(LOCAL, REMOTE, 51000, 8443, 901, 5, ACK, 0);
        let v = parse_ipv4_tcp(&out_ack).unwrap();
        assert!(matches!(classify(&v, LOCAL, REMOTE, 443), Action::Ignore));

        let inb = packet(REMOTE, LOCAL, 8443, 51000, 5, 901, ACK, 0);
        let v = parse_ipv4_tcp(&inb).unwrap();
        assert!(matches!(classify(&v, LOCAL, REMOTE, 443), Action::Ignore));
    }
}
