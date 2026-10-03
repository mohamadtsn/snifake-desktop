//! Launching the engine elevated from an unelevated GUI.
//!
//! `ShellExecuteExW` with the `runas` verb is the only supported way to do
//! this. It triggers the UAC consent dialog and, with SEE_MASK_NOCLOSEPROCESS,
//! returns a process handle so the GUI can still supervise the engine's
//! lifetime. It cannot redirect standard handles — which is exactly why the
//! GUI↔engine channel is a named pipe rather than stdio.

use crate::engine_host::EngineProcess;
use windows_sys::Win32::Foundation::{ERROR_CANCELLED, S_FALSE, S_OK};
use windows_sys::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows_sys::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Quotes each argument for the Windows command-line parser. Our arguments
/// are a pipe name and a hex token, but quoting is not optional: the engine
/// path can contain spaces (`C:\Program Files\...`).
fn join_args(args: &[String]) -> String {
    args.iter()
        .map(|a| format!("\"{}\"", a.replace('"', "\\\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

struct ComGuard(bool);
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

pub fn spawn_elevated(program: &str, args: &[String]) -> Result<EngineProcess, String> {
    crate::logging::info("elevate", &format!("spawning elevated engine: {program}"));

    // ShellExecuteEx delegates to Shell extensions that require COM STA.
    // Worker threads in Tokio pools do not have COM initialized by default.
    let hr = unsafe {
        CoInitializeEx(
            std::ptr::null_mut(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    let need_uninit = hr == S_OK || hr == S_FALSE;
    let _guard = ComGuard(need_uninit);

    let verb = wide("runas");
    let file = wide(program);
    let params = wide(&join_args(args));
    let dir = std::path::Path::new(program)
        .parent()
        .map(|p| wide(&p.to_string_lossy()))
        .unwrap_or_else(|| wide("."));

    // SAFETY: SHELLEXECUTEINFOW is a plain C struct with no invalid bit
    // patterns; every field is either set below or legitimately zero.
    // SEE_MASK_NOCLOSEPROCESS requests the child process handle (info.hProcess).
    // DO NOT set SEE_MASK_NOASYNC on worker threads without a message loop:
    // MSDN explicitly warns that SEE_MASK_NOASYNC without a message pump
    // causes ShellExecuteEx to hang indefinitely.
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.lpDirectory = dir.as_ptr();
    info.nShow = SW_HIDE as i32;

    // SAFETY: info is fully initialised and every pointer it holds outlives
    // the call.
    let ok = unsafe { ShellExecuteExW(&mut info) };
    if ok == 0 {
        let err = std::io::Error::last_os_error();
        crate::logging::error("elevate", &format!("ShellExecuteExW failed: {err}"));
        if err.raw_os_error() == Some(ERROR_CANCELLED as i32) {
            return Err("Administrator access was declined.".into());
        }
        return Err(format!("could not launch the engine elevated: {err}"));
    }
    if info.hProcess.is_null() {
        crate::logging::error("elevate", "ShellExecuteExW returned null process handle");
        return Err("the elevated engine started but returned no process handle".into());
    }
    crate::logging::info(
        "elevate",
        &format!("elevated engine spawned successfully, hProcess: {:?}", info.hProcess),
    );
    Ok(EngineProcess::Handle(info.hProcess as isize))
}

#[cfg(test)]
mod tests {
    use super::join_args;

    #[test]
    fn every_argument_is_quoted_so_spaces_survive() {
        assert_eq!(
            join_args(&[r"\\.\pipe\snifake-ab".into(), "deadbeef".into()]),
            "\"\\\\.\\pipe\\snifake-ab\" \"deadbeef\""
        );
    }

    #[test]
    fn an_embedded_quote_is_escaped_rather_than_ending_the_argument() {
        assert_eq!(join_args(&["a\"b".into()]), "\"a\\\"b\"");
    }
}
