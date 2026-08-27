//! WinDivert bound at runtime with LoadLibraryW + GetProcAddress.
//!
//! Dynamic rather than link-time on purpose: it removes the vendored
//! import library and the build script that would have to produce it, and
//! it turns "the DLL is missing" from a failure before `main` into an error
//! message the user can act on.

use std::ffi::CString;
use std::io;
use windows_sys::Win32::Foundation::{FreeLibrary, HANDLE, HMODULE};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

pub const LAYER_NETWORK: u32 = 0;
pub const FLAG_SNIFF: u64 = 0x0001;

/// `WINDIVERT_ADDRESS` is 64 bytes. Deliberately opaque: we capture one and
/// hand the same bytes back to `WinDivertSend`, so no bitfield layout
/// assumption can drift against a future WinDivert release.
pub const ADDRESS_LEN: usize = 64;

type FnOpen = unsafe extern "system" fn(*const i8, u32, i16, u64) -> HANDLE;
type FnRecvEx = unsafe extern "system" fn(
    HANDLE,
    *mut u8,
    u32,
    *mut u32,
    u64,
    *mut u8,
    *mut u32,
    *mut std::ffi::c_void,
) -> i32;
type FnSend = unsafe extern "system" fn(HANDLE, *const u8, u32, *mut u32, *const u8) -> i32;
type FnClose = unsafe extern "system" fn(HANDLE) -> i32;
type FnCalcChecksums = unsafe extern "system" fn(*mut u8, u32, *const u8, u64) -> i32;

pub struct WinDivertApi {
    module: HMODULE,
    pub open: FnOpen,
    pub recv_ex: FnRecvEx,
    pub send: FnSend,
    pub close: FnClose,
    pub calc_checksums: FnCalcChecksums,
}

// The module handle and the function pointers are immutable after load.
unsafe impl Send for WinDivertApi {}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

impl WinDivertApi {
    /// Loads the DLL sitting next to the engine executable. Windows searches
    /// the executable's directory first, which is where the bundler puts it.
    pub fn load() -> io::Result<Self> {
        Self::load_from("WinDivert.dll")
    }

    pub fn load_from(name: &str) -> io::Result<Self> {
        let wide_name = wide(name);
        // SAFETY: wide_name is a valid NUL-terminated UTF-16 string.
        let module = unsafe { LoadLibraryW(wide_name.as_ptr()) };
        if module.is_null() {
            return Err(io::Error::other(format!(
                "could not load {name} ({}). It must sit next to the engine executable.",
                io::Error::last_os_error()
            )));
        }

        // SAFETY: each symbol is looked up by its documented name and
        // transmuted to its documented signature; a missing symbol is
        // checked for before the transmute.
        unsafe {
            let sym = |n: &str| -> io::Result<*const ()> {
                let c = CString::new(n).unwrap();
                match GetProcAddress(module, c.as_ptr() as *const u8) {
                    Some(p) => Ok(p as *const ()),
                    None => Err(io::Error::other(format!("{name} has no symbol {n}"))),
                }
            };
            let api = WinDivertApi {
                module,
                open: std::mem::transmute::<*const (), FnOpen>(sym("WinDivertOpen")?),
                recv_ex: std::mem::transmute::<*const (), FnRecvEx>(sym("WinDivertRecvEx")?),
                send: std::mem::transmute::<*const (), FnSend>(sym("WinDivertSend")?),
                close: std::mem::transmute::<*const (), FnClose>(sym("WinDivertClose")?),
                calc_checksums: std::mem::transmute::<*const (), FnCalcChecksums>(sym(
                    "WinDivertHelperCalcChecksums",
                )?),
            };
            Ok(api)
        }
    }
}

impl Drop for WinDivertApi {
    fn drop(&mut self) {
        // SAFETY: a module handle we loaded and have not freed.
        unsafe { FreeLibrary(self.module) };
    }
}
