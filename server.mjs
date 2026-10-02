import http from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = dirname(fileURLToPath(import.meta.url));
const root = join(base, 'dist');
const dataDir = process.env.MILK_BOARD_DATA_DIR || join(base, 'data');
const dataFile = join(dataDir, 'state.json');
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']]
]);
const port = Number(process.env.PORT ?? 4173);

function validState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const hours = state.intervalHours;
  if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0.5 || hours > 24 || Math.abs(hours * 10 - Math.round(hours * 10)) > 1e-8)) return false;
  const started = state.intervalStartedAt;
  if (started !== null && (typeof started !== 'number' || !Number.isFinite(started) || started <= 0)) return false;
  if (!Array.isArray(state.entries) || state.entries.length > 10000) return false;
  const ids = new Set();
  for (const entry of state.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || entry.id.length > 120 || ids.has(entry.id)) return false;
    if (typeof entry.at !== 'number' || !Number.isFinite(entry.at) || entry.at <= 0) return false;
    if (!Number.isInteger(entry.amount) || entry.amount < 1 || entry.amount > 2000) return false;
    if (entry.auto !== undefined && typeof entry.auto !== 'boolean') return false;
    ids.add(entry.id);
  }
  return true;
}

const emptyState = () => ({ intervalHours: null, intervalStartedAt: null, entries: [] });
let stored;
try {
  const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
  if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 1 || !validState(parsed.state)) throw new Error('Invalid saved data');
  stored = parsed;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  stored = { revision: 0, state: emptyState() };
}

async function save(next) {
  await mkdir(dataDir, { recursive: true });
  const temp = join(dataDir, `state.json.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, dataFile);
  stored = next;
}

let writes = Promise.resolve();
function queueWrite(action) {
  const result = writes.then(action);
  writes = result.catch(() => {});
  return result;
}

function reply(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function jsonBody(request) {
  if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) throw new Error('需要 JSON 请求');
  const parts = [];
  let length = 0;
  for await (const part of request) {
    length += part.length;
    if (length > 1024 * 1024) throw new Error('数据过大');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('JSON 格式错误'); }
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/downloads/baby-feeding-dashboard.apk' && request.method === 'GET') {
    try {
      const apk = await readFile(join(base, 'artifacts', 'baby-feeding-dashboard-1.1.4.apk'));
      response.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="baby-feeding-dashboard-1.1.4.apk"',
        'Content-Length': apk.length,
        'Cache-Control': 'no-cache',
      }).end(apk);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('APK unavailable');
    }
    return;
  }
  if (path === '/api/state') {
    if (request.method === 'GET') {
      reply(response, 200, { initialized: stored.revision > 0, revision: stored.revision, state: stored.state });
      return;
    }
    if (request.method === 'PUT') {
      try {
        const body = await jsonBody(request);
        if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !validState(body.state)) {
          reply(response, 400, { error: '记录数据无效' });
          return;
        }
        await queueWrite(async () => {
          if (body.revision !== stored.revision) {
            reply(response, 409, { error: '服务器记录已更新', revision: stored.revision, state: stored.state });
            return;
          }
          const next = { revision: stored.revision + 1, state: body.state };
          await save(next);
          reply(response, 200, next);
        });
      } catch (error) {
        if (!response.headersSent) {
          if (error.message === '数据过大') reply(response, 413, { error: error.message });
          else if (error.message === '需要 JSON 请求' || error.message === 'JSON 格式错误') reply(response, 400, { error: error.message });
          else {
            process.stderr.write(`保存记录失败：${error.message}\n`);
            reply(response, 500, { error: '服务器保存失败' });
          }
        }
      }
      return;
    }
    reply(response, 405, { error: '不支持此方法' });
    return;
  }
  const asset = files.get(path);
  if (!asset || request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, asset[0]));
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    response.writeHead(500).end('Unable to read file');
  }
});
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`喝奶看板已启动：http://<这台电脑的局域网 IP>:${server.address().port}\n`);
});
