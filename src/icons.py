"""SVG icon loading and rendering helpers for SNI Spoof."""

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer

from .theme import COLORS


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
    painter.setPen(QColor(COLORS["bg"]))
    painter.drawEllipse(x, y, badge_size, badge_size)
    painter.end()
    return QIcon(pixmap)
