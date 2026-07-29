#!/usr/bin/env bash
# uninstall.sh — Remove opencode-bgrun symlinks from the user's environment.
# Only removes symlinks that point back into this repo; never deletes real files.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { printf "${GREEN}  ✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${NC}  %s\n" "$1"; }

# ── Helper: remove one symlink if it points into $SCRIPT_DIR ─────────────────
# Usage: remove_link <dest>
remove_link() {
    local dest="$1"

    if [ ! -L "$dest" ]; then
        # Not a symlink at all — skip (real file or missing)
        if [ -e "$dest" ]; then
            warn "SKIP  $dest is not a symlink — leaving it untouched"
        else
            warn "SKIP  $dest does not exist"
        fi
        return
    fi

    # Resolve the link target and check it lives inside our repo
    local target
    target="$(readlink "$dest")"

    # Normalise relative links against the link's parent dir
    case "$target" in
        /*) ;;                                    # already absolute
        *)  target="$(dirname "$dest")/$target" ;;
    esac

    # Check if the resolved target is under SCRIPT_DIR
    case "$target" in
        "$SCRIPT_DIR"*)
            rm "$dest"
            ok "Removed $dest (was -> $target)"
            ;;
        *)
            warn "SKIP  $dest points to $target (not in $SCRIPT_DIR) — leaving it untouched"
            ;;
    esac
}

printf "\n=== opencode-bgrun uninstall ===\n\n"

# ── 1. CLI scripts ────────────────────────────────────────────────────────────
printf "1/3  CLI scripts from ~/.local/bin/\n"
for name in bgrun bgstatus bgtail bgclean; do
    remove_link "$HOME/.local/bin/$name"
done

# ── 2. Plugin ─────────────────────────────────────────────────────────────────
printf "\n2/3  Plugin from ~/.config/opencode/plugin/\n"
remove_link "$HOME/.config/opencode/plugin/bgrun-wake.js"

# ── 3. Skill ──────────────────────────────────────────────────────────────────
printf "\n3/3  Skill from ~/.config/opencode/skills/\n"
remove_link "$HOME/.config/opencode/skills/run-bg"

printf "\n=== Done ===\n\n"
printf "  ⚠️  REMINDER: Restart OpenCode for the plugin change to take effect.\n\n"
