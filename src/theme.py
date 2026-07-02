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
