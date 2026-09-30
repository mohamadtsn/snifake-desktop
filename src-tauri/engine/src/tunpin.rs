//! What the TUN is called and where it lives, compiled into both halves.
//!
//! The GUI writes these into the sing-box config; the engine builds the
//! kill switch from them. They are constants rather than fields on the
//! wire for the reason `corepin` is: the engine runs as root, and a value
//! it receives from the unprivileged side is a value it has to distrust.
//! One it compiled in, it does not.

/// The interface sing-box creates. Linux caps names at 15 bytes.
#[cfg(not(windows))]
pub const INTERFACE_NAME: &str = "snifake-tun0";
/// On Windows this is the adapter's alias; phase 5 looks its LUID up by it.
#[cfg(windows)]
pub const INTERFACE_NAME: &str = "snifake-tun";

pub const ADDRESS_V4: &str = "172.19.83.1/30";
/// Claimed so the physical IPv6 default route cannot carry traffic around
/// the tunnel, then refused by the generated `ip_version: 6` guard.
pub const ADDRESS_V6: &str = "fdfe:dcba:534e::1/126";
pub const MTU: u32 = 9000;

/// Set on every socket sing-box opens (`route.default_mark`) and accepted
/// by the kill switch, so the core's own direct traffic — the Bypass list,
/// LAN, its resolver — can leave. "SN" in ASCII. SO_MARK is Linux-only.
pub const ROUTING_MARK: u32 = 0x534e;

/// The `proto` the route guard's routes carry, so a crashed run's route
/// can be flushed without knowing which address it pinned.
pub const ROUTE_PROTO: u8 = 177;

/// sing-box's `iproute2_table_index` and `iproute2_rule_index`, pinned
/// rather than left at its defaults. `strict_route` installs policy rules
/// from this priority upward, and they survive a SIGKILL of the core; a
/// known number is what lets the startup purge delete them (Linux plan
/// Task 1 measured it). `RULE_SPAN` is how many priorities the purge sweeps.
pub const IPROUTE2_TABLE: u32 = 5346;
pub const IPROUTE2_RULE: u32 = 5346;
pub const RULE_SPAN: u32 = 16;

/// Policy-rule priorities for coexisting VPNs, just ahead of sing-box's
/// (`IPROUTE2_RULE`) so their traffic is decided before the TUN can claim
/// it. Servers first: a WireGuard server can also be one of its own routes,
/// and its outer packets must go out physically, not into itself.
pub const PASS_ENDPOINT_RULE: u32 = 5340;
pub const PASS_ROUTE_RULE: u32 = 5341;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_interface_name_fits_the_kernel_limit() {
        // IFNAMSIZ is 16 including the NUL.
        assert!(INTERFACE_NAME.len() <= 15);
    }

    #[test]
    fn the_mark_is_the_one_the_probe_measured() {
        // Linux plan Task 1 ran with `default_mark: 21326`.
        assert_eq!(ROUTING_MARK, 21326);
    }

    #[test]
    fn passthrough_rules_run_before_sing_boxs() {
        assert!(PASS_ENDPOINT_RULE < PASS_ROUTE_RULE);
        assert!(PASS_ROUTE_RULE < IPROUTE2_RULE);
    }
}
