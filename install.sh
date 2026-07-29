#!/usr/bin/env bash
# install.sh — Wire opencode-bgrun into the user's environment.
# Safe to re-run; replaces existing symlinks, never clobbers real files.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Colour

ok()   { printf "${GREEN}  ✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}  ⚠${NC}  %s\n" "$1"; }
fail() { printf "${RED}  ✗${NC} %s\n" "$1"; }

# ── Helper: create one symlink ────────────────────────────────────────────────
# Usage: make_link <src> <dest>
# - If dest is a symlink (possibly broken), replaces it.
# - If dest is a real file/dir, warns and skips (non-destructive).
make_link() {
    local src="$1"
    local dest="$2"

    if [ -L "$dest" ]; then
        # Already a symlink — replace (ln -sfn handles both file and dir targets)
        ln -sfn "$src" "$dest"
        ok "Linked  $dest -> $src"
    elif [ -e "$dest" ]; then
        warn "SKIP    $dest already exists and is not a symlink — leaving it untouched"
    else
        ln -sfn "$src" "$dest"
        ok "Linked  $dest -> $src"
    fi
}

printf "\n=== opencode-bgrun install ===\n\n"

# ── 1. CLI scripts → ~/.local/bin/ ───────────────────────────────────────────
printf "1/3  CLI scripts → ~/.local/bin/\n"
mkdir -p "$HOME/.local/bin"

for name in bgrun bgstatus bgtail bgclean; do
    make_link "$SCRIPT_DIR/bin/$name" "$HOME/.local/bin/$name"
done

# ── 2. Plugin → ~/.config/opencode/plugin/ ───────────────────────────────────
printf "\n2/3  Plugin → ~/.config/opencode/plugin/\n"
mkdir -p "$HOME/.config/opencode/plugin"

make_link \
    "$SCRIPT_DIR/plugin/bgrun-wake.js" \
    "$HOME/.config/opencode/plugin/bgrun-wake.js"

# ── 3. Skill → ~/.config/opencode/skills/ ────────────────────────────────────
printf "\n3/3  Skill → ~/.config/opencode/skills/\n"
mkdir -p "$HOME/.config/opencode/skills"

make_link \
    "$SCRIPT_DIR/skill/run-bg" \
    "$HOME/.config/opencode/skills/run-bg"

# ── Verification: check every symlink resolves ────────────────────────────────
printf "\n--- Verification ---\n"
LINKS=(
    "$HOME/.local/bin/bgrun"
    "$HOME/.local/bin/bgstatus"
    "$HOME/.local/bin/bgtail"
    "$HOME/.local/bin/bgclean"
    "$HOME/.config/opencode/plugin/bgrun-wake.js"
    "$HOME/.config/opencode/skills/run-bg"
)

all_ok=1
for link in "${LINKS[@]}"; do
    if [ -e "$link" ]; then
        ok "$link"
    else
        fail "DANGLING: $link"
        all_ok=0
    fi
done

if [ "$all_ok" -eq 0 ]; then
    printf "\n"
    warn "One or more symlinks are dangling — the source file may be missing."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n=== Done ===\n\n"
printf "  Symlinks created/verified:\n"
printf "    CLI (4):  bgrun  bgstatus  bgtail  bgclean  →  ~/.local/bin/\n"
printf "    Plugin:   bgrun-wake.js  →  ~/.config/opencode/plugin/\n"
printf "    Skill:    run-bg/        →  ~/.config/opencode/skills/\n"
printf "\n"
printf "  ⚠️  REMINDER: Restart OpenCode for the plugin to load.\n"
printf "\n"
