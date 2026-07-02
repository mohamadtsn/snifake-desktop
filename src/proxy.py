"""SNI Spoof proxy process manager."""

import os
import signal
import subprocess
import sys

from PySide6.QtCore import QObject, QTimer, Signal

from .config import Config, get_binary_path
from .auth import get_elevated_prefix


class SniProxy(QObject):
    """Manages the sni-spoof binary process lifecycle."""

    state_changed = Signal(str)  # "stopped", "starting", "running", "error"
    log_message = Signal(str)

    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self._process: subprocess.Popen | None = None
        self._state = "stopped"

    @property
    def state(self) -> str:
        return self._state

    @property
    def is_running(self) -> bool:
        return (
            self._state == "running" and self._process and self._process.poll() is None
        )

    def _set_state(self, state: str):
        self._state = state
        self.state_changed.emit(state)

    def start(self):
        """Start the proxy process with elevated privileges."""
        if self.is_running:
            return

        binary = get_binary_path()
        if not binary.exists():
            self._set_state("error")
            self.log_message.emit(f"Binary not found: {binary}")
            return

        self._set_state("starting")
        prefix = get_elevated_prefix(str(binary))

        cmd = prefix + [str(binary)]
        env = {
            "LISTEN_HOST": self.config["LISTEN_HOST"],
            "LISTEN_PORT": str(self.config["LISTEN_PORT"]),
            "CONNECT_IP": self.config["CONNECT_IP"],
            "CONNECT_PORT": str(self.config["CONNECT_PORT"]),
            "FAKE_SNI": self.config["FAKE_SNI"],
        }
        full_env = {**os.environ, **env}

        popen_kwargs = {}
        if sys.platform != "win32":
            # Run in its own process group so stop() can signal the whole
            # tree: elevation wrappers (pkexec/sudo) fork the real binary as
            # a child, and signaling just the wrapper's PID can leave that
            # child running as an orphaned root process.
            popen_kwargs["start_new_session"] = True

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=full_env,
                text=True,
                **popen_kwargs,
            )
            self._set_state("running")
            self.log_message.emit(f"Proxy started (PID {self._process.pid})")
        except Exception as e:
            self._set_state("error")
            self.log_message.emit(f"Failed to start: {e}")

    def stop(self):
        """Stop the proxy process gracefully."""
        if not self._process:
            self._set_state("stopped")
            return

        try:
            self._terminate_process_tree()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._kill_process_tree()
                self._process.wait(timeout=3)
        except Exception:
            pass

        self._process = None
        self._set_state("stopped")
        self.log_message.emit("Proxy stopped")

    def _terminate_process_tree(self):
        if sys.platform == "win32":
            self._process.send_signal(signal.SIGTERM)
            return
        try:
            os.killpg(os.getpgid(self._process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            self._process.send_signal(signal.SIGTERM)

    def _kill_process_tree(self):
        if sys.platform == "win32":
            self._process.kill()
            return
        try:
            os.killpg(os.getpgid(self._process.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            self._process.kill()

    def restart(self):
        """Stop then start, without blocking the Qt event loop."""
        self.stop()
        QTimer.singleShot(500, self.start)
