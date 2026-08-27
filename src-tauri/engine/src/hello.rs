//! The fake TLS ClientHello that gets injected out-of-window.
//!
//! Byte-for-byte port of `buildClientHello` from the Go implementation. The
//! template is a real 517-byte ClientHello lifted from the original tool;
//! we rewrite the client random, session id, key share and SNI, and absorb
//! the SNI's length change in the trailing padding extension so the frame
//! is always exactly 517 bytes. DPI has to be able to parse it; the server
//! never sees it (it arrives before the receive window).

/// Template body, hex. The tail is zero-padded out to 517 bytes at init.
const TPL_HEX: &str = "1603010200010001fc030341d5b549d9cd1adfa7296c8418d157dc7b624c842824ff493b9375bb48d34f2b20bf018bcc90a7c89a230094815ad0c15b736e38c01209d72d282cb5e2105328150024130213031301c02cc030c02bc02fcca9cca8c024c028c023c027009f009e006b006700ff0100018f0000000b00090000066d63692e6972000b000403000102000a00160014001d0017001e0019001801000101010201030104002300000010000e000c02683208687474702f312e310016000000170000000d002a0028040305030603080708080809080a080b080408050806040105010601030303010302040205020602002b00050403040303002d00020101003300260024001d0020435bacc4d05f9d41fef44ab3ad55616c36e0613473e2338770efdaa98693d217001500d5";

const FRAME_LEN: usize = 517;
const MAX_SNI: usize = 219;

fn template() -> Vec<u8> {
    let hex = TPL_HEX.as_bytes();
    let mut out = Vec::with_capacity(FRAME_LEN);
    let mut i = 0;
    while i + 1 < hex.len() {
        let hi = (hex[i] as char).to_digit(16).expect("template hex is valid");
        let lo = (hex[i + 1] as char).to_digit(16).expect("template hex is valid");
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    out.resize(FRAME_LEN, 0);
    out
}

/// 32 bytes of OS randomness — no `rand` dependency for three 32-byte reads.
fn random32() -> [u8; 32] {
    let mut buf = [0u8; 32];
    crate::sysrand::fill(&mut buf);
    buf
}

pub fn build_client_hello(sni: &str) -> Result<Vec<u8>, String> {
    let sni = sni.as_bytes();
    if sni.len() > MAX_SNI {
        return Err(format!(
            "FAKE_SNI is {} bytes, maximum is {MAX_SNI}",
            sni.len()
        ));
    }
    let tpl = template();
    let pad_len = MAX_SNI - sni.len();

    let mut out: Vec<u8> = Vec::with_capacity(FRAME_LEN);
    out.extend_from_slice(&tpl[..11]);
    out.extend_from_slice(&random32()); // client random
    out.push(0x20); // session id length
    out.extend_from_slice(&random32()); // session id
    out.extend_from_slice(&tpl[76..120]);
    out.extend_from_slice(&((sni.len() + 5) as u16).to_be_bytes());
    out.extend_from_slice(&((sni.len() + 3) as u16).to_be_bytes());
    out.push(0x00); // name_type = host_name
    out.extend_from_slice(&(sni.len() as u16).to_be_bytes());
    out.extend_from_slice(sni);
    out.extend_from_slice(&tpl[133..268]);
    out.extend_from_slice(&random32()); // x25519 key share
    out.extend_from_slice(&[0x00, 0x15]); // padding extension
    out.extend_from_slice(&(pad_len as u16).to_be_bytes());
    out.resize(FRAME_LEN, 0);

    debug_assert_eq!(out.len(), FRAME_LEN);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_hello_is_always_517_bytes() {
        for sni in ["a", "security.vercel.com", &"x".repeat(219)] {
            let out = build_client_hello(sni).unwrap();
            assert_eq!(out.len(), 517, "sni len {} produced {}", sni.len(), out.len());
        }
    }

    #[test]
    fn client_hello_embeds_the_sni_with_correct_length_prefixes() {
        let sni = "security.vercel.com";
        let out = build_client_hello(sni).unwrap();
        let n = sni.len();
        // server_name extension: ext_len, list_len, name_type, name_len, name
        assert_eq!(u16::from_be_bytes([out[120], out[121]]), (n + 5) as u16);
        assert_eq!(u16::from_be_bytes([out[122], out[123]]), (n + 3) as u16);
        assert_eq!(out[124], 0x00);
        assert_eq!(u16::from_be_bytes([out[125], out[126]]), n as u16);
        assert_eq!(&out[127..127 + n], sni.as_bytes());
    }

    #[test]
    fn client_hello_randomises_the_random_field() {
        let a = build_client_hello("example.com").unwrap();
        let b = build_client_hello("example.com").unwrap();
        assert_ne!(a[11..43], b[11..43], "client random must differ per call");
    }

    #[test]
    fn client_hello_rejects_an_oversized_sni() {
        assert!(build_client_hello(&"x".repeat(220)).is_err());
    }
}
