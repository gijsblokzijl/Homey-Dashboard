import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHtml, toFragment, withConfig } from '../scripts/build.mjs';
import { findSaveTool, saveArgs, normalizeUrl } from '../scripts/lib/bridge.mjs';
import { startFakeBridge } from './fake-bridge.mjs';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('build voegt alles samen tot één bestand', async () => {
  const html = await buildHtml();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.doesNotMatch(html, /@inline-/);
  for (const marker of ['root.HDCore', 'root.HDMcp', 'root.HDDemo', 'function tileHTML', '--glow:']) assert.ok(html.includes(marker), marker);
  assert.equal((html.match(/<\/script>/g) || []).length, 5, 'config + vier scripts');
});

test('fragment heeft geen omhulsel maar wel titel, stijl en scripts', async () => {
  const frag = toFragment(await buildHtml());
  assert.doesNotMatch(frag, /<html|<head>|<body>|<!doctype/i);
  assert.match(frag, /^<title>Homey Dashboard<\/title>/);
  assert.match(frag, /<style>/);
  assert.match(frag, /root\.HDCore/);
});

test('config wordt veilig in de pagina gezet', async () => {
  const html = withConfig(await buildHtml(), { endpoint: '/mcp', homeName: '</script><b>' });
  const json = html.match(/id="hd-config">([^<]*)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json), { endpoint: '/mcp', homeName: '</script><b>' });
});

test('normalizeUrl vult poort en pad aan', () => {
  assert.equal(normalizeUrl('192.168.1.50'), 'http://192.168.1.50:52199/mcp');
  assert.equal(normalizeUrl('http://homey.local:52199/mcp'), 'http://homey.local:52199/mcp');
});

test('findSaveTool kiest de HTML-dashboardtool van de bridge, niet die van Homey', () => {
  const tools = [
    { name: 'homey_dashboards_create', inputSchema: { properties: { name: {}, columns: {} } } },
    { name: 'dashboard_list', inputSchema: { properties: {} } },
    { name: 'dashboard_save', inputSchema: { properties: { name: { type: 'string' }, mode: { type: 'string', enum: ['config', 'html'] }, html: { type: 'string' }, set_default: { type: 'boolean' } }, required: ['name', 'mode'] } },
  ];
  const found = findSaveTool(tools);
  assert.deepEqual(found.map((c) => c.tool.name), ['dashboard_save']);
  const { args, missing } = saveArgs(found[0], { html: '<p>', name: 'thuis', setDefault: true, title: 'x' });
  assert.deepEqual(args, { html: '<p>', name: 'thuis', mode: 'html', set_default: true });
  assert.deepEqual(missing, []);
});

test('deploy en inspect werken tegen een bridge', async () => {
  const bridge = await startFakeBridge();
  try {
    const dry = await run(process.execPath, [join(root, 'scripts/deploy.mjs'), '--url', bridge.url, '--key', 'test-key', '--dry-run']);
    assert.match(dry.stdout, /Tool: dashboard_save/);
    assert.match(dry.stdout, /Dry run/);
    assert.equal(Object.keys(bridge.dashboards).length, 0);

    const real = await run(process.execPath, [join(root, 'scripts/deploy.mjs'), '--url', bridge.url, '--key', 'test-key', '--name', 'thuis', '--default', '--home', 'Ons huis']);
    assert.match(real.stdout, /Opgeslagen/);
    const saved = bridge.dashboards.thuis;
    assert.equal(saved.mode, 'html');
    assert.equal(saved.set_default, true);
    assert.match(saved.html, /"endpoint":"\/mcp"/);
    assert.match(saved.html, /"homeName":"Ons huis"/);
    assert.doesNotMatch(saved.html, /test-key/, 'sleutel alleen met --embed-key');

    const insp = await run(process.execPath, [join(root, 'scripts/inspect.mjs'), '--url', bridge.url, '--key', 'test-key']);
    assert.match(insp.stdout, /apparaten ophalen\s+devices_list/);
    assert.match(insp.stdout, /51 apparaten/);
    assert.match(insp.stdout, /Verlichting\s+14/);
  } finally {
    await bridge.close();
  }
});
