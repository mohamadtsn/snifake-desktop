//! Running the sing-box core, from inside the privileged half.
//!
//! Two rules shape this module.
//!
//! First, it never parses the configuration. It receives finished JSON,
//! writes it, and runs it; how to tell the core is up arrives as an
//! explicit `ReadyProbe` rather than being inferred from the config or
//! matched against a log line, because a core upgrade that rewords its
//! startup message must not silently break readiness detection.
//!
//! Second, it does not trust the path it is given. The core lives in a
//! user-writable directory and the path arrives from an unprivileged
//! process; executing it unchecked would turn this helper into a
//! user-to-root escalation. `verify_core` compares the file against a
//! digest compiled into this binary before anything is executed.

use crate::corepin;
use crate::proto::{LogLevel, ReadyProbe, TunnelSpec};
use crate::sniffer::LogFn;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader};
// Only the unix branch of `write_config` needs it: the windows branch uses
// `fs::write`, which takes the bytes rather than a handle.
#[cfg(unix)]
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// How long to wait for the core to come up before giving up on it.
const READY_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a stopped core gets to exit on its own before it is killed.
const EXIT_GRACE: Duration = Duration::from_secs(5);

pub struct TunnelSupervisor {
    child: Child,
    config_path: PathBuf,
}

impl TunnelSupervisor {
    pub fn start(spec: &TunnelSpec, log: LogFn) -> Result<TunnelSupervisor, String> {
        let core = Path::new(&spec.core_path);
        verify_core(core)?;

        let dir = std::env::temp_dir();
        let config_path = write_config(&spec.config, &dir)?;

        let mut command = Command::new(core);
        command
            .arg("run")
            .arg("-c")
            .arg(&config_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Its own process group, so stopping can signal the whole tree
        // rather than orphaning anything the core spawned.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let mut child = command.spawn().map_err(|e| {
            let _ = std::fs::remove_file(&config_path);
            format!("could not start the core: {e}")
        })?;

        pump(child.stdout.take(), log.clone(), LogLevel::Info);
        pump(child.stderr.take(), log.clone(), LogLevel::Warn);

        if let Err(e) = wait_ready(&spec.ready_probe, READY_TIMEOUT) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&config_path);
            return Err(e);
        }

        Ok(TunnelSupervisor { child, config_path })
    }

    /// Teardown never gives up half way: every step runs even if an
    /// earlier one failed, because a skipped step leaves system state
    /// behind that nothing else will clean up.
    pub fn stop(mut self) {
        #[cfg(unix)]
        {
            // SAFETY: signalling a process group we created.
            unsafe {
                libc::killpg(self.child.id() as i32, libc::SIGTERM);
            }
        }
        #[cfg(windows)]
        let _ = self.child.kill();

        let deadline = Instant::now() + EXIT_GRACE;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() > deadline => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let _ = std::fs::remove_file(&self.config_path);
    }
}

/// The trust boundary for the core binary. See the module comment.
pub fn verify_core(path: &Path) -> Result<(), String> {
    let expected = corepin::binary_sha256()
        .ok_or_else(|| format!("no pinned core digest for {}", corepin::target()))?;
    let bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        return Err(format!(
            "core checksum mismatch at {} — refusing to execute it",
            path.display()
        ));
    }
    Ok(())
}

/// Writes the configuration into `dir` with owner-only permissions. It
/// carries a credential, and this process runs as root, so a world-
/// readable file would be handing it out.
pub fn write_config(config: &Value, dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join(format!("snifake-tunnel-{}.json", std::process::id()));
    let body = serde_json::to_string(config).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("create {}: {e}", path.display()))?;
        file.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        // A file under the elevated process's temp directory is already
        // inaccessible to unprivileged users.
        std::fs::write(&path, body.as_bytes())
            .map_err(|e| format!("create {}: {e}", path.display()))?;
    }

    Ok(path)
}

