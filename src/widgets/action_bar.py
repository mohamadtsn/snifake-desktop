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

        self.start_btn = styled_button(
            "Start", COLORS["success"], COLORS["success_hover"]
        )
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
