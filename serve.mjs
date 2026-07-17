// BilheteIA Pro — servidor Node para o bundle SSR.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class ServerNoopWebSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    CONNECTING = 0; OPEN = 1; CLOSING = 2; CLOSED = 3; readyState = 3;
    protocol = ''; extensions = ''; bufferedAmount = 0; binaryType = 'blob';
    onopen = null; onmessage = null; onclose = null; onerror = null;
    constructor(url, protocols) { super(); this.url = String(url); this.protocols = protocols; }
    close() {}
    send() { throw new Error('Realtime não está habilitado no servidor local.'); }
  };
}

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(ROOT, 'dist', 'server');
const ENTRY_CANDIDATES = ['index.mjs', 'server.js', 'server.mjs', 'index.js'];
const entryName = ENTRY_CANDIDATES.find((f) => existsSync(join(SERVER_DIR, f)));
if (!entryName) {
  console.error(JSON.stringify({ level: 'fatal', message: 'SSR entry não encontrado', dir: SERVER_DIR }));
  process.exit(1);
}
const handler = (await import(join(SERVER_DIR, entryName))).default;
const CLIENT = join(ROOT, 'dist', 'client');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 2_000_000);
const startedAt = Date.now();

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.webp': 'image/webp', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function securityHeaders(headers = new Headers()) {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('cross-origin-opener-policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  return headers;
}

async function serveStatic(pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(CLIENT, safePath);
  if (!file.startsWith(CLIENT)) return null;
  try { if (!(await stat(file)).isFile()) return null; } catch { return null; }
  const buf = await readFile(file);
  const immutable = /\.[a-f0-9]{8,}\./i.test(file) || file.includes('/assets/');
  return new Response(buf, {
    headers: securityHeaders(new Headers({
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    })),
  });
}

const env = { ASSETS: { fetch: async (req) => (await serveStatic(new URL(req.url).pathname)) || new Response('Not found', { status: 404 }) } };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

function json(res, status, payload, requestId) {
  res.statusCode = status;
  securityHeaders().forEach((v, k) => res.setHeader(k, v));
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-request-id', requestId);
  res.end(JSON.stringify(payload));
}

const server = createServer(async (nreq, nres) => {
  const requestId = String(nreq.headers['x-request-id'] || randomUUID());
  const started = performance.now();
  try {
    const host = nreq.headers.host || 'localhost';
    const url = new URL(nreq.url || '/', `http://${host}`);
    if (url.pathname === '/health' || url.pathname === '/ready') {
      return json(nres, 200, { status: 'ok', service: 'bilheteiapro', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }, requestId);
    }

    const method = nreq.method || 'GET';
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        nreq.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            reject(Object.assign(new Error('Payload muito grande'), { statusCode: 413 }));
            nreq.destroy();
            return;
          }
          chunks.push(chunk);
        });
        nreq.on('end', () => resolve(Buffer.concat(chunks)));
        nreq.on('error', reject);
      });
    }

    const request = new Request(url, { method, headers: nreq.headers, body, duplex: body ? 'half' : undefined });
    const response = await handler.fetch(request, env, ctx);
    nres.statusCode = response.status;
    response.headers.forEach((v, k) => nres.setHeader(k, v));
    securityHeaders().forEach((v, k) => nres.setHeader(k, v));
    nres.setHeader('x-request-id', requestId);
    if ((response.headers.get('content-type') || '').includes('text/html')) nres.setHeader('cache-control', 'no-store');
    nres.end(Buffer.from(await response.arrayBuffer()));

    console.log(JSON.stringify({ level: 'info', requestId, method, path: url.pathname, status: response.status, durationMs: Math.round(performance.now() - started) }));
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error(JSON.stringify({ level: 'error', requestId, status, message: error instanceof Error ? error.message : String(error) }));
    if (!nres.headersSent) json(nres, status, { error: status === 413 ? 'Payload muito grande' : 'Erro interno', requestId }, requestId);
    else nres.end();
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(JSON.stringify({ level: 'info', message: 'Servidor iniciado', host: HOST, port: PORT })));

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', message: 'Encerrando servidor', signal }));
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
