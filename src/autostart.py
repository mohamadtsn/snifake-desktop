"""Cross-platform autostart management."""

import sys
import textwrap
from pathlib import Path


APP_NAME = "sni-fake"
APP_DISPLAY = "SNI Spoof"


def _get_exe_path() -> str:
    """Return the current executable or script path."""
    if getattr(sys, "frozen", False):
        return sys.executable
    return (
        sys.executable
        + " "
        + str(Path(__file__).resolve().parent.parent / "src" / "main.py")
    )


def is_autostart_enabled() -> bool:
    """Check if autostart is currently enabled."""
    if sys.platform == "linux":
        desktop = Path.home() / ".config" / "autostart" / f"{APP_NAME}.desktop"
        return desktop.exists()
    elif sys.platform == "win32":
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            )
            winreg.QueryValueEx(key, APP_NAME)
            winreg.CloseKey(key)
            return True
        except (FileNotFoundError, OSError):
            return False
    elif sys.platform == "darwin":
        plist = Path.home() / "Library" / "LaunchAgents" / f"com.{APP_NAME}.plist"
        return plist.exists()
    return False


def toggle_autostart(enable: bool):
    """Enable or disable autostart."""
    if enable:
        _enable_autostart()
    else:
        _disable_autostart()


def _enable_autostart():
    exe = _get_exe_path()

    if sys.platform == "linux":
        _enable_linux(exe)
    elif sys.platform == "win32":
        _enable_windows(exe)
    elif sys.platform == "darwin":
        _enable_macos(exe)


def _disable_autostart():
    if sys.platform == "linux":
        _disable_linux()
    elif sys.platform == "win32":
        _disable_windows()
    elif sys.platform == "darwin":
        _disable_macos()


# ── Linux (.desktop) ──────────────────────────────────────────────


def _enable_linux(exe: str):
    autostart_dir = Path.home() / ".config" / "autostart"
    autostart_dir.mkdir(parents=True, exist_ok=True)
    desktop = autostart_dir / f"{APP_NAME}.desktop"
    desktop.write_text(
        textwrap.dedent(f"""\
        [Desktop Entry]
        Type=Application
        Name={APP_DISPLAY}
        Exec={exe}
        Hidden=false
        X-GNOME-Autostart-enabled=true
    """)
    )


def _disable_linux():
    desktop = Path.home() / ".config" / "autostart" / f"{APP_NAME}.desktop"
    if desktop.exists():
        desktop.unlink()


# ── Windows (Registry) ────────────────────────────────────────────


def _enable_windows(exe: str):
    import winreg

    key = winreg.OpenKey(
        winreg.HKEY_CURRENT_USER,
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        0,
        winreg.KEY_SET_VALUE,
    )
    winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{exe}"')
    winreg.CloseKey(key)


def _disable_windows():
    import winreg

    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        )
        winreg.DeleteValue(key, APP_NAME)
        winreg.CloseKey(key)
    except (FileNotFoundError, OSError):
        pass


# ── macOS (LaunchAgent) ──────────────────────────────────────────


def _enable_macos(exe: str):
    launch_dir = Path.home() / "Library" / "LaunchAgents"
    launch_dir.mkdir(parents=True, exist_ok=True)
    plist = launch_dir / f"com.{APP_NAME}.plist"
    plist.write_text(
        textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
          "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>com.{APP_NAME}</string>
            <key>ProgramArguments</key>
            <array>
                <string>{exe}</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
        </dict>
        </plist>
    """)
    )


def _disable_macos():
    plist = Path.home() / "Library" / "LaunchAgents" / f"com.{APP_NAME}.plist"
    if plist.exists():
        plist.unlink()
