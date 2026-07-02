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
