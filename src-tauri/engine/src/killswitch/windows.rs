//! The Windows kill switch: a dedicated sublayer in Windows Filtering Platform (WFP).
//!
//! Opened without FWPM_SESSION_FLAG_DYNAMIC and without FWPM_FILTER_FLAG_PERSISTENT:
//! filters outlive process crashes but are cleaned up on reboot. Startup purge
//! removes the sublayer by fixed GUID, atomically clearing all orphan filters.

#![cfg(target_os = "windows")]

use super::{Allowlist, KillSwitch};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
use windows_sys::Win32::NetworkManagement::IpHelper::ConvertInterfaceAliasToLuid;
use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;
use windows_sys::Win32::Networking::WinSock::{IPPROTO_TCP, IPPROTO_UDP};
use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_DEFAULT;

/// Fixed sublayer GUID: {534e4946-5455-4e00-aabb-ccddeeff0001}
pub const SUBLAYER_GUID: GUID = GUID {
    data1: 0x534e4946,
    data2: 0x5455,
    data3: 0x4e00,
    data4: [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x01],
};

const SUBLAYER_WEIGHT: u16 = 0x8000;

pub struct Wfp {
    engine: HANDLE,
    tun_luid: Option<u64>,
}

unsafe impl Send for Wfp {}

impl Wfp {
    pub fn open() -> Result<Wfp, String> {
        let mut engine: HANDLE = ptr::null_mut();
        let status = unsafe {
            FwpmEngineOpen0(
                ptr::null(),
                RPC_C_AUTHN_DEFAULT as u32,
                ptr::null(),
                ptr::null(),
                &mut engine,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("FwpmEngineOpen0 failed: {status:#x}"));
        }
        Ok(Wfp { engine, tun_luid: None })
    }

    fn ensure_sublayer(&self) -> Result<(), String> {
        let sublayer = FWPM_SUBLAYER0 {
            subLayerKey: SUBLAYER_GUID,
            displayData: FWPM_DISPLAY_DATA0 {
                name: windows_sys::core::w!("Snifake Kill Switch") as *mut u16,
                description: windows_sys::core::w!("Fail-closed protection for Snifake TUN mode") as *mut u16,
            },
            flags: 0,
            providerKey: ptr::null_mut(),
            providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
            weight: SUBLAYER_WEIGHT,
        };
        unsafe {
            // Ignore error if it already exists
            let _ = FwpmSubLayerAdd0(self.engine, &sublayer, ptr::null_mut());
        }
        Ok(())
    }

    fn clear_sublayer(&self) {
        unsafe {
            let _ = FwpmSubLayerDeleteByKey0(self.engine, &SUBLAYER_GUID);
        }
    }

    fn add_drop_filters(&self) -> Result<(), String> {
        for (layer, name) in [
            (FWPM_LAYER_ALE_AUTH_CONNECT_V4, windows_sys::core::w!("Snifake Block IPv4 Outbound")),
            (FWPM_LAYER_ALE_AUTH_CONNECT_V6, windows_sys::core::w!("Snifake Block IPv6 Outbound")),
        ] {
            let mut weight_val: u64 = 1;
            let filter = FWPM_FILTER0 {
                filterKey: GUID { data1: 0x534e4946, data2: 0x0001, data3: 0, data4: [0; 8] },
                displayData: FWPM_DISPLAY_DATA0 { name: name as *mut u16, description: ptr::null_mut() },
                flags: 0,
                providerKey: ptr::null_mut(),
                providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
                layerKey: layer,
                subLayerKey: SUBLAYER_GUID,
                weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
                numFilterConditions: 0,
                filterCondition: ptr::null_mut(),
                action: FWPM_ACTION0 {
                    r#type: FWP_ACTION_BLOCK,
                    Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
                },
                Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
                reserved: ptr::null_mut(),
                filterId: 0,
                effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
            };
            let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
            if status != ERROR_SUCCESS {
                return Err(format!("Failed to add drop filter: {status:#x}"));
            }
        }
        Ok(())
    }

