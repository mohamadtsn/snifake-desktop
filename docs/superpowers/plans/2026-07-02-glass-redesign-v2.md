# Glass GUI Redesign + Bug Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current monolithic, cramped `src/gui.py` layout with a resizable, well-spaced glassmorphism UI split into focused widget modules, and fix the real correctness bugs found in `src/*.py` during review (config defaults not merging, elevated process not fully terminating on stop, blocking sleep on the Qt event loop, missing input validation, unbounded log growth, a hardcoded color bypassing the theme).

**Architecture:** Extract a `src/theme.py` module holding the color palette and all shared QSS/glow helpers (currently duplicated inline in `src/gui.py`). Split the four visual sections of the window (status, config form, action buttons, log) into their own widgets under a new `src/widgets/` package, each owning its own styling and public interface. `src/gui.py` shrinks to `MainWindow` (assembly + signal wiring) and `SystemTrayIcon`. `src/titlebar.py` is unchanged — it already follows this pattern. `src/proxy.py`, `src/config.py`, and `src/icons.py` get targeted bug fixes, not rewrites.

**Tech Stack:** PySide6 (Qt6) — no new dependencies. `QSizeGrip` (ships with `QtWidgets`) replaces the fixed-size window to make it resizable without hand-rolling resize-drag math. `QTimer.singleShot` replaces a blocking `time.sleep` in `SniProxy.restart()`.

## Global Constraints

- No test suite exists in this project (see `CLAUDE.md`) and this plan does not introduce one (no new dependency on `pytest`). Verification per task is: (a) a quick offscreen smoke-import via `QT_QPA_PLATFORM=offscreen python -c "..."` where a widget can be constructed standalone, (b) `docker compose run --rm test` (ruff check + format) after every task, and (c) a full manual `python main.py` run-through in the final task.
- This repo is **not a git repository** — skip all `git add`/`git commit` steps; track progress via checkboxes only.
- Preserve the exact public surface `main.py` depends on: `MainWindow(config, proxy)`, `MainWindow.start_requested` / `MainWindow.stop_requested` Qt Signals, `SystemTrayIcon(window)`. Do not rename or change these signatures.
- Preserve the exact environment variable names passed to the `sni-spoof` binary: `LISTEN_HOST`, `LISTEN_PORT`, `CONNECT_IP`, `CONNECT_PORT`, `FAKE_SNI` — the external binary reads these names verbatim.
- English only for all code, comments, and UI strings.
- Don't touch `src/auth.py` or `src/autostart.py` — no bugs were found there and they're out of scope for this UI/bug pass.

---

### Task 1: `src/theme.py` — shared palette + glass/QSS helpers

**Files:**
- Create: `src/theme.py`

**Interfaces:**
- Produces: `COLORS: dict`, `SPACING: int`, `apply_glow(widget, color, blur=24, alpha=140, y_offset=4)`, `glass_panel_qss(selector="QFrame") -> str`, `input_qss() -> str`, `checkbox_qss() -> str`, `gradient_button_qss(color, hover) -> str`, `styled_button(text, color, hover) -> QPushButton` — consumed by every widget module in Tasks 5-9 and by `src/gui.py` in Task 9.

- [ ] **Step 1: Write the theme module**

`src/theme.py`:

```python
"""Shared color palette and QSS/glass styling helpers for SNI Spoof."""

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QGraphicsDropShadowEffect, QPushButton

COLORS = {
    "bg": "#1a1a2e",
    "bg_gradient_mid": "#16213e",
    "bg_gradient_end": "#0f0c29",
    "surface": "#16213e",
    "surface_light": "#1f3460",
    "surface_glass": "rgba(255, 255, 255, 16)",
    "surface_glass_sheen": "rgba(255, 255, 255, 28)",
    "border_glass": "rgba(255, 255, 255, 32)",
    "border_glass_dim": "rgba(255, 255, 255, 14)",
    "accent": "#0f3460",
    "primary": "#e94560",
    "primary_hover": "#ff6b81",
    "success": "#2ecc71",
    "success_hover": "#27ae60",
    "danger": "#e74c3c",
    "danger_hover": "#c0392b",
    "warning": "#f39c12",
    "text": "#ecf0f1",
    "text_dim": "#95a5a6",
    "border": "#2c3e50",
}

SPACING = 8  # base grid unit (px) — use multiples of this for margins/spacing


def apply_glow(widget, color: str, blur: int = 24, alpha: int = 140, y_offset: int = 4):
    """Attach a soft colored drop-shadow to a widget for a 'glass' lift effect."""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(blur)
    glow_color = QColor(color)
    glow_color.setAlpha(alpha)
    effect.setColor(glow_color)
    effect.setOffset(0, y_offset)
    widget.setGraphicsEffect(effect)


def glass_panel_qss(selector: str = "QFrame") -> str:
    """QSS for a frosted-glass panel: layered translucency + a soft top sheen."""
    return f"""
        {selector} {{
            background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                stop:0 {COLORS["surface_glass_sheen"]}, stop:1 {COLORS["surface_glass"]});
            border: 1px solid {COLORS["border_glass"]};
            border-bottom: 1px solid {COLORS["border_glass_dim"]};
            border-radius: 12px;
        }}
    """


def input_qss() -> str:
    """QSS for QLineEdit/QSpinBox fields used inside glass panels."""
    return f"""
        QLineEdit, QSpinBox {{
            background-color: {COLORS["surface_light"]};
            border: 1px solid {COLORS["border"]};
            border-radius: 6px;
            padding: {SPACING - 2}px {SPACING + 2}px;
            color: {COLORS["text"]};
            font-size: 13px;
        }}
        QLineEdit:focus, QSpinBox:focus {{
            border: 1px solid {COLORS["primary"]};
        }}
        QSpinBox::up-button, QSpinBox::down-button {{
            width: 20px;
            border: none;
            background-color: {COLORS["accent"]};
        }}
        QSpinBox::up-button {{
            border-top-right-radius: 6px;
        }}
        QSpinBox::down-button {{
            border-bottom-right-radius: 6px;
        }}
    """


def checkbox_qss() -> str:
    """QSS for QCheckBox controls used inside glass panels."""
    return f"""
        QCheckBox {{
            color: {COLORS["text"]};
            font-size: 13px;
            spacing: {SPACING}px;
        }}
        QCheckBox::indicator {{
            width: 18px;
            height: 18px;
            border-radius: 4px;
            border: 2px solid {COLORS["border"]};
            background-color: {COLORS["surface_light"]};
        }}
        QCheckBox::indicator:checked {{
            background-color: {COLORS["primary"]};
            border-color: {COLORS["primary"]};
        }}
    """


def gradient_button_qss(color: str, hover: str) -> str:
    """QSS for a gradient-filled rounded button."""
    return f"""
        QPushButton {{
            background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                stop:0 {hover}, stop:1 {color});
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0 {SPACING * 2}px;
            font-size: 13px;
            font-weight: 600;
        }}
        QPushButton:hover {{
            background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                stop:0 {hover}, stop:1 {hover});
        }}
        QPushButton:pressed {{
            padding-top: 2px;
        }}
        QPushButton:disabled {{
            background: {COLORS["border"]};
            color: {COLORS["text_dim"]};
        }}
    """


def styled_button(text: str, color: str, hover: str) -> QPushButton:
    """Create a gradient-filled rounded button with a matching glow."""
    btn = QPushButton(text)
    btn.setFixedHeight(38)
    btn.setCursor(Qt.PointingHandCursor)
    btn.setStyleSheet(gradient_button_qss(color, hover))
    apply_glow(btn, color, blur=16, alpha=110, y_offset=3)
    return btn
```

- [ ] **Step 2: Verify it imports standalone**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.theme import COLORS, SPACING, styled_button
btn = styled_button('Test', COLORS['success'], COLORS['success_hover'])
assert btn.text() == 'Test'
assert SPACING == 8
print('theme OK')
"
```

Expected output: `theme OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 2: Bugfix — `src/config.py` doesn't merge defaults for missing keys

**Files:**
- Modify: `src/config.py:52-58`

**Interfaces:** none — internal behavior fix, `Config.__getitem__`/`__setitem__`/`.data` unchanged.

**Problem:** `Config.load()` replaces `self._data` entirely with whatever is in `config.json`. If a user has an old/partial config file missing a key (e.g. upgraded from a version without `FAKE_SNI`), any later `config["FAKE_SNI"]` raises `KeyError` instead of falling back to `DEFAULT_CONFIG`.

- [ ] **Step 1: Fix `load()` to merge over defaults**

Replace (currently `src/config.py:52-58`):

```python
    def load(self):
        """Load config from file, falling back to defaults."""
        if self.config_path.exists():
            with open(self.config_path, "r") as f:
                self._data = json.load(f)
        else:
            self._data = dict(DEFAULT_CONFIG)
```

with:

```python
    def load(self):
        """Load config from file, falling back to defaults for missing keys."""
        if self.config_path.exists():
            with open(self.config_path, "r") as f:
                loaded = json.load(f)
            self._data = {**DEFAULT_CONFIG, **loaded}
        else:
            self._data = dict(DEFAULT_CONFIG)
```

- [ ] **Step 2: Verify the merge behavior**

Run:

```bash
python -c "
import json, tempfile, os
from pathlib import Path
from unittest import mock

tmpdir = tempfile.mkdtemp()
partial = {'LISTEN_HOST': '0.0.0.0'}  # missing every other key
cfg_path = Path(tmpdir) / 'config.json'
cfg_path.write_text(json.dumps(partial))

with mock.patch('src.config.get_app_dir', return_value=Path(tmpdir)):
    from src.config import Config
    c = Config()
    assert c['LISTEN_HOST'] == '0.0.0.0', 'explicit value should win'
    assert c['FAKE_SNI'] == 'chatgpt.com', 'missing key should fall back to default'
    print('config merge OK')
"
```