pub fn wait_ready(probe: &ReadyProbe, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if ready(probe) {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err(match probe {
                ReadyProbe::TcpAccept { host, port } => {
                    format!("the core did not become ready on {host}:{port}")
                }
                ReadyProbe::Interface { name } => {
                    format!("the core did not become ready: interface {name} never appeared")
                }
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn ready(probe: &ReadyProbe) -> bool {
    match probe {
        ReadyProbe::TcpAccept { host, port } => {
            TcpStream::connect((host.as_str(), *port)).is_ok()
        }
        #[cfg(unix)]
        ReadyProbe::Interface { name } => match std::ffi::CString::new(name.as_str()) {
            // SAFETY: a valid NUL-terminated C string that outlives the call.
            // Parenthesised deliberately: in a match arm a bare `unsafe {}`
            // is parsed as a statement, and the `!= 0` would be left
            // dangling as a pattern.
            Ok(c) => (unsafe { libc::if_nametoindex(c.as_ptr()) }) != 0,
            Err(_) => false,
        },
        #[cfg(windows)]
        ReadyProbe::Interface { .. } => false,
    }
}

/// One thread per stream, each line prefixed so `Activity` can show both
/// stages interleaved and still say which is which.
fn pump<R: std::io::Read + Send + 'static>(
    stream: Option<R>,
    log: LogFn,
    level: LogLevel,
) {
    let Some(stream) = stream else { return };
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            log(level, format!("[tunnel] {line}"));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::time::Duration;

    fn tempdir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "snifake-tunnel-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_core_whose_hash_does_not_match_the_compiled_pin_is_refused() {
        // The whole point: the path came from an unprivileged process, and
        // this check is what stops it being an instruction to run anything.
        let dir = tempdir();
        let fake = dir.join("sing-box");
        std::fs::write(&fake, b"not the core").unwrap();
        let err = verify_core(&fake).unwrap_err();
        assert!(err.to_lowercase().contains("checksum"), "{err}");
    }

    #[test]
    fn a_core_that_is_not_there_is_refused_without_panicking() {
        let err = verify_core(std::path::Path::new("/nonexistent/sing-box")).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn the_config_is_written_where_it_was_asked_and_is_valid_json() {
        let dir = tempdir();
        let cfg = serde_json::json!({ "log": { "level": "warn" } });
        let path = write_config(&cfg, &dir).unwrap();
        assert!(path.starts_with(&dir));
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[cfg(unix)]
    #[test]
    fn the_written_config_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir();
        let path = write_config(&serde_json::json!({}), &dir).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "mode was {mode:o}");
    }

    #[test]
    fn a_tcp_probe_succeeds_as_soon_as_something_is_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let probe = ReadyProbe::TcpAccept {
            host: "127.0.0.1".into(),
            port,
        };
        assert!(wait_ready(&probe, Duration::from_secs(2)).is_ok());
    }

    #[test]
    fn a_tcp_probe_times_out_when_nothing_ever_listens() {
        // Bind then drop, so the port is almost certainly free.
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let probe = ReadyProbe::TcpAccept {
            host: "127.0.0.1".into(),
            port,
        };
        let started = std::time::Instant::now();
        let err = wait_ready(&probe, Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("did not become ready"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3), "it must give up promptly");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn an_interface_probe_finds_loopback_and_gives_up_on_a_name_that_cannot_exist() {
        let ok = ReadyProbe::Interface { name: "lo".into() };
        assert!(wait_ready(&ok, Duration::from_secs(1)).is_ok());
        let nope = ReadyProbe::Interface {
            name: "snifake-nope0".into(),
        };
        assert!(wait_ready(&nope, Duration::from_millis(200)).is_err());
    }

    /// The one test that exercises the whole supervisor against the real
    /// core: verify, write, spawn, probe, stop. Ignored by default because
    /// it needs an installed core, which is not in the repo:
    ///
    /// ```text
    /// SINGBOX_CORE=~/.config/snifake/cores/sing-box-1.13.21/sing-box \
    ///   cargo test -p snifake-engine --lib -- --ignored supervises_the_real_core
    /// ```
    ///
    /// Everything below it is unit-tested in isolation; this is what proves
    /// the pieces are wired to each other and that a probe-based readiness
    /// signal actually fires against sing-box rather than against a mock.
    #[test]
    #[ignore]
    fn supervises_the_real_core_from_start_to_stop() {
        let Ok(core) = std::env::var("SINGBOX_CORE") else {
            panic!("set SINGBOX_CORE to an installed, pinned sing-box binary");
        };

        // A free port, released before the core is told to bind it.
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };

        // Deliberately self-contained: a mixed inbound and a direct
        // outbound need no SNI stage and no network to come up.
        let spec = TunnelSpec {
            config: serde_json::json!({
                "log": { "level": "warn", "timestamp": false },
                "inbounds": [{
                    "type": "mixed", "tag": "in",
                    "listen": "127.0.0.1", "listen_port": port
                }],
                "outbounds": [{ "type": "direct", "tag": "direct" }],
                "route": { "final": "direct" }
            }),
            core_path: core,
            ready_probe: ReadyProbe::TcpAccept {
                host: "127.0.0.1".into(),
                port,
            },
            connect_ip: "127.0.0.1".into(),
            connect_port: 443,
            listen_host: "127.0.0.1".into(),
        };

        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let sink = lines.clone();
        let log: LogFn =
            std::sync::Arc::new(move |_lvl, msg| sink.lock().unwrap().push(msg));

        let sup = TunnelSupervisor::start(&spec, log).expect("the core should come up");
        // Readiness returning means the port really accepts.
        TcpStream::connect(("127.0.0.1", port)).expect("the proxy port must accept");

        sup.stop();

        // And it must actually be gone, not merely signalled.
        std::thread::sleep(Duration::from_millis(300));
        assert!(
            TcpStream::connect_timeout(
                &format!("127.0.0.1:{port}").parse().unwrap(),
                Duration::from_millis(300)
            )
            .is_err(),
            "the core is still listening after stop"
        );
    }

}
