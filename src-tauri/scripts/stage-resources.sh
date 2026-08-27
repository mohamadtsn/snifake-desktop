#!/bin/sh
# Collects everything `bundle.resources` ships into src-tauri/resources/.
#
# This indirection exists because cargo puts a cross-compiled binary in
# target/<triple>/release/ but a native one in target/release/, and
# tauri.conf.json's resource map is a set of fixed paths with no way to
# express "wherever this build's target dir happens to be". Staging into one
# stable directory keeps the map identical for every platform.
#
# Usage: stage-resources.sh [target-triple]   (no triple = native build)
set -eu

triple="${1:-}"
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)   # src-tauri/
if [ -n "$triple" ]; then
    bin_dir="$root/target/$triple/release"
else
    bin_dir="$root/target/release"
fi
out="$root/resources"

rm -rf "$out"
mkdir -p "$out"

staged=""
for name in sni-fake-engine.exe sni-fake-engine; do
    if [ -f "$bin_dir/$name" ]; then
        cp "$bin_dir/$name" "$out/"
        staged=$name
        break
    fi
done
if [ -z "$staged" ]; then
    echo "stage-resources: no engine binary in $bin_dir — build it first" >&2
    exit 1
fi

# Windows also needs the driver sitting next to the engine; see
# vendor/windivert/README.md.
case "$triple" in
*windows*)
    for f in WinDivert.dll WinDivert64.sys; do
        if [ ! -f "$root/vendor/windivert/$f" ]; then
            echo "stage-resources: missing vendor/windivert/$f" >&2
            exit 1
        fi
        cp "$root/vendor/windivert/$f" "$out/"
    done
    ;;
esac

echo "stage-resources: staged $(ls "$out" | tr '\n' ' ')into resources/"