    fn add_permit_loopback(&self) -> Result<(), String> {
        let loopback_val = FWP_CONDITION_FLAG_IS_LOOPBACK as u32;
        let mut cond = FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_FLAGS,
            matchType: FWP_MATCH_FLAGS_ALL_SET,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_UINT32,
                Anonymous: FWP_CONDITION_VALUE0_0 { uint32: loopback_val },
            },
        };
        for (layer, name) in [
            (FWPM_LAYER_ALE_AUTH_CONNECT_V4, windows_sys::core::w!("Snifake Permit Loopback v4")),
            (FWPM_LAYER_ALE_AUTH_CONNECT_V6, windows_sys::core::w!("Snifake Permit Loopback v6")),
        ] {
            let mut weight_val: u64 = 100;
            let filter = FWPM_FILTER0 {
                filterKey: GUID { data1: 0x534e4946, data2: 0x0002, data3: 0, data4: [0; 8] },
                displayData: FWPM_DISPLAY_DATA0 { name: name as *mut u16, description: ptr::null_mut() },
                flags: 0,
                providerKey: ptr::null_mut(),
                providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
                layerKey: layer,
                subLayerKey: SUBLAYER_GUID,
                weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
                numFilterConditions: 1,
                filterCondition: &mut cond,
                action: FWPM_ACTION0 {
                    r#type: FWP_ACTION_PERMIT,
                    Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
                },
                Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
                reserved: ptr::null_mut(),
                filterId: 0,
                effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
            };
            let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
            if status != ERROR_SUCCESS {
                return Err(format!("Failed to permit loopback: {status:#x}"));
            }
        }
        Ok(())
    }

    fn add_permit_connect(&self, allow: &Allowlist) -> Result<(), String> {
        let (ip, port) = allow.connect;
        let ip_u32 = u32::from(ip);
        let port_u16 = port;
        let proto_u8 = IPPROTO_TCP as u8;

        let mut conds = [
            FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT32,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint32: ip_u32 },
                },
            },
            FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_PORT,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT16,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint16: port_u16 },
                },
            },
            FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_PROTOCOL,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT8,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint8: proto_u8 },
                },
            },
        ];

        let mut weight_val: u64 = 200;
        let filter = FWPM_FILTER0 {
            filterKey: GUID { data1: 0x534e4946, data2: 0x0003, data3: 0, data4: [0; 8] },
            displayData: FWPM_DISPLAY_DATA0 {
                name: windows_sys::core::w!("Snifake Permit CONNECT_IP") as *mut u16,
                description: ptr::null_mut(),
            },
            flags: 0,
            providerKey: ptr::null_mut(),
            providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
            layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            subLayerKey: SUBLAYER_GUID,
            weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
            numFilterConditions: conds.len() as u32,
            filterCondition: conds.as_mut_ptr(),
            action: FWPM_ACTION0 {
                r#type: FWP_ACTION_PERMIT,
                Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
            },
            Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
            reserved: ptr::null_mut(),
            filterId: 0,
            effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
        };
        let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
        if status != ERROR_SUCCESS {
            return Err(format!("Failed to permit CONNECT_IP: {status:#x}"));
        }
        Ok(())
    }

    fn add_permit_dhcp(&self) -> Result<(), String> {
        let proto = IPPROTO_UDP as u8;
        let port = 67u16;
        let mut conds = [
            FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_PROTOCOL,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT8,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint8: proto },
                },
            },
            FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_PORT,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_UINT16,
                    Anonymous: FWP_CONDITION_VALUE0_0 { uint16: port },
                },
            },
        ];
        let mut weight_val: u64 = 150;
        let filter = FWPM_FILTER0 {
            filterKey: GUID { data1: 0x534e4946, data2: 0x0004, data3: 0, data4: [0; 8] },
            displayData: FWPM_DISPLAY_DATA0 {
                name: windows_sys::core::w!("Snifake Permit DHCP") as *mut u16,
                description: ptr::null_mut(),
            },
            flags: 0,
            providerKey: ptr::null_mut(),
            providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
            layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
            subLayerKey: SUBLAYER_GUID,
            weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
            numFilterConditions: conds.len() as u32,
            filterCondition: conds.as_mut_ptr(),
            action: FWPM_ACTION0 {
                r#type: FWP_ACTION_PERMIT,
                Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
            },
            Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
            reserved: ptr::null_mut(),
            filterId: 0,
            effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
        };
        let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
        if status != ERROR_SUCCESS {
            return Err(format!("Failed to permit DHCP: {status:#x}"));
        }
        Ok(())
    }

    fn add_permit_lan(&self) -> Result<(), String> {
        let subnets = [
            (0x0a000000u32, 0xff000000u32), // 10.0.0.0/8
            (0xac100000u32, 0xfff00000u32), // 172.16.0.0/12
            (0xc0a80000u32, 0xffff0000u32), // 192.168.0.0/16
            (0xa9fe0000u32, 0xffff0000u32), // 169.254.0.0/16
            (0xe0000000u32, 0xf0000000u32), // 224.0.0.0/4
            (0xffffffffu32, 0xffffffffu32), // 255.255.255.255/32
        ];
        for (idx, (addr, mask)) in subnets.iter().enumerate() {
            let mut v4_mask = FWP_V4_ADDR_AND_MASK { addr: *addr, mask: *mask };
            let mut cond = FWPM_FILTER_CONDITION0 {
                fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                matchType: FWP_MATCH_EQUAL,
                conditionValue: FWP_CONDITION_VALUE0 {
                    r#type: FWP_V4_ADDR_MASK,
                    Anonymous: FWP_CONDITION_VALUE0_0 {
                        v4AddrMask: &mut v4_mask as *mut _,
                    },
                },
            };
            let mut weight_val: u64 = 120;
            let filter = FWPM_FILTER0 {
                filterKey: GUID { data1: 0x534e4946, data2: 0x0005, data3: idx as u16, data4: [0; 8] },
                displayData: FWPM_DISPLAY_DATA0 {
                    name: windows_sys::core::w!("Snifake Permit LAN") as *mut u16,
                    description: ptr::null_mut(),
                },
                flags: 0,
                providerKey: ptr::null_mut(),
                providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
                layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                subLayerKey: SUBLAYER_GUID,
                weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
                numFilterConditions: 1,
                filterCondition: &mut cond,
                action: FWPM_ACTION0 {
                    r#type: FWP_ACTION_PERMIT,
                    Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
                },
                Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
                reserved: ptr::null_mut(),
                filterId: 0,
                effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
            };
            let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
            if status != ERROR_SUCCESS {
                return Err(format!("Failed to permit LAN subnet {idx}: {status:#x}"));
            }
        }
        Ok(())
    }

    fn add_permit_endpoints(&self, endpoints: &[(std::net::Ipv4Addr, u16)]) -> Result<(), String> {
        for (idx, (ip, port)) in endpoints.iter().enumerate() {
            let ip_u32 = u32::from(*ip);
            let port_u16 = *port;
            let mut conds = [
                FWPM_FILTER_CONDITION0 {
                    fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
                    matchType: FWP_MATCH_EQUAL,
                    conditionValue: FWP_CONDITION_VALUE0 {
                        r#type: FWP_UINT32,
                        Anonymous: FWP_CONDITION_VALUE0_0 { uint32: ip_u32 },
                    },
                },
                FWPM_FILTER_CONDITION0 {
                    fieldKey: FWPM_CONDITION_IP_REMOTE_PORT,
                    matchType: FWP_MATCH_EQUAL,
                    conditionValue: FWP_CONDITION_VALUE0 {
                        r#type: FWP_UINT16,
                        Anonymous: FWP_CONDITION_VALUE0_0 { uint16: port_u16 },
                    },
                },
            ];
            let mut weight_val: u64 = 210;
            let filter = FWPM_FILTER0 {
                filterKey: GUID { data1: 0x534e4946, data2: 0x0006, data3: idx as u16, data4: [0; 8] },
                displayData: FWPM_DISPLAY_DATA0 {
                    name: windows_sys::core::w!("Snifake Permit Passthrough Endpoint") as *mut u16,
                    description: ptr::null_mut(),
                },
                flags: 0,
                providerKey: ptr::null_mut(),
                providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
                layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                subLayerKey: SUBLAYER_GUID,
                weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
                numFilterConditions: conds.len() as u32,
                filterCondition: conds.as_mut_ptr(),
                action: FWPM_ACTION0 {
                    r#type: FWP_ACTION_PERMIT,
                    Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
                },
                Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
                reserved: ptr::null_mut(),
                filterId: 0,
                effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
            };
            let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
            if status != ERROR_SUCCESS {
                return Err(format!("Failed to permit endpoint {ip}:{port}: {status:#x}"));
            }
        }
        Ok(())
    }
}

