#!/bin/sh
# One-time setup: installs a NOPASSWD sudoers rule scoped to exactly the
# engine binary, so future engine launches use `sudo -n` and never prompt for
# a password again (across app restarts, since it's a real sudoers.d file).
# This script itself is only ever run once, elevated via pkexec — that is
# the single password prompt the user should ever see.
#
# $1 = the unprivileged username to grant the rule to
# $2 = absolute path to the sni-fake-engine binary
set -e
user="$1"
program="$2"
rule="$user ALL=(root) NOPASSWD: $program"
tmp="$(mktemp)"
printf '%s\n' "$rule" > "$tmp"
chmod 0440 "$tmp"
visudo -cf "$tmp"
install -o root -g root -m 0440 "$tmp" /etc/sudoers.d/sni-fake
rm -f "$tmp"