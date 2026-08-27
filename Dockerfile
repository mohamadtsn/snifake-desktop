# Rust/Tauri toolchain for SNI Spoof — Linux bundles, Windows cross-builds,
# macOS compile checks, and the test suite.
#
# Frontend (npm/React/Vite) tooling stays on the host; this image only runs
# cargo/tauri. See docker-compose.yml for the per-target services.
FROM rust:1-bookworm

# Linux bundler deps (webkit2gtk, GTK, appindicator), plus:
#   clang/lld  — the linker cargo-xwin drives for the MSVC target
#   nsis       — the only Windows installer format that bundles off Windows
#                (WiX/MSI needs a real Windows host)
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
    clang \
    lld \
    llvm \
    nsis \
    && rm -rf /var/lib/apt/lists/*

# Windows: a real cross-compile target.
# macOS: check-only. `cargo check` never links, so the std target alone is
# enough to type-check the cfg(target_os = "macos") code — producing a real
# .app/.dmg still needs a Mac.
RUN rustup target add \
    x86_64-pc-windows-msvc \
    aarch64-apple-darwin \
    x86_64-apple-darwin

RUN cargo install tauri-cli --version "^2.0.0" --locked \
 && cargo install cargo-xwin --locked

# cargo-xwin downloads the Windows SDK+CRT headers here. Compose mounts a
# named volume over it so that ~1GB download happens once, not per build.
ENV XWIN_CACHE_DIR=/root/.cache/cargo-xwin
ENV XWIN_ARCH=x86_64

WORKDIR /app

CMD ["/bin/bash"]
