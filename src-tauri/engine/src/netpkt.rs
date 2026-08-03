//! IPv4/TCP header handling: parsing, RFC 1071 checksums, and the
//! out-of-window fake packet built from a captured third-handshake ACK.
//!
//! Everything here works on the **IP layer onward**, never on Ethernet
//! frames. Link-layer framing is the capture backend's business — Linux and
//! macOS hand us an Ethernet header to put back on, Windows (WinDivert)
//! never sees one.

pub const FIN: u8 = 0x01;
pub const SYN: u8 = 0x02;
pub const RST: u8 = 0x04;
pub const PSH: u8 = 0x08;
pub const ACK: u8 = 0x10;

pub struct TcpView<'a> {
    pub src_ip: [u8; 4],
    pub dst_ip: [u8; 4],
    pub src_port: u16,
    pub dst_port: u16,
    pub seq: u32,
    pub ack: u32,
    pub flags: u8,
    pub payload_len: usize,
    _ip: &'a [u8],
}

fn ip_hdr_len(ip: &[u8]) -> usize {
    (ip[0] & 0x0f) as usize * 4
}

pub fn parse_ipv4_tcp(ip: &[u8]) -> Option<TcpView<'_>> {
    if ip.len() < 20 || ip[0] >> 4 != 4 || ip[9] != 6 {
        return None;
    }
    let ihl = ip_hdr_len(ip);
    if ihl < 20 || ip.len() < ihl + 20 {
        return None;
    }
    let tcp = &ip[ihl..];
    let data_off = (tcp[12] >> 4) as usize * 4;
    if data_off < 20 || tcp.len() < data_off {
        return None;
    }
    Some(TcpView {
        src_ip: [ip[12], ip[13], ip[14], ip[15]],
        dst_ip: [ip[16], ip[17], ip[18], ip[19]],
        src_port: u16::from_be_bytes([tcp[0], tcp[1]]),
        dst_port: u16::from_be_bytes([tcp[2], tcp[3]]),
        seq: u32::from_be_bytes([tcp[4], tcp[5], tcp[6], tcp[7]]),
        ack: u32::from_be_bytes([tcp[8], tcp[9], tcp[10], tcp[11]]),
        flags: tcp[13],
        payload_len: tcp.len() - data_off,
        _ip: ip,
    })
}

fn sum16(b: &[u8]) -> u32 {
    let mut s: u32 = 0;
    let mut i = 0;
    while i + 1 < b.len() {
        s += ((b[i] as u32) << 8) | b[i + 1] as u32;
        i += 2;
    }
    if b.len() % 2 == 1 {
        s += (b[b.len() - 1] as u32) << 8;
    }
    while s >> 16 != 0 {
        s = (s & 0xffff) + (s >> 16);
    }
    s
}

fn fold(mut s: u32) -> u16 {
    while s >> 16 != 0 {
        s = (s & 0xffff) + (s >> 16);
    }
    !(s as u16)
}

pub fn ip_checksum(iph: &[u8]) -> u16 {
    fold(sum16(iph))
}

pub fn tcp_checksum(iph: &[u8], tcp_and_payload: &[u8]) -> u16 {
    let mut pseudo = [0u8; 12];
    pseudo[0..4].copy_from_slice(&iph[12..16]);
    pseudo[4..8].copy_from_slice(&iph[16..20]);
    pseudo[9] = 6; // protocol
    pseudo[10..12].copy_from_slice(&(tcp_and_payload.len() as u16).to_be_bytes());
    fold(sum16(&pseudo) + sum16(tcp_and_payload))
}

