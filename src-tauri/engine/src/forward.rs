//! The user-facing half of the engine: accept clients, dial upstream from
//! the discovered egress address, wait for the sniffer's confirmation, then
//! relay bytes in both directions.

use crate::proto::{LogLevel, Profile};
use crate::sniffer::{LogFn, PortTable};
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// How long to wait for the server's ACK of ISN+1 before giving up. No
/// fallback: without the confirmation the fake probably never landed, and
/// relaying anyway would expose the real SNI to DPI.
pub const CONFIRM_TIMEOUT: Duration = Duration::from_secs(2);

/// How long to wait for the sniffer to register a connection it has not seen
/// the SYN for yet. The dial has already completed by the time we look, so
/// this only covers the scheduling gap between the two threads.
const REGISTER_TIMEOUT: Duration = Duration::from_millis(100);

pub struct Egress {
    pub local_ip: [u8; 4],
    pub iface_name: String,
    pub iface_index: u32,
}

/// Which source address and interface the kernel would use to reach
/// `connect_ip`. `connect` on a UDP socket sends nothing — it just resolves
/// the route.
pub fn discover_egress(connect_ip: Ipv4Addr) -> Result<Egress, String> {
    let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("bind probe socket: {e}"))?;
    sock.connect(SocketAddr::from((connect_ip, 53)))
        .map_err(|e| format!("no route to {connect_ip}: {e}"))?;
    let local = match sock.local_addr().map_err(|e| e.to_string())? {
        SocketAddr::V4(a) => *a.ip(),
        SocketAddr::V6(_) => return Err("egress address is IPv6, which is unsupported".into()),
    };

    let addrs = nix::ifaddrs::getifaddrs().map_err(|e| format!("getifaddrs: {e}"))?;
    for ifaddr in addrs {
        let Some(storage) = ifaddr.address else {
            continue;
        };
        let Some(sin) = storage.as_sockaddr_in() else {
            continue;
        };
        if Ipv4Addr::from(sin.ip()) != local {
            continue;
        }
        let name = ifaddr.interface_name.clone();
        let cname = std::ffi::CString::new(name.clone()).map_err(|e| e.to_string())?;
        // SAFETY: cname is a valid NUL-terminated C string that outlives the call.
        let index = unsafe { libc::if_nametoindex(cname.as_ptr()) };
        if index == 0 {
            return Err(format!("if_nametoindex({name}) failed"));
        }
        return Ok(Egress {
            local_ip: local.octets(),
            iface_name: name,
            iface_index: index,
        });
    }
    Err(format!("no interface holds the egress address {local}"))
}

pub struct Forwarder {
    listener: TcpListener,
    running: Arc<AtomicBool>,
}

impl Forwarder {
    /// Binds the listener synchronously — a port clash is reported here, not
    /// swallowed on a background thread — then serves it until [`stop`].
    ///
    /// [`stop`]: Forwarder::stop
    pub fn start(
        profile: &Profile,
        table: Arc<PortTable>,
        log: LogFn,
    ) -> Result<Forwarder, String> {
        let bind = format!("{}:{}", profile.listen_host, profile.listen_port);
        let listener = TcpListener::bind(&bind).map_err(|e| format!("listen on {bind}: {e}"))?;
        let upstream = SocketAddr::from((
            profile
                .connect_ip
                .parse::<Ipv4Addr>()
                .map_err(|e| format!("CONNECT_IP {}: {e}", profile.connect_ip))?,
            profile.connect_port,
        ));

        let running = Arc::new(AtomicBool::new(true));
        let accept_listener = listener.try_clone().map_err(|e| e.to_string())?;
        let flag = running.clone();
        std::thread::spawn(move || {
            for stream in accept_listener.incoming() {
                if !flag.load(Ordering::Relaxed) {
                    return;
                }
                let client = match stream {
                    Ok(s) => s,
                    Err(e) => {
                        log(LogLevel::Warn, format!("accept failed: {e}"));
                        continue;
                    }
                };
                let table = table.clone();
                let log = log.clone();
                std::thread::spawn(move || {
                    if let Err(e) = handle(client, upstream, table, &log) {
                        log(LogLevel::Warn, e);
                    }
                });
            }
        });

        Ok(Forwarder { listener, running })
    }

    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.listener.local_addr()
    }

    /// Clears the run flag and wakes the blocked `accept(2)` with one throwaway
    /// connection. In-flight relays are left to finish on their own threads.
    pub fn stop(self) {
        self.running.store(false, Ordering::Relaxed);
        if let Ok(addr) = self.listener.local_addr() {
            let _ = TcpStream::connect_timeout(&poke_addr(addr), Duration::from_millis(200));
        }
        drop(self.listener);
    }
}

/// A wildcard bind answers on the loopback address, but connecting *to* the
/// wildcard is not portable — rewrite it before poking ourselves.
fn poke_addr(mut addr: SocketAddr) -> SocketAddr {
    if addr.ip().is_unspecified() {
        addr.set_ip(match addr {
            SocketAddr::V4(_) => IpAddr::V4(Ipv4Addr::LOCALHOST),
            SocketAddr::V6(_) => IpAddr::V6(std::net::Ipv6Addr::LOCALHOST),
        });
    }
    addr
}

