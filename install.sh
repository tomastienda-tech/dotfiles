#!/usr/bin/env bash
# Install these dotfiles.
#
#   ./install.sh            back up, then install everything
#   ./install.sh --dry-run  show what would happen, touch nothing
#
# This script is the SOURCE OF TRUTH for what gets installed where. The README
# used to carry the copy list in prose, and it drifted: a fresh install silently
# got no pi keybindings and none of the prompt templates, so the welcome panel
# advertised slash commands that did not exist. tools/check-install.mjs now
# asserts that every config the repo ships has a destination here.
#
# Installation is by COPY, not symlink — several of these apps fail to load
# their config when the path or one of its parents is a symlink.
set -euo pipefail

cd "$(dirname "$0")"
REPO="$PWD"
DRY=false
[ "${1:-}" = "--dry-run" ] && DRY=true

say() { printf '  %s\n' "$*"; }
run() { if $DRY; then say "would: $*"; else "$@"; fi; }

# ── What goes where ─────────────────────────────────────────────────────────
# One entry per thing the repo ships. `file` copies one path, `dir` mirrors a
# directory's contents. Keep this list complete — the checker enforces it.
MAP=(
  "file:.aerospace.toml:$HOME/.aerospace.toml"
  "dir:borders:$HOME/.config/borders"
  "dir:cmux:$HOME/.config/cmux"
  "dir:ghostty:$HOME/.config/ghostty"
  "dir:karabiner:$HOME/.config/karabiner"
  "dir:nvim:$HOME/.config/nvim"
  "dir:sketchybar:$HOME/.config/sketchybar"
  "file:zsh/.zshrc:$HOME/.zshrc"
  "file:zsh/.p10k.zsh:$HOME/.p10k.zsh"
  # pi is copied file-by-file so credentials, sessions and model caches in
  # ~/.pi/agent are never touched.
  "file:pi/settings.json:$HOME/.pi/agent/settings.json"
  "file:pi/keybindings.json:$HOME/.pi/agent/keybindings.json"
  "dir:pi/extensions:$HOME/.pi/agent/extensions"
  "dir:pi/themes:$HOME/.pi/agent/themes"
  "dir:pi/prompts:$HOME/.pi/agent/prompts"
  "file:tools/cmux-dock-hook.sh:$HOME/.config/cmux/dock-hook.sh"
  # Called by the AeroSpace launcher bindings, which reference it by $HOME path.
  "file:aerospace/launch.sh:$HOME/.config/aerospace/launch.sh"
  # VS Code settings live outside ~/.config, and the whole palette is in here
  # via colorCustomizations rather than as a theme extension.
  "file:vscode/settings.json:$HOME/Library/Application Support/Code/User/settings.json"
  "file:vscode/keybindings.json:$HOME/Library/Application Support/Code/User/keybindings.json"
)

# ── Back up whatever is already there ───────────────────────────────────────
BK="$HOME/dotfiles-backup-$(date +%Y%m%d-%H%M%S)"
echo "==> backing up to $BK"
$DRY || mkdir -p "$BK"
for entry in "${MAP[@]}"; do
  dest="${entry##*:}"
  if [ -e "$dest" ]; then
    rel="${dest#"$HOME"/}"
    $DRY || mkdir -p "$BK/$(dirname "$rel")"
    run cp -R "$dest" "$BK/$rel"
  fi
done
say "backed up $(ls -A "$BK" 2>/dev/null | wc -l | tr -d ' ') top-level item(s)"

# ── Install ─────────────────────────────────────────────────────────────────
echo "==> installing"
for entry in "${MAP[@]}"; do
  kind="${entry%%:*}"
  rest="${entry#*:}"
  src="${rest%%:*}"
  dest="${rest#*:}"
  [ -e "$REPO/$src" ] || { say "skip (absent in repo): $src"; continue; }

  case "$kind" in
    file)
      run mkdir -p "$(dirname "$dest")"
      run cp "$REPO/$src" "$dest"
      ;;
    dir)
      run mkdir -p "$dest"
      run rsync -a "$REPO/$src/" "$dest/"
      ;;
  esac
  say "$src → ${dest/#$HOME/~}"
done

# The hook is executed by cmux, and a non-executable hook fails silently.
$DRY || chmod +x "$HOME/.config/cmux/dock-hook.sh" 2>/dev/null || true
# Same trap: AeroSpace runs this via bash and a non-executable script fails quietly.
$DRY || chmod +x "$HOME/.config/aerospace/launch.sh" 2>/dev/null || true
$DRY || chmod +x "$HOME/.config/sketchybar/"*.sh "$HOME/.config/sketchybar/plugins/"*.sh 2>/dev/null || true

# ── Verify ──────────────────────────────────────────────────────────────────
if ! $DRY; then
  echo "==> verifying"
  fail=0
  for entry in "${MAP[@]}"; do
    dest="${entry##*:}"
    src="${entry#*:}"; src="${src%%:*}"
    [ -e "$REPO/$src" ] || continue
    if [ -e "$dest" ]; then say "ok   ${dest/#$HOME/~}"; else say "FAIL ${dest/#$HOME/~}"; fail=1; fi
  done
  [ "$fail" = 0 ] || { echo "install incomplete" >&2; exit 1; }
fi

cat <<'NEXT'

==> next steps (not automated on purpose)

  Wallpaper — pick the resolution for your display:
    cp wallpapers/iris-dark-3024x1964.png ~/Pictures/
    osascript -e 'tell application "System Events" to set picture of every desktop to "'"$HOME"'/Pictures/iris-dark-3024x1964.png"'

  VS Code extensions the settings depend on:
    cat vscode/extensions.txt | grep -v '^#' | xargs -n1 code --install-extension

  CmuxDock (optional, macOS notch indicator):
    (cd swift/CmuxDock && ./build.sh --install)
    cp swift/CmuxDock/com.iris.cmuxdock.plist ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.iris.cmuxdock.plist

  Reload:
    sketchybar --reload
    pkill -x borders; (~/.config/borders/bordersrc &)
    aerospace reload-config
    exec zsh
    # cmux refuses reload-config from outside itself; run it INSIDE cmux
    cmux reload-config
NEXT
