"""Configuration management for SNI Spoof."""

import json
import os
import sys
from pathlib import Path

DEFAULT_CONFIG = {
    "LISTEN_HOST": "127.0.0.1",
    "LISTEN_PORT": 40443,
    "CONNECT_IP": "103.160.204.34",
    "CONNECT_PORT": 443,
    "FAKE_SNI": "chatgpt.com",
}


def get_app_dir() -> Path:
    """Return platform-appropriate config directory."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "sni-fake"


def get_binary_path() -> Path:
    """Return the platform-appropriate sni-spoof binary path."""
    base = Path(__file__).resolve().parent.parent
    if sys.platform == "win32":
        return base / "sni-spoof-windows-amd64.exe"
    elif sys.platform == "darwin":
        import platform

        arch = platform.machine()
        name = f"sni-spoof-darwin-{arch}"
        return base / name
    else:
        return base / "sni-spoof-linux-amd64"


class Config:
    """App configuration backed by a JSON file."""

    def __init__(self):
        self.app_dir = get_app_dir()
        self.config_path = self.app_dir / "config.json"
        self._data: dict = {}
        self.load()

    def load(self):
        """Load config from file, falling back to defaults for missing keys."""
        if self.config_path.exists():
            with open(self.config_path, "r") as f:
                loaded = json.load(f)
            self._data = {**DEFAULT_CONFIG, **loaded}
        else:
            self._data = dict(DEFAULT_CONFIG)

    def save(self):
        """Persist current config to disk."""
        self.app_dir.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w") as f:
            json.dump(self._data, f, indent=2)

    def __getitem__(self, key):
        return self._data[key]

    def __setitem__(self, key, value):
        self._data[key] = value

    @property
    def data(self) -> dict:
        return dict(self._data)
