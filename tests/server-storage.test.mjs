import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function startServer(dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, MILK_BOARD_DATA_DIR: dataDir, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Server start timed out: ' + output)); }, 5000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /:(\d+)\n/.exec(output);
      if (match) { clearTimeout(timer); resolve({ child, url: `http://127.0.0.1:${match[1]}` }); }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error('Server exited ' + code + ': ' + output)); });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await stopped;
}

test('首次导入写入服务器，拒绝旧版本覆盖，重启后仍能读取', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'milk-board-'));
  let server;
  try {
    server = await startServer(dataDir);
    let response = await fetch(server.url + '/api/state');
    assert.deepEqual(await response.json(), {
      initialized: false, revision: 0,
      state: { intervalHours: null, intervalStartedAt: null, entries: [] },
    });
    const state = {
      intervalHours: 3.1, intervalStartedAt: null,
      entries: [{ id: 'old-record', at: 1790474400000, amount: 120 }],
    };
    response = await fetch(server.url + '/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 0, state }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, 1);
    response = await fetch(server.url + '/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 0, state: { ...state, entries: [] } }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).state, state);
    const disk = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
    assert.deepEqual(disk.state, state);
    await stopServer(server.child);
    server = await startServer(dataDir);
    response = await fetch(server.url + '/api/state');
    assert.equal((await response.json()).state.entries[0].id, 'old-record');
  } finally {
    if (server) await stopServer(server.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