impl KillSwitch for Wfp {
    fn install(&mut self, allow: &Allowlist) -> Result<(), String> {
        self.clear_sublayer();
        self.ensure_sublayer()?;
        self.add_drop_filters()?;
        self.add_permit_loopback()?;
        self.add_permit_connect(allow)?;
        self.add_permit_dhcp()?;
        if allow.allow_lan {
            self.add_permit_lan()?;
        }
        if !allow.endpoints.is_empty() {
            self.add_permit_endpoints(&allow.endpoints)?;
        }
        if let Some(luid) = self.tun_luid {
            self.permit_luid(luid)?;
        }
        Ok(())
    }

    fn permit_interface(&mut self, name: &str) -> Result<(), String> {
        let wide: Vec<u16> = OsStr::new(name).encode_wide().chain(std::iter::once(0)).collect();
        let mut luid = NET_LUID_LH { Value: 0 };
        let status = unsafe { ConvertInterfaceAliasToLuid(wide.as_ptr(), &mut luid) };
        if status != ERROR_SUCCESS {
            return Err(format!("Could not resolve interface alias '{name}' to LUID: {status:#x}"));
        }
        let luid_val = unsafe { luid.Value };
        self.tun_luid = Some(luid_val);
        self.permit_luid(luid_val)
    }