Expected output: `config merge OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 3: Bugfixes — `src/proxy.py` (orphaned elevated process, blocking restart, stray inline import)

**Files:**
- Modify: `src/proxy.py` (whole file)

**Interfaces:**
- Consumes: `Config`, `get_binary_path` from `src/config.py`; `get_elevated_prefix` from `src/auth.py` (all unchanged).
- Produces: `SniProxy.state_changed(str)`, `SniProxy.log_message(str)`, `SniProxy.start()`, `SniProxy.stop()`, `SniProxy.restart()`, `SniProxy.state`, `SniProxy.is_running` — same public surface as before, consumed by `main.py` and `src/gui.py` (Task 9). No signature changes.

**Problems found:**
1. `env = {**dict(__import__("os").environ), **env}` does an inline `__import__("os")` instead of a top-level `import os` — works, but is a code smell that also means `os` isn't available for the process-group fix below.
2. `stop()` calls `self._process.send_signal(signal.SIGTERM)`, which only signals the direct child. When the process was launched through `sudo -n` or `pkexec`, that direct child is the elevation wrapper, not the actual `sni-spoof` binary — on some systems the wrapper exits without forwarding the signal to its own child, leaving an unkillable root-owned proxy bound to the port.
3. `restart()` calls `time.sleep(0.5)` directly on whatever thread calls it — since `SniProxy` is a plain `QObject` living on the main/GUI thread, this blocks the Qt event loop (freezes the window) for half a second.

- [ ] **Step 1: Replace the whole file**

`src/proxy.py`:

```python
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
```

- [ ] **Step 2: Verify the module imports and basic lifecycle works without a real binary**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.config import Config
from src.proxy import SniProxy
import tempfile, json
from pathlib import Path
from unittest import mock

tmpdir = tempfile.mkdtemp()
with mock.patch('src.config.get_app_dir', return_value=Path(tmpdir)):
    cfg = Config()
proxy = SniProxy(cfg)
assert proxy.state == 'stopped'
proxy.start()  # binary won't exist in this sandbox -> should go to 'error', not crash
assert proxy.state == 'error'
proxy.stop()   # no process -> should be a no-op that stays 'stopped'
assert proxy.state == 'stopped'
print('proxy OK')
"
```

Expected output: `proxy OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 4: Bugfix — `src/icons.py` hardcoded color bypasses the theme

**Files:**
- Modify: `src/icons.py`

**Interfaces:** `load_app_icon`, `make_tray_icon`, `get_resource_path` signatures unchanged.

**Problem:** `make_tray_icon`'s badge outline is hardcoded to `"#1a1a2e"` instead of referencing the theme, so if the background color ever changes the badge outline silently goes out of sync.

- [ ] **Step 1: Import the theme color and use it**

Replace (currently `src/icons.py:1-9`):

```python
"""SVG icon loading and rendering helpers for SNI Spoof."""

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer
```

with:

```python
"""SVG icon loading and rendering helpers for SNI Spoof."""

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

from .theme import COLORS
```

Replace (currently `src/icons.py:44`):

```python
    painter.setPen(QColor("#1a1a2e"))
```

with:

```python
    painter.setPen(QColor(COLORS["bg"]))
```

- [ ] **Step 2: Verify icons still render**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.icons import load_app_icon, make_tray_icon
icon = load_app_icon()
tray_icon = make_tray_icon('#2ecc71')
assert not icon.isNull()
assert not tray_icon.isNull()
print('icons OK')
"
```

Expected output: `icons OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 5: `src/widgets/status_card.py` — status indicator

**Files:**
- Create: `src/widgets/__init__.py`
- Create: `src/widgets/status_card.py`

**Interfaces:**
- Consumes: `COLORS`, `SPACING`, `apply_glow`, `glass_panel_qss` from `src/theme.py` (Task 1).
- Produces: `StatusCard(parent=None)` with method `set_state(state: str)` where `state` is one of `"stopped"`, `"starting"`, `"running"`, `"error"` — consumed by `MainWindow` in Task 9.

- [ ] **Step 1: Create the package init**

`src/widgets/__init__.py`:

```python
"""UI widgets for the SNI Spoof main window."""
```

- [ ] **Step 2: Write the status card widget**

`src/widgets/status_card.py`:

```python
"""Status indicator card showing the proxy's current state."""

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPainter, QPixmap
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout

from ..theme import COLORS, SPACING, apply_glow, glass_panel_qss

_STATE_TEXT = {
    "stopped": "Stopped",
    "starting": "Starting…",
    "running": "Running",
    "error": "Error",
}

_STATE_COLOR = {
    "stopped": COLORS["text_dim"],
    "starting": COLORS["warning"],
    "running": COLORS["success"],
    "error": COLORS["danger"],
}

_STATE_SUBTITLE = {
    "stopped": "Proxy is not running",
    "starting": "Waiting for elevated launch…",
    "running": "Proxy is active",
    "error": "Proxy failed to start",
}


