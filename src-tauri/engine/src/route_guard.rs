//! A host route that pins the SNI upstream to the physical interface.
//!
//! Installed before sing-box's `auto_route` exists, so `ip route get`
//! still answers with the real gateway, and so `Forwarder::discover_egress`
//! keeps resolving to the physical interface and ClientHello injection
//! keeps working (design §6). Defence in depth beside `route_exclude_address`
//! and the generated direct rule, none of which depends on another.
//!
//! Runs `ip` rather than linking a netlink crate, for the reason the kill
//! switch runs `nft` (spec §12.2). Its routes carry `proto 177`, so a
//! crashed run's route can be flushed without knowing the address.

use crate::tunpin;
#[cfg(not(windows))]
use crate::sysbin;
use std::net::Ipv4Addr;
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::Command;


#[derive(Debug, PartialEq)]
pub struct Route {
    pub gateway: Option<Ipv4Addr>,
    pub dev: String,
}

/// `ip -j route get <ip>` prints a one-element array.
pub fn parse_route_get(json: &str) -> Result<Route, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("unreadable route: {e}"))?;
    let r = v.get(0).ok_or("there is no route to the SNI upstream")?;
    let dev = r["dev"]
        .as_str()
        .ok_or("the route to the SNI upstream names no interface")?
        .to_string();
    let gateway = match r.get("gateway").and_then(|g| g.as_str()) {
        Some(g) => Some(g.parse().map_err(|_| format!("gateway '{g}' is not IPv4"))?),
        None => None,
    };
    Ok(Route { gateway, dev })
}

pub fn replace_args(ip: Ipv4Addr, r: &Route) -> Vec<String> {
    let mut a: Vec<String> = vec!["route".into(), "replace".into(), format!("{ip}/32")];
    if let Some(gw) = r.gateway {
        a.extend(["via".into(), gw.to_string()]);
    }
    a.extend([
        "dev".into(),
        r.dev.clone(),
        "proto".into(),
        tunpin::ROUTE_PROTO.to_string(),
    ]);
    a
}

#[cfg(not(windows))]
pub struct RouteGuard {
    bin: PathBuf,
    pinned: Ipv4Addr,
}

#[cfg(not(windows))]
impl RouteGuard {
    pub fn install(ip: Ipv4Addr) -> Result<RouteGuard, String> {
        let bin = sysbin::find("ip").ok_or("Install the iproute2 package to use TUN.")?;
        let out = Command::new(&bin)
            .args(["-j", "route", "get", &ip.to_string()])
            .output()
            .map_err(|e| format!("could not run ip: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "no route to the SNI upstream {ip}: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let route = parse_route_get(&String::from_utf8_lossy(&out.stdout))?;
        if route.dev == tunpin::INTERFACE_NAME {
            // Pinning the upstream into the tunnel is the loop this guard
            // exists to prevent.
            return Err("the route to the SNI upstream already goes through the tunnel".into());
        }
        run(&bin, &replace_args(ip, &route))?;
        Ok(RouteGuard { bin, pinned: ip })
    }

    pub fn remove(self) -> Result<(), String> {
        let dst = format!("{}/32", self.pinned);
        let proto = tunpin::ROUTE_PROTO.to_string();
        run(&self.bin, &["route", "del", dst.as_str(), "proto", proto.as_str()])
    }
}

#[cfg(not(windows))]
/// Our pinned route, and the policy rules and table sing-box's
/// `strict_route` leaves behind when it is killed: they route everything
/// into a table whose TUN no longer exists, so without this a crashed
/// session would stay offline even after the kill switch is gone.
pub fn purge() -> Result<(), String> {
    let Some(bin) = sysbin::find("ip") else {
        return Ok(());
    };
    let proto = tunpin::ROUTE_PROTO.to_string();
    let route = match run(&bin, &["route", "flush", "proto", proto.as_str()]) {
        // Older iproute2 reports an empty flush as a failure.
        Err(e) if e.contains("Nothing to flush") => Ok(()),
        other => other,
    };
    for family in ["-4", "-6"] {
        for p in rule_priorities() {
            // One delete removes one rule, and sing-box puts several at one
            // priority (the owner's probe found three at 5349). Stop at the
            // first failure: an absent rule is the common case, not an error.
            // Bounded, so a rule the kernel keeps re-accepting cannot spin.
            let p = p.to_string();
            for _ in 0..RULES_PER_PRIORITY {
                if run(&bin, &[family, "rule", "del", "priority", p.as_str()]).is_err() {
                    break;
                }
            }
        }
        let table = tunpin::IPROUTE2_TABLE.to_string();
        let _ = run(&bin, &[family, "route", "flush", "table", table.as_str()]);
    }
    crate::passthrough::clear_rules(&bin);
    route
}

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::NO_ERROR;
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    ConvertInterfaceAliasToLuid, CreateIpForwardEntry2, DeleteIpForwardEntry2, FreeMibTable,
    GetBestRoute2, GetIpForwardTable2, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2,
};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
#[cfg(windows)]
use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET};

#[cfg(windows)]
pub struct RouteGuard {
    row: MIB_IPFORWARD_ROW2,
}

