// Een nagebootste MCP AI Bridge voor tests: Streamable HTTP, sessies, SSE-antwoorden en een Origin-controle.
import http from 'node:http';
import '../src/demo.js';

const Demo = globalThis.HDDemo;

const TOOLS = [
  { name: 'home_briefing', description: 'Overview of the home', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'devices_list',
    description: 'List devices. Compact by default.',
    inputSchema: { type: 'object', properties: { detailed: { type: 'boolean' }, limit: { type: 'integer', maximum: 30 }, offset: { type: 'integer' }, zone: { type: 'string' } } },
  },
  { name: 'devices_get', description: 'One device', inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } }, required: ['deviceId'] } },
  {
    name: 'devices_set_capability',
    description: 'Set a capability value',
    inputSchema: { type: 'object', properties: { deviceId: { type: 'string' }, capabilityId: { type: 'string' }, value: {} }, required: ['deviceId', 'capabilityId', 'value'] },
  },
  { name: 'devices_get_offline', description: 'Offline devices', inputSchema: { type: 'object', properties: {} } },
  { name: 'zones_list', description: 'List zones', inputSchema: { type: 'object', properties: {} } },
  { name: 'moods_list', description: 'List moods', inputSchema: { type: 'object', properties: {} } },
  { name: 'moods_activate', description: 'Activate a mood', inputSchema: { type: 'object', properties: { moodId: { type: 'string' } }, required: ['moodId'] } },
  { name: 'homey_dashboards_list', description: 'Native Homey dashboards', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'dashboard_save',
    description: 'Save a dashboard served by the bridge at /dashboard/<name>.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, mode: { type: 'string', enum: ['config', 'html'] }, html: { type: 'string' }, config: { type: 'object' }, set_default: { type: 'boolean' } },
      required: ['name', 'mode'],
    },
  },
  { name: 'dashboard_list', description: 'List bridge dashboards', inputSchema: { type: 'object', properties: {} } },
];

export async function startFakeBridge(options = {}) {
  const o = { sse: false, requireKey: 'test-key', ...options };
  const house = Demo.create();
  const sessions = new Set();
  const calls = [];
  const dashboards = {};
  let origin = '';

  const deviceCompact = (d) => ({
    id: d.id,
    name: d.name,
    zone: house.zones.find((z) => z.id === d.zone).name,
    class: d.class,
    available: d.available !== false,
    capabilities: Object.fromEntries(Object.entries(d.capabilitiesObj).map(([k, v]) => [k, v.value])),
  });

  function callTool(name, args) {
    calls.push({ name, args });
    switch (name) {
      case 'devices_list': {
        const all = args.detailed ? house.devices : house.devices.map(deviceCompact);
        const offset = args.offset || 0;
        const limit = Math.min(args.limit || 30, 30);
        const items = all.slice(offset, offset + limit);
        return { structuredContent: { items, count: items.length, total: all.length, truncated: offset + limit < all.length } };
      }
      case 'devices_get': {
        const d = house.devices.find((x) => x.id === args.deviceId);
        if (!d) return { isError: true, content: [{ type: 'text', text: 'Device not found' }] };
        return { content: [{ type: 'text', text: JSON.stringify(d) }] };
      }
      case 'devices_set_capability':
        try {
          Demo.setValue(house, args.deviceId, args.capabilityId, args.value);
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
      case 'zones_list':
        return { content: [{ type: 'text', text: JSON.stringify({ items: house.zones, count: house.zones.length }) }] };
      case 'moods_list':
        return { structuredContent: { items: house.moods } };
      case 'moods_activate':
        Demo.activateMood(house, args.moodId);
        return { content: [{ type: 'text', text: 'ok' }] };
      case 'dashboard_save': {
        dashboards[args.name] = args;
        return { structuredContent: { saved: true, name: args.name, url: `/dashboard/${args.name}`, default: !!args.set_default } };
      }
      case 'dashboard_list':
        return { structuredContent: { items: Object.keys(dashboards) } };
      default:
        return { content: [{ type: 'text', text: '{}' }] };
    }
  }

  function send(res, payload, headers = {}) {
    if (o.sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
      res.write(': keep-alive\n\n');
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    }
  }

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/dashboard')) {
      const name = decodeURIComponent(path.split('/')[2] || '') || Object.keys(dashboards)[0];
      const d = dashboards[name];
      res.writeHead(d ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(d ? d.html : 'geen dashboard');
    }
    if (path !== '/mcp' || req.method !== 'POST') { res.writeHead(405); return res.end(); }
    if (req.headers.origin && req.headers.origin !== origin) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"origin_rejected"}'); }
    if (o.requireKey && req.headers.authorization !== `Bearer ${o.requireKey}`) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
    let body = '';
    for await (const c of req) body += c;
    const msg = JSON.parse(body);
    if (msg.method === 'initialize') {
      const sid = `s-${Math.random().toString(36).slice(2)}`;
      sessions.add(sid);
      return send(res, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'MCP AI Bridge', version: '4.18.2-test' } } }, { 'mcp-session-id': sid });
    }
    const sid = req.headers['mcp-session-id'];
    if (!sessions.has(sid)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"unknown session"}'); }
    if (!('id' in msg)) { res.writeHead(202); return res.end(); }
    if (msg.method === 'tools/list') {
      const page = msg.params && msg.params.cursor === 'p2' ? TOOLS.slice(6) : TOOLS.slice(0, 6);
      return send(res, { jsonrpc: '2.0', id: msg.id, result: { tools: page, ...(msg.params && msg.params.cursor ? {} : { nextCursor: 'p2' }) } });
    }
    if (msg.method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === msg.params.name);
      if (!tool) return send(res, { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool ${msg.params.name}` } });
      return send(res, { jsonrpc: '2.0', id: msg.id, result: callTool(msg.params.name, msg.params.arguments || {}) });
    }
    return send(res, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  });

  await new Promise((r) => server.listen(o.port || 0, '127.0.0.1', r));
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/mcp`,
    origin,
    house,
    calls,
    dashboards,
    sessions,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// Los te starten voor handmatig testen: node test/fake-bridge.mjs [poort]
if (import.meta.url === `file://${process.argv[1]}`) {
  const b = await startFakeBridge({ port: Number(process.argv[2]) || 52199 });
  console.log(`Nep-bridge op ${b.url} (API-sleutel: test-key)`);
}
