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

/** Create a temp project root with a .run/ dir. */
function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgrun-test-'));
  const runDir = path.join(dir, '.run');
  fs.mkdirSync(runDir);
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

  // ── (f) missing .run/ doesn't crash ──────────────────────────────────────
  {
    console.log('\n(f) missing .run/ does not crash');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgrun-test-'));
    // NOTE: we do NOT create .run/ here.
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

    assert('(f) plugin does not throw when .run/ missing', !threw);
    assert('(f) no wakes when .run/ missing', calls.promptAsync.length === 0);

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
