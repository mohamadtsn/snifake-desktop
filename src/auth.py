"""Cross-platform privilege escalation for running the proxy."""

import os
import shutil
import subprocess
import sys


def _is_root() -> bool:
    """Check if already running as root."""
    if sys.platform == "win32":
        try:
            import ctypes

            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception:
            return False
    return os.geteuid() == 0


def get_elevated_prefix(binary_path: str) -> list[str]:
    """
    Return a command prefix to run `binary_path` with elevated privileges.

    Linux:   Uses pkexec (polkit GUI dialog).
    macOS:   Uses osascript with administrator privileges.
    Windows: Returns [] — UAC manifest handles elevation at launch.
    """
    if _is_root():
        return []

    if sys.platform == "linux":
        pkexec = shutil.which("pkexec")
        if pkexec:
            return [pkexec]
        # Fallback: try sudo
        sudo = shutil.which("sudo")
        if sudo:
            return [sudo, "-n"]
        return []

    elif sys.platform == "darwin":
        # osascript will prompt for password via native dialog
        return [
            "osascript",
            "-e",
            f'do shell script "{binary_path}" with administrator privileges',
        ]

    elif sys.platform == "win32":
        # Windows: handled by UAC manifest in the packaged .exe
        # For development, we try to re-launch elevated
        if not _is_root():
            try:
                import ctypes

                ctypes.windll.shell32.ShellExecuteW(
                    None, "runas", sys.executable, " ".join(sys.argv), None, 1
                )
                sys.exit(0)
            except Exception:
                pass
        return []

    return []


def test_elevation() -> bool:
    """Quick test: can we run a command with elevation?"""
    try:
        prefix = get_elevated_prefix("/bin/true")
        if not prefix:
            return _is_root()
        result = subprocess.run(prefix + ["/bin/true"], capture_output=True, timeout=10)
        return result.returncode == 0
    except Exception:
        return False
