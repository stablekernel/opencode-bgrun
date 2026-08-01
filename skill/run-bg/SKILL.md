---
name: run-bg
description: Use when running any long or verbose shell command (make test, go test ./...,
  make lint, builds) so output lands in a file instead of flooding context and the session
  stays unblocked. Start the job, hand control back, check status later, and read only a
  tail or a code-processed summary of the log.
---

# Run in Background

Run long/verbose commands detached. Output → file. Status → file. Context stays clean; the
session never blocks. State lives in `~/.bgrun/jobs` (default) so a *new* agent session can
pick up a job the previous one started.

## When to use
- Any command expected to run > ~30s OR emit > ~100 lines.
- Typical commands to background: `make test-short`, `make test`, `go test ./...`,
  `make lint`, `make build`.
- Integration test / infrastructure commands (long-running, always background):
  `make its`, project test suites, `IT_FORCE_BUILD=1 go test ./integration/...`.
- Any time you want to start work and return control to the user while it runs.

## When NOT to use
- Commands that complete in < ~5s — the overhead of bgrun isn't worth it.
- Short, quiet commands whose full output you actually need (`git status`, `go build ./onepkg`).
- Commands requiring interactive stdin — bgrun detaches from the terminal.
- Interactive commands (prompts, REPL, SSH sessions).

## Commands

| Action | How (agent) | How (human shell) |
|---|---|---|
| Start  | call the `bgrun` tool with `command` argument | `bgrun [--origin <tool>] [--] <command...>` |
| Status | `bgstatus [<job-id>]` | `bgstatus [<job-id>]` |
| Tail   | `bgtail <job-id> [lines]` | `bgtail <job-id> [lines]` |
| Wait   | — | `bgwait <job-id>` |
| Kill   | — | `bgkill <job-id>` |
| Clean  | `bgclean [days]` | `bgclean [days]` |

- **`bgwait <job-id>`** — blocks until the job finishes; exits with the job's exit code. Useful for sequential shell scripting (`bgwait "$JOB" && deploy.sh`).
- **`bgkill <job-id>`** — sends SIGTERM to a running job and marks it killed. Use when a job is hung or no longer needed.

The shell scripts are installed on PATH via `./install.sh --cli-only` (or full `./install.sh` for local dev).
No path prefix needed — use bare `bgstatus`, `bgtail`, `bgwait`, `bgkill`, `bgclean` (and
`bgrun` when in a human shell).

## Live session wake (OpenCode only)

**Agents: call the `bgrun` tool** (not a bash command). The tool captures the calling
session id (`context.sessionID`) in-process and passes it to the underlying shell script
via a `-s <session-id>` flag. This guarantees the correct session is woken even when many
concurrent agent sessions share the same directory.

```
// Tool call — not a bash line:
bgrun(command: "make test-short")
// returns: "started: <job-id>"
```

Store the returned job-id; check status / tail the log later (non-blocking). OpenCode will
**wake this session automatically** when the job finishes — no polling needed.

- **`--origin <tool>`** — one of `opencode` (default) | `claude` | `cursor`. Omit for
  OpenCode; the tool sets this automatically.
- **Human shell users:** call `bgrun <command...>` directly. Because there is no live agent
  session in a human shell, this is **notify-only** (desktop notification via
  `terminal-notifier` or `osascript`). The `-s` flag is the tool→script channel and is
  normally not typed by hand; omitting it produces notify-only behavior.
- **bgrun flags MUST come before the command** (shell usage). Once the command token begins,
  everything after it is passed through as command arguments. Use `--` to prevent ambiguity:
  ```bash
  bgrun -- grep -r pattern /etc/hosts   # -- prevents bgrun misreading command flags
  ```

### How wake works on OpenCode

Wake is performed by **`bgrun-wake.js`**, an in-process OpenCode plugin that ships in this
repo. When the **`bgrun` tool** is called, `context.sessionID` is captured in-process and
forwarded to `_bgrunner.sh` via the `-s <session-id>` flag. The script atomically writes a
`.session` sidecar file before spawning the detached job, so the exact originating session
is on disk from the start. When the job finishes, `_bgrunner.sh` writes a `.notify`
breadcrumb. The plugin polls `~/.bgrun/jobs` every 1s, atomically claims the breadcrumb
(renames `.notify` → `.notified`, fire-once), reads the `.session` sidecar to route the
wake to the exact session, and calls `client.session.promptAsync()` to wake the live agent
so it proactively continues. `chat.message` hook tracking and `client.session.list()` serve
only as a fallback when no `.session` sidecar is present.

