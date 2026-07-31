/**
 * Smoke test for bgrun-wake.js plugin logic.
 * Run with: node --experimental-vm-modules plugin/bgrun-wake.test.js
 * (or just: node plugin/bgrun-wake.test.js — requires Node 20+ with ESM)
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { BgrunWakePlugin } from './bgrun-wake.js';

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function assert(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS: ${label}`);
    results.push({ label, ok: true });
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    results.push({ label, ok: false, detail });
    failed++;
  }
}

/** Sleep N milliseconds. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a temp project root with a jobs dir and set BGRUN_DIR to it.
 * The plugin reads process.env.BGRUN_DIR to find the job directory.
 * Returns { dir, runDir } — dir is the "project root", runDir is the job dir (BGRUN_DIR).
 */
function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgrun-test-'));
  const runDir = path.join(dir, 'jobs');
  fs.mkdirSync(runDir, { recursive: true });
  // Set BGRUN_DIR so the plugin watches this temp dir instead of ~/.bgrun/jobs.
  process.env.BGRUN_DIR = runDir;
  return { dir, runDir };
}

/** Write a fake job into runDir. Returns jobId. */
function writeJob(runDir, jobId, { origin = 'opencode', exit = '0', withNotify = false } = {}) {
  fs.writeFileSync(path.join(runDir, `${jobId}.origin`), origin + '\n');
  fs.writeFileSync(path.join(runDir, `${jobId}.status`), `state=done\nexit=${exit}\ncmd=make test-short\n`);
  if (withNotify) {
    fs.writeFileSync(path.join(runDir, `${jobId}.notify`), `done\n`);
  }
  return jobId;
}

