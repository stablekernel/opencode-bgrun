/**
 * bgrun-wake — OpenCode plugin that wakes a live agent session when a bgrun job finishes.
 *
 * HOW IT WORKS
 * ------------
 * bgrun writes sidecar files into <project-root>/.run/ when launched:
 *   <jobid>.origin   — "opencode" (only wake for this origin)
 *   <jobid>.session  — calling session id (written atomically BEFORE spawn when -s passed)
 *   <jobid>.notify   — completion breadcrumb; its APPEARANCE signals job done
 *   <jobid>.status   — key=value file with exit=<code>, cmd=..., etc.
 *
 * SESSION TRACKING (two-tier)
 * ---------------------------
 * Tier 1 — exact routing: when bgrun is invoked by the plugin's bgrun TOOL, it passes
 *   -s <context.sessionID>. The script writes a .session sidecar BEFORE spawning, so the
 *   plugin can read it and route the wake to exactly the right session, even when multiple
 *   sessions share the same directory.
 *
 * Tier 2 — fallback: when bgrun is run from a terminal (no -s), the plugin falls back to
 *   activeSessionID (set by the chat.message hook on every user message), then to
 *   client.session.list() picking the most-recently-updated session.
 *
 * BGRUN TOOL
 * ----------
 * The plugin exposes a `bgrun` tool. When the agent calls it, execute() captures
 * context.sessionID in-process and passes it to the script via -s. The tool returns
 * the "started: <id>" line so the agent sees the job id immediately.
 *
 * FIRE-ONCE DESIGN
 * ----------------
 * Each .notify is processed exactly once even across event storms or plugin restarts:
 *   1. An in-memory Set<jobId> prevents double-firing within the same process run.
 *   2. On claim, we rename .notify → .notified (atomic on POSIX FS) before waking.
 *      The rename is the atomic claim: only one writer wins.
 *   3. On plugin load, existing .notified files pre-populate the in-memory Set so
 *      a restart doesn't replay already-fired jobs.
 *
 * Export name: BgrunWakePlugin
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

// Poll interval in milliseconds — 1s is plenty for bgrun's use case.
const POLL_INTERVAL_MS = 1000;

export const BgrunWakePlugin = async ({ client, directory, $ }) => {
  // $ (Bun shell) is available here if needed; we use execFileSync for shell-out
  // because it handles free-form command strings safely without word-splitting.
  void $; // suppress unused-variable lint if any

  // ── Lazy-load @opencode-ai/plugin (dynamic import — resolution cascade) ────
  // This import is deferred until the factory runs (not at module load time) so
  // that merely importing bgrun-wake.js — e.g. in standalone tests — does NOT
  // pull in zod transitively.
  //
  // Resolution cascade (in order):
  //   1. Bare import('@opencode-ai/plugin') — works when a real SDK is installed
  //      locally in the repo's own node_modules. Guard against the 0.0.0-stub by
  //      requiring typeof mod.tool === 'function'.
  //   2. Config-dir absolute path — proven to work from any symlink-target dir.
  //      Reads OPENCODE_CONFIG_DIR env or falls back to ~/.config/opencode.
  //   3. If both fail, log a LOUD warning (not silent) and return null — the poller
  //      still runs, only the bgrun tool registration is skipped.

  /**
   * Try to load a module namespace object that has a usable `tool` function.
   * Returns the module namespace or null.
   */
  const loadSDK = async () => {
    let lastErr = null;

    // ── Attempt 1: bare import ────────────────────────────────────────────────
    try {
      const mod = await import('@opencode-ai/plugin');
      if (mod && typeof mod.tool === 'function') {
        return mod; // real SDK resolved locally
      }
      // importable but useless (e.g., 0.0.0-stub if zod ever gets installed) — fall through
    } catch (err) {
      lastErr = err;
      // ENOENT / ERR_MODULE_NOT_FOUND — continue to config-dir path
    }

    // ── Attempt 2: OpenCode config-dir absolute path ──────────────────────────
    try {
      const configDir =
        process.env.OPENCODE_CONFIG_DIR ||
        path.join(os.homedir(), '.config', 'opencode');
      const sdkEntry = path.join(
        configDir,
        'node_modules',
        '@opencode-ai',
        'plugin',
        'dist',
        'index.js',
      );
      if (fs.existsSync(sdkEntry)) {
        const url = pathToFileURL(sdkEntry);
        const mod = await import(url.href);
        if (mod && typeof mod.tool === 'function') {
          return mod;
        }
        // file exists but tool not a function — treat as miss
        lastErr = new Error(`${sdkEntry} loaded but tool is not a function`);
      } else {
        lastErr = new Error(`SDK entry not found at ${sdkEntry}`);
      }
    } catch (err) {
      lastErr = err;
    }

    // ── Both failed ───────────────────────────────────────────────────────────
    const configDir =
      process.env.OPENCODE_CONFIG_DIR ||
      path.join(os.homedir(), '.config', 'opencode');
    console.error(
      '[bgrun-wake] Could not load @opencode-ai/plugin SDK — the bgrun TOOL will NOT be ' +
      'registered (poller still runs). Tried: bare import, and ' +
      `${path.join(configDir, 'node_modules', '@opencode-ai', 'plugin')}. ` +
      'Install the SDK or check OPENCODE_CONFIG_DIR. ' +
      `Last error: ${lastErr?.message ?? String(lastErr)}`,
    );
    return null;
  };

  const sdk = await loadSDK();
  const tool = sdk ? sdk.tool : null;

  // ── Resolve path to bin/bgrun ──────────────────────────────────────────────
  // import.meta.url is the symlink path when OpenCode loads the plugin via the
  // ~/.config/opencode/plugin/ symlink. fs.realpathSync follows the symlink to the
  // real repo file, then ../bin/bgrun is stable regardless of symlink depth.
  const _pluginFilePath = fileURLToPath(import.meta.url);
  let _pluginRealPath;
  try {
    _pluginRealPath = fs.realpathSync(_pluginFilePath);
  } catch (_) {
    _pluginRealPath = _pluginFilePath; // symlink unresolvable — use as-is
  }
  const bgrunBin = path.resolve(path.dirname(_pluginRealPath), '..', 'bin', 'bgrun');

  // ── bgrun tool ─────────────────────────────────────────────────────────────
  // When the agent calls this tool, context.sessionID is the live calling session.
  // We pass it to the script via -s so a .session sidecar is written BEFORE spawn,
  // guaranteeing exact session routing even for ultra-fast jobs.
  // bgrunTool is null when @opencode-ai/plugin couldn't be loaded (graceful degrade).
  const bgrunTool = tool ? tool({
    description:
      'Run a shell command in the background (detached). Use this **instead of bash** whenever ' +
      'a command would produce verbose output or run for a non-trivial duration — tests, builds, ' +
      'lint, integration suites are typical candidates. Raw output streams to a file so it never ' +
      'floods your conversation context. The tool returns immediately with a job id — use ' +
      'bgstatus <id> to check progress and bgtail <id> [lines] to retrieve output. When the job ' +
      'finishes, THIS session is automatically woken so you can proactively continue; do NOT poll ' +
      'in a loop waiting for completion. Pattern: start → hand control back → session wakes you ' +
      'on done.',
    args: {
      command: tool.schema.string().describe(
        'The full shell command to run in the background, e.g. "make test-short"'
      ),
    },
    execute: async (args, context) => {
      // execFileSync is used (rather than Bun $) because args.command is a free-form
      // string that may contain spaces, quotes, pipes, etc. Passing it as the sole
      // argument to `sh -c` is the safest way to run arbitrary shell syntax.
      // _bgrunner.sh runs "$@" directly, so argv becomes: sh -c "<command>" — correct.
      try {
        const output = execFileSync(
          bgrunBin,
          ['-s', context.sessionID, '--', 'sh', '-c', args.command],
          { encoding: 'utf8' }
        );
        return output.trim();
      } catch (err) {
        const msg = err?.stdout ? err.stdout.trim() : (err?.message ?? String(err));
        return `bgrun error: ${msg}`;
      }
    },
  }) : null;

  const runDir = path.join(directory, '.run');

  // Auto-tracked session id. Set by the chat.message hook on every user message.
  // Starts null; if a job fires before any message, we fall back to session.list().
  let activeSessionID = null;

  // In-memory set of job ids we've already processed (or are processing).
  // Pre-populated on startup from existing .notified files so restarts don't replay.
  const processed = new Set();

  // Pre-populate from any .notified files that already exist.
  try {
    const existing = fs.readdirSync(runDir);
    for (const name of existing) {
      if (name.endsWith('.notified')) {
        const jobId = name.slice(0, -'.notified'.length);
        processed.add(jobId);
      }
    }
  } catch (_) {
    // .run/ doesn't exist yet — that's fine, we'll handle it in the poll loop.
  }

  /**
   * Read a single-line sidecar file, trim whitespace/newlines.
   * Returns null if the file doesn't exist or can't be read.
   */
  const readSidecar = (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (_) {
      return null;
    }
  };

  /**
   * Parse exit code from a .status file.
   * Returns null if unavailable.
   */
  const readExitCode = (statusPath) => {
    try {
      const content = fs.readFileSync(statusPath, 'utf8');
      const match = content.match(/^exit=(\d+)/m);
      return match ? parseInt(match[1], 10) : null;
    } catch (_) {
      return null;
    }
  };

  /**
   * Attempt to atomically claim a .notify file by renaming it to .notified.
   * Returns true if we won the claim, false if another process/restart already took it.
   */
  const claimNotify = (notifyPath, notifiedPath) => {
    try {
      fs.renameSync(notifyPath, notifiedPath);
      return true;
    } catch (_) {
      // ENOENT means another process already claimed it (or it disappeared).
      return false;
    }
  };

  /**
   * Resolve the target session id for waking.
   * Uses activeSessionID if set, otherwise falls back to the most-recently-updated session.
   * Returns null if no session can be determined.
   */
  const resolveSessionID = async () => {
    if (activeSessionID) {
      return activeSessionID;
    }
    // Fallback: list sessions and pick the most-recently-updated.
    try {
      const sessions = await client.session.list();
      if (!sessions || sessions.length === 0) {
        return null;
      }
      // Sessions have a time.updated field (epoch ms). Sort descending.
      const sorted = [...sessions].sort((a, b) => {
        const aUpd = a?.time?.updated ?? 0;
        const bUpd = b?.time?.updated ?? 0;
        return bUpd - aUpd;
      });
      return sorted[0].id ?? null;
    } catch (err) {
      console.error('[bgrun-wake] session.list() fallback failed:', err?.message ?? err);
      return null;
    }
  };

  /**
   * Process a single completed job: validate sidecars, claim the .notify, wake the session.
   */
  const handleJob = async (jobId) => {
    // Guard against double-processing within this process run.
    if (processed.has(jobId)) return;
    processed.add(jobId); // Optimistic add — stays even if we skip (prevents infinite retry).

    const notifyPath   = path.join(runDir, `${jobId}.notify`);
    const notifiedPath = path.join(runDir, `${jobId}.notified`);
    const originPath   = path.join(runDir, `${jobId}.origin`);
    const statusPath   = path.join(runDir, `${jobId}.status`);

    // Only wake when .origin == "opencode".
    const origin = readSidecar(originPath);
    if (origin !== 'opencode') {
      // Not our target — leave the .notify intact for other consumers,
      // but don't re-check this job in future polls.
      return;
    }

    // Tier 1: read .session sidecar for exact session routing (written by bgrun -s).
    // Written atomically BEFORE spawn, so if the file exists it's always complete.
    const sessionPath = path.join(runDir, `${jobId}.session`);
    const sessionFromSidecar = readSidecar(sessionPath);

    // Resolve target session id — prefer .session sidecar, fall back to hook/list().
    const sessionID = sessionFromSidecar || (await resolveSessionID());
    if (!sessionID) {
      console.error(`[bgrun-wake] job ${jobId}: no active session and list() returned nothing — skipping wake`);
      // Still claim the .notify so we don't keep trying on every poll.
      claimNotify(notifyPath, notifiedPath);
      return;
    }

    // Atomically claim the .notify by renaming it to .notified.
    if (!claimNotify(notifyPath, notifiedPath)) {
      // Another process (or a prior plugin instance) already claimed it.
      // processed.add() already called — won't retry.
      return;
    }

    // Read exit code from .status for a richer message.
    const exitCode = readExitCode(statusPath);
    const exitStr = exitCode !== null ? String(exitCode) : '?';
    const exitEmoji = exitCode === 0 ? '✅' : '❌';

    // Compose a wake message that makes the agent act, not just acknowledge.
    const wakeMessage =
      `${exitEmoji} Background job \`${jobId}\` finished (exit ${exitStr}). ` +
      `Review the result now: run \`bgtail ${jobId} 40\` to see the output, ` +
      `summarize pass/fail, and continue the task that depended on it.`;

    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: 'text', text: wakeMessage }],
        },
      });
      console.log(`[bgrun-wake] woke session ${sessionID} for job ${jobId} (exit ${exitStr})`);
    } catch (err) {
      // A bad session id or network error must never crash the plugin.
      console.error(`[bgrun-wake] failed to wake session ${sessionID} for job ${jobId}:`, err?.message ?? err);
      // Don't remove from processed — the .notify is already renamed to .notified,
      // so we can't retry anyway. Avoids an infinite loop of failed attempts.
    }
  };

  /**
   * Poll .run/ for new .notify files and process each one.
   */
  const poll = () => {
    let entries;
    try {
      entries = fs.readdirSync(runDir);
    } catch (_) {
      // .run/ doesn't exist yet — nothing to do.
      return;
    }

    for (const name of entries) {
      if (!name.endsWith('.notify')) continue;
      const jobId = name.slice(0, -'.notify'.length);
      if (processed.has(jobId)) continue;

      // Fire-and-forget: handleJob is async but we don't await in the sync poll loop.
      // Errors are caught inside handleJob.
      handleJob(jobId).catch((err) => {
        console.error(`[bgrun-wake] unexpected error handling job ${jobId}:`, err);
      });
    }
  };

  // Start polling.
  const timer = setInterval(poll, POLL_INTERVAL_MS);
  // Run once immediately so jobs that finished before the plugin loaded are picked up.
  poll();

  // Build return object. Omit the `tool` key when @opencode-ai/plugin wasn't available
  // (standalone / test env) so the plugin still constructs and the poller is fully usable.
  const pluginReturn = {
    /**
     * chat.message hook — fires on every user message and carries sessionID.
     * Provides the activeSessionID fallback when bgrun is run from a terminal (no -s).
     */
    'chat.message': async (input) => {
      try {
        if (input?.sessionID) {
          activeSessionID = input.sessionID;
        }
      } catch (_) {
        // Never throw from a hook.
      }
    },

    dispose: async () => {
      clearInterval(timer);
    },
  };

  if (bgrunTool) {
    /**
     * bgrun tool — lets the agent run a command in the background and get woken
     * when it finishes. context.sessionID is captured in-process for exact routing.
     * Only registered when @opencode-ai/plugin loaded successfully (real OpenCode runtime).
     */
    pluginReturn.tool = { bgrun: bgrunTool };
  }

  return pluginReturn;
};

export default BgrunWakePlugin;
