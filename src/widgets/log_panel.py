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
