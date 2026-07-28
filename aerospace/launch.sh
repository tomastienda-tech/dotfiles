#!/bin/sh
# Focus-or-launch, for AeroSpace's Hyper+number launchers.
#
#   launch.sh "cmux"
#
# `open -a` on an ALREADY-OPEN app activates it — and if its window happens to
# live on another workspace, macOS follows the app and drags you there, undoing
# the `workspace X` that ran immediately before in the same binding. So the
# launch only happens when there is nothing to focus.
#
# The check is `aerospace list-windows`, not `pgrep`. Measured on this machine,
# `pgrep -f "/Applications/Visual Studio Code.app"` reports a match while the
# app is NOT running — leftover helper processes — which would suppress the
# launch and make the key do nothing. And the question that actually matters is
# not "is the process alive" but "is there a window to focus": an app running
# with zero windows still needs `open -a` to show one.
#
# Exists as a script rather than inline in the TOML because the inline form
# needs three levels of nested quoting, which AeroSpace rejects outright.
set -u

app=${1:?usage: launch.sh "<App Name>"}

if aerospace list-windows --all --format '%{app-name}' 2>/dev/null | grep -Fxq "$app"; then
	exit 0
fi

exec open -a "$app"
