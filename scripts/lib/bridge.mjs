// Gedeelde helpers voor de Node-scripts: dezelfde kernlogica en MCP-client als het dashboard zelf.
import '../../src/core.js';
import '../../src/mcp.js';

export const C = globalThis.HDCore;
export const { McpClient, McpError } = globalThis.HDMcp;

export function bridgeOptions(values) {
  const url = values.url || process.env.HOMEY_BRIDGE_URL;
  const key = values.key || process.env.HOMEY_BRIDGE_KEY || '';
  if (!url) {
    throw new Error('Geef het adres van de bridge op met --url http://<homey-ip>:52199/mcp of zet HOMEY_BRIDGE_URL.');
  }
  return { url: normalizeUrl(url), key };
}

export function normalizeUrl(url) {
  const u = new URL(url.includes('://') ? url : `http://${url}`);
  if (!u.port && u.protocol === 'http:') u.port = '52199';
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/mcp';
  return u.href;
}

export async function connectBridge({ url, key }) {
  const client = new McpClient({ url, apiKey: key, clientName: 'homey-dashboard-cli', timeoutMs: 30000 });
  await client.connect();
  const tools = await client.listTools();
  return { client, tools, map: C.pickTools(tools) };
}

// Alle apparaten ophalen zoals het dashboard dat doet, inclusief paginering.
export async function fetchAll({ client, map }) {
  let zones = C.normalizeZones(null);
  if (map.listZones) {
    try { zones = C.normalizeZones(C.extractPayload(await client.callTool(map.listZones.name, C.listArgs(map.listZones)))); } catch { /* optioneel */ }
  }
  if (!map.listDevices) throw new Error('Deze sleutel ziet geen tool om apparaten op te halen.');
  let args = C.listArgs(map.listDevices, { detailed: true });
  const raw = [];
  let firstPayload = null;
  for (let page = 0; page < 50; page++) {
    const payload = C.extractPayload(await client.callTool(map.listDevices.name, args));
    if (!firstPayload) firstPayload = payload;
    const items = C.extractList(payload);
    raw.push(...items);
    const next = C.nextPageArgs(map.listDevices, args, payload, items.length);
    if (!next) break;
    args = next;
  }
  return { zones, devices: C.normalizeDevices(raw, zones), raw, firstPayload };
}

export function describeTool(t) {
  const props = (t.inputSchema && t.inputSchema.properties) || {};
  const required = new Set((t.inputSchema && t.inputSchema.required) || []);
  const fields = Object.entries(props).map(([k, p]) => {
    const type = [].concat(p.type || (p.enum ? 'enum' : 'any')).join('|');
    const en = p.enum ? ` [${p.enum.join(', ')}]` : '';
    return `    ${required.has(k) ? '*' : ' '} ${k}: ${type}${en}${p.description ? ` — ${String(p.description).split('\n')[0].slice(0, 110)}` : ''}`;
  });
  const desc = String(t.description || '').split('\n')[0].slice(0, 160);
  return `  ${t.name}${desc ? `\n    ${desc}` : ''}${fields.length ? '\n' + fields.join('\n') : ''}`;
}

// Tools die de door de bridge zelf geserveerde dashboards beheren (niet Homey's eigen dashboards).
export function bridgeDashboardTools(tools) {
  return tools.filter((t) => /dashboard/i.test(t.name) && !/^homey_dashboards?_/i.test(t.name));
}

const HTML_KEYS = ['html', 'content', 'markup', 'body', 'page', 'source', 'template', 'code', 'document'];
const NAME_KEYS = ['name', 'slug', 'dashboard', 'dashboard_name', 'dashboardName', 'id', 'title'];
const DEFAULT_KEYS = ['set_default', 'setDefault', 'make_default', 'default', 'is_default'];
const MODE_KEYS = ['mode', 'type', 'format', 'kind'];

function keyIn(props, list) {
  const keys = Object.keys(props);
  for (const k of list) if (keys.includes(k)) return k;
  return null;
}

// Kandidaten om een eigen HTML-dashboard mee op te slaan, met de argumenten die erbij horen.
export function findSaveTool(tools, wanted) {
  const pool = wanted ? tools.filter((t) => t.name === wanted) : bridgeDashboardTools(tools);
  const out = [];
  for (const t of pool) {
    const props = (t.inputSchema && t.inputSchema.properties) || {};
    const htmlKey = keyIn(props, HTML_KEYS);
    if (!htmlKey && !wanted) continue;
    if (!wanted && /(list|get|delete|remove|read|token|status)/i.test(t.name) && !/(save|create|set|update|write|put|upload|build)/i.test(t.name)) continue;
    out.push({ tool: t, htmlKey });
  }
  return out;
}

export function saveArgs(candidate, { html, name, setDefault, title }) {
  const t = candidate.tool;
  const props = (t.inputSchema && t.inputSchema.properties) || {};
  const required = (t.inputSchema && t.inputSchema.required) || [];
  const args = {};
  const htmlKey = candidate.htmlKey || 'html';
  args[htmlKey] = html;
  const nameKey = keyIn(props, NAME_KEYS.filter((k) => k !== htmlKey));
  if (nameKey) args[nameKey] = nameKey === 'title' ? title : name;
  if (props.title && nameKey !== 'title') args.title = title;
  for (const k of MODE_KEYS) {
    const p = props[k];
    if (!p || !Array.isArray(p.enum)) continue;
    const hit = p.enum.find((v) => /html/i.test(v)) || p.enum.find((v) => /custom|raw/i.test(v));
    if (hit) args[k] = hit;
  }
  const defKey = keyIn(props, DEFAULT_KEYS);
  if (defKey && setDefault != null) args[defKey] = !!setDefault;
  const missing = required.filter((k) => !(k in args));
  return { args, missing };
}

export function short(value, max = 120) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}… (${s.length} tekens)` : s;
}
