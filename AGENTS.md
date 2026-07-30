# AGENTS.md — opencode-bgrun

Background job runner for AI coding agents with **live session wake-to-act** on OpenCode. When a long-running command finishes, it wakes the exact originating agent session (not just a desktop notification) so the agent can proactively continue. Distributed as an OpenCode plugin + optional human shell CLIs.

- **Repo:** `stablekernel/opencode-bgrun` (public) — https://github.com/stablekernel/opencode-bgrun
- **npm package:** `@stablekernel/opencode-bgrun` (scoped, public npm — **not yet published**, see Blocked section)
- **Current version:** `0.1.2` (tagged, not yet on npm)

## Quick Start

```bash
# Verify everything works
npm test          # smoke tests (node plugin/bgrun-wake.test.js) — expect 19/19 pass
npm run lint      # shellcheck + node --check — expect exit 0
npm pack --dry-run  # verify tarball contents (expect 12 files, @stablekernel/opencode-bgrun@0.1.2)
```

## Project Structure

```
bin/               # Shell CLI scripts (bgrun, bgstatus, bgtail, bgclean, _bgrunner.sh)
plugin/
  bgrun-wake.js    # OpenCode plugin — registers the bgrun TOOL, runs the wake poller
  bgrun-wake.test.js  # Standalone smoke tests (19 tests, no npm deps in runner)
skill/run-bg/SKILL.md  # Agent-facing skill for consuming this tool
install.sh         # Dev/clone install: symlinks bin+plugin+skill + --cli-only mode
uninstall.sh       # Removes install.sh-created symlinks + --cli-only mode
CHANGELOG.md       # Keep-a-Changelog format, backfilled through v0.1.2
.github/workflows/
  ci.yml           # Lint+test on push/PR — job named 'lint-test' (MUST stay that name)
  lint-test.yml    # Reusable workflow_call CI gate (for release.yml to depend on)
  release.yml      # npm publish pipeline: triggered by GitHub Release or workflow_dispatch dry-run
```

## Architecture

**Two separate audiences, two separate paths:**

| Audience | Path | Wake feature |
|---|---|---|
| AI agent | Calls the `bgrun` **TOOL** registered by the plugin | ✅ Wakes the exact originating session via `promptAsync` |
| Human (shell) | Runs `bgrun`/`bgstatus`/`bgtail`/`bgclean` directly | ❌ Desktop notification only (notify-only) |

**How the wake works (Option B):**
1. Plugin's `bgrun` tool captures `context.sessionID` at call time.
2. Calls `bin/bgrun -s <sessionID> -- sh -c "<command>"` — shells out, writes `.run/<job>.session` atomically BEFORE spawn.
3. `_bgrunner.sh` runs the command detached, writes `.run/<job>.notify` on completion.
4. Plugin's poller (1s interval) detects `.notify`, atomically claims it (rename → `.notified`), reads `.session`, calls `client.session.promptAsync()` to wake that exact session.

**Key file: `plugin/bgrun-wake.js`**
- `loadSDK()` cascade: (a) bare import gated on `typeof mod.tool === 'function'`, (b) fallback to `<OPENCODE_CONFIG_DIR>/node_modules/@opencode-ai/plugin/dist/index.js`, (c) loud `console.error` (never silent).
- bin/bgrun resolved by **absolute path** from plugin file (line ~144: `path.resolve(path.dirname(_pluginRealPath), '..', 'bin', 'bgrun')`). Never uses `$PATH`. Works from any install location.

## Distribution

**Current blessed install (git-install, pre-npm):**
```json
{ "plugin": ["opencode-bgrun@github:stablekernel/opencode-bgrun#v0.1.2"] }
```

**Future canonical install (npm, once published):**
```json
{ "plugin": ["@stablekernel/opencode-bgrun@0.1.2"] }
```
Once npm is live, git-install references should be removed from docs.

**Human CLI on PATH (optional, notify-only):**
```bash
# From a clone:
./install.sh --cli-only

# Without a clone (once npm-published):
npm i -g @stablekernel/opencode-bgrun   # bin map puts bgrun/bgstatus/bgtail/bgclean on PATH
```

## Git State & Versioning

```
e5f5601  HEAD, main, origin/main  — ci: add npm release pipeline
0f0ed39  tag: v0.1.2              — chore: release v0.1.2 (scoped npm, install scripts shipped)
58e1938  tag: v0.1.1              — chore: release v0.1.1 (--cli-only install mode)
...      tag: v0.1.0              — initial release
```

Working tree is **clean** — no uncommitted changes as of 2026-07-30.

## CI / CD

- **`ci.yml`** runs `lint-test` on every push to `main` and every PR. The job is named `lint-test` — **do not rename it** (it is the required status check on the branch-protected `main`; renaming silently disables protection).
- **`lint-test.yml`** is a reusable `workflow_call` copy of the same gate used by `release.yml`. It exists ONLY to give `release.yml` a CI dependency without breaking the `ci.yml` check name. Do not rename its job either.
- **`release.yml`** fires on GitHub Release published. Runs `verify` (calls lint-test.yml) then `publish` (OIDC trusted publishing, provenance, version-consistency guard). Also accepts `workflow_dispatch` with `dry-run: true` (default) for safe dry-run testing.

## Branch Protection (`main`)