class StatusCard(QFrame):
    """Glass card with a colored dot, a state title, and a subtitle."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(glass_panel_qss("QFrame"))
        apply_glow(self, "#000000", blur=20, alpha=100, y_offset=3)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(SPACING * 2, SPACING * 2, SPACING * 2, SPACING * 2)
        layout.setSpacing(SPACING)

        self._dot = QLabel()
        self._dot.setFixedSize(16, 16)
        layout.addWidget(self._dot)

        text_layout = QVBoxLayout()
        text_layout.setSpacing(0)

        self._title = QLabel()
        self._title.setStyleSheet(
            f"font-size: 16px; font-weight: 700; color: {COLORS['text']};"
        )
        self._subtitle = QLabel()
        self._subtitle.setStyleSheet(f"font-size: 11px; color: {COLORS['text_dim']};")
        text_layout.addWidget(self._title)
        text_layout.addWidget(self._subtitle)

        layout.addLayout(text_layout)
        layout.addStretch()

        self.set_state("stopped")

    def _paint_dot(self, color: str):
        pixmap = QPixmap(16, 16)
        pixmap.fill(Qt.transparent)
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QColor(color))
        painter.setPen(Qt.NoPen)
        painter.drawEllipse(1, 1, 14, 14)
        painter.end()
        self._dot.setPixmap(pixmap)

    def set_state(self, state: str):
        """Update the card to reflect `state` ("stopped"/"starting"/"running"/"error")."""
        color = _STATE_COLOR.get(state, COLORS["text_dim"])
        self._title.setText(_STATE_TEXT.get(state, "Unknown"))
        self._subtitle.setText(_STATE_SUBTITLE.get(state, ""))
        self._paint_dot(color)
```

- [ ] **Step 3: Verify it constructs and updates standalone**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.widgets.status_card import StatusCard
card = StatusCard()
card.set_state('running')
assert card._title.text() == 'Running'
card.set_state('unknown_state')
assert card._title.text() == 'Unknown'
print('status_card OK')
"
```

Expected output: `status_card OK`

- [ ] **Step 4: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 6: `src/widgets/config_form.py` — grouped, validated config form

**Files:**
- Create: `src/widgets/config_form.py`

**Interfaces:**
- Consumes: `COLORS`, `SPACING`, `glass_panel_qss`, `input_qss` from `src/theme.py` (Task 1); `Config` from `src/config.py`.
- Produces: `ConfigForm(config: Config, parent=None)` with methods `apply_to(config: Config) -> None` and `validate() -> tuple[bool, str]` — consumed by `MainWindow` in Task 9.

**Bug fixed here:** the old form had no input validation at all — an empty host/IP/SNI, or a malformed IP, would be silently passed to the subprocess as an env var. `validate()` catches this before `start()`/`save()` proceed.

- [ ] **Step 1: Write the config form widget**

`src/widgets/config_form.py`:

```python
"""Proxy configuration form with grouped fields and inline validation."""

import ipaddress

from PySide6.QtWidgets import QFormLayout, QFrame, QGroupBox, QLineEdit, QSpinBox, QVBoxLayout

from ..config import Config
from ..theme import COLORS, SPACING, glass_panel_qss, input_qss


class ConfigForm(QGroupBox):
    """Editable proxy settings, grouped into Listen / Connect / SNI sections."""

    def __init__(self, config: Config, parent=None):
        super().__init__("Proxy Configuration", parent)
        self.setStyleSheet(
            glass_panel_qss("QGroupBox")
            + f"""
            QGroupBox {{
                margin-top: {SPACING * 2}px;
                padding: {SPACING * 3}px {SPACING * 2}px {SPACING * 2}px {SPACING * 2}px;
                font-size: 13px;
                font-weight: 600;
                color: {COLORS["text_dim"]};
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: {SPACING * 2}px;
                padding: 0 {SPACING}px;
            }}
        """
            + input_qss()
        )

        outer = QVBoxLayout(self)
        outer.setSpacing(SPACING * 2)

        self.host_edit = QLineEdit(config["LISTEN_HOST"])
        self.port_spin = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(config["LISTEN_PORT"])
        outer.addLayout(
            self._section([("Listen Host:", self.host_edit), ("Listen Port:", self.port_spin)])
        )
        outer.addWidget(self._separator())

        self.connect_ip_edit = QLineEdit(config["CONNECT_IP"])
        self.connect_port_spin = QSpinBox()
        self.connect_port_spin.setRange(1, 65535)
        self.connect_port_spin.setValue(config["CONNECT_PORT"])
        outer.addLayout(
            self._section(
                [("Connect IP:", self.connect_ip_edit), ("Connect Port:", self.connect_port_spin)]
            )
        )
        outer.addWidget(self._separator())

        self.sni_edit = QLineEdit(config["FAKE_SNI"])
        outer.addLayout(self._section([("Fake SNI:", self.sni_edit)]))

    def _separator(self) -> QFrame:
        line = QFrame()
        line.setFrameShape(QFrame.HLine)
        line.setStyleSheet(
            f"background-color: {COLORS['border_glass']}; max-height: 1px; border: none;"
        )
        return line

    def _section(self, rows: list) -> QFormLayout:
        form = QFormLayout()
        form.setSpacing(SPACING)
        for label, widget in rows:
            form.addRow(label, widget)
        return form

    def apply_to(self, config: Config) -> None:
        """Write the form's current values into `config` (does not save to disk)."""
        config["LISTEN_HOST"] = self.host_edit.text().strip()
        config["LISTEN_PORT"] = self.port_spin.value()
        config["CONNECT_IP"] = self.connect_ip_edit.text().strip()
        config["CONNECT_PORT"] = self.connect_port_spin.value()
        config["FAKE_SNI"] = self.sni_edit.text().strip()

    def validate(self) -> tuple[bool, str]:
        """Check the form's current values. Returns (is_valid, error_message)."""
        host = self.host_edit.text().strip()
        connect_ip = self.connect_ip_edit.text().strip()
        sni = self.sni_edit.text().strip()

        if not host:
            return False, "Listen Host cannot be empty."
        if not connect_ip:
            return False, "Connect IP cannot be empty."
        try:
            ipaddress.ip_address(connect_ip)
        except ValueError:
            return False, f"Connect IP '{connect_ip}' is not a valid IP address."
        if not sni:
            return False, "Fake SNI cannot be empty."
        return True, ""
