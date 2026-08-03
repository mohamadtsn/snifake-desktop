//! BPF wire format and ioctl encoding, with no syscalls in it.
//!
//! `macos.rs` is the only caller, but none of this needs a Mac to be correct,
//! and there is no macOS toolchain in this project's build container — so the
//! parts most likely to be wrong (the `bpf_hdr` layout, the record walk, the
//! `_IOW`/`_IOR` encoding) live here, where they compile and are unit-tested
//! on Linux. Compiled on non-macOS hosts only under `cfg(test)`.

/// Bytes of `struct bpf_hdr` we actually parse — BSD's `SIZEOF_BPF_HDR`,
/// i.e. through the end of `bh_hdrlen`, excluding the tail padding that makes
/// `sizeof` 20. The kernel reports the real distance to the payload in
/// `bh_hdrlen`, so we never depend on that padding.
const BPF_HDR_FIELDS: usize = 18;

// Field offsets in Darwin's `struct bpf_hdr` on a 64-bit userland. `bh_tstamp`
// is a `timeval32` (two i32s) even on LP64, which is why `bh_caplen` sits at 8
// and not 16. `macos.rs` static-asserts these against `libc::bpf_hdr`.
const OFF_CAPLEN: usize = 8;
const OFF_HDRLEN: usize = 16;

/// `BPF_WORDALIGN` from `<net/bpf.h>`: records in a read(2) batch start on a
/// 4-byte boundary (`BPF_ALIGNMENT` is `sizeof(int32_t)` on Darwin).
fn bpf_word_align(x: usize) -> usize {
    (x + 3) & !3
}

/// One captured frame inside a read(2) batch.
pub struct Record<'a> {
    /// The link-layer frame, `bh_caplen` bytes of it.
    pub frame: &'a [u8],
    /// Offset of the next record. May land past the end of the batch, which
    /// simply means the batch is drained.
    pub next: usize,
}

/// Reads the record at `pos` in a batch returned by read(2) on a bpf device.
///
/// `buf` must be trimmed to the bytes read(2) actually returned. `None` means
/// the remainder is not a whole record (a truncated or malformed tail); the
/// caller should abandon the rest of the batch rather than retry, since there
/// is no way to resynchronise.
pub fn next_record(buf: &[u8], pos: usize) -> Option<Record<'_>> {
    let hdr = buf.get(pos..pos.checked_add(BPF_HDR_FIELDS)?)?;
    let caplen = u32::from_ne_bytes(hdr[OFF_CAPLEN..OFF_CAPLEN + 4].try_into().ok()?) as usize;
    let hdrlen = u16::from_ne_bytes(hdr[OFF_HDRLEN..OFF_HDRLEN + 2].try_into().ok()?) as usize;
    if hdrlen < BPF_HDR_FIELDS {
        return None;
    }
    let start = pos.checked_add(hdrlen)?;
    let end = start.checked_add(caplen)?;
    if end > buf.len() {
        return None;
    }
    Some(Record {
        frame: &buf[start..end],
        // `hdrlen` is at least 18, so `next` is always past `pos` — a caller
        // looping on this cannot stall.
        next: bpf_word_align(end),
    })
}

pub const ETH_HDR_LEN: usize = 14;
const ETH_P_IP: u16 = 0x0800;

/// Splits an Ethernet frame into the header to re-attach on transmit and the
/// IPv4 packet behind it. `None` for a runt or for any EtherType but IPv4 —
/// the caller reports that as "nothing this call", never as an error.
pub fn strip_ethernet(frame: &[u8]) -> Option<([u8; ETH_HDR_LEN], &[u8])> {
    if frame.len() < ETH_HDR_LEN {
        return None;
    }
    let (l2, ip) = frame.split_at(ETH_HDR_LEN);
    if u16::from_be_bytes([l2[12], l2[13]]) != ETH_P_IP {
        return None;
    }
    Some((l2.try_into().ok()?, ip))
}