**Wake message format** — when woken, the agent receives a prompt like:
```
✅ Background job abc123 finished (exit 0).
Command: make test-short
Last output: ok  github.com/stablekernel/myrepo  42.3s
Run `bgtail abc123 40` to see the full tail.
```
- ✅ = exit 0; ❌ = non-zero exit
- `Last output` is the last non-empty log line, truncated to 200 chars
- When woken: check the exit status first, then run `bgtail <id> 40` for details

**The plugin is required on OpenCode.** Without it, the human desktop notification still
fires, but there is no live agent wake. Install the plugin by adding
`@stablekernel/opencode-bgrun@0.1.2` to the `plugin` array in your
`opencode.json` (recommended), or run `./install.sh` from a repo clone for local dev.
Restart OpenCode either way. See Setup below.

### Other tools (Cursor, Claude Code)

`--origin cursor` and `--origin claude` receive the macOS desktop notification only — no
live session wake. Each tool would need its own in-process bridge; these are separate future
deliverables. Today `bgrun` handles them at the notification rung only.

- **Non-fatal:** if the wake fails for any reason (plugin not loaded, network issue, etc.)
  the job still completes normally and the human notification fires as usual.

### Sidecar files written

| File | Content |
|---|---|
| `~/.bgrun/jobs/<job>.origin` | origin tool |
| `~/.bgrun/jobs/<job>.session` | session id written atomically by the script when `-s` is provided (tool path); read by the plugin to route the wake to the exact originating session |
| `~/.bgrun/jobs/<job>.notify` | completion breadcrumb written by `_bgrunner.sh` at job finish |
| `~/.bgrun/jobs/<job>.notified` | written by the plugin on atomic claim (rename from `.notify`); marks job already-woken |

`bgclean` removes all four sidecars alongside the standard `.status`/`.log` pair.

## Setup (one-time)

**1. Recommended — plugin via npm:**
Add the spec to the `plugin` array in your `opencode.json`:
```json
{ "plugin": ["@stablekernel/opencode-bgrun@0.1.2"] }
```
OpenCode fetches the package automatically on next start. Restart OpenCode to load the
plugin. This gives you the agent-facing `bgrun` tool and the session-wake feature. It does
**not** put the human shell CLIs (`bgrun`, `bgstatus`, `bgtail`, `bgclean`) on your PATH.

**2. Human shell CLI (optional, notify-only):**
Recommended: `npm i -g @stablekernel/opencode-bgrun` — puts all six CLI scripts on your
PATH via npm's bin map. Alternatively, run `./install.sh --cli-only` from a clone, or
auto-discovers the npm-installed package in OpenCode's cache without a clone.
`./install.sh --help` shows all modes. Remove with `./uninstall.sh --cli-only`.

**3. Local dev (from a clone):**
Run `./install.sh` (no flags) from the repo root. It symlinks CLI + plugin + skill from
your clone for development. Restart OpenCode after.

**Configuration (optional env vars):**
```bash
# Override where job artifacts are stored (default: ~/.bgrun/jobs)
export BGRUN_DIR=/tmp/my-jobs          # e.g. per-project isolation or temp storage

# Or inline for a single run:
BGRUN_DIR=/tmp/my-jobs bgrun -- npm test
```

`terminal-notifier` is optional — if absent, notifications fall back to `osascript` (built
into macOS). For click-through to OpenCode from notifications, add to `~/.zshrc`:
```bash
export BGRUN_ACTIVATE=com.superset.desktop  # OpenCode; swap for your terminal's bundle ID
```

> **Legacy note:** Earlier versions stored jobs in `.run/` at the project root. If you have
> old jobs there, the plugin prints a one-time informational warning on startup. Use
> `BGRUN_DIR=.run bgrun …` to keep old behavior, or leave it and use the new default.

## Workflow

