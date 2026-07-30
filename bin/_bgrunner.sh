#!/usr/bin/env bash
# Internal. Invoked detached by `bgrun`. Do not call directly.
# Args: <status-file> <log-file> <command...>
STATUS="$1"; LOG="$2"; shift 2

"$@" >> "$LOG" 2>&1
ec=$?

# Atomic status flip: write temp then mv (rename is atomic on POSIX FS).
tmp="${STATUS}.tmp.$$"
{
  echo "state=done"
  echo "exit=${ec}"
  echo "finished=$(date +%s)"
} > "$tmp"
# Preserve the original started=/cmd=/pid=/bundle_id= lines by appending them back.
grep -E '^(started|cmd|pid|bundle_id)=' "$STATUS" >> "$tmp" 2>/dev/null || true
mv "$tmp" "$STATUS"

# Derive job id and run dir from the status file path.
_job_id="$(basename "$STATUS" .status)"
_bg_dir="$(dirname "$STATUS")"

# Write .notify breadcrumb if origin is "opencode". This is the ONLY wake path:
# the OpenCode bgrun-wake plugin watches .run/ for this file and calls session.promptAsync
# to wake the active session's live agent. The plugin auto-tracks the session id via the
# chat.message hook — bgrun no longer writes a .session sidecar.
# (The old `opencode run -s` CLI inject was removed — it spawned a separate headless agent
# and never triggered the live TUI loop. See README.)
_origin_file="$_bg_dir/$_job_id.origin"
_origin_val=""
if [ -f "$_origin_file" ]; then
  _origin_val="$(tr -d '[:space:]' < "$_origin_file" 2>/dev/null)"
fi
if [ "$_origin_val" = "opencode" ]; then
  _notify_msg="Background job ${_job_id} completed: exit ${ec} - run: bgtail ${_job_id}"
  _notify_tmp="$_bg_dir/$_job_id.notify.tmp.$$"
  printf '%s\n' "$_notify_msg" > "$_notify_tmp"
  mv "$_notify_tmp" "$_bg_dir/$_job_id.notify"
fi

# Notify on completion. osascript is built into macOS — no extra deps.
# This human notification is the floor (Rung 3): it always fires, so non-OpenCode tools
# (Cursor, Claude Code) and sessions without the plugin still get a completion signal.
label="$(grep '^cmd=' "$STATUS" 2>/dev/null | sed 's/^cmd=//' | cut -c1-60)"
if [ "$ec" -eq 0 ]; then
  result="✅ passed"
else
  result="❌ failed (exit $ec)"
fi
if command -v terminal-notifier >/dev/null 2>&1; then
  bundle_id="$(grep '^bundle_id=' "$STATUS" 2>/dev/null | sed 's/^bundle_id=//')"
  args=()
  [ -n "$bundle_id" ] && args=(-activate "$bundle_id")
  terminal-notifier -title "bgrun" -message "${result}: ${label}" -sound Morse -timeout 15 "${args[@]}" 2>/dev/null || true
else
  osascript -e 'on run argv' \
            -e 'display notification (item 1 of argv) with title "bgrun" sound name "Glass"' \
            -e 'end run' \
            -- "${result}: ${label}" 2>/dev/null || true
fi