| Rule | Setting |
|---|---|
| Required status check | `lint-test` (strict, up-to-date) |
| PR reviews | 1 approval, stale reviews dismissed |
| Signed commits | required |
| Force-push | blocked |
| Branch deletion | blocked |
| Enforce for admins | **false** — admins can bypass |

Admin bypass is **intentionally enabled** (Lloyd's call). Admins can push directly to main.

## Signing

All commits MUST be signed (`commit.gpgsign=true`, key `824AA8A544E8AB33`, `lloyd.engebretsen@stablekernel.com`). Tags are signed annotated (`git tag -s`).

## npm Auth

- **Public npm** (`registry.npmjs.org`): authed as **`lloydsk`** (SK account, linked to GitHub). The repo `.npmrc` pins public registry so publish always targets npm, not CFA Artifactory.
- **CFA Artifactory**: global `~/.npmrc` → `cfa.jfrog.io`. This is the CFA default for other projects — irrelevant here.
- **To publish from this repo dir:** `cd ~/sk/opencode-bgrun && npm publish --access public` (routes to public npm as `lloydsk` automatically).

## ⚠️ BLOCKED — What Must Happen Before npm Publish

The package is fully prepared and `npm publish --dry-run` succeeds. The single blocker:

**`lloydsk` needs publish rights in the `@stablekernel` npm org.**

The `@stablekernel` org is owned/managed by **Justin Carper (`wubs` / justincarper@me.com)**. The ask: add npm user `lloydsk` to `@stablekernel` with Developer (publish) rights.

Once that lands:
```bash
cd ~/sk/opencode-bgrun
npm org ls stablekernel lloydsk     # verify membership
npm publish --access public          # first publish — creates the package on npm
npm view @stablekernel/opencode-bgrun version  # confirm → 0.1.2
```

## After First Publish — Remaining Work (in order)

1. **Wire OIDC trusted publisher on npmjs.com** — go to the package settings page on npmjs.com, add a trusted publisher: repo `stablekernel/opencode-bgrun`, workflow `release.yml`. This activates `release.yml`'s automated publish (no NPM_TOKEN needed). Also set `default_workflow_permissions` → `read` on the repo actions settings (currently `write` — a security gap).

2. **Dogfood the npm install** — update `~/.config/opencode/opencode.json`:
   ```json
   "@stablekernel/opencode-bgrun@0.1.2"
   ```
   Restart OpenCode, confirm the `bgrun` tool loads from the npm-installed cache (not the `@github:` cache). Then run `bgtail` (should now resolve from `npm i -g` or the npm cache — confirm PATH setup).

3. **PR3: docs reconciliation** — strip all git-install (`@github:`) references from README, SKILL.md, `install.sh`'s guidance messages; update cache-path examples to the npm cache layout (`@stablekernel/opencode-bgrun@0.1.2/` — no embedded `/` or `#`, well-behaved path); document `npm i -g @stablekernel/opencode-bgrun` as the recommended human CLI path. This is the big docs simplification unlocked by going public+npm.

4. **Future: add Dependabot** (`.github/dependabot.yml`) for github-actions SHA updates and npm deps. Optional but recommended per the release pipeline design.

## Critical DO NOTs

1. **NEVER rename the `lint-test` job in `ci.yml`** — it is the required status check; renaming silently breaks branch protection.
2. **NEVER commit secrets** — no `.env`, no NPM_TOKEN in code. Use OIDC trusted publishing.
3. **NEVER publish a version that doesn't have a matching signed git tag** — the `release.yml` version-consistency guard enforces this, but also enforce it manually.
4. **NEVER modify generated files** in `node_modules/`.
5. **NEVER force-push `main`** — use admin bypass via normal `git push` (bypass is already enabled for admins).

## Key Design Decisions (don't relitigate without reading these)

- **Option B architecture:** plugin captures sessionID at tool-call time → passes via `-s` flag to the shell script → written to `.session` sidecar atomically before spawn. Poller reads `.session` for exact-session routing. This was chosen over alternatives (auto-track via `chat.message`, `session.list()` polling) because it's the only approach that correctly identifies the originating session when multiple sessions run in the same directory.
- **`install.sh` kept for dev/clone path** — `install.sh` is a dev tool; npm `bin` map handles PATH for npm users; they are complementary, not competing.
- **Repo visibility flipped to public (2026-07-30)** — security audit confirmed clean (no secrets, no internal refs in history). Required for `curl|sh` one-liner and npm publish without auth friction.
- **Admin bypass on branch protection** — enables direct-to-main commits for releases and admin operations without opening a PR, while keeping the protection for the ~26 write-holders.
- **OIDC trusted publishing over NPM_TOKEN** — no long-lived secret; provenance is automatic; `NPM_TOKEN` is documented as a commented fallback in `release.yml`.

## Useful Context Files

- `.opencode/wip/release-pipeline-design.md` — full release pipeline design (architect doc, covers trigger model, OIDC, lockstep, install.sh gap decision, PR sequence, human action table)
- `.opencode/wip/retro-2026-07-29-option-b-bgrun-tool.md` — Option B design rationale and the SDK-resolution bug history
- `.opencode/wip/retro-2026-07-30-git-install-wake-validation.md` — git-install wake validation + PATH gap discovery
