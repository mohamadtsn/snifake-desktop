//! The GUI↔engine channel: a unix domain socket on Unix, a named pipe on
//! Windows. Both are local-only, both are access-controlled to the creating
//! user, and both carry the same NDJSON.
//!
//! Windows needs its own object rather than stdio because launching an
//! elevated child from a non-elevated parent goes through ShellExecuteEx,
//! which cannot redirect standard handles. macOS needs it too, because
//! `osascript ... with administrator privileges` buffers a child's output
//! until the child exits — which would mean no live logs at all.

use std::io::{self, Read, Write};
use std::time::Duration;

pub struct Endpoint(String);

impl Endpoint {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(unix)]
mod imp {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use std::time::Instant;

    fn socket_dir() -> PathBuf {
        std::env::temp_dir()
    }

    pub struct Listener {
        inner: UnixListener,
        endpoint: Endpoint,
    }

    #[derive(Debug)]
    pub struct Stream(UnixStream);

    impl Listener {
        pub fn bind() -> io::Result<Listener> {
            let path = socket_dir().join(format!("sni-fake-{}.sock", crate::sysrand::hex(8)));
            let _ = std::fs::remove_file(&path);
            let inner = UnixListener::bind(&path)?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            inner.set_nonblocking(true)?;
            Ok(Listener {
                inner,
                endpoint: Endpoint(path.to_string_lossy().into_owned()),
            })
        }

        pub fn endpoint(&self) -> &Endpoint {
            &self.endpoint
        }

        pub fn accept_timeout(&self, timeout: Duration) -> io::Result<Stream> {
            let deadline = Instant::now() + timeout;
            loop {
                match self.inner.accept() {
                    Ok((s, _)) => {
                        s.set_nonblocking(false)?;
                        return Ok(Stream(s));
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return Err(io::Error::new(
                                io::ErrorKind::TimedOut,
                                "accept timed out",
                            ));
                        }
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    Err(e) => return Err(e),
                }
            }
        }

        /// Removes the socket file. Safe to call more than once.
        pub fn cleanup(&self) {
            let _ = std::fs::remove_file(self.endpoint.as_str());
        }
    }

    impl Stream {
        pub fn connect(endpoint: &str) -> io::Result<Stream> {
            Ok(Stream(UnixStream::connect(endpoint)?))
        }

        pub fn try_clone(&self) -> io::Result<Stream> {
            Ok(Stream(self.0.try_clone()?))
        }
    }

