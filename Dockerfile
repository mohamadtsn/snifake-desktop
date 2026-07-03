# Rust/Tauri build & dev environment for SNI Spoof.
# Frontend (npm/React/Vite) tooling is expected on the host — this image
# only needs to run `cargo tauri dev` / `cargo tauri build`.
FROM rust:1-bookworm

# System deps for Tauri's Linux bundler (webkit2gtk, GTK, appindicator, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    patchelf \
    file \
    build-essential \
    curl \
    wget \
    pkg-config \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install tauri-cli --version "^2.0.0" --locked

WORKDIR /app

CMD ["/bin/bash"]