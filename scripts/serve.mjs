#!/usr/bin/env node
// Serveert het dashboard vanaf je eigen computer, NAS of Raspberry Pi en stuurt /mcp door naar de bridge.
// De API-sleutel blijft op de server; de browser krijgt hem nooit te zien.
//   node scripts/serve.mjs --url http://192.168.1.50:52199/mcp --key <API-sleutel> [--port 8080] [--host 0.0.0.0]
//   node scripts/serve.mjs                 zonder bridge: alleen de voorbeeldwoning
import http from 'node:http';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { buildHtml, withConfig } from './build.mjs';
import { normalizeUrl } from './lib/bridge.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    port: { type: 'string', default: process.env.PORT || '8080' },
    host: { type: 'string', default: '127.0.0.1' },
    home: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Gebruik: node scripts/serve.mjs [--url http://<homey-ip>:52199/mcp] [--key <API-sleutel>] [--port 8080] [--host 0.0.0.0] [--home "Ons huis"]');
  process.exit(0);
}

const target = values.url || process.env.HOMEY_BRIDGE_URL ? normalizeUrl(values.url || process.env.HOMEY_BRIDGE_URL) : null;
const key = values.key || process.env.HOMEY_BRIDGE_KEY || '';
const FORWARD_REQ = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const FORWARD_RES = ['content-type', 'mcp-session-id', 'cache-control'];

async function page() {
  const config = target ? { endpoint: '/mcp', proxied: true } : { demo: true };
  if (values.home) config.homeName = values.home;
  // Telkens opnieuw bouwen, zodat een wijziging in src/ na een herlaadbeurt zichtbaar is.
  return withConfig(await buildHtml(), config);
}

async function proxy(req, res) {
  if (!target) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Geen bridge ingesteld. Start met --url.' }));
    return;
  }
  const headers = {};
  for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  if (key) headers.authorization = `Bearer ${key}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const out = {};
    for (const h of FORWARD_RES) { const v = upstream.headers.get(h); if (v) out[h] = v; }
    res.writeHead(upstream.status, out);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Bridge niet bereikbaar op ${target}: ${err.cause?.code || err.message}` }));
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/mcp') return await proxy(req, res);
    if (req.method === 'GET' && (path === '/' || path === '/index.html' || path.startsWith('/dashboard'))) {
      const html = await page();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Niet gevonden');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(err.message);
  }
});

server.listen(Number(values.port), values.host, () => {
  const where = values.host === '0.0.0.0' ? 'http://<ip-van-deze-computer>' : `http://${values.host}`;
  console.log(`Homey Dashboard draait op ${where}:${values.port}`);
  console.log(target ? `/mcp gaat door naar ${target}${key ? ' (met API-sleutel)' : ' (zonder API-sleutel)'}` : 'Geen --url opgegeven: het dashboard toont de voorbeeldwoning.');
  if (values.host === '0.0.0.0' && target) console.log('Let op: iedereen op je netwerk die deze pagina opent, kan de apparaten bedienen die de sleutel toestaat.');
});
