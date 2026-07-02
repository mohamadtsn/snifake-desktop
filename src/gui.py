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
from .theme import COLORS, SPACING
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
        # Note: no apply_glow() here — central is an ancestor of several
        # descendants (status_card, config_form, log_view, action buttons)
        # that already carry their own QGraphicsDropShadowEffect. Qt does
        # not support nesting a graphics effect on a widget whose children
        # also have effects: the child subtree renders corrupted (garbled
        # text, solid-color fields) when an ancestor effect is added.

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