#[cfg(windows)]
impl RouteGuard {
    pub fn install(ip: Ipv4Addr) -> Result<RouteGuard, String> {
        let mut dest: SOCKADDR_INET = unsafe { std::mem::zeroed() };
        dest.Ipv4.sin_family = AF_INET as u16;
        dest.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes(ip.octets());

        let mut best_route: MIB_IPFORWARD_ROW2 = unsafe { std::mem::zeroed() };
        let mut best_source: SOCKADDR_INET = unsafe { std::mem::zeroed() };

        let status = unsafe {
            GetBestRoute2(
                std::ptr::null(),
                0,
                std::ptr::null(),
                &dest,
                0,
                &mut best_route,
                &mut best_source,
            )
        };
        if status != NO_ERROR {
            return Err(format!("GetBestRoute2 failed for {ip}: {status:#x}"));
        }

        let wide: Vec<u16> = std::ffi::OsStr::new(tunpin::INTERFACE_NAME)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut tun_luid = NET_LUID_LH { Value: 0 };
        if unsafe { ConvertInterfaceAliasToLuid(wide.as_ptr(), &mut tun_luid) } == NO_ERROR {
            if unsafe { best_route.InterfaceLuid.Value == tun_luid.Value } {
                return Err("the route to the SNI upstream already goes through the tunnel".into());
            }
        }

        let mut row: MIB_IPFORWARD_ROW2 = unsafe { std::mem::zeroed() };
        row.DestinationPrefix.Prefix.Ipv4.sin_family = AF_INET as u16;
        row.DestinationPrefix.Prefix.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes(ip.octets());
        row.DestinationPrefix.PrefixLength = 32;
        row.NextHop = best_route.NextHop;
        row.InterfaceLuid = best_route.InterfaceLuid;
        row.InterfaceIndex = best_route.InterfaceIndex;
        row.Metric = 1;
        row.Protocol = tunpin::ROUTE_PROTO as i32;

        let status = unsafe { CreateIpForwardEntry2(&row) };
        if status != NO_ERROR && status != 0x5010 /* ERROR_OBJECT_ALREADY_EXISTS */ {
            return Err(format!("CreateIpForwardEntry2 failed for {ip}/32: {status:#x}"));
        }

        Ok(RouteGuard { row })
    }

    pub fn remove(self) -> Result<(), String> {
        let status = unsafe { DeleteIpForwardEntry2(&self.row) };
        if status != NO_ERROR {
            return Err(format!("DeleteIpForwardEntry2 failed: {status:#x}"));
        }
        Ok(())
    }
}

#[cfg(windows)]
pub fn purge() -> Result<(), String> {
    let mut table_ptr: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIpForwardTable2(AF_INET as u16, &mut table_ptr) };
    if status == NO_ERROR && !table_ptr.is_null() {
        let table = unsafe { &*table_ptr };
        let num_entries = table.NumEntries as usize;
        let entries = unsafe {
            std::slice::from_raw_parts(table.Table.as_ptr(), num_entries)
        };
        for entry in entries {
            if entry.Protocol == tunpin::ROUTE_PROTO as i32 {
                unsafe {
                    let _ = DeleteIpForwardEntry2(entry);
                }
            }
        }
        unsafe {
            FreeMibTable(table_ptr as *const _);
        }
    }
    Ok(())
}



#[cfg(not(windows))]
/// More than sing-box has ever been seen to put at one priority.
const RULES_PER_PRIORITY: usize = 8;


pub fn rule_priorities() -> std::ops::Range<u32> {
    tunpin::IPROUTE2_RULE..tunpin::IPROUTE2_RULE + tunpin::RULE_SPAN
}

#[cfg(not(windows))]
fn run<S: AsRef<std::ffi::OsStr>>(bin: &Path, args: &[S]) -> Result<(), String> {
    let out = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| format!("could not run ip: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("ip refused the route: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_routed_upstream_yields_its_gateway_and_interface() {
        let json = r#"[{"dst":"104.18.4.130","gateway":"192.168.1.1","dev":"wlp2s0","prefsrc":"192.168.1.20","flags":[],"uid":0,"cache":[]}]"#;
        assert_eq!(
            parse_route_get(json).unwrap(),
            Route { gateway: Some(Ipv4Addr::new(192, 168, 1, 1)), dev: "wlp2s0".into() }
        );
    }

    #[test]
    fn an_on_link_upstream_has_no_gateway() {
        let json = r#"[{"dst":"192.168.1.9","dev":"eth0","prefsrc":"192.168.1.20"}]"#;
        assert_eq!(parse_route_get(json).unwrap().gateway, None);
    }

    #[test]
    fn no_route_is_an_error_not_a_panic() {
        assert!(parse_route_get("[]").is_err());
        assert!(parse_route_get("not json").is_err());
    }

    #[test]
    fn the_purge_sweeps_exactly_the_priorities_sing_box_was_told_to_use() {
        assert_eq!(rule_priorities(), 5346..5362);
    }

    #[test]
    fn the_pinned_route_carries_our_proto_so_a_crash_can_be_flushed() {
        let r = Route { gateway: Some(Ipv4Addr::new(192, 168, 1, 1)), dev: "wlp2s0".into() };
        assert_eq!(
            replace_args(Ipv4Addr::new(104, 18, 4, 130), &r),
            ["route", "replace", "104.18.4.130/32", "via", "192.168.1.1", "dev", "wlp2s0", "proto", "177"]
        );
        let on_link = Route { gateway: None, dev: "eth0".into() };
        assert_eq!(
            replace_args(Ipv4Addr::new(192, 168, 1, 9), &on_link),
            ["route", "replace", "192.168.1.9/32", "dev", "eth0", "proto", "177"]
        );
    }
}
