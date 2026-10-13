import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { SyncStore } from './store.mjs';
import { AppleAuth } from './auth.mjs';
import { createHandler } from './routes.mjs';

const origin = new URL(process.env.SYNC_ORIGIN ?? 'https://babysync.codeainews.top');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('SYNC_ORIGIN 必须是无路径的 HTTPS 域名');
const dataFile = resolve(process.env.SYNC_DATABASE ?? 'sync-server/data/state.sqlite');
await mkdir(dirname(dataFile), {recursive:true,mode:0o700});
const store = new SyncStore(dataFile);
const keys = ['APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY_FILE','APPLE_APP_ID','APPLE_SERVICES_ID','SYNC_ENCRYPTION_KEY'];
const configured = keys.filter(key => process.env[key]);
let auth = null;
if (configured.length && configured.length !== keys.length) throw new Error('Apple 登录配置不完整：缺少 ' + keys.filter(key => !process.env[key]).join(', '));
if (configured.length) {
  const encryptionKey = Buffer.from(process.env.SYNC_ENCRYPTION_KEY, 'base64');
  auth = new AppleAuth(store, {
    teamId:process.env.APPLE_TEAM_ID,keyId:process.env.APPLE_KEY_ID,
    privateKey:await readFile(process.env.APPLE_PRIVATE_KEY_FILE, 'utf8'),encryptionKey,
    clientIds:{ipad:process.env.APPLE_APP_ID,web:process.env.APPLE_SERVICES_ID,android:process.env.APPLE_SERVICES_ID},
    redirectURI:origin.origin + '/api/auth/callback',
  });
}
const server = createServer(createHandler({store,auth,origin:origin.origin,trustProxy:process.env.SYNC_TRUST_PROXY === '1',log:row => console.log(JSON.stringify(row))}));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.timeout = 20000;
const host = process.env.SYNC_HOST ?? '127.0.0.1', port = Number(process.env.SYNC_PORT ?? 4180);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('SYNC_PORT 无效');
server.listen(port, host, () => console.log(JSON.stringify({event:'listening',host,port:server.address().port,appleLogin:!!auth})));
let retrying = false;
async function retryDeletions() {
  if (!auth || retrying) return;
  retrying = true;
  try {
    auth.sessions.cleanup();
    const results = await auth.retryDeletions();
    if (results.length) console.log(JSON.stringify({event:'deletion-retry',completed:results.filter(r => r.ok).length,pending:results.filter(r => !r.ok).length}));
  } finally { retrying = false; }
}
const retryTimer = setInterval(retryDeletions, 60000);
retryTimer.unref();
await retryDeletions();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => {
  clearInterval(retryTimer);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
});