1. **Start:** call the `bgrun` tool with `command: "make test-short"`.
   The tool returns `started: <job-id>`. Tell the user the job started; continue other work.
   OpenCode will wake this session when the job finishes — you don't need to poll.
2. **Check (non-blocking, if you can't wait for the wake):** `bgstatus "$JOB"`
   - `running` → keep doing other work; check again later. Do NOT spin a wait loop.
   - `done exit=0` → success. Read the tail to confirm.
   - `done exit=<non-zero>` or `crashed` → failure; analyze the log.
3. **Read results (context-safe):**
   - Success or small log → `bgtail "$JOB" 40`
   - Need the whole log → **ctx_execute_file** on `~/.bgrun/jobs/<JOB>.log` to extract only
     the failing lines. NEVER `cat` or `Read` the full log — that reintroduces token bloat.

### Example full workflow

```
// 1. Start — call the bgrun TOOL (not a bash command)
bgrun(command: "make test-short")
// → "started: abc123"
JOB=abc123

// 2. Continue other work. OpenCode wakes this session automatically when done.

// 3. If you need to check before the wake arrives (non-blocking):
bgstatus "$JOB"

// 4. Retrieve results
bgtail "$JOB" 40
```

### For commands with pipes or chaining

Pass the full shell string as the `command` argument to the tool:
```
bgrun(command: "make build && make test-short")
```

When using the script directly (human shell), wrap in `bash -c`:
```bash
bgrun bash -c 'make build && make test-short'
```

## Resuming after hand-off / new session

- List all jobs: `bgstatus`  (reads files from `~/.bgrun/jobs`; no memory needed)
- Then `bgstatus <id>` / `bgtail <id>` as above.

## Rules

- Call the scripts; never hand-roll `nohup … &` inline (fragile under bash 3.2 + set -e).
- One job = one id. Multiple concurrent jobs are fine — each has its own `~/.bgrun/jobs/<id>.log` and `~/.bgrun/jobs/<id>.status`.
- Logs live in `~/.bgrun/jobs` (not in the project; not gitignored there). Safe to leave; `bgrun` never deletes prior logs automatically (auto-cleanup happens at startup after 14 days).
- **Never `cat` or `Read` a full log** — use `bgtail` for tails or `ctx_execute_file` for analysis.
- Run `bgclean` periodically to proactively remove completed jobs before the 14-day auto-cleanup.

## Housekeeping

`~/.bgrun/jobs` accumulates a `.status` + `.log` pair (plus optional sidecars) for every
job. Two cleanup tiers keep it from growing unbounded:

**Automatic (startup):** the plugin silently removes completed job artifacts older than
**14 days** each time OpenCode starts. No action required.

**Manual (on-demand):** call the `bgclean` tool or shell command to clean up sooner.
Default threshold is **7 days** (more aggressive than the startup sweep — you're asking
for it explicitly).

```bash
# Remove completed jobs older than 7 days (default)
bgclean

# Remove completed jobs older than 3 days
bgclean 3
```

`bgclean` is safe to run at any time:
- **Never removes a running job** — skips any job whose PID is still alive.
- **Cleans crashed jobs** — if a job shows `state=running` but the PID is gone, it removes the artifacts rather than leaving them to accumulate.
- Prints a summary: `removed N job(s), kept M[, skipped K running]`.

## Log analysis pattern (ctx_execute_file)

When you need to analyze the whole log without loading it into context:

```
ctx_execute_file(
  path: "~/.bgrun/jobs/<JOB>.log",
  language: "javascript",
  code: "const L=FILE_CONTENT.split('\\n'); \
         const fails=L.filter(l=>/(--- FAIL|FAIL|panic:|Error:)/.test(l)); \
         console.log(`lines: ${L.length}, failures: ${fails.length}`); \
         console.log(fails.slice(0,40).join('\\n'));"
)
```

A 10 000-line `make test` log collapses to a ~30-line summary in context.

## Decision rule

- `exit: 0` → report success from the tail.
- `exit: <non-zero>` → failure; `ctx_execute_file` the log for a failure summary.
- `crashed` → process died before writing status (OOM, uncaught signal, etc.); treat like a
  non-zero exit and analyze the log the same way.
- **Never `cat`/`Read` the full log.**