    fn update(&mut self, allow: &Allowlist) -> Result<(), String> {
        self.install(allow)
    }

    fn remove(&mut self) -> Result<(), String> {
        self.clear_sublayer();
        self.tun_luid = None;
        Ok(())
    }
}

impl Wfp {
    fn permit_luid(&self, mut luid_val: u64) -> Result<(), String> {
        // Crucial (Review Focus 1): conditionValue holds a pointer to luid_val, so luid_val must not move or drop
        let mut cond = FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_IP_LOCAL_INTERFACE,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_UINT64,
                Anonymous: FWP_CONDITION_VALUE0_0 {
                    uint64: &mut luid_val as *mut u64,
                },
            },
        };
        for (layer, name) in [
            (FWPM_LAYER_ALE_AUTH_CONNECT_V4, windows_sys::core::w!("Snifake Permit TUN v4")),
            (FWPM_LAYER_ALE_AUTH_CONNECT_V6, windows_sys::core::w!("Snifake Permit TUN v6")),
        ] {
            let mut weight_val: u64 = 300;
            let filter = FWPM_FILTER0 {
                filterKey: GUID { data1: 0x534e4946, data2: 0x0007, data3: 0, data4: [0; 8] },
                displayData: FWPM_DISPLAY_DATA0 { name: name as *mut u16, description: ptr::null_mut() },
                flags: 0,
                providerKey: ptr::null_mut(),
                providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
                layerKey: layer,
                subLayerKey: SUBLAYER_GUID,
                weight: FWP_VALUE0 { r#type: FWP_UINT64, Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 } },
                numFilterConditions: 1,
                filterCondition: &mut cond,
                action: FWPM_ACTION0 {
                    r#type: FWP_ACTION_PERMIT,
                    Anonymous: FWPM_ACTION0_0 { filterType: GUID { data1: 0, data2: 0, data3: 0, data4: [0; 8] } },
                },
                Anonymous: FWPM_FILTER0_0 { rawContext: 0 },
                reserved: ptr::null_mut(),
                filterId: 0,
                effectiveWeight: FWP_VALUE0 { r#type: FWP_EMPTY, Anonymous: FWP_VALUE0_0 { uint8: 0 } },
            };
            let status = unsafe { FwpmFilterAdd0(self.engine, &filter, ptr::null_mut(), ptr::null_mut()) };
            if status != ERROR_SUCCESS {
                return Err(format!("Failed to permit TUN interface: {status:#x}"));
            }
        }
        Ok(())
    }
}

impl Drop for Wfp {
    fn drop(&mut self) {
        if !self.engine.is_null() {
            unsafe {
                FwpmEngineClose0(self.engine);
            }
        }
    }
}

pub fn purge() -> Result<(), String> {
    let mut engine: HANDLE = ptr::null_mut();
    unsafe {
        let status = FwpmEngineOpen0(
            ptr::null(),
            RPC_C_AUTHN_DEFAULT as u32,
            ptr::null(),
            ptr::null(),
            &mut engine,
        );
        if status == ERROR_SUCCESS {
            let _ = FwpmSubLayerDeleteByKey0(engine, &SUBLAYER_GUID);
            FwpmEngineClose0(engine);
        }
    }
    Ok(())
}
