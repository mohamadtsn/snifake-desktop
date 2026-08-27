//! OS randomness, without a `rand` dependency. Two call sites: the fake
//! ClientHello's random fields, and the socket auth token. Both are
//! security-relevant, so neither may fall back to anything weaker.

/// Fills `buf` with cryptographically secure random bytes. Panics rather
/// than degrading: a silent fallback to a weak source here would be worse
/// than a crash.
pub fn fill(buf: &mut [u8]) {
    if buf.is_empty() {
        return;
    }
    #[cfg(unix)]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(buf))
            .expect("/dev/urandom is readable");
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        // SAFETY: buf is a valid, writable slice of the given length.
        let status = unsafe {
            BCryptGenRandom(
                std::ptr::null_mut(),
                buf.as_mut_ptr(),
                buf.len() as u32,
                BCRYPT_USE_SYSTEM_PREFERRED_RNG,
            )
        };
        assert!(status >= 0, "BCryptGenRandom failed with status {status:#x}");
    }
}

/// `bytes` random bytes, lowercase hex — so `hex(16)` is 32 characters.
pub fn hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    fill(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_writes_every_byte_requested() {
        // A 64-byte buffer left entirely zero would be a 1-in-2^512 event.
        let mut buf = [0u8; 64];
        fill(&mut buf);
        assert!(buf.iter().any(|&b| b != 0));
    }

    #[test]
    fn successive_calls_differ() {
        let mut a = [0u8; 32];
        let mut b = [0u8; 32];
        fill(&mut a);
        fill(&mut b);
        assert_ne!(a, b);
    }

    #[test]
    fn hex_returns_two_characters_per_byte() {
        let s = hex(16);
        assert_eq!(s.len(), 32);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(s, hex(16));
    }

    #[test]
    fn fill_tolerates_an_empty_buffer() {
        fill(&mut []);
    }
}