```

- [ ] **Step 2: Verify construction, apply_to, and validate**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.widgets.config_form import ConfigForm

class FakeConfig(dict):
    def __getitem__(self, k):
        return dict.__getitem__(self, k)
    def __setitem__(self, k, v):
        dict.__setitem__(self, k, v)

cfg = FakeConfig(LISTEN_HOST='127.0.0.1', LISTEN_PORT=40443, CONNECT_IP='1.2.3.4', CONNECT_PORT=443, FAKE_SNI='chatgpt.com')
form = ConfigForm(cfg)
ok, err = form.validate()
assert ok, err

form.connect_ip_edit.setText('not-an-ip')
ok, err = form.validate()
assert not ok and 'valid IP' in err

form.connect_ip_edit.setText('1.2.3.4')
form.host_edit.setText('')
ok, err = form.validate()
assert not ok and 'Listen Host' in err

form.host_edit.setText('0.0.0.0')
out = FakeConfig(LISTEN_HOST='', LISTEN_PORT=0, CONNECT_IP='', CONNECT_PORT=0, FAKE_SNI='')
form.apply_to(out)
assert out['LISTEN_HOST'] == '0.0.0.0'
assert out['CONNECT_IP'] == '1.2.3.4'
print('config_form OK')
"
```

Expected output: `config_form OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 7: `src/widgets/action_bar.py` — start/stop/save/autostart/exit controls

**Files:**
- Create: `src/widgets/action_bar.py`

**Interfaces:**
- Consumes: `COLORS`, `SPACING`, `styled_button`, `checkbox_qss` from `src/theme.py` (Task 1).
- Produces: `ActionBar(autostart_enabled: bool, parent=None)` with Signals `start_clicked`, `stop_clicked`, `save_clicked`, `exit_clicked`, `autostart_toggled(bool)`, and method `set_running_state(state: str)` — consumed by `MainWindow` in Task 9.

- [ ] **Step 1: Write the action bar widget**

`src/widgets/action_bar.py`:

```python
"""Start/Stop/Save/Autostart/Exit action controls."""

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QCheckBox, QHBoxLayout, QVBoxLayout, QWidget

from ..theme import COLORS, SPACING, checkbox_qss, styled_button


class ActionBar(QWidget):
    """A Start/Stop row plus a Save/Autostart/Exit row."""

    start_clicked = Signal()
    stop_clicked = Signal()
    save_clicked = Signal()
    exit_clicked = Signal()
    autostart_toggled = Signal(bool)

    def __init__(self, autostart_enabled: bool, parent=None):
        super().__init__(parent)
        self.setStyleSheet(checkbox_qss())

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(SPACING)

        primary_row = QHBoxLayout()
        primary_row.setSpacing(SPACING + 2)

        self.start_btn = styled_button("Start", COLORS["success"], COLORS["success_hover"])
        self.start_btn.clicked.connect(self.start_clicked.emit)
        primary_row.addWidget(self.start_btn)

        self.stop_btn = styled_button("Stop", COLORS["danger"], COLORS["danger_hover"])
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self.stop_clicked.emit)
        primary_row.addWidget(self.stop_btn)

        layout.addLayout(primary_row)

        secondary_row = QHBoxLayout()
        secondary_row.setSpacing(SPACING)

        self.save_btn = styled_button("Save", COLORS["accent"], COLORS["surface_light"])
        self.save_btn.setFixedWidth(80)
        self.save_btn.clicked.connect(self.save_clicked.emit)
        secondary_row.addWidget(self.save_btn)

        self.autostart_cb = QCheckBox("Autostart")
        self.autostart_cb.setChecked(autostart_enabled)
        self.autostart_cb.toggled.connect(self.autostart_toggled.emit)
        secondary_row.addWidget(self.autostart_cb)

        secondary_row.addStretch()

        self.exit_btn = styled_button("Exit", "#555555", "#444444")
        self.exit_btn.setFixedWidth(80)
        self.exit_btn.clicked.connect(self.exit_clicked.emit)
        secondary_row.addWidget(self.exit_btn)

        layout.addLayout(secondary_row)

    def set_running_state(self, state: str):
        """Enable/disable Start/Stop to match the proxy's current state."""
        self.start_btn.setEnabled(state in ("stopped", "error"))
        self.stop_btn.setEnabled(state in ("running", "starting"))
```

- [ ] **Step 2: Verify signals fire and state toggling works**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.widgets.action_bar import ActionBar

bar = ActionBar(autostart_enabled=True)
assert bar.autostart_cb.isChecked()
assert bar.start_btn.isEnabled() and not bar.stop_btn.isEnabled()

fired = []
bar.start_clicked.connect(lambda: fired.append('start'))
bar.start_btn.click()
assert fired == ['start']

bar.set_running_state('running')
assert not bar.start_btn.isEnabled() and bar.stop_btn.isEnabled()
print('action_bar OK')
"
```

Expected output: `action_bar OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 8: `src/widgets/log_panel.py` — capped activity log

**Files:**
- Create: `src/widgets/log_panel.py`

**Interfaces:**
- Consumes: `COLORS`, `SPACING`, `apply_glow` from `src/theme.py` (Task 1).
- Produces: `LogPanel(parent=None)` with method `append(message: str)` — consumed by `MainWindow` in Task 9 (connected directly to `SniProxy.log_message`).

**Bug fixed here:** the old `QTextEdit.append()` call had no cap, so a long-running session accumulates unbounded log text in memory.

- [ ] **Step 1: Write the log panel widget**

`src/widgets/log_panel.py`:

```python
"""Scrolling activity log with a hard cap on retained lines."""

from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import QLabel, QTextEdit, QVBoxLayout, QWidget

from ..theme import COLORS, SPACING, apply_glow