/** Build a mock client. Returns { client, calls }. */
function makeMockClient(sessions = []) {
  const calls = { promptAsync: [], listCalled: 0 };
  const client = {
    session: {
      promptAsync: async ({ path: p, body }) => {
        calls.promptAsync.push({ id: p.id, text: body.parts[0].text });
      },
      list: async () => {
        calls.listCalled++;
        return sessions;
      },
    },
  };
  return { client, calls };
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n=== bgrun-wake smoke tests ===\n');

  // ── (a) chat.message sets activeSessionID; poll wakes correct session ─────
  {
    console.log('(a) chat.message hook → wakes active session');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });

    // Simulate chat.message hook firing.
    await hooks['chat.message']({ sessionID: 'ses_TEST' }, {});

    // Drop a job.
    writeJob(runDir, 'job-001', { withNotify: true });

    // Wait for poll (up to 2.5s, poll is every 1s).
    await sleep(2500);
    await hooks.dispose();

    assert('(a) promptAsync called once', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(a) target session is ses_TEST', calls.promptAsync[0]?.id === 'ses_TEST',
      `got ${calls.promptAsync[0]?.id}`);
    assert('(a) message mentions job id', calls.promptAsync[0]?.text.includes('job-001'));
    assert('(a) .notified file exists', fs.existsSync(path.join(runDir, 'job-001.notified')));
    assert('(a) .notify file removed', !fs.existsSync(path.join(runDir, 'job-001.notify')));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (b) second poll does NOT re-fire ──────────────────────────────────────
  {
    console.log('\n(b) second poll does not re-fire');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_B' }, {});

    writeJob(runDir, 'job-002', { withNotify: true });

    // Let first poll fire.
    await sleep(1500);
    const countAfterFirst = calls.promptAsync.length;

    // Wait for another poll cycle.
    await sleep(1500);
    await hooks.dispose();

    assert('(b) first poll fired once', countAfterFirst === 1);
    assert('(b) no second fire after extra poll', calls.promptAsync.length === 1,
      `total calls: ${calls.promptAsync.length}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (c) pre-existing .notified prevents replay ───────────────────────────
  {
    console.log('\n(c) pre-existing .notified prevents replay on startup');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    // Write a job that was ALREADY processed — .notified exists, no .notify.
    writeJob(runDir, 'job-003', {});
    fs.writeFileSync(path.join(runDir, 'job-003.notified'), 'done\n');

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_C' }, {});

    await sleep(1500);
    await hooks.dispose();

    assert('(c) no wake for already-notified job', calls.promptAsync.length === 0,
      `called ${calls.promptAsync.length} times`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (d) origin=claude is NOT woken ───────────────────────────────────────
  {
    console.log('\n(d) origin=claude is NOT woken');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_D' }, {});

    writeJob(runDir, 'job-004', { origin: 'claude', withNotify: true });

    await sleep(1500);
    await hooks.dispose();

    assert('(d) no wake for claude-origin job', calls.promptAsync.length === 0,
      `called ${calls.promptAsync.length} times`);
    // .notify should still be present (not claimed by plugin).
    assert('(d) .notify still present (left for other consumers)',
      fs.existsSync(path.join(runDir, 'job-004.notify')));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (e) activeSessionID null → falls back to session.list() ──────────────
  {
    console.log('\n(e) activeSessionID null → fallback to session.list()');
    const fakeSessions = [
      { id: 'ses_OLD', time: { created: 1000, updated: 2000 } },
      { id: 'ses_LATEST', time: { created: 1000, updated: 9999 } },
      { id: 'ses_MID', time: { created: 1000, updated: 5000 } },
    ];
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient(fakeSessions);

    // Do NOT call chat.message hook — activeSessionID stays null.
    const hooks = await BgrunWakePlugin({ client, directory: dir });

    writeJob(runDir, 'job-005', { withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    assert('(e) session.list() was called', calls.listCalled >= 1,
      `listCalled=${calls.listCalled}`);
    assert('(e) woke most-recently-updated session (ses_LATEST)',
      calls.promptAsync[0]?.id === 'ses_LATEST',
      `got ${calls.promptAsync[0]?.id}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (f) empty jobs dir doesn't crash and produces no wakes ─────────────
  {
    console.log('\n(f) empty jobs dir does not crash');
    // makeTmpRoot creates a fresh empty dir and sets BGRUN_DIR to it.
    const { dir } = makeTmpRoot();
    // NOTE: no jobs written — runDir is empty.
    const { client, calls } = makeMockClient();

    let threw = false;
    try {
      const hooks = await BgrunWakePlugin({ client, directory: dir });
      await hooks['chat.message']({ sessionID: 'ses_F' }, {});
      await sleep(1500);
      await hooks.dispose();
    } catch (err) {
      threw = true;
      console.error('  plugin threw:', err);
    }

    assert('(f) plugin does not throw with empty jobs dir', !threw);
    assert('(f) no wakes with empty jobs dir', calls.promptAsync.length === 0);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (g) .session sidecar used for exact routing when present ─────────────
  {
    console.log('\n(g) .session sidecar → used for exact routing (overrides activeSessionID)');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });

    // Set activeSessionID to a different session via chat.message hook.
    await hooks['chat.message']({ sessionID: 'ses_ACTIVE' }, {});

    // Write a job with a .session sidecar pointing to a different session.
    const jobId = 'job-007';
    writeJob(runDir, jobId, { withNotify: true });
    // Write the .session sidecar (simulates bgrun -s ses_SIDECAR).
    fs.writeFileSync(path.join(runDir, `${jobId}.session`), 'ses_SIDECAR\n');

    // Wait for poll.
    await sleep(2500);
    await hooks.dispose();

    assert('(g) promptAsync called once', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(g) routed to .session sidecar session (ses_SIDECAR), not activeSessionID',
      calls.promptAsync[0]?.id === 'ses_SIDECAR',
      `got ${calls.promptAsync[0]?.id}`);
    assert('(g) .notified file exists', fs.existsSync(path.join(runDir, `${jobId}.notified`)));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (h) no .session sidecar → falls back to activeSessionID ──────────────
  {
    console.log('\n(h) no .session sidecar → fallback to activeSessionID from chat.message hook');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });

    // Set activeSessionID via chat.message hook.
    await hooks['chat.message']({ sessionID: 'ses_FALLBACK' }, {});

    // Write a job WITHOUT a .session sidecar.
    const jobId = 'job-008';
    writeJob(runDir, jobId, { withNotify: true });
    // Deliberately do NOT write a .session file — fallback path.

    await sleep(2500);
    await hooks.dispose();

    assert('(h) promptAsync called once', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(h) routed to activeSessionID (ses_FALLBACK)',
      calls.promptAsync[0]?.id === 'ses_FALLBACK',
      `got ${calls.promptAsync[0]?.id}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (i) BGRUN_DIR env var — plugin polls the custom dir, not ~/.bgrun/jobs ─
  {
    console.log('\n(i) BGRUN_DIR env var — plugin watches the env-specified dir');
    const { dir, runDir } = makeTmpRoot(); // sets process.env.BGRUN_DIR = runDir
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_I' }, {});

    // Write the job into the BGRUN_DIR-specified runDir — plugin must see it there.
    writeJob(runDir, 'job-009', { withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    // If BGRUN_DIR is honoured the job was processed; if ~/.bgrun/jobs was used instead,
    // promptAsync would never be called (job not there).
    assert('(i) promptAsync called — BGRUN_DIR dir was polled', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(i) .notified exists in BGRUN_DIR dir',
      fs.existsSync(path.join(runDir, 'job-009.notified')));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (j) wake message includes exit code from .status ──────────────────────
  {
    console.log('\n(j) wake message includes exit code');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_J' }, {});

    // Write a job that exited with code 42.
    writeJob(runDir, 'job-010', { exit: '42', withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    assert('(j) promptAsync called', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(j) wake message contains exit code 42',
      calls.promptAsync[0]?.text.includes('42'),
      `text: ${calls.promptAsync[0]?.text}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (k) wake message contains ✅ emoji for exit 0 ─────────────────────────
  {
    console.log('\n(k) wake message has ✅ for exit 0');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_K' }, {});

    writeJob(runDir, 'job-011', { exit: '0', withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    assert('(k) promptAsync called', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(k) wake message has ✅ for success',
      calls.promptAsync[0]?.text.includes('✅'),
      `text: ${calls.promptAsync[0]?.text}`);
    assert('(k) wake message does NOT have ❌ for success',
      !calls.promptAsync[0]?.text.includes('❌'),
      `text: ${calls.promptAsync[0]?.text}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (l) wake message contains ❌ emoji for non-zero exit ──────────────────
  {
    console.log('\n(l) wake message has ❌ for exit 1');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_L' }, {});

    writeJob(runDir, 'job-012', { exit: '1', withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    assert('(l) promptAsync called', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(l) wake message has ❌ for failure',
      calls.promptAsync[0]?.text.includes('❌'),
      `text: ${calls.promptAsync[0]?.text}`);
    assert('(l) wake message does NOT have ✅ for failure',
      !calls.promptAsync[0]?.text.includes('✅'),
      `text: ${calls.promptAsync[0]?.text}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (m) wake message includes last log line when .log file exists ─────────
  {
    console.log('\n(m) wake message includes last log line');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_M' }, {});

    const jobId = 'job-013';
    writeJob(runDir, jobId, { withNotify: true });
    // Write a multi-line .log file; plugin should include the last non-empty line.
    fs.writeFileSync(
      path.join(runDir, `${jobId}.log`),
      'line one\nline two\nall tests passed\n',
    );

    await sleep(2500);
    await hooks.dispose();

    assert('(m) promptAsync called', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(m) wake message contains last log line',
      calls.promptAsync[0]?.text.includes('all tests passed'),
      `text: ${calls.promptAsync[0]?.text}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (n) auto-cleanup on startup removes jobs older than 14 days ───────────
  {
    console.log('\n(n) auto-cleanup removes jobs older than 14 days on plugin init');
    const { dir, runDir } = makeTmpRoot();

    // Write an old job (no .notify — already done).
    const oldJobId = 'job-old';
    writeJob(runDir, oldJobId, { exit: '0' });
    // Backdate the .status file to 15 days ago so cleanupJobs sees it as expired.
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(runDir, `${oldJobId}.status`), fifteenDaysAgo, fifteenDaysAgo);

    // Write a recent job (should NOT be cleaned up).
    const recentJobId = 'job-recent';
    writeJob(runDir, recentJobId, { exit: '0' });

    const { client } = makeMockClient();
    // Constructing the plugin triggers auto-cleanup(14) internally.
    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks.dispose();

    assert('(n) old job .status deleted by auto-cleanup',
      !fs.existsSync(path.join(runDir, `${oldJobId}.status`)));
    assert('(n) old job .origin deleted by auto-cleanup',
      !fs.existsSync(path.join(runDir, `${oldJobId}.origin`)));
    assert('(n) recent job .status preserved by auto-cleanup',
      fs.existsSync(path.join(runDir, `${recentJobId}.status`)));

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (o) migration hint logs console.error when legacy .run/ has .status files
  {
    console.log('\n(o) migration hint warns when legacy .run/ contains .status files');
    const { dir, runDir } = makeTmpRoot();

    // Create a legacy .run/ dir with a .status file inside the project root.
    const legacyDir = path.join(dir, '.run');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'oldjob.status'), 'state=done\nexit=0\n');

    // Capture console.error output.
    const errorLines = [];
    const origError = console.error;
    console.error = (...args) => {
      errorLines.push(args.join(' '));
      // Suppress output to keep test runner clean; remove this line to debug.
    };

    const { client } = makeMockClient();
    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks.dispose();

    // Restore console.error.
    console.error = origError;

    const migrationWarning = errorLines.find((l) => l.includes('[bgrun-wake] note: legacy .run/'));
    assert('(o) migration hint console.error was emitted',
      !!migrationWarning,
      `captured error lines: ${JSON.stringify(errorLines)}`);
    assert('(o) migration hint mentions the legacy dir path',
      !!(migrationWarning && migrationWarning.includes(legacyDir)),
      `warning: ${migrationWarning}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (p) migration hint is NOT emitted when legacy .run/ is absent ─────────
  {
    console.log('\n(p) no migration hint when legacy .run/ does not exist');
    const { dir } = makeTmpRoot();
    // Do NOT create a .run/ dir — should be silently ignored.

    const errorLines = [];
    const origError = console.error;
    console.error = (...args) => {
      errorLines.push(args.join(' '));
    };

    const { client } = makeMockClient();
    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks.dispose();

    console.error = origError;

    const migrationWarning = errorLines.find((l) => l.includes('[bgrun-wake] note: legacy .run/'));
    assert('(p) no migration hint when no legacy .run/ exists', !migrationWarning,
      `unexpected warning: ${migrationWarning}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── (q) wake message contains the command from .status ────────────────────
  {
    console.log('\n(q) wake message includes command string from .status');
    const { dir, runDir } = makeTmpRoot();
    const { client, calls } = makeMockClient();

    const hooks = await BgrunWakePlugin({ client, directory: dir });
    await hooks['chat.message']({ sessionID: 'ses_Q' }, {});

    // writeJob writes cmd=make test-short in the status file.
    writeJob(runDir, 'job-014', { withNotify: true });

    await sleep(2500);
    await hooks.dispose();

    assert('(q) promptAsync called', calls.promptAsync.length === 1,
      `called ${calls.promptAsync.length} times`);
    assert('(q) wake message contains command string',
      calls.promptAsync[0]?.text.includes('make test-short'),
      `text: ${calls.promptAsync[0]?.text}`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ─── summary ─────────────────────────────────────────────────────────────
  console.log('\n=== Results ===');
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${passed + failed}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.label}${r.detail ? ': ' + r.detail : ''}`));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
