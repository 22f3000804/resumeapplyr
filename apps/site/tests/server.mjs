// Local preview: serves public/ and runs functions/api/signup.js against an in-memory D1.
// `npm run serve` → http://localhost:8788. Pass --no-db to see the "not switched on yet" state.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost } from '../functions/api/signup.js';
import { createFakeD1 } from './fake-d1.mjs';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function startServer({ port = 8788, db = createFakeD1() } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/signup' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) });
      const response = await onRequestPost({ request, env: db ? { DB: db } : {} });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(join(ROOT, '404.html')).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, db, url: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ db: process.argv.includes('--no-db') ? null : createFakeD1() });
  console.log(`resumeapplyr site on ${url}`);
}
