import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), 'dist');
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
const port = Number(process.env.PORT || 4173);

http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
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
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`喝奶看板已启动：http://<这台电脑的局域网 IP>:${port}\n`);
});