// ── ioctl encoding ──────────────────────────────────────────────────────
//
// `libc` publishes only a handful of Darwin `BIOC*` constants (`BIOCSETF`,
// `BIOCSRTIMEOUT`, `BIOCGRTIMEOUT`, `BIOCSETFNR`, `BIOCSSEESENT`, ...) — the
// ones this backend needs to *configure* a device are missing, so we encode
// them the way `<sys/ioccom.h>` does. The tests check that encoding against
// the constants libc does publish.

const IOC_OUT: u64 = 0x4000_0000;
const IOC_IN: u64 = 0x8000_0000;
const IOCPARM_MASK: u64 = 0x1fff;
/// The `'B'` ioctl group all `BIOC*` commands share.
const GROUP: u64 = b'B' as u64;

const fn bpf_ioc(dir: u64, num: u64, size: usize) -> u64 {
    dir | (((size as u64) & IOCPARM_MASK) << 16) | (GROUP << 8) | num
}

/// `_IOR('B', 102, u_int)` — the kernel's read buffer size. A read(2) whose
/// length is not exactly this fails with `EINVAL`, so it is not advisory.
pub const BIOCGBLEN: u64 = bpf_ioc(IOC_OUT, 102, 4);
/// `_IOWR('B', 102, u_int)` — must be set *before* `BIOCSETIF`.
pub const BIOCSBLEN: u64 = bpf_ioc(IOC_IN | IOC_OUT, 102, 4);
/// `_IOW('B', 108, struct ifreq)` — attaches the device to an interface.
pub const BIOCSETIF: u64 = bpf_ioc(IOC_IN, 108, 32);
/// `_IOW('B', 112, u_int)` — deliver each frame as it arrives instead of
/// holding it until the buffer fills.
pub const BIOCIMMEDIATE: u64 = bpf_ioc(IOC_IN, 112, 4);
/// `_IOW('B', 117, u_int)` — leave the source MAC of what we write alone.
pub const BIOCSHDRCMPLT: u64 = bpf_ioc(IOC_IN, 117, 4);

#[cfg(test)]
mod tests {
    use super::*;

    /// A `bpf_hdr` for `caplen` bytes of payload, header padded to `hdrlen`.
    fn hdr(caplen: u32, hdrlen: u16) -> Vec<u8> {
        let mut h = vec![0u8; hdrlen as usize];
        h[OFF_CAPLEN..OFF_CAPLEN + 4].copy_from_slice(&caplen.to_ne_bytes());
        // bh_datalen, unread by us but part of the layout.
        h[12..16].copy_from_slice(&caplen.to_ne_bytes());
        h[OFF_HDRLEN..OFF_HDRLEN + 2].copy_from_slice(&hdrlen.to_ne_bytes());
        h
    }

    fn eth_frame(ethertype: u16, payload: &[u8]) -> Vec<u8> {
        let mut f = vec![0u8; ETH_HDR_LEN];
        f[12..14].copy_from_slice(&ethertype.to_be_bytes());
        f.extend_from_slice(payload);
        f
    }

    #[test]
    fn bpf_word_align_rounds_up_to_four() {
        assert_eq!(bpf_word_align(0), 0);
        assert_eq!(bpf_word_align(1), 4);
        assert_eq!(bpf_word_align(4), 4);
        assert_eq!(bpf_word_align(5), 8);
        assert_eq!(bpf_word_align(18), 20);
    }

