#!/bin/sh
# Focus-or-launch, for AeroSpace's Hyper+number launchers.
#
#   launch.sh "Google Chrome" B
#
# The promise is one sentence: after pressing the key you are LOOKING AT the
# app. Three cases, tried in this order:
#
#   1. a window on the home workspace → focus it
#   2. a window somewhere else        → focus it where it is, don't move it
#   3. no window at all              → go to the home workspace, then launch
#
# WHY THE SCRIPT OWNS THE WORKSPACE SWITCH
# ----------------------------------------
# The bindings used to be ['workspace B', 'exec-and-forget open -a Chrome'].
# Two failures, in sequence.
#
# First: `open -a` on an already-open app activates it, and macOS follows the
# app to its window, dragging you to whatever workspace that window lives on —
# undoing the `workspace B` that ran a moment earlier in the same binding.
#
# So a guard was added: skip the launch when the app already has a window. That
# made a different case WORSE. The binding switched to a FIXED workspace while
# the guard looked for a window ANYWHERE, so when the window was not on that
# workspace the key took you somewhere empty, declined to launch, and did
# nothing at all. Measured for real: Chrome's window was on workspace `2` while
# the binding went to `B`.
#
# Windows do end up off their rule here. `on-window-detected` fires once, at
# detection, and never again — move a window by hand afterwards and it stays
# moved. Notes currently has two windows on workspace `1`, which is not even a
# declared persistent workspace. So the launcher cannot assume a location; it
# has to look.
#
# Case 2 focuses the window where it lives rather than relocating it. A window
# the user deliberately moved should not be yanked back by a launcher key.
#
# WHY NOT pgrep
# -------------
# Measured on this machine: `pgrep -f "/Applications/Visual Studio Code.app"`
# matches while VS Code is NOT running — leftover helper processes — which would
# suppress the launch and leave the key dead. `aerospace list-windows` agreed
# with the real process list on all nine launcher apps. And the question that
# matters is not whether a process is alive but whether there is a window to
# focus: an app running with zero windows still needs `open -a`.
#
# Exists as a script rather than inline in the TOML because the inline form
# needs three levels of nested quoting, which AeroSpace rejects outright.
set -u

app=${1:?usage: launch.sh "<App Name>" <workspace>}
home_ws=${2:?usage: launch.sh "<App Name>" <workspace>}

windows=$(aerospace list-windows --all --format '%{window-id}|%{workspace}|%{app-name}' 2>/dev/null)

# Prefer a window already on the home workspace, so pressing the key twice does
# not wander between workspaces when an app has several windows.
id=$(printf '%s\n' "$windows" |
	awk -F'|' -v a="$app" -v w="$home_ws" '$3 == a && $2 == w { print $1; exit }')

# Otherwise take the first window anywhere.
[ -n "$id" ] || id=$(printf '%s\n' "$windows" |
	awk -F'|' -v a="$app" '$3 == a { print $1; exit }')

if [ -n "$id" ]; then
	exec aerospace focus --window-id "$id"
fi

# Nothing to focus. Switch first so the app opens in front of you rather than
# behind you; the on-window-detected rule then confirms the placement.
aerospace workspace "$home_ws" 2>/dev/null || true
exec open -a "$app"
