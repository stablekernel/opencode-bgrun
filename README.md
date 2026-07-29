# opencode-bgrun

Run long shell commands (test suites, builds, linters) as detached background jobs so your
AI coding agent's session stays unblocked and its context stays clean. Output lands in a file
under `.run/`; the command returns immediately. State is file-based, so a new agent session can
pick up a job started by a prior one.

On **OpenCode**, a companion plugin **wakes the originating agent session** when a job
finishes — so the agent proactively reads results and reacts, rather than waiting for a human
to notice a notification.

---

## Quick start

```bash
./install.sh        # symlink scripts + plugin + skill
# restart OpenCode  # required for the plugin to load
```

**As an AI agent (OpenCode) — call the `bgrun` tool:**

```
bgrun(command: "make test-short")
// returns immediately: "started: <job-id>"
// agent is woken automatically when the job finishes
```

**As a human in a shell — call the script directly:**

```bash
bgrun make test-short
# returns immediately; desktop notification fires on completion
```

---

## How it works

### Two audiences

**AI agents on OpenCode** call the **`bgrun` tool** — a first-class OpenCode plugin tool.
The tool captures `context.sessionID` in-process and forwards it to the underlying shell
script via a `-s <session-id>` flag. When the job finishes, the plugin wakes *that exact
session* via `client.session.promptAsync()`. This is correct even when many concurrent agent
sessions share the same directory.

**Humans in a shell** call the `bgrun` script directly. A human shell invocation has no live
agent session to wake, so it is **notify-only** — a desktop notification fires via
`terminal-notifier` (or `osascript` as fallback) when the job finishes. This is expected and
honest behavior. Omitting `-s` always produces notify-only behavior.

### Wake routing

The `bgrun` script writes sidecar files into `<project-root>/.run/` for each job:

| Sidecar | Contents |
|---------|----------|
| `.status` | Key=value state: `state`, `pid`, `exit`, `cmd`, … |
| `.log` | Captured command output |
| `.origin` | Which tool launched the job (`opencode` \| `claude` \| `cursor`; defaults to `opencode`) |
| `.session` | Session id to wake (written only when `-s` is passed) |

The `.session` sidecar is written **atomically before the job is spawned**, so even a job that
finishes instantly is routed correctly — there is no race.

On completion the runner drops a `.notify` breadcrumb. The plugin polls `.run/` (~1 s interval),
atomically claims each `.notify` by renaming it to `.notified` (fire-once — survives plugin
restarts), reads the `.session` sidecar for exact routing, and wakes that session. If no
`.session` sidecar is present the plugin falls back to the most-recently-active session.

**Non-fatal degradation:** if the wake fails for any reason — plugin not loaded, SDK missing,
etc. — the job still completes normally and the human desktop notification fires as usual.

---

## Commands

| Command | Typical caller | Purpose |
|---------|---------------|---------|
| `bgrun <command…>` | Agent tool / shell | Launch a command as a detached background job; returns `started: <job-id>` immediately |
| `bgstatus [<job-id>]` | Agent / shell | Show status (`running`, `done`, `crashed`) and exit code; omit job-id to list all jobs |
| `bgtail <job-id> [lines]` | Agent / shell | Print the last *N* lines of the job's log (default 40) |
| `bgclean [days]` | Shell / cron | Delete `.run/` artifacts older than *N* days (default 7); self-prunes the log directory |

When used from an agent, the `bgrun` **tool** (plugin-registered) wraps the `bgrun` script
and handles session-id injection automatically. `bgstatus`, `bgtail`, and `bgclean` are shell
scripts called from the agent via a bash tool.

---

## Install details

```bash
./install.sh
```

Creates symlinks:

| Source | Destination |
|--------|-------------|
| `bin/bgrun`, `bin/bgstatus`, `bin/bgtail`, `bin/bgclean` | `~/.local/bin/` |
| `plugin/bgrun-wake.js` | `~/.config/opencode/plugin/` |
| `skill/run-bg/` | `~/.config/opencode/skills/run-bg/` |

`./uninstall.sh` removes those symlinks.

**Restart OpenCode after install.** OpenCode discovers plugins in `~/.config/opencode/plugin/`
at startup — no `opencode.json` entry is needed — but the plugin is not hot-loaded; a restart
is required for the tool registration and completion poller to become active.

### Plugin SDK resolution

The plugin loads the OpenCode SDK (`@opencode-ai/plugin`) via a resolution cascade: bare import
first, then the OpenCode config directory. If the SDK cannot be found the poller still runs
(desktop notifications work), but the `bgrun` tool and agent-wake require a successful SDK load.

### Optional: desktop notifications

Install `terminal-notifier` for richer macOS notifications:

```bash
brew install terminal-notifier
```

To get click-through to your editor when a notification fires, set `BGRUN_ACTIVATE` to your
editor's bundle ID in your shell profile:

```bash
# ~/.zshrc
export BGRUN_ACTIVATE=com.example.YourEditor
```

---

## Scope and portability

The **live-agent wake** is OpenCode-specific. Only an in-process plugin can call
`client.session.promptAsync()` to wake a live OpenCode session — a CLI path and an HTTP bridge
were both proven dead-ends. This component cannot be ported without a per-tool equivalent.

The **file-based job runner** (`bin/`) is tool-agnostic: plain POSIX sh, no OpenCode dependency.
The `.origin` sidecar is the intended routing seam for per-tool plugins — a Cursor or Claude
Code integration would read `.origin` and apply its own wake mechanism. These are separate
future deliverables; the core runner works today regardless of which agent (or no agent) is
present.

**Summary:** OpenCode-first for the full agent-wake experience; core job runner is portable.

---

## Components

```
bin/
  bgrun              # Launch a detached job; writes .run/ sidecars
  _bgrunner.sh       # Detached executor (invoked by bgrun, not directly)
  bgstatus           # Check job status
  bgtail             # Tail job log output
  bgclean            # Remove old .run/ artifacts
plugin/
  bgrun-wake.js      # OpenCode plugin: registers bgrun tool + runs completion poller
skill/
  run-bg/            # OpenCode skill: teaches agents when/how to use bgrun
install.sh           # Symlink everything into place
uninstall.sh         # Remove symlinks
```
