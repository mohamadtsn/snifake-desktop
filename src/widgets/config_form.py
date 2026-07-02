"""Proxy configuration form with grouped fields and inline validation."""

import ipaddress

from PySide6.QtWidgets import (
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from ..config import Config
from ..theme import COLORS, SPACING, glass_panel_qss, input_qss

FIELD_MIN_HEIGHT = 32
LABEL_WIDTH = 96


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
            self._section(
                [("Listen Host:", self.host_edit), ("Listen Port:", self.port_spin)]
            )
        )
        outer.addWidget(self._separator())

        self.connect_ip_edit = QLineEdit(config["CONNECT_IP"])
        self.connect_port_spin = QSpinBox()
        self.connect_port_spin.setRange(1, 65535)
        self.connect_port_spin.setValue(config["CONNECT_PORT"])
        outer.addLayout(
            self._section(
                [
                    ("Connect IP:", self.connect_ip_edit),
                    ("Connect Port:", self.connect_port_spin),
                ]
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

    def _section(self, rows: list) -> QVBoxLayout:
        """Build a label/field column manually (not QFormLayout).

        QFormLayout's automatic row-height computation was observed
        collapsing rows to ~10px tall when nested this deep (QGroupBox ->
        QVBoxLayout -> QFormLayout inside QVBoxLayout -> QVBoxLayout inside
        QMainWindow). Plain QHBoxLayout rows with an explicit field height
        give deterministic geometry regardless of nesting depth.
        """
        section = QVBoxLayout()
        section.setSpacing(SPACING)
        for label_text, field in rows:
            field.setMinimumHeight(FIELD_MIN_HEIGHT)

            row = QWidget()
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(0, 0, 0, 0)
            row_layout.setSpacing(SPACING)

            label = QLabel(label_text)
            label.setFixedWidth(LABEL_WIDTH)
            label.setStyleSheet(f"color: {COLORS['text_dim']}; font-size: 13px;")
            row_layout.addWidget(label)
            row_layout.addWidget(field, stretch=1)

            section.addWidget(row)
        return section

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