    impl Read for Stream {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.0.read(buf)
        }
    }

    impl Write for Stream {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.write(buf)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.0.flush()
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_PIPE_CONNECTED, GENERIC_READ, GENERIC_WRITE, HANDLE,
        INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, ReadFile, WriteFile, FILE_SHARE_MODE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_ACCESS_DUPLEX, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
        PIPE_WAIT,
    };

    const BUFFER: u32 = 64 * 1024;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub struct Listener {
        handle: std::cell::Cell<HANDLE>,
        endpoint: Endpoint,
    }

    // The handle is only ever touched under &self from the owning thread, and
    // accept_timeout's worker borrows it for the duration of one blocking call.
    unsafe impl Send for Listener {}
    unsafe impl Sync for Listener {}

    #[derive(Debug)]
    pub struct Stream(OwnedHandle);

    impl Listener {
        pub fn bind() -> io::Result<Listener> {
            // Default security: the creating user and SYSTEM. The elevated
            // engine runs as the same user, so it is allowed; another
            // account on the machine is not.
            let name = format!(r"\\.\pipe\sni-fake-{}", crate::sysrand::hex(8));
            let wide_name = wide(&name);
            // SAFETY: wide_name is a valid NUL-terminated UTF-16 string.
            let handle = unsafe {
                CreateNamedPipeW(
                    wide_name.as_ptr(),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1,
                    BUFFER,
                    BUFFER,
                    0,
                    std::ptr::null(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            Ok(Listener {
                handle: std::cell::Cell::new(handle),
                endpoint: Endpoint(name),
            })
        }

        pub fn endpoint(&self) -> &Endpoint {
            &self.endpoint
        }

        /// `ConnectNamedPipe` on a blocking pipe would wait forever, so the
        /// blocking call runs on a worker thread and the deadline is enforced
        /// here with `recv_timeout`.
        pub fn accept_timeout(&self, timeout: Duration) -> io::Result<Stream> {
            let raw = self.handle.get() as isize;
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                // SAFETY: the handle outlives this call — the Listener is
                // alive for the duration of accept_timeout.
                let ok = unsafe { ConnectNamedPipe(raw as HANDLE, std::ptr::null_mut()) };
                let err = io::Error::last_os_error();
                let connected = ok != 0 || err.raw_os_error() == Some(ERROR_PIPE_CONNECTED as i32);
                let _ = tx.send(connected);
            });

            match rx.recv_timeout(timeout) {
                Ok(true) => {
                    let handle = self.handle.get();
                    self.handle.set(INVALID_HANDLE_VALUE);
                    // SAFETY: ownership of the pipe handle moves to Stream.
                    Ok(Stream(unsafe { OwnedHandle::from_raw_handle(handle as _) }))
                }
                Ok(false) => Err(io::Error::last_os_error()),
                Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "accept timed out")),
            }
        }

        pub fn cleanup(&self) {
            let handle = self.handle.get();
            if handle != INVALID_HANDLE_VALUE {
                // SAFETY: a handle we own and have not otherwise released.
                unsafe { CloseHandle(handle) };
                self.handle.set(INVALID_HANDLE_VALUE);
            }
        }
    }

    impl Stream {
        pub fn connect(endpoint: &str) -> io::Result<Stream> {
            let wide_name = wide(endpoint);
            // SAFETY: wide_name is a valid NUL-terminated UTF-16 string.
            let handle = unsafe {
                CreateFileW(
                    wide_name.as_ptr(),
                    (GENERIC_READ | GENERIC_WRITE) as u32,
                    FILE_SHARE_MODE::default(),
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: a freshly created handle we own.
            Ok(Stream(unsafe { OwnedHandle::from_raw_handle(handle as _) }))
        }

        pub fn try_clone(&self) -> io::Result<Stream> {
            Ok(Stream(self.0.try_clone()?))
        }

        fn raw(&self) -> HANDLE {
            self.0.as_raw_handle() as HANDLE
        }
    }

    impl Read for Stream {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let mut read = 0u32;
            // SAFETY: buf is a valid writable slice; read is a valid out-param.
            let ok = unsafe {
                ReadFile(
                    self.raw(),
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut read,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(read as usize)
        }
    }

    impl Write for Stream {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let mut written = 0u32;
            // SAFETY: buf is a valid readable slice; written is a valid out-param.
            let ok = unsafe {
                WriteFile(
                    self.raw(),
                    buf.as_ptr(),
                    buf.len() as u32,
                    &mut written,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(written as usize)
        }

        fn flush(&mut self) -> io::Result<()> {
            // SAFETY: a handle we own.
            unsafe { FlushFileBuffers(self.raw()) };
            Ok(())
        }
    }
}

pub use imp::{Listener, Stream};

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};

    #[test]
    fn endpoints_are_unique_per_listener() {
        let a = Listener::bind().unwrap();
        let b = Listener::bind().unwrap();
        assert_ne!(a.endpoint().as_str(), b.endpoint().as_str());
        a.cleanup();
        b.cleanup();
    }

    #[test]
    fn a_client_can_connect_and_exchange_ndjson_lines() {
        let listener = Listener::bind().unwrap();
        let endpoint = listener.endpoint().as_str().to_string();

        let client = std::thread::spawn(move || {
            let mut s = Stream::connect(&endpoint).unwrap();
            writeln!(s, "hello-from-client").unwrap();
            s.flush().unwrap();
            let mut reader = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            line.trim().to_string()
        });

        let server = listener.accept_timeout(Duration::from_secs(5)).unwrap();
        let mut reader = BufReader::new(server.try_clone().unwrap());
        let mut got = String::new();
        reader.read_line(&mut got).unwrap();
        assert_eq!(got.trim(), "hello-from-client");

        let mut writer = server;
        writeln!(writer, "hello-from-server").unwrap();
        writer.flush().unwrap();

        assert_eq!(client.join().unwrap(), "hello-from-server");
        listener.cleanup();
    }

    #[test]
    fn accept_times_out_when_nobody_connects() {
        let listener = Listener::bind().unwrap();
        let err = listener
            .accept_timeout(Duration::from_millis(150))
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        listener.cleanup();
    }
}