/// Builds the injected packet from `template_ip` — the IP layer of the
/// outbound third-handshake ACK we just captured, which already carries the
/// right addresses, ports and TCP options.
///
/// The sequence number is set to `isn + 1 - fake.len()`, i.e. deliberately
/// *before* the server's receive window: DPI parses the segment and
/// whitelists the flow, the server discards it as out of window.
pub fn build_fake_packet(template_ip: &[u8], isn: u32, fake: &[u8]) -> Vec<u8> {
    let ihl = ip_hdr_len(template_ip);
    let tcp_hl = (template_ip[ihl + 12] >> 4) as usize * 4;

    let mut out = Vec::with_capacity(ihl + tcp_hl + fake.len());
    out.extend_from_slice(&template_ip[..ihl + tcp_hl]);
    out.extend_from_slice(fake);

    let total = out.len() as u16;
    out[2..4].copy_from_slice(&total.to_be_bytes());
    let id = u16::from_be_bytes([out[4], out[5]]).wrapping_add(1);
    out[4..6].copy_from_slice(&id.to_be_bytes());
    out[10] = 0;
    out[11] = 0;
    let ck = ip_checksum(&out[..ihl]);
    out[10..12].copy_from_slice(&ck.to_be_bytes());

    out[ihl + 13] |= PSH;
    let seq = isn.wrapping_add(1).wrapping_sub(fake.len() as u32);
    out[ihl + 4..ihl + 8].copy_from_slice(&seq.to_be_bytes());
    out[ihl + 16] = 0;
    out[ihl + 17] = 0;
    let iph = out[..ihl].to_vec();
    let ck = tcp_checksum(&iph, &out[ihl..]);
    out[ihl + 16..ihl + 18].copy_from_slice(&ck.to_be_bytes());

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal IPv4 + TCP third-handshake ACK: 20-byte IP header,
    /// 20-byte TCP header, no options, no payload.
    fn sample_ack() -> Vec<u8> {
        let mut p = vec![0u8; 40];
        p[0] = 0x45; // version 4, IHL 5
        p[2..4].copy_from_slice(&40u16.to_be_bytes()); // total length
        p[4..6].copy_from_slice(&0x1234u16.to_be_bytes()); // id
        p[8] = 64; // ttl
        p[9] = 6; // protocol = TCP
        p[12..16].copy_from_slice(&[192, 168, 1, 10]); // src
        p[16..20].copy_from_slice(&[104, 18, 4, 130]); // dst
        p[20..22].copy_from_slice(&51000u16.to_be_bytes()); // src port
        p[22..24].copy_from_slice(&443u16.to_be_bytes()); // dst port
        p[24..28].copy_from_slice(&1001u32.to_be_bytes()); // seq
        p[28..32].copy_from_slice(&2001u32.to_be_bytes()); // ack
        p[32] = 5 << 4; // data offset
        p[33] = ACK;
        p
    }

    #[test]
    fn parses_an_ipv4_tcp_packet() {
        let p = sample_ack();
        let v = parse_ipv4_tcp(&p).unwrap();
        assert_eq!(v.src_ip, [192, 168, 1, 10]);
        assert_eq!(v.dst_ip, [104, 18, 4, 130]);
        assert_eq!(v.src_port, 51000);
        assert_eq!(v.dst_port, 443);
        assert_eq!(v.seq, 1001);
        assert_eq!(v.ack, 2001);
        assert_eq!(v.flags & ACK, ACK);
        assert_eq!(v.payload_len, 0);
    }

    #[test]
    fn rejects_non_ipv4_and_non_tcp() {
        let mut p = sample_ack();
        p[0] = 0x65; // version 6
        assert!(parse_ipv4_tcp(&p).is_none());
        let mut p = sample_ack();
        p[9] = 17; // UDP
        assert!(parse_ipv4_tcp(&p).is_none());
        assert!(parse_ipv4_tcp(&[0u8; 10]).is_none());
    }

    #[test]
    fn ip_checksum_of_a_header_with_a_correct_checksum_folds_to_zero() {
        let mut p = sample_ack();
        let ck = ip_checksum(&p[..20]);
        p[10..12].copy_from_slice(&ck.to_be_bytes());
        assert_eq!(ip_checksum(&p[..20]), 0, "a correct header re-sums to zero");
    }

    #[test]
    fn tcp_checksum_of_a_correct_segment_folds_to_zero() {
        let mut p = sample_ack();
        let ck = tcp_checksum(&p[..20].to_vec(), &p[20..].to_vec());
        p[36..38].copy_from_slice(&ck.to_be_bytes());
        assert_eq!(tcp_checksum(&p[..20].to_vec(), &p[20..].to_vec()), 0);
    }

    #[test]
    fn fake_packet_sits_before_the_receive_window() {
        let tpl = sample_ack();
        let fake = vec![0xAAu8; 517];
        let isn = 1000u32;
        let out = build_fake_packet(&tpl, isn, &fake);

        assert_eq!(out.len(), 40 + 517);
        // IP total length updated
        assert_eq!(u16::from_be_bytes([out[2], out[3]]), (40 + 517) as u16);
        // IP id incremented so it is not a literal duplicate
        assert_eq!(u16::from_be_bytes([out[4], out[5]]), 0x1235);
        // seq = isn + 1 - len(fake)  →  deliberately out of window
        assert_eq!(
            u32::from_be_bytes([out[24], out[25], out[26], out[27]]),
            isn.wrapping_add(1).wrapping_sub(517)
        );
        // PSH set
        assert_eq!(out[33] & PSH, PSH);
        // payload copied verbatim
        assert_eq!(&out[40..], &fake[..]);
        // checksums valid
        assert_eq!(ip_checksum(&out[..20]), 0);
        assert_eq!(tcp_checksum(&out[..20].to_vec(), &out[20..].to_vec()), 0);
    }
}
