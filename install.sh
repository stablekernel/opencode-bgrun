#!/usr/bin/env bash
# install.sh — Local/dev install for opencode-bgrun.
#
# Default (no flags): full DEV install.
#   • Installs Node deps into the repo (so the symlinked plugin resolves them).
#   • Symlinks bin/, plugin/, and skill/ into the user's config dirs.
#
# --cli-only: PATH-only install for users who already have the plugin installed
#   via the git-install spec in opencode.json.
#   • Skips npm, plugin symlink, and skill symlink.
#   • Discovers CLI scripts from (a) this repo clone or (b) the OpenCode cache.
#
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

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
Usage: install.sh [OPTIONS]

Options:
  --cli-only    Install only the 4 CLI scripts (bgrun bgstatus bgtail bgclean)
                onto PATH (~/.local/bin/).  Skips npm install, plugin symlink,
                and skill symlink.  Useful for git-install users who already
                have the plugin loaded via opencode.json and just want shell
                access to the bg* helpers.

  --help, -h    Show this help and exit.

Modes:
  (no flags)    Full dev install: npm deps + CLI + plugin + skill symlinks.
                Assumes you are running from a repo clone.

  --cli-only    PATH-only install.  Source priority:
                  1. <repo>/bin/  (if running from a clone)
                  2. ~/.cache/opencode/packages/opencode-bgrun@.../bin/
                     (auto-discovered from OpenCode's plugin cache)
                If neither source is found, installation fails with guidance.
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
            fail "Unknown option: $arg"
            printf "\n"
            usage
            exit 2
            ;;
    esac
done

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

# ── PATH check helper ─────────────────────────────────────────────────────────
check_path() {
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *)
            warn "$HOME/.local/bin is not on your PATH — bgrun and friends won't be found in a shell."
            warn "Add this line to your ~/.zshrc (or ~/.bashrc), then restart your shell:"
            printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
            ;;
    esac
}

# ── CLI-only mode ─────────────────────────────────────────────────────────────
if [ "$CLI_ONLY" -eq 1 ]; then
    printf "\n=== opencode-bgrun install (--cli-only) ===\n\n"

    # Resolve CLI source directory
    CLI_SRC=""

    # (a) Prefer repo clone
    if [ -f "$SCRIPT_DIR/bin/bgrun" ]; then
        CLI_SRC="$SCRIPT_DIR/bin"
        ok "Linking CLI from: $CLI_SRC  (repo clone)"
    else
        # (b) Discover from OpenCode plugin cache
        # The cache path contains @ : # and an embedded / in the package spec,
        # so the package spec spans two path segments:
        #   opencode-bgrun@github:stablekernel  /  opencode-bgrun#v0.1.1
        # We glob over both segments to handle any version.
        CACHE_MATCH=""
        CACHE_COUNT=0

        # Expand the glob manually; iterate over potential matches.
        # Using a for loop with a glob is safe — bash expands it before the loop.
        # We use a sub-glob for the two-segment package spec, then check each hit.
        for candidate in "$HOME"/.cache/opencode/packages/opencode-bgrun@*/opencode-bgrun*/node_modules/opencode-bgrun/bin; do
            # If the glob found no matches, bash leaves the literal pattern —
            # check that the candidate actually exists as a directory.
            if [ -d "$candidate" ]; then
                CACHE_COUNT=$((CACHE_COUNT + 1))
                CACHE_MATCH="$candidate"
            fi
        done

        if [ "$CACHE_COUNT" -eq 0 ]; then
            fail "CLI source not found."
            printf "\n"
            printf "  Neither a repo clone bin/ dir nor a cached plugin installation was found.\n"
            printf "  To fix, do one of:\n"
            printf "    1. Run this script from a repo clone (git clone stablekernel/opencode-bgrun).\n"
            printf "    2. Add the plugin to opencode.json first:\n"
            printf "         \"plugins\": [\"opencode-bgrun@github:stablekernel/opencode-bgrun#v0.1.1\"]\n"
            printf "       then let OpenCode fetch it, and re-run: install.sh --cli-only\n"
            exit 1
        fi

        if [ "$CACHE_COUNT" -gt 1 ]; then
            warn "Multiple cached plugin versions found — using the last (lexically highest) match."
            warn "Matches found:"
            for candidate in "$HOME"/.cache/opencode/packages/opencode-bgrun@*/opencode-bgrun*/node_modules/opencode-bgrun/bin; do
                if [ -d "$candidate" ]; then
                    warn "  $candidate"
                fi
            done
        fi

        CLI_SRC="$CACHE_MATCH"
        ok "Linking CLI from: $CLI_SRC  (OpenCode plugin cache)"
    fi

    # Symlink the 4 CLI scripts
    printf "\n1/1  CLI scripts → ~/.local/bin/\n"
    mkdir -p "$HOME/.local/bin"

    for name in bgrun bgstatus bgtail bgclean; do
        make_link "$CLI_SRC/$name" "$HOME/.local/bin/$name"
    done

    # PATH check
    check_path

    # Verification
    printf "\n--- Verification ---\n"
    all_ok=1
    for name in bgrun bgstatus bgtail bgclean; do
        link="$HOME/.local/bin/$name"
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

    # CLI-only summary
    printf "\n=== Done ===\n\n"
    printf "  CLI symlinks created/verified:\n"
    printf "    bgrun  bgstatus  bgtail  bgclean  →  ~/.local/bin/\n"
    printf "\n"
    printf "  Optional: brew install terminal-notifier  (macOS desktop notifications)\n"
    printf "\n"
    exit 0
fi

# ── Full dev install ──────────────────────────────────────────────────────────
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
check_path

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

all_ok=1
for link in \
    "$HOME/.local/bin/bgrun" \
    "$HOME/.local/bin/bgstatus" \
    "$HOME/.local/bin/bgtail" \
    "$HOME/.local/bin/bgclean" \
    "$HOME/.config/opencode/plugin/bgrun-wake.js" \
    "$HOME/.config/opencode/skills/run-bg"; do
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