/// Every message here is keyed on the local ephemeral port, because that is
/// the only identifier the sniffer also has — the two log streams interleave
/// per connection.
fn handle(
    client: TcpStream,
    upstream: SocketAddr,
    table: Arc<PortTable>,
    log: &LogFn,
) -> Result<(), String> {
    let server = TcpStream::connect_timeout(&upstream, Duration::from_secs(5))
        .map_err(|e| format!("dial {upstream}: {e}"))?;
    let port = server.local_addr().map_err(|e| e.to_string())?.port();
    log(LogLevel::Info, format!("conn #{port}  → {upstream}"));

    // The sniffer is the only other owner of this entry and it never evicts;
    // dropping the guard is what keeps the table from growing without bound,
    // on the error paths as much as the clean one. (A dial that fails outright
    // leaves nothing to clean: its port is unknown to us, and the next
    // connection to reuse it overwrites the stale entry.)
    struct Cleanup(Arc<PortTable>, u16);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            self.0.remove(self.1);
        }
    }
    let _cleanup = Cleanup(table.clone(), port);

    // The sniffer registers the port when it sees our SYN, which may not have
    // been scheduled yet. Poll briefly, exactly as the Go version does.
    let deadline = std::time::Instant::now() + REGISTER_TIMEOUT;
    let gate = loop {
        if let Some(g) = table.waiter(port) {
            break g;
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "conn #{port}  sniffer never saw this connection, aborting"
            ));
        }
        std::thread::sleep(Duration::from_millis(1));
    };

    if !gate.wait(CONFIRM_TIMEOUT) {
        return Err(format!(
            "conn #{port}  timeout waiting for the server to ack ISN+1, aborting"
        ));
    }

    let up = server.try_clone().map_err(|e| e.to_string())?;
    let down = client.try_clone().map_err(|e| e.to_string())?;
    let t = std::thread::spawn(move || pipe(down, up));
    pipe(server, client);
    let _ = t.join();
    log(LogLevel::Info, format!("conn #{port}  closed"));
    Ok(())
}

/// Copies until EOF, then half-closes both ends so the peer thread unblocks.
fn pipe(mut from: TcpStream, mut to: TcpStream) {
    let _ = io::copy(&mut from, &mut to);
    let _ = from.shutdown(std::net::Shutdown::Read);
    let _ = to.shutdown(std::net::Shutdown::Write);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::Ipv4Addr;

    #[test]
    fn discovers_a_route_to_a_public_address() {
        // No packets are sent: connect(2) on a UDP socket only consults the
        // routing table. Skipped when the host has no default route.
        let Ok(egress) = discover_egress(Ipv4Addr::new(104, 18, 4, 130)) else {
            eprintln!("no default route on this host, skipping");
            return;
        };
        assert_ne!(egress.local_ip, [0, 0, 0, 0]);
        assert!(!egress.iface_name.is_empty());
        assert!(egress.iface_index > 0);
    }

    #[test]
    fn confirm_timeout_matches_the_original_implementation() {
        assert_eq!(CONFIRM_TIMEOUT, Duration::from_secs(2));
    }

    fn silent_log() -> LogFn {
        Arc::new(|_, _| {})
    }

    fn profile_for(upstream: SocketAddr) -> Profile {
        Profile {
            id: "t".into(),
            name: "t".into(),
            listen_host: "127.0.0.1".into(),
            listen_port: 0,
            connect_ip: upstream.ip().to_string(),
            connect_port: upstream.port(),
            fake_sni: "example.com".into(),
        }
    }

    /// Accepts one connection and echoes every byte back. Returns the port the
    /// forwarder dialled from, which is the key the sniffer would register.
    fn spawn_echo_upstream() -> (SocketAddr, std::sync::mpsc::Receiver<u16>) {
        let up = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = up.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut sock, peer) = up.accept().unwrap();
            tx.send(peer.port()).unwrap();
            let mut buf = [0u8; 64];
            while let Ok(n) = sock.read(&mut buf) {
                if n == 0 || sock.write_all(&buf[..n]).is_err() {
                    return;
                }
            }
        });
        (addr, rx)
    }

    #[test]
    fn relays_only_after_the_gate_opens() {
        let (upstream, port_rx) = spawn_echo_upstream();
        let table = Arc::new(PortTable::default());
        let fwd = Forwarder::start(&profile_for(upstream), table.clone(), silent_log()).unwrap();
        let listen = fwd.local_addr().unwrap();

        let mut client = TcpStream::connect(listen).unwrap();
        // Stand in for the sniffer: the upstream tells us which local port our
        // dial used, which is exactly what classify() reads off our SYN.
        let port = port_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        table.register(port, 7, vec![0xde]);
        table.take_for_injection(port).unwrap();
        assert!(table.confirm(port, 8), "ISN+1 must open the gate");

        client.write_all(b"ping").unwrap();
        let mut buf = [0u8; 4];
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        client.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"ping");

        drop(client);
        fwd.stop();
        // The relay threads unwind on their own schedule; the guarantee under
        // test is that the entry goes away, not when.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while table.waiter(port).is_some() {
            assert!(
                std::time::Instant::now() < deadline,
                "the entry was never evicted"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn drops_the_client_when_the_sniffer_never_registers() {
        let (upstream, _port_rx) = spawn_echo_upstream();
        let table = Arc::new(PortTable::default());
        let fwd = Forwarder::start(&profile_for(upstream), table.clone(), silent_log()).unwrap();

        let mut client = TcpStream::connect(fwd.local_addr().unwrap()).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut buf = [0u8; 1];
        // Nothing was ever registered, so handle() bails and drops both ends.
        assert_eq!(client.read(&mut buf).unwrap(), 0, "expected EOF, not relay");
        fwd.stop();
    }
}
