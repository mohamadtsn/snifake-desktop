#!/usr/bin/env python3
"""SNI Spoof — Cross-platform GUI proxy with system tray."""

import sys

from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont

from src.config import Config
from src.proxy import SniProxy
from src.gui import MainWindow, SystemTrayIcon


def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    app.setApplicationName("SNI Spoof")

    font = QFont("Segoe UI", 10)
    font.setHintingPreference(QFont.PreferNoHinting)
    app.setFont(font)

    config = Config()
    proxy = SniProxy(config)

    window = MainWindow(config, proxy)
    tray = SystemTrayIcon(window)

    window.start_requested.connect(proxy.start)
    window.stop_requested.connect(proxy.stop)

    window.show()
    tray.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
