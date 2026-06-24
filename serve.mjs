// Node adapter to run the Cloudflare-module SSR build (dist/server/index.mjs)
// on a plain Node server, serving static assets from dist/client.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './dist/server/index.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(ROOT, 'dist', 'client');
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp',
  '.map': 'application/json', '.txt': 'text/plain',
};

async function serveStatic(pathname) {
  const file = join(CLIENT, pathname);
  if (!file.startsWith(CLIENT)) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
  } catch {
    return null;
  }
  const buf = await readFile(file);
  return new Response(buf, {
    headers: {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// Minimal Cloudflare bindings expected by the nitro cloudflare-module handler.
const env = {
  ASSETS: {
    fetch: async (req) =>
      (await serveStatic(new URL(req.url).pathname)) ||
      new Response('Not found', { status: 404 }),
  },
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

createServer(async (nreq, nres) => {
  try {
    const url = `http://${nreq.headers.host || 'localhost'}${nreq.url}`;
    const method = nreq.method || 'GET';
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      body = await new Promise((resolve) => {
        const chunks = [];
        nreq.on('data', (d) => chunks.push(d));
        nreq.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }
    const request = new Request(url, {
      method,
      headers: nreq.headers,
      body,
      duplex: 'half',
    });
    const res = await handler.fetch(request, env, ctx);
    nres.statusCode = res.status;
    res.headers.forEach((v, k) => nres.setHeader(k, v));
    nres.end(Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    console.error(e);
    nres.statusCode = 500;
    nres.end('Server error');
  }
}).listen(PORT, HOST, () => console.log(`SSR listening on http://${HOST}:${PORT}`));
