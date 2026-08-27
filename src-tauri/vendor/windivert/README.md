# WinDivert binaries

`WinDivert.dll` and `WinDivert64.sys` from the official WinDivert **2.2.2-A**
x64 release: <https://reqrypt.org/windivert.html>
(`https://reqrypt.org/download/WinDivert-2.2.2-A.zip`, the `x64/` folder).

```
sha256(WinDivert-2.2.2-A.zip) = 63cb41763bb4b20f600b6de04e991a9c2be73279e317d4d82f237b150c5f3f15
sha256(WinDivert.dll)         = c1e060ee19444a259b2162f8af0f3fe8c4428a1c6f694dce20de194ac8d7d9a2
sha256(WinDivert64.sys)       = 8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2
```

**Ship the official signed build. Never rebuild the driver from source** —
an unsigned `.sys` is rejected with `ERROR_INVALID_IMAGE_HASH` on any
machine that has not had test signing enabled, which is all of them.

Both files must land in the same directory as `snifake-engine.exe`.
`scripts/stage-resources.sh` copies them into `src-tauri/resources/` for any
`*-windows-*` target, and `bundle.resources` in `tauri.conf.json` ships that
directory flat into the installed layout. The engine loads the DLL by name,
Windows finds it next to the executable, and `WinDivertOpen()` installs and
starts the driver service silently on first call — there is no separate
installer and no setup step for the user.

Only x64 is vendored, matching the only Windows target we build. Adding
`x86` or `arm64` means adding the matching `.sys` here **and** a case in
`stage-resources.sh`.

To refresh: download the new release, replace both files, update the hashes
above, and re-run the Windows verification in
`docs/superpowers/plans/2026-07-25-phase3-windows-windivert.md`.
