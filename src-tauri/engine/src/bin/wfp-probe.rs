#[cfg(not(windows))]
fn main() {
    eprintln!("wfp-probe is Windows-only");
}

#[cfg(windows)]
mod win {
    use std::ptr;
    use windows_sys::core::GUID;
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::*;
    use windows_sys::Win32::System::Rpc::RPC_C_AUTHN_DEFAULT;

    pub const PROBE_SUBLAYER_GUID: GUID = GUID {
        data1: 0x534e4946,
        data2: 0x5455,
        data3: 0x4e00,
        data4: [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x01],
    };

    pub fn main() {

    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "run" => run_probe(),
        "purge" => purge_probe(),
        _ => {
            println!("Usage: wfp-probe.exe [run|purge]");
            println!("  run   - Installs WFP drop rules and pauses to test kill-switch survival");
            println!("  purge - Deletes the test sublayer and all associated filters");
        }
    }
}

fn run_probe() {
    println!("== 1. Opening WFP engine session (non-dynamic)...");
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
        eprintln!("FAIL: FwpmEngineOpen0 returned {:#x}", status);
        return;
    }
    println!("OK: Engine opened.");

    println!("== 2. Purging any previous test sublayer...");
    unsafe {
        let _ = FwpmSubLayerDeleteByKey0(engine, &PROBE_SUBLAYER_GUID);
    }

    println!("== 3. Adding persistent sublayer...");
    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: PROBE_SUBLAYER_GUID,
        displayData: FWPM_DISPLAY_DATA0 {
            name: windows_sys::core::w!("Snifake WFP Probe Sublayer") as *mut u16,
            description: ptr::null_mut(),
        },
        flags: 0,
        providerKey: ptr::null_mut(),
        providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
        weight: 0x8000,
    };
    let status = unsafe { FwpmSubLayerAdd0(engine, &sublayer, ptr::null_mut()) };
    if status != ERROR_SUCCESS {
        eprintln!("FAIL: FwpmSubLayerAdd0 returned {:#x}", status);
        unsafe { FwpmEngineClose0(engine); }
        return;
    }
    println!("OK: Sublayer added.");

    println!("== 4. Adding outbound drop filter...");
    let mut weight_val: u64 = 1;
    let filter = FWPM_FILTER0 {
        filterKey: GUID { data1: 0x534e4946, data2: 0x0001, data3: 0, data4: [0; 8] },
        displayData: FWPM_DISPLAY_DATA0 {
            name: windows_sys::core::w!("Snifake Probe Drop All") as *mut u16,
            description: ptr::null_mut(),
        },
        flags: 0,
        providerKey: ptr::null_mut(),
        providerData: FWP_BYTE_BLOB { size: 0, data: ptr::null_mut() },
        layerKey: FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        subLayerKey: PROBE_SUBLAYER_GUID,
        weight: FWP_VALUE0 {
            r#type: FWP_UINT64,
            Anonymous: FWP_VALUE0_0 { uint64: &mut weight_val as *mut u64 },
        },
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
    let status = unsafe { FwpmFilterAdd0(engine, &filter, ptr::null_mut(), ptr::null_mut()) };
    if status != ERROR_SUCCESS {
        eprintln!("FAIL: FwpmFilterAdd0 returned {:#x}", status);
        unsafe { FwpmEngineClose0(engine); }
        return;
    }
    println!("OK: Drop filter added.");
    unsafe { FwpmEngineClose0(engine); }

    println!("== 5. Sublayer and filters installed.");
    println!("Test instructions:");
    println!("  a) Try 'curl https://1.1.1.1' in another terminal -> Must TIMEOUT/FAIL.");
    println!("  b) Kill this process (Ctrl+C or taskkill).");
    println!("  c) Re-try curl -> Must STILL TIMEOUT/FAIL (confirms fail-closed survival).");
    println!("  d) Run 'wfp-probe.exe purge' -> Network must be RESTORED.");
}

fn purge_probe() {
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
            let del_status = FwpmSubLayerDeleteByKey0(engine, &PROBE_SUBLAYER_GUID);
            println!("Sublayer deletion returned: {:#x}", del_status);
            FwpmEngineClose0(engine);
            println!("OK: Probe filters purged. Connectivity restored.");
        } else {
            eprintln!("Failed to open engine: {:#x}", status);
        }
    }
}
}

#[cfg(windows)]
fn main() {
    win::main();
}