    /// The encoding is shared by every `BIOC*` command, so agreeing with the
    /// three constants libc publishes for Darwin is evidence for the five we
    /// derive ourselves. Expected values are libc 0.2's apple tables.
    #[test]
    fn ioctl_encoding_matches_libcs_published_darwin_constants() {
        // BIOCSSEESENT = _IOW('B', 119, u_int)
        assert_eq!(bpf_ioc(IOC_IN, 119, 4), 0x8004_4277);
        // BIOCSETF = _IOW('B', 103, struct bpf_program) — 16 bytes on LP64
        assert_eq!(bpf_ioc(IOC_IN, 103, 16), 0x8010_4267);
        // BIOCGRTIMEOUT = _IOR('B', 110, struct timeval) — 16 bytes on LP64
        assert_eq!(bpf_ioc(IOC_OUT, 110, 16), 0x4010_426e);
    }

    #[test]
    fn bioc_constants_have_the_expected_values() {
        assert_eq!(BIOCGBLEN, 0x4004_4266);
        assert_eq!(BIOCSBLEN, 0xc004_4266);
        assert_eq!(BIOCSETIF, 0x8020_426c);
        assert_eq!(BIOCIMMEDIATE, 0x8004_4270);
        assert_eq!(BIOCSHDRCMPLT, 0x8004_4275);
    }

    #[test]
    fn next_record_walks_a_batch_of_two_padded_records() {
        // 3-byte payload: the record is 20 + 3 = 23 bytes and the next one
        // starts at 24. Getting this wrong desynchronises the whole batch.
        let mut buf = hdr(3, 20);
        buf.extend_from_slice(&[0xaa, 0xbb, 0xcc]);
        buf.push(0); // BPF_WORDALIGN padding
        buf.extend(hdr(2, 20));
        buf.extend_from_slice(&[0x11, 0x22]);

        let first = next_record(&buf, 0).expect("first record");
        assert_eq!(first.frame, [0xaa, 0xbb, 0xcc]);
        assert_eq!(first.next, 24);

        let second = next_record(&buf, first.next).expect("second record");
        assert_eq!(second.frame, [0x11, 0x22]);
        assert!(second.next >= buf.len(), "batch should now be drained");
    }

    #[test]
    fn next_record_rejects_a_truncated_tail() {
        // Header claims 8 bytes of payload but only 2 were read.
        let mut buf = hdr(8, 20);
        buf.extend_from_slice(&[0x11, 0x22]);
        assert!(next_record(&buf, 0).is_none());

        // Not even a whole header left.
        assert!(next_record(&hdr(0, 20)[..10], 0).is_none());

        // A hdrlen that would point back into the header itself.
        assert!(next_record(&hdr(0, 20), 0).is_some());
        let mut bad = hdr(0, 20);
        bad[OFF_HDRLEN..OFF_HDRLEN + 2].copy_from_slice(&4u16.to_ne_bytes());
        assert!(next_record(&bad, 0).is_none());
    }

    #[test]
    fn next_record_accepts_the_unpadded_18_byte_header() {
        // Nothing in the protocol promises hdrlen is 20; trust the field.
        let mut buf = hdr(1, 18);
        buf.push(0x42);
        let rec = next_record(&buf, 0).expect("record");
        assert_eq!(rec.frame, [0x42]);
        assert_eq!(rec.next, 20);
    }

    #[test]
    fn strip_ethernet_keeps_ipv4_and_drops_everything_else() {
        let frame = eth_frame(0x0800, &[0x45, 0x00, 0x00, 0x14]);
        let (l2, ip) = strip_ethernet(&frame).expect("ipv4");
        assert_eq!(l2, frame[..ETH_HDR_LEN]);
        assert_eq!(ip, [0x45, 0x00, 0x00, 0x14]);

        assert!(strip_ethernet(&eth_frame(0x86dd, &[0x60])).is_none(), "ipv6");
        assert!(strip_ethernet(&eth_frame(0x0806, &[0x00])).is_none(), "arp");
        assert!(strip_ethernet(&[0u8; 13]).is_none(), "runt");
        // An IPv4 frame with no payload is still not a packet worth passing
        // up, but it must not panic.
        assert_eq!(strip_ethernet(&eth_frame(0x0800, &[])).unwrap().1, b"");
    }
}
