#!/bin/sh
# Elevated launch wrapper for the sni-spoof binary. Bundled as a resource
# alongside it so its install path is fixed and known (see
# src-tauri/policy/com.snifake.desktop.policy, which grants cached admin
# auth for pkexec runs of exactly this script — not for arbitrary shells).
#
# $1 is the writable config.json maintained by the GUI (in the user's
# app-data dir); the binary itself only reads config.json from its own
# directory, so this copies the current settings there before exec'ing it.
set -e
dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cp -f "$1" "$dir/config.json"
exec "$dir/sni-spoof-linux-amd64"