MAX_LOG_LINES = 500


class LogPanel(QWidget):
    """Read-only scrolling log that discards the oldest lines past a cap."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(SPACING // 2)

        label = QLabel("Activity Log")
        label.setStyleSheet(
            f"color: {COLORS['text_dim']}; font-size: 12px; font-weight: 600;"
        )
        layout.addWidget(label)

        self._view = QTextEdit()
        self._view.setReadOnly(True)
        self._view.setStyleSheet(f"""
            QTextEdit {{
                background-color: {COLORS["surface_glass"]};
                border: 1px solid {COLORS["border_glass"]};
                border-radius: 8px;
                color: {COLORS["text_dim"]};
                font-size: 11px;
                font-family: monospace;
                padding: {SPACING}px;
            }}
        """)
        apply_glow(self._view, "#000000", blur=14, alpha=70, y_offset=2)
        layout.addWidget(self._view)

    def append(self, message: str):
        """Append `message` as a new log line, trimming oldest lines past the cap."""
        self._view.append(message)
        doc = self._view.document()
        excess = doc.blockCount() - MAX_LOG_LINES
        if excess <= 0:
            return
        cursor = self._view.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.Start)
        for _ in range(excess):
            cursor.select(QTextCursor.SelectionType.BlockUnderCursor)
            cursor.removeSelectedText()
            cursor.deleteChar()
```

- [ ] **Step 2: Verify the cap actually trims**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.widgets.log_panel import LogPanel, MAX_LOG_LINES

panel = LogPanel()
for i in range(MAX_LOG_LINES + 50):
    panel.append(f'line {i}')

block_count = panel._view.document().blockCount()
assert block_count <= MAX_LOG_LINES + 1, f'expected <= {MAX_LOG_LINES + 1} blocks, got {block_count}'
assert 'line 0' not in panel._view.toPlainText(), 'oldest line should have been trimmed'
assert f'line {MAX_LOG_LINES + 49}' in panel._view.toPlainText(), 'newest line should be present'
print('log_panel OK')
"
```

Expected output: `log_panel OK`

- [ ] **Step 3: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 9: `src/gui.py` — reassemble MainWindow, make the window resizable

**Files:**
- Modify: `src/gui.py` (full rewrite of `MainWindow` and `SystemTrayIcon`; `src/titlebar.py` is unchanged and stays imported as-is)

**Interfaces:**
- Consumes: `COLORS`, `SPACING`, `apply_glow` from `src/theme.py` (Task 1); `StatusCard` (Task 5); `ConfigForm` (Task 6); `ActionBar` (Task 7); `LogPanel` (Task 8); `TitleBar` from `src/titlebar.py` (unchanged); `load_app_icon`/`make_tray_icon` from `src/icons.py` (Task 4).
- Produces: `MainWindow(config: Config, proxy: SniProxy)` with Signals `start_requested`, `stop_requested` and `SystemTrayIcon(window: MainWindow)` — **must match exactly** what `main.py:26-30` already wires up (no changes needed in `main.py`).

**Fixes bundled into this rewrite:**
- Window is resizable now (`setMinimumSize` + a `QSizeGrip` in the bottom-right corner) instead of `setFixedSize(420, 560)`.
- `_on_start`/`_on_save_config` now call `ConfigForm.validate()` first and show a `QMessageBox.warning` instead of silently accepting bad input (closes the validation gap from Task 6).
- Default window size grows to 440×640 to fit the new spacing without feeling cramped.

- [ ] **Step 1: Replace the whole file**

`src/gui.py`:

```python
"""System tray icon and main window for SNI Spoof."""

from PySide6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QMainWindow,
    QMenu,
    QMessageBox,
    QSizeGrip,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)
from PySide6.QtCore import Qt, Signal, Slot
from PySide6.QtGui import QAction

from .config import Config
from .proxy import SniProxy
from .autostart import is_autostart_enabled, toggle_autostart
from .icons import load_app_icon, make_tray_icon
from .theme import COLORS, SPACING, apply_glow
from .titlebar import TitleBar
from .widgets.action_bar import ActionBar
from .widgets.config_form import ConfigForm
from .widgets.log_panel import LogPanel
from .widgets.status_card import StatusCard


class MainWindow(QMainWindow):
    """Modern, resizable main window with proxy controls."""

    start_requested = Signal()
    stop_requested = Signal()

    def __init__(self, config: Config, proxy: SniProxy):
        super().__init__()
        self.config = config
        self.proxy = proxy
        self.setWindowTitle("SNI Spoof")
        self.setMinimumSize(400, 560)
        self.resize(440, 640)
        self.setWindowFlags(Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowIcon(load_app_icon())

        central = QWidget()
        central.setObjectName("rootCard")
        central.setAttribute(Qt.WA_StyledBackground, True)
        self.setCentralWidget(central)
        central.setStyleSheet(f"""
            #rootCard {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 {COLORS["bg"]}, stop:0.5 {COLORS["bg_gradient_mid"]},
                    stop:1 {COLORS["bg_gradient_end"]});
                border-radius: 16px;
                border: 1px solid {COLORS["border"]};
            }}
        """)
        apply_glow(central, "#000000", blur=32, alpha=160, y_offset=8)

        outer_layout = QVBoxLayout(central)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        outer_layout.setSpacing(0)

        self.title_bar = TitleBar("SNI Spoof", load_app_icon(), COLORS, central)
        self.title_bar.minimize_requested.connect(self.showMinimized)
        self.title_bar.close_requested.connect(self.close)
        outer_layout.addWidget(self.title_bar)

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setSpacing(SPACING * 2)
        layout.setContentsMargins(SPACING * 2, SPACING * 2, SPACING * 2, SPACING * 2)
        outer_layout.addWidget(content, stretch=1)

        self.status_card = StatusCard()
        layout.addWidget(self.status_card)

        self.config_form = ConfigForm(config)
        layout.addWidget(self.config_form)

        self.action_bar = ActionBar(is_autostart_enabled())
        self.action_bar.start_clicked.connect(self._on_start)
        self.action_bar.stop_clicked.connect(self._on_stop)
        self.action_bar.save_clicked.connect(self._on_save_config)
        self.action_bar.exit_clicked.connect(self._on_exit)
        self.action_bar.autostart_toggled.connect(self._on_autostart_toggled)
        layout.addWidget(self.action_bar)

        self.log_panel = LogPanel()
        layout.addWidget(self.log_panel, stretch=1)

        grip_row = QHBoxLayout()
        grip_row.addStretch()
        grip_row.addWidget(QSizeGrip(self))
        layout.addLayout(grip_row)

        self.proxy.state_changed.connect(self._update_state)
        self.proxy.log_message.connect(self.log_panel.append)

    @Slot(str)
    def _update_state(self, state: str):
        self.status_card.set_state(state)
        self.action_bar.set_running_state(state)

    def _on_start(self):
        is_valid, error = self.config_form.validate()
        if not is_valid:
            QMessageBox.warning(self, "Invalid Configuration", error)
            return
        self.config_form.apply_to(self.config)
        self.start_requested.emit()

    def _on_stop(self):
        self.stop_requested.emit()

    def _on_save_config(self):
        is_valid, error = self.config_form.validate()
        if not is_valid:
            QMessageBox.warning(self, "Invalid Configuration", error)
            return
        self.config_form.apply_to(self.config)
        self.config.save()
        self.log_panel.append("Config saved")

    def _on_exit(self):
        self._confirm_and_exit()

    def _confirm_and_exit(self) -> bool:
        """Ask for confirmation, then stop the proxy and quit if approved.

        Returns True if the app is exiting, False if the user cancelled.
        """
        reply = QMessageBox.question(
            self,
            "Exit SNI Spoof",
            "Quit SNI Spoof and stop the proxy?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return False
        self.proxy.stop()
        QApplication.instance().quit()
        return True

    def closeEvent(self, event):
        if self._confirm_and_exit():
            event.accept()
        else:
            event.ignore()

    @Slot(bool)
    def _on_autostart_toggled(self, checked: bool):
        toggle_autostart(checked)


class SystemTrayIcon(QSystemTrayIcon):
    """System tray icon with context menu."""

    def __init__(self, window: MainWindow):
        super().__init__(make_tray_icon(COLORS["text_dim"]))
        self.window = window

        self.setToolTip("SNI Spoof — Stopped")

        menu = QMenu()
        menu.setStyleSheet(f"""
            QMenu {{
                background-color: {COLORS["surface"]};
                border: 1px solid {COLORS["border"]};
                border-radius: 8px;
                padding: {SPACING - 2}px;
            }}
            QMenu::item {{
                color: {COLORS["text"]};
                padding: {SPACING - 2}px {SPACING * 3}px;
                border-radius: 4px;
            }}
            QMenu::item:selected {{
                background-color: {COLORS["surface_light"]};
            }}
            QMenu::separator {{
                height: 1px;
                background-color: {COLORS["border"]};
                margin: {SPACING - 4}px {SPACING}px;
            }}
        """)

        self._show_action = QAction("Show Window")
        self._show_action.triggered.connect(self._show_window)
        menu.addAction(self._show_action)

        menu.addSeparator()

        self._start_action = QAction("Start Proxy")
        self._start_action.triggered.connect(window._on_start)
        menu.addAction(self._start_action)

        self._stop_action = QAction("Stop Proxy")
        self._stop_action.triggered.connect(window._on_stop)
        menu.addAction(self._stop_action)

        menu.addSeparator()

        quit_action = QAction("Exit")
        quit_action.triggered.connect(self._quit)
        menu.addAction(quit_action)

        self.setContextMenu(menu)
        self.activated.connect(self._on_activated)

        window.proxy.state_changed.connect(self._update_state)

    def _show_window(self):
        self.window.show()
        self.window.raise_()
        self.window.activateWindow()

    def _on_activated(self, reason):
        if reason == QSystemTrayIcon.DoubleClick:
            self._show_window()

    @Slot(str)
    def _update_state(self, state: str):
        colors = {
            "stopped": COLORS["text_dim"],
            "starting": COLORS["warning"],
            "running": COLORS["success"],
            "error": COLORS["danger"],
        }
        self.setIcon(make_tray_icon(colors.get(state, COLORS["text_dim"])))
        self.setToolTip(f"SNI Spoof — {state.capitalize()}")

    def _quit(self):
        self.window._confirm_and_exit()
```

- [ ] **Step 2: Verify the window constructs and signals are wired**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
import tempfile
from pathlib import Path
from unittest import mock

tmpdir = tempfile.mkdtemp()
with mock.patch('src.config.get_app_dir', return_value=Path(tmpdir)):
    from src.config import Config
    from src.proxy import SniProxy
    from src.gui import MainWindow, SystemTrayIcon

    cfg = Config()
    proxy = SniProxy(cfg)
    window = MainWindow(cfg, proxy)
    tray = SystemTrayIcon(window)

    assert window.minimumSize().width() == 400
    proxy._set_state('running')
    assert window.status_card._title.text() == 'Running'
    assert not window.action_bar.start_btn.isEnabled()
    print('gui OK')
"
```

Expected output: `gui OK`

- [ ] **Step 3: Full manual run-through**

Run: `python main.py` (or `docker compose run --rm dev` then `python main.py` inside)

Check:
1. Window opens at ~440×640, no OS title bar, rounded corners, visible diagonal 3-stop gradient background.
2. Drag the bottom-right corner grip → window resizes; drag below `setMinimumSize` (400×560) → it stops shrinking there.
3. Status card, config form, and log panel look like distinct frosted-glass panels (translucent, soft top sheen, soft shadow) with visibly more breathing room than before (8px-grid spacing, not the old cramped layout).
4. Config form shows three visually separated sections (Listen / Connect / SNI) with thin separator lines.
5. Clear the "Listen Host" field and click Start → a warning dialog appears, proxy does not attempt to start. Restore the value, click Start again → proceeds normally (or shows "Binary not found" if no real `sni-spoof` binary is present, which is expected in a dev sandbox).
6. Type `not-an-ip` into "Connect IP" and click Save → warning dialog, config not saved. Fix it and Save again → "Config saved" appears in the log.
7. Click Stop, Exit (with dialog), tray icon show/start/stop/exit — all behave as before (this plan didn't change that logic, only where it lives).

- [ ] **Step 4: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 10: Update `CLAUDE.md` architecture notes to match the new file layout

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none — documentation only.

**Problem:** `CLAUDE.md`'s Architecture section currently describes `src/gui.py` as a single file owning "MainWindow (config form + start/stop/save/autostart controls + activity log)". After Tasks 1-9 that's no longer true — leaving it as-is would mislead the next person (or agent) reading this file about where things live.

- [ ] **Step 1: Update the Architecture section**

In `CLAUDE.md`, find the bullet list under `## Architecture` and replace the `src/gui.py` line (and the line above it, if present, describing `src/titlebar.py`) with:

```markdown
- `src/theme.py` — shared color palette (`COLORS`), spacing constant (`SPACING`), and QSS/glow helpers (`apply_glow`, `glass_panel_qss`, `input_qss`, `checkbox_qss`, `gradient_button_qss`, `styled_button`) used by every widget module below.
- `src/widgets/status_card.py` — `StatusCard`: the glass panel showing current proxy state (dot + title + subtitle).
- `src/widgets/config_form.py` — `ConfigForm`: the Listen/Connect/SNI config fields, with `apply_to(config)` and `validate() -> (bool, str)`.
- `src/widgets/action_bar.py` — `ActionBar`: Start/Stop/Save/Autostart/Exit controls, exposed as Qt Signals (`start_clicked`, `stop_clicked`, `save_clicked`, `exit_clicked`, `autostart_toggled`).
- `src/widgets/log_panel.py` — `LogPanel`: capped-length (`MAX_LOG_LINES`) activity log.
- `src/gui.py` — `MainWindow` (assembles the widgets above via signals) and `SystemTrayIcon` (tray icon reflecting proxy state, context menu mirroring window actions). The window is resizable (`QSizeGrip`), not fixed-size.
- `src/titlebar.py` — `TitleBar`: custom draggable title bar for the frameless window (icon, title, drag-to-move, minimize/close buttons).
```

- [ ] **Step 2: Verify the doc matches the repo**

Run: `ls src/widgets/ src/theme.py`
Expected: lists `__init__.py`, `action_bar.py`, `config_form.py`, `log_panel.py`, `status_card.py`, and `src/theme.py` exists — confirming the doc isn't describing files that don't exist.

---

### Task 11: Final integration pass

**Files:** none (verification-only task).

- [ ] **Step 1: Full lint pass**

Run: `docker compose run --rm test`
Expected: `All checks passed`

- [ ] **Step 2: Full offscreen smoke test of the whole app wiring**

Run:

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
import tempfile
from pathlib import Path
from unittest import mock

tmpdir = tempfile.mkdtemp()
with mock.patch('src.config.get_app_dir', return_value=Path(tmpdir)):
    from src.config import Config
    from src.proxy import SniProxy
    from src.gui import MainWindow, SystemTrayIcon

    cfg = Config()
    proxy = SniProxy(cfg)
    window = MainWindow(cfg, proxy)
    tray = SystemTrayIcon(window)
    window.start_requested.connect(proxy.start)
    window.stop_requested.connect(proxy.stop)

    window.action_bar.start_btn.click()  # empty-safe: fields have default values
    print('integration OK, proxy state:', proxy.state)
"
```

Expected: prints `integration OK, proxy state: <starting|error>` (exact state depends on whether a real `sni-spoof` binary is present in the sandbox — either outcome confirms the wiring didn't crash).

- [ ] **Step 3: Manual visual/interactive run**

Run: `python main.py` and repeat the full checklist from Task 9 Step 3 one more time end-to-end, including autostart toggle (check `~/.config/autostart/sni-fake.desktop` appears/disappears) and tray minimize/restore.

- [ ] **Step 4: Mark plan complete**

Check off this step once Steps 1-3 all pass with no unexpected errors.