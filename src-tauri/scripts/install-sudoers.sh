#!/bin/sh
# One-time setup: installs a NOPASSWD sudoers rule scoped to exactly
# run-proxy.sh, so future proxy starts use `sudo -n` and never prompt for
# a password again (across app restarts, since it's a real sudoers.d file).
# This script itself is only ever run once, elevated via pkexec — that is
# the single password prompt the user should ever see.
#
# $1 = the unprivileged username to grant the rule to
# $2 = absolute path to run-proxy.sh
set -e
user="$1"
script="$2"
rule="$user ALL=(root) NOPASSWD: $script"
tmp="$(mktemp)"
printf '%s\n' "$rule" > "$tmp"
chmod 0440 "$tmp"
visudo -cf "$tmp"
install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/sni-fake
rm -f "$tmp"