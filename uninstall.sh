#!/usr/bin/env bash
# uninstall.sh — Remove opencode-bgrun symlinks from the user's environment.
# Only removes symlinks that point back into this repo or the OpenCode plugin
# cache (~/.cache/opencode/packages/opencode-bgrun*); never deletes real files.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { printf "${GREEN}  ✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${NC}  %s\n" "$1"; }

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
Usage: uninstall.sh [OPTIONS]

Options:
  --cli-only    Remove only the 4 CLI symlinks from ~/.local/bin/.
                Skips plugin and skill removal.

  --help, -h    Show this help and exit.

Modes:
  (no flags)    Remove all symlinks: CLI + plugin + skill.

  --cli-only    Remove only bgrun bgstatus bgtail bgclean from ~/.local/bin/.

Safety: only removes symlinks whose target is under either:
  • This repo directory ($SCRIPT_DIR)
  • The OpenCode plugin cache (~/.cache/opencode/packages/opencode-bgrun*)
Real files and symlinks pointing elsewhere are left untouched.
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────
CLI_ONLY=0

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            usage
            exit 0
            ;;
        --cli-only)
            CLI_ONLY=1
            ;;
        *)
            warn "Unknown option: $arg"
            printf "\n"
            usage
            exit 2
            ;;
    esac
done

# ── Helper: remove one symlink if it points into an accepted root ─────────────
# Usage: remove_link <dest>
# Accepted roots:
#   1. $SCRIPT_DIR   (dev/clone install)
#   2. $HOME/.cache/opencode/packages/  containing "@stablekernel/opencode-bgrun"  (npm install)
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

    # Resolve the link target
    local target
    target="$(readlink "$dest")"

    # Normalise relative links against the link's parent dir
    case "$target" in
        /*) ;;                                    # already absolute
        *)  target="$(dirname "$dest")/$target" ;;
    esac

    # Check if the resolved target is under an accepted root
    case "$target" in
        "$SCRIPT_DIR"*)
            rm "$dest"
            ok "Removed $dest (was -> $target)"
            ;;
        "$HOME"/.cache/opencode/packages/*opencode-bgrun*)
            rm "$dest"
            ok "Removed $dest (was -> $target)"
            ;;
        *)
            warn "SKIP  $dest points to $target"
            warn "      (not under $SCRIPT_DIR or ~/.cache/opencode/packages/opencode-bgrun*)"
            warn "      — leaving it untouched"
            ;;
    esac
}

printf "\n=== opencode-bgrun uninstall ===\n\n"

# ── 1. CLI scripts ────────────────────────────────────────────────────────────
printf "1/%d  CLI scripts from ~/.local/bin/\n" "$([ "$CLI_ONLY" -eq 1 ] && printf '1' || printf '3')"
for name in bgrun bgstatus bgtail bgclean; do
    remove_link "$HOME/.local/bin/$name"
done

if [ "$CLI_ONLY" -eq 1 ]; then
    printf "\n=== Done ===\n\n"
    exit 0
fi

# ── 2. Plugin ─────────────────────────────────────────────────────────────────
printf "\n2/3  Plugin from ~/.config/opencode/plugin/\n"
remove_link "$HOME/.config/opencode/plugin/bgrun-wake.js"

# ── 3. Skill ──────────────────────────────────────────────────────────────────
printf "\n3/3  Skill from ~/.config/opencode/skills/\n"
remove_link "$HOME/.config/opencode/skills/run-bg"

printf "\n=== Done ===\n\n"
printf "  ⚠️  REMINDER: Restart OpenCode for the plugin change to take effect.\n\n"
