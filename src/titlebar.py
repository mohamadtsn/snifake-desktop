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
                background-color: {colors["surface"]};
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
        title_label.setStyleSheet(
            f"color: {colors['text']}; font-size: 13px; font-weight: 600;"
        )
        layout.addWidget(title_label)

        layout.addStretch()

        self.min_btn = self._make_control_button("–", colors["text_dim"])
        self.min_btn.clicked.connect(self.minimize_requested.emit)
        layout.addWidget(self.min_btn)

        self.close_btn = self._make_control_button("×", colors["danger"])
        self.close_btn.clicked.connect(self.close_requested.emit)
        layout.addWidget(self.close_btn)

    def _make_control_button(self, symbol: str, hover_color: str) -> QPushButton:
        btn = QPushButton(symbol)
        btn.setFixedSize(28, 24)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setStyleSheet(f"""
            QPushButton {{
                background-color: transparent;
                color: {self._colors["text_dim"]};
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
