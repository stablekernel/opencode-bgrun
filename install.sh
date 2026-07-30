#!/usr/bin/env bash
# install.sh — Local/dev install for opencode-bgrun.
#   • Installs Node deps into the repo (so the symlinked plugin resolves them).
#   • Symlinks bin/, plugin/, and skill/ into the user's config dirs.
# Safe to re-run; replaces existing symlinks, never clobbers real files.
# Coworkers: use the git-install plugin spec in the README instead.
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

# ── Prerequisite: node ────────────────────────────────────────────────────────
if ! command -v node > /dev/null 2>&1; then
    warn "node not found — the plugin (tool registration + wake notifications) requires Node/OpenCode's runtime."
    warn "The shell scripts (bgrun/bgstatus/bgtail/bgclean) will still work without it."
fi

# ── Dep install: plugin Node dependencies ─────────────────────────────────────
printf "0/3  Installing plugin dependencies into repo…\n"
if command -v npm > /dev/null 2>&1; then
    if ! npm install --prefix "$SCRIPT_DIR"; then
        warn "npm install failed — the plugin may fall back to resolving the OpenCode SDK from the OpenCode config dir at runtime."
    else
        ok "npm install complete"
    fi
elif command -v bun > /dev/null 2>&1; then
    if ! (cd "$SCRIPT_DIR" && bun install); then
        warn "bun install failed — the plugin may fall back to resolving the OpenCode SDK from the OpenCode config dir at runtime."
    else
        ok "bun install complete"
    fi
else
    warn "Neither npm nor bun found — Node deps not installed."
    warn "The plugin will fall back to resolving the OpenCode SDK from the OpenCode config dir at runtime (usually works)."
fi

# ── 1. CLI scripts → ~/.local/bin/ ───────────────────────────────────────────
printf "1/3  CLI scripts → ~/.local/bin/\n"
mkdir -p "$HOME/.local/bin"

for name in bgrun bgstatus bgtail bgclean; do
    make_link "$SCRIPT_DIR/bin/$name" "$HOME/.local/bin/$name"
done

# PATH check — warn if ~/.local/bin isn't on $PATH
case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *)
        warn "\$HOME/.local/bin is not on your PATH — bgrun and friends won't be found in a shell."
        warn "Add this line to your ~/.zshrc (or ~/.bashrc), then restart your shell:"
        printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
        ;;
esac

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
printf "  Optional: brew install terminal-notifier  (macOS desktop notifications)\n"
printf "\n"
