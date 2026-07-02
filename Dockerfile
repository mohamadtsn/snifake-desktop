# ── Build stage: install deps, bundle with PyInstaller ─────────────
FROM python:3.12-slim AS builder

# System deps for PySide6 / Qt
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libfontconfig1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libxcb-cursor0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-xinerama0 \
    libxcb-xfixes0 \
    libx11-xcb1 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt pyinstaller

# Copy source
COPY . .

# Build standalone binary with PyInstaller
RUN python -m PyInstaller \
    --name sni-fake \
    --onefile \
    --windowed \
    --add-data "config.json:." \
    --clean \
    main.py

# ── Runtime stage: minimal image for testing ───────────────────────
FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libfontconfig1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libxcb-cursor0 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-xinerama0 \
    libxcb-xfixes0 \
    libx11-xcb1 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Copy built binary
COPY --from=builder /app/dist/sni-fake /usr/local/bin/sni-fake

# Copy config
COPY config.json /app/config.json

WORKDIR /app

ENTRYPOINT ["/usr/local/bin/sni-fake"]
