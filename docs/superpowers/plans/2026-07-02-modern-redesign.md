# Modern Redesign + Confirm-Exit + App Icon + README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give SNI Spoof a frameless dark-glassmorphism GUI, a unified confirm-before-exit flow (window close, Exit button, tray Exit all go through one dialog), a custom SVG app icon (also used for the tray icon with a status badge), and a standard English README.

**Architecture:** All GUI changes live in `src/gui.py` plus two new small focused modules: `src/icons.py` (SVG icon loading/rendering) and `src/titlebar.py` (the frameless window's custom draggable title bar). No changes to `src/proxy.py`, `src/config.py`, or `src/auth.py` — this is a UI-only pass. Packaging config (`sni-fake.spec`, `docker-compose.yml`) gets updated to bundle the new `assets/icon.svg`.

**Tech Stack:** PySide6 (Qt6) — `QtSvg` for icon rendering (ships with base PySide6, no new dependency), `QGraphicsDropShadowEffect` for glass-card glow, `QWindow.startSystemMove()` for frameless drag (native WM delegation, not hand-rolled geometry math).

## Global Constraints

- No test suite exists in this project (see CLAUDE.md) — verification is manual: run the app (`python main.py` or `docker compose run --rm dev`) and observe behavior, plus `docker compose run --rm test` (ruff check + format) after every task.
- This repo is **not a git repository** (`git -C . status` → "Not a git repository"). Skip all `git add`/`git commit` steps from the standard plan template — mark tasks done via checkbox only. If the user later runs `git init`, a single commit can be made covering everything.
- Don't over-trust the existing source as correct-by-default. While touching a file for this plan, if you notice a bug, dead code, or inconsistency in the surrounding code you're editing (e.g. unused imports, a state check that doesn't match `SniProxy`'s actual emitted states), fix it as part of the task and note it in that task's completion — don't silently work around it or leave it for later.
- Preserve existing behavior that isn't in scope: proxy start/stop logic, config persistence, autostart toggle, elevation logic (`src/auth.py`) are untouched.
- Window stays fixed-size (no edge-resize) — frameless windows lose native edge-resize and that's out of scope.
- English only for all new UI strings, code, comments, and docs (README is English per user's choice).

---

### Task 1: App icon asset + SVG icon-loading helper

**Files:**
- Create: `assets/icon.svg`
- Create: `src/icons.py`

**Interfaces:**
- Produces: `get_resource_path(name: str) -> Path`, `load_app_icon(size: int = 128) -> QIcon`, `make_tray_icon(status_color: str, size: int = 64) -> QIcon` — used by Task 3 (title bar icon) and Task 5 (tray icon + window icon).

- [ ] **Step 1: Create the SVG icon**

`assets/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0f3460"/>
    </linearGradient>
    <linearGradient id="shield" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e94560"/>
      <stop offset="100%" stop-color="#ff6b81"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="60" fill="url(#bg)" stroke="#2c3e50" stroke-width="2"/>
  <path d="M64 26 L96 40 V64 C96 86 82 102 64 110 C46 102 32 86 32 64 V40 Z"
        fill="url(#shield)" opacity="0.95"/>
  <path d="M50 64 L60 74 L80 52" fill="none" stroke="#ecf0f1" stroke-width="6"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 2: Write the icon loader module**

`src/icons.py`:

```python
"""SVG icon loading and rendering helpers for SNI Spoof."""

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer


def get_resource_path(name: str) -> Path:
    """Return path to a bundled resource, handling PyInstaller's frozen layout."""
    if hasattr(sys, "_MEIPASS"):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent.parent
    return base / name


def load_app_icon(size: int = 128) -> QIcon:
    """Render assets/icon.svg into a QIcon at the given pixel size."""
    renderer = QSvgRenderer(str(get_resource_path("assets/icon.svg")))
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    renderer.render(painter)
    painter.end()
    return QIcon(pixmap)


def make_tray_icon(status_color: str, size: int = 64) -> QIcon:
    """App icon with a small colored status badge in the bottom-right corner."""
    renderer = QSvgRenderer(str(get_resource_path("assets/icon.svg")))
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter)

    badge_size = int(size * 0.36)
    x = size - badge_size - 2
    y = size - badge_size - 2
    painter.setBrush(QColor(status_color))
    painter.setPen(QColor("#1a1a2e"))
    painter.drawEllipse(x, y, badge_size, badge_size)
    painter.end()
    return QIcon(pixmap)
```

- [ ] **Step 3: Verify it renders**

Run (offscreen, no display needed):

```bash
QT_QPA_PLATFORM=offscreen python -c "
from PySide6.QtWidgets import QApplication
app = QApplication([])
from src.icons import load_app_icon, make_tray_icon
icon = load_app_icon()
tray_icon = make_tray_icon('#2ecc71')
assert not icon.isNull(), 'app icon failed to render'
assert not tray_icon.isNull(), 'tray icon failed to render'
print('icons OK')
"
```

Expected output: `icons OK`

- [ ] **Step 4: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 2: Unified confirm-before-exit

**Files:**
- Modify: `src/gui.py` (`MainWindow` class, `SystemTrayIcon` class)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MainWindow._confirm_and_exit() -> bool` — used by Task 3's title bar close button and by `SystemTrayIcon._quit()`.

- [ ] **Step 1: Add `QMessageBox` to the imports**

In `src/gui.py`, modify the `QtWidgets` import block (currently `src/gui.py:3-8`):

```python
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QSystemTrayIcon, QMenu,
    QPushButton, QLabel, QVBoxLayout, QWidget, QCheckBox,
    QHBoxLayout, QGroupBox, QFormLayout, QLineEdit, QSpinBox,
    QTextEdit, QFrame, QGraphicsDropShadowEffect, QMessageBox,
)
```

- [ ] **Step 2: Replace `_on_exit` with a shared confirm-and-exit method, and override `closeEvent`**

In `src/gui.py`, replace the existing `_on_exit` method (currently `src/gui.py:339-341`):

```python
    def _on_exit(self):
        self.proxy.stop()
        QApplication.instance().quit()
```

with:

```python
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
```

- [ ] **Step 3: Route the tray's Exit action through the same method**

In `src/gui.py`, replace `SystemTrayIcon._quit` (currently `src/gui.py:432-434`):

```python
    def _quit(self):
        self.window.proxy.stop()
        QApplication.instance().quit()
```

with:

```python
    def _quit(self):
        self.window._confirm_and_exit()
```

- [ ] **Step 4: Manual verification**

Run: `python main.py` (or `docker compose run --rm dev` then `python main.py` inside)

Check:
1. Click the window's Exit button → dialog appears → No → window stays open. Yes → app fully quits (tray icon disappears).
2. Relaunch. Click the window's X (close) → same dialog → No → window stays open (not closed). Yes → app quits.
3. Relaunch. Right-click tray icon → Exit → same dialog → No → app keeps running. Yes → app quits.

- [ ] **Step 5: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 3: Frameless window + custom draggable title bar

**Files:**
- Create: `src/titlebar.py`
- Modify: `src/gui.py` (`MainWindow.__init__`)

**Interfaces:**
- Consumes: `load_app_icon()` from Task 1's `src/icons.py`; `MainWindow.close()` (built-in) and `MainWindow._confirm_and_exit()`/`closeEvent` from Task 2.
- Produces: `TitleBar(title: str, icon: QIcon, colors: dict, parent=None)` with signals `minimize_requested` and `close_requested` — used by `MainWindow.__init__` in this task, and its `close_requested` signal must connect to `MainWindow.close` (which now routes through `closeEvent` → `_confirm_and_exit`, so the confirm dialog still fires for the custom close button).

- [ ] **Step 1: Write the `TitleBar` widget**

`src/titlebar.py`:

```python
"""Custom draggable title bar for the frameless main window."""

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget


class TitleBar(QWidget):
    """Frameless-window title bar: icon, title, drag area, minimize/close buttons."""

    minimize_requested = Signal()
    close_requested = Signal()

    def __init__(self, title: str, icon: QIcon, colors: dict, parent=None):
        super().__init__(parent)
        self._colors = colors
        self.setFixedHeight(40)
        self.setObjectName("titleBar")
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(f"""
            #titleBar {{
                background-color: {colors['surface']};
                border-top-left-radius: 16px;
                border-top-right-radius: 16px;
            }}
        """)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 6, 10, 6)
        layout.setSpacing(8)

        icon_label = QLabel()
        icon_label.setPixmap(icon.pixmap(20, 20))
        layout.addWidget(icon_label)

        title_label = QLabel(title)
        title_label.setStyleSheet(f"color: {colors['text']}; font-size: 13px; font-weight: 600;")
        layout.addWidget(title_label)

        layout.addStretch()

        self.min_btn = self._make_control_button("–", colors['text_dim'])
        self.min_btn.clicked.connect(self.minimize_requested.emit)
        layout.addWidget(self.min_btn)

        self.close_btn = self._make_control_button("×", colors['danger'])
        self.close_btn.clicked.connect(self.close_requested.emit)
        layout.addWidget(self.close_btn)

    def _make_control_button(self, symbol: str, hover_color: str) -> QPushButton:
        btn = QPushButton(symbol)
        btn.setFixedSize(28, 24)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {self._colors['text_dim']};
                border: none;
                border-radius: 6px;
                font-size: 15px;
                font-weight: 700;
            }}
            QPushButton:hover {{
                background-color: {hover_color};
                color: white;
            }}
        """)
        return btn

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            handle = self.window().windowHandle()
            if handle is not None:
                handle.startSystemMove()
                event.accept()
                return
        super().mousePressEvent(event)
```

`–` is en-dash (minimize glyph), `×` is multiplication-sign-as-X (close glyph) — plain ASCII `-`/`x` look cramped at this button size, these render as cleaner symbols.

- [ ] **Step 2: Wire the frameless window + title bar into `MainWindow.__init__`**

In `src/gui.py`, add the import (near the top, alongside the existing `from .config import Config` etc.):

```python
from .icons import load_app_icon
from .titlebar import TitleBar
```

Replace the window setup at the start of `__init__` (currently `src/gui.py:103-105`):

```python
        self.setWindowTitle("SNI Spoof")
        self.setFixedSize(420, 520)
        self.setWindowFlags(Qt.WindowCloseButtonHint)
```

with:

```python
        self.setWindowTitle("SNI Spoof")
        self.setFixedSize(420, 560)
        self.setWindowFlags(Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowIcon(load_app_icon())
```

(560 = old 520 + 40px title bar height, so the content area keeps its original size.)

Replace the central-widget setup and the "Header" section (currently `src/gui.py:174-190`, i.e. from `central = QWidget()` through the `layout.addWidget(header)` line) with:

```python
        central = QWidget()
        central.setObjectName("rootCard")
        central.setAttribute(Qt.WA_StyledBackground, True)
        self.setCentralWidget(central)

        outer_layout = QVBoxLayout(central)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        outer_layout.setSpacing(0)

        self.title_bar = TitleBar("SNI Spoof", load_app_icon(), COLORS, central)
        self.title_bar.minimize_requested.connect(self.showMinimized)
        self.title_bar.close_requested.connect(self.close)
        outer_layout.addWidget(self.title_bar)

        content = QWidget()
        content.setObjectName("content")
        layout = QVBoxLayout(content)
        layout.setSpacing(12)
        layout.setContentsMargins(20, 16, 20, 20)
        outer_layout.addWidget(content)
```

Every subsequent `layout.addWidget(...)` / `layout.addLayout(...)` call in `__init__` (status frame, config group, action buttons, bottom row, log label, log view) stays exactly as-is — they already reference the local variable `layout`, which now points at `content`'s layout instead of `central`'s. No other line changes are needed for this step.

The big `self.setStyleSheet(...)` call currently at `src/gui.py:106-172` (the one covering `QMainWindow`, `QGroupBox`, `QLineEdit`, etc.) must move from `self.setStyleSheet(...)` to `content.setStyleSheet(...)` and drop the `QMainWindow { background-color: ... }` rule from it (the root card's background is now handled separately in Task 4, since a translucent frameless `QMainWindow` has no meaningful "background" of its own — `central`/`#rootCard` is the visible surface). Leave every other rule in that stylesheet block unchanged for this task; Task 4 will update the colors.

- [ ] **Step 3: Manual verification**

Run: `python main.py`

Check:
1. Window appears with no OS title bar — a dark rounded-corner rectangle with the custom title bar (icon, "SNI Spoof" text, minimize/close buttons) at the top.
2. Drag the custom title bar → window moves.
3. Click minimize (–) → window minimizes to taskbar/dock.
4. Click close (×) → the Task 2 confirm-exit dialog appears (proves `close_requested` → `close()` → `closeEvent` → `_confirm_and_exit` chain works).
5. All existing content (status, config form, buttons, log) still visible and functional below the title bar.

- [ ] **Step 4: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 4: Dark-gradient glassmorphism restyle

**Files:**
- Modify: `src/gui.py` (`COLORS` dict, `_styled_button`, `MainWindow.__init__` styling, status frame, config group)

**Interfaces:**
- Consumes: `content` widget and `central` widget from Task 3.
- Produces: nothing new consumed by later tasks — purely visual.

- [ ] **Step 1: Extend the color palette**

In `src/gui.py`, replace the `COLORS` dict (currently `src/gui.py:21-34`):

```python
COLORS = {
    "bg": "#1a1a2e",
    "surface": "#16213e",
    "surface_light": "#1f3460",
    "accent": "#0f3460",
    "primary": "#e94560",
    "primary_hover": "#ff6b81",
    "success": "#2ecc71",
    "warning": "#f39c12",
    "danger": "#e74c3c",
    "text": "#ecf0f1",
    "text_dim": "#95a5a6",
    "border": "#2c3e50",
}
```

with:

```python
COLORS = {
    "bg": "#1a1a2e",
    "bg_gradient_end": "#0f0c29",
    "surface": "#16213e",
    "surface_light": "#1f3460",
    "surface_glass": "rgba(255, 255, 255, 18)",
    "border_glass": "rgba(255, 255, 255, 30)",
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
```

Note: `rgba(255, 255, 255, 18)` uses Qt stylesheet's 0-255 alpha channel (not CSS's 0-1/percent syntax) — Qt's `rgba()` in QSS takes four integers 0-255.

- [ ] **Step 2: Add a drop-shadow helper**

In `src/gui.py`, add this function right after `_make_status_icon` (after line 61, before `_styled_button`):

```python
def _apply_glow(widget, color: str, blur: int = 24, alpha: int = 140, y_offset: int = 4):
    """Attach a soft colored drop-shadow to a widget for a 'glass' lift effect."""
    effect = QGraphicsDropShadowEffect(widget)
    effect.setBlurRadius(blur)
    glow_color = QColor(color)
    glow_color.setAlpha(alpha)
    effect.setColor(glow_color)
    effect.setOffset(0, y_offset)
    widget.setGraphicsEffect(effect)
```

- [ ] **Step 3: Give the root card a gradient background + rounded corners + outer shadow**

In `src/gui.py`, in `MainWindow.__init__`, right after `self.setCentralWidget(central)` (added in Task 3), add:

```python
        central.setStyleSheet(f"""
            #rootCard {{
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 {COLORS['bg']}, stop:1 {COLORS['bg_gradient_end']});
                border-radius: 16px;
                border: 1px solid {COLORS['border']};
            }}
        """)
        _apply_glow(central, "#000000", blur=32, alpha=160, y_offset=8)
```

- [ ] **Step 4: Glass-ify the status frame**

In `src/gui.py`, replace the status frame's stylesheet (currently `src/gui.py:194-200`):

```python
        status_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {COLORS['surface']};
                border-radius: 10px;
                padding: 8px;
            }}
        """)
```

with:

```python
        status_frame.setAttribute(Qt.WA_StyledBackground, True)
        status_frame.setStyleSheet(f"""
            QFrame {{
                background-color: {COLORS['surface_glass']};
                border: 1px solid {COLORS['border_glass']};
                border-radius: 12px;
                padding: 8px;
            }}
        """)
        _apply_glow(status_frame, "#000000", blur=18, alpha=90, y_offset=2)
```

- [ ] **Step 5: Update the shared content stylesheet with glass colors**

In the `content.setStyleSheet(...)` block moved in Task 3 (originally `src/gui.py:106-172`), apply these replacements:

- `QGroupBox` background: change `background-color: {COLORS['surface']};` to `background-color: {COLORS['surface_glass']};` and its `border: 1px solid {COLORS['border']};` to `border: 1px solid {COLORS['border_glass']};`.
- `QTextEdit` (the log view) background: same swap — `background-color: {COLORS['surface_glass']};` / `border: 1px solid {COLORS['border_glass']};`.
- Leave `QLineEdit`, `QSpinBox`, `QCheckBox` rules as-is (they already use `surface_light`, which still reads correctly against the new gradient).

After this edit, add a glow to the config group and log view in `__init__` right after they're constructed:

```python
        _apply_glow(config_group, "#000000", blur=18, alpha=90, y_offset=2)
```

(add directly after `layout.addWidget(config_group)`), and:

```python
        _apply_glow(self.log_view, "#000000", blur=14, alpha=70, y_offset=2)
```

(add directly after `layout.addWidget(self.log_view)`).

- [ ] **Step 6: Gradient buttons with colored glow**

Replace `_styled_button` (currently `src/gui.py:64-90`):

```python
def _styled_button(text: str, color: str, hover: str) -> QPushButton:
    """Create a styled rounded button."""
    btn = QPushButton(text)
    btn.setFixedHeight(38)
    btn.setCursor(Qt.PointingHandCursor)
    btn.setStyleSheet(f"""
        QPushButton {{
            background-color: {color};
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0 20px;
            font-size: 13px;
            font-weight: 600;
        }}
        QPushButton:hover {{
            background-color: {hover};
        }}
        QPushButton:pressed {{
            padding-top: 2px;
        }}
        QPushButton:disabled {{
            background-color: {COLORS['border']};
            color: {COLORS['text_dim']};
        }}
    """)
    return btn
```

with:

```python
def _styled_button(text: str, color: str, hover: str) -> QPushButton:
    """Create a gradient-filled rounded button with a matching glow."""
    btn = QPushButton(text)
    btn.setFixedHeight(38)
    btn.setCursor(Qt.PointingHandCursor)
    btn.setStyleSheet(f"""
        QPushButton {{
            background: qlineargradient(x1:0, y1:0, x2:0, y2:1,
                stop:0 {hover}, stop:1 {color});
            color: white;
            border: none;
            border-radius: 8px;
            padding: 0 20px;
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
            background: {COLORS['border']};
            color: {COLORS['text_dim']};
        }}
    """)
    _apply_glow(btn, color, blur=16, alpha=110, y_offset=3)
    return btn
```

The three call sites (`start_btn`, `stop_btn`, `save_btn`, `exit_btn`) don't need to change — they already pass `(text, color, hover)` positionally, and `_apply_glow` now runs inside the factory automatically. Update the `save_btn`/`exit_btn` call sites' colors to use the new `success_hover`/`danger_hover` keys where they previously used raw hex hovers:

Replace (currently `src/gui.py:250, 254`):

```python
        self.start_btn = _styled_button("Start", COLORS['success'], "#27ae60")
        ...
        self.stop_btn = _styled_button("Stop", COLORS['danger'], "#c0392b")
```

with:

```python
        self.start_btn = _styled_button("Start", COLORS['success'], COLORS['success_hover'])
        ...
        self.stop_btn = _styled_button("Stop", COLORS['danger'], COLORS['danger_hover'])
```

- [ ] **Step 7: Manual verification**

Run: `python main.py`

Check:
1. Window background is a visible diagonal dark gradient, not flat.
2. Status frame, config group, and log view look "glassy" (semi-transparent, soft border, subtle shadow) against the gradient.
3. Start/Stop/Save/Exit buttons show a vertical gradient fill and a soft colored glow; hovering brightens them.
4. Whole window has a soft outer shadow and rounded corners (no square edges visible).
5. No visual regression: all text still legible (contrast check — text is `COLORS['text']` = light gray/white against dark glass, should be fine).

- [ ] **Step 8: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 5: Tray icon uses the new SVG + status badge

**Files:**
- Modify: `src/gui.py` (`SystemTrayIcon`, remove now-unused `_make_status_icon`)

**Interfaces:**
- Consumes: `make_tray_icon(status_color: str, size: int = 64) -> QIcon` from Task 1's `src/icons.py`.

- [ ] **Step 1: Remove the old dot-only icon generator**

Delete `_make_status_icon` (currently `src/gui.py:37-61`) — it's fully superseded by `make_tray_icon` from `src/icons.py`.

- [ ] **Step 2: Import `make_tray_icon`**

In `src/gui.py`, update the icons import added in Task 3:

```python
from .icons import load_app_icon, make_tray_icon
```

- [ ] **Step 3: Use it for the tray icon's initial state and state updates**

In `SystemTrayIcon.__init__`, replace (currently `src/gui.py:359`):

```python
        super().__init__(_make_status_icon(COLORS['text_dim']))
```

with:

```python
        super().__init__(make_tray_icon(COLORS['text_dim']))
```

In `SystemTrayIcon._update_state`, replace (currently `src/gui.py:421-430`):

```python
    @Slot(str)
    def _update_state(self, state: str):
        colors = {
            "stopped": COLORS['text_dim'],
            "starting": COLORS['warning'],
            "running": COLORS['success'],
            "error": COLORS['danger'],
        }
        self.setIcon(_make_status_icon(colors.get(state, COLORS['text_dim'])))
        self.setToolTip(f"SNI Spoof — {state.capitalize()}")
```

with:

```python
    @Slot(str)
    def _update_state(self, state: str):
        colors = {
            "stopped": COLORS['text_dim'],
            "starting": COLORS['warning'],
            "running": COLORS['success'],
            "error": COLORS['danger'],
        }
        self.setIcon(make_tray_icon(colors.get(state, COLORS['text_dim'])))
        self.setToolTip(f"SNI Spoof — {state.capitalize()}")
```

- [ ] **Step 4: Manual verification**

Run: `python main.py`

Check:
1. Tray icon shows the app's shield glyph (not a bare dot) with a small gray badge (stopped state) in the corner.
2. Click Start → badge turns orange (starting) then green (running).
3. Click Stop → badge returns to gray.
4. Taskbar/alt-tab icon (window icon, set in Task 3) also shows the shield glyph.

- [ ] **Step 5: Lint check**

Run: `docker compose run --rm test`
Expected: `All checks passed`

---

### Task 6: Bundle `assets/icon.svg` into the packaged binary

**Files:**
- Modify: `sni-fake.spec`
- Modify: `docker-compose.yml`

**Interfaces:** none — packaging-only, no code interfaces.

- [ ] **Step 1: Add the asset to the PyInstaller spec**

In `sni-fake.spec`, replace (currently line 8):

```python
    datas=[('config.json', '.')],
```

with:

```python
    datas=[('config.json', '.'), ('assets/icon.svg', 'assets')],
```

- [ ] **Step 2: Add the asset to the Docker Compose `build` and `package` service commands**

In `docker-compose.yml`, the `build` service command (currently lines 29-37):

```yaml
  build:
    <<: *common
    command: >
      python -m PyInstaller
      --name sni-fake
      --onefile
      --windowed
      --add-data "config.json:."
      --distpath /app/dist
      --clean
      main.py
```

becomes:

```yaml
  build:
    <<: *common
    command: >
      python -m PyInstaller
      --name sni-fake
      --onefile
      --windowed
      --add-data "config.json:."
      --add-data "assets/icon.svg:assets"
      --distpath /app/dist
      --clean
      main.py
```

Apply the same `--add-data "assets/icon.svg:assets"` line addition to the `package` service command (currently lines 48-61), inserted right after the existing `--add-data 'config.json:.'` line.

- [ ] **Step 2: Verify `get_resource_path` matches the bundled layout**

Re-read `src/icons.py`'s `get_resource_path` (Task 1, Step 2): when frozen, it resolves `sys._MEIPASS / "assets" / "icon.svg"` — this matches the `('assets/icon.svg', 'assets')` datas entry (PyInstaller copies the source file into a directory named by the second tuple element, `assets`, inside the bundle root). No code change needed here, this step is a read-through check, not an edit.

- [ ] **Step 3: Verification**

This task's correctness can only be fully confirmed by an actual PyInstaller build (`docker compose run --rm package`), which is slow and produces a binary artifact — don't run it as part of this task unless the user asks for a packaged build. Instead, confirm by inspection: `grep -n "icon.svg" sni-fake.spec docker-compose.yml` should show the asset referenced in all three places (spec `datas`, `build` command, `package` command).

Run: `grep -n "icon.svg" sni-fake.spec docker-compose.yml`
Expected: 3 matching lines.

---

### Task 7: README.md

**Files:**
- Create: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Write the README**

`README.md`:

```markdown
# SNI Spoof

A cross-platform desktop GUI (system tray app) for managing a TLS SNI-spoofing proxy. It configures, launches (with elevated privileges), monitors, and stops a pre-built `sni-spoof` binary — it does not implement the proxy itself.

## Features

- System tray control with live status (stopped / starting / running / error)
- Simple form to configure listen/connect endpoints and the fake SNI value
- One-click elevated start (via `pkexec`/`sudo` on Linux, admin prompt on macOS, UAC on Windows)
- "Run on login" autostart toggle
- Persistent JSON config stored in the platform's standard app-data directory

## Requirements

- Python 3.9+
- [PySide6](https://pypi.org/project/PySide6/) `>=6.5.0`
- A `sni-spoof-{platform}-{arch}` binary placed alongside the app (not included in this repo)

## Installation

```bash
pip install -r requirements.txt
python main.py
```

## Docker-based dev/build workflow

```bash
docker compose run --rm dev        # Interactive dev shell (X11 passthrough via DISPLAY)
docker compose run --rm build      # Build standalone binary with PyInstaller -> ./dist/sni-fake
docker compose run --rm test       # ruff check + ruff format --check on src/
docker compose run --rm package    # Full package build (same as build, with completion message)
```

## Configuration

Settings are edited in the GUI and saved to a JSON config file (`Config.save()`), then passed to the proxy subprocess as environment variables on start.

| Key            | Description                          |
|----------------|---------------------------------------|
| `LISTEN_HOST`  | Local address the proxy listens on    |
| `LISTEN_PORT`  | Local port the proxy listens on       |
| `CONNECT_IP`   | Upstream IP the proxy connects to     |
| `CONNECT_PORT` | Upstream port the proxy connects to   |
| `FAKE_SNI`     | SNI value sent instead of the real one|

Config file location:

| Platform | Path                                              |
|----------|----------------------------------------------------|
| Linux    | `$XDG_CONFIG_HOME/sni-fake` (default `~/.config/sni-fake`) |
| Windows  | `%APPDATA%\sni-fake`                                |
| macOS    | `~/Library/Application Support/sni-fake`            |

## Building a standalone binary

```bash
docker compose run --rm build
```

Produces `./dist/sni-fake` (mirrors the `sni-fake.spec` PyInstaller config: `--onefile --windowed --add-data config.json:. --add-data assets/icon.svg:assets`).

## Project layout

- `main.py` — entry point, wires `Config`, `SniProxy`, `MainWindow`, `SystemTrayIcon` together
- `src/config.py` — JSON-backed settings + binary path resolution per platform/arch
- `src/proxy.py` — manages the `sni-spoof` binary's subprocess lifecycle
- `src/auth.py` — platform-specific elevated-privilege launch prefix
- `src/autostart.py` — cross-platform "run on login" toggle
- `src/gui.py` — main window + system tray icon
- `src/icons.py` — SVG icon loading/rendering
- `src/titlebar.py` — custom draggable title bar for the frameless window

## License

Add your license here.
```

- [ ] **Step 2: Verify the doc reflects the actual repo**

Run: `ls assets/ src/` — confirm `assets/icon.svg`, `src/icons.py`, `src/titlebar.py` all exist (from Tasks 1 and 3) so the README's project-layout section isn't describing files that don't exist.

Expected: all three files listed.
