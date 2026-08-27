#!/bin/sh
# Builds the engine for whatever target the Tauri CLI is bundling, then
# stages it into resources/.
#
# The engine has to match the app's architecture, and on CI it often does
# not match the *host*: a macos-latest runner is arm64 but also builds the
# x86_64 bundle. TAURI_ENV_TARGET_TRIPLE is set by the CLI for build hooks
# and is the only reliable answer to "what are we actually building?".
#
# Cross-compiling to Windows is not handled here — that path goes through
# cargo-xwin in docker-compose.yml, which stages explicitly.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"   # src-tauri/

triple="${TAURI_ENV_TARGET_TRIPLE:-}"
host=$(rustc -vV | sed -n 's/^host: //p')

if [ -z "$triple" ] || [ "$triple" = "$host" ]; then
    cargo build --release -p snifake-engine
    sh scripts/stage-resources.sh
else
    cargo build --release -p snifake-engine --target "$triple"
    sh scripts/stage-resources.sh "$triple"
fi
