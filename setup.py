"""SNI Spoof — Cross-platform GUI proxy with system tray."""

from setuptools import setup, find_packages

setup(
    name="sni-fake",
    version="1.0.0",
    description="Cross-platform GUI for SNI spoofing proxy with system tray",
    author="Mohammad",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "PySide6>=6.5.0",
    ],
    entry_points={
        "console_scripts": [
            "sni-fake=src.main:main",
        ],
    },
    package_data={
        "": ["config.json"],
    },
)
