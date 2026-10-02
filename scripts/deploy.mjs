#!/usr/bin/env node
// Zet dist/homey-dashboard.html als eigen HTML-dashboard op MCP AI Bridge.
//   node scripts/deploy.mjs --url http://192.168.1.50:52199/mcp --key <API-sleutel> [opties]
//
//   --name thuis        naam van het dashboard (wordt /dashboard/thuis)
//   --default           maak het het standaarddashboard op /dashboard
//   --embed-key <sleutel>  zet een (Control only) sleutel in de pagina, zodat browsers niets hoeven in te vullen
//   --home "Ons huis"   naam die bovenaan het dashboard staat
//   --tool <naam>       gebruik deze tool als de automatische keuze niet klopt
//   --dry-run           laat zien wat er verstuurd zou worden, zonder iets te veranderen
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { bridgeOptions, connectBridge, bridgeDashboardTools, describeTool, findSaveTool, saveArgs, short, C } from './lib/bridge.mjs';
import { buildHtml, withConfig } from './build.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    name: { type: 'string', default: 'thuis' },
    default: { type: 'boolean', default: false },
    'embed-key': { type: 'string' },
    home: { type: 'string' },
    tool: { type: 'string' },
    file: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(readHelp());
  process.exit(0);
}

function readHelp() {
  return 'Gebruik: node scripts/deploy.mjs --url http://<homey-ip>:52199/mcp --key <API-sleutel> [--name thuis] [--default] [--embed-key <sleutel>] [--home "Ons huis"] [--tool <naam>] [--dry-run]';
}

try {
  const opts = bridgeOptions(values);
  let html = values.file ? await readFile(values.file, 'utf8') : await buildHtml();
  const config = { endpoint: '/mcp' };
  if (values.home) config.homeName = values.home;
  if (values['embed-key']) config.apiKey = values['embed-key'];
  html = withConfig(html, config);

  console.log(`Verbinden met ${opts.url} …`);
  const { client, tools, map } = await connectBridge(opts);
  console.log(`✓ ${(client.serverInfo && client.serverInfo.name) || 'MCP-server'} · ${tools.length} tools`);
  if (!map.listDevices) console.log('! Deze sleutel ziet geen apparaten-tool. Het dashboard zelf gebruikt de sleutel die in de browser of met --embed-key is ingevuld.');

  const candidates = findSaveTool(tools, values.tool);
  if (candidates.length !== 1) {
    const dash = bridgeDashboardTools(tools);
    console.error(candidates.length
      ? `✗ Meer dan één tool kan een dashboard opslaan: ${candidates.map((c) => c.tool.name).join(', ')}. Kies er een met --tool.`
      : `✗ Geen tool gevonden die een eigen HTML-dashboard opslaat${values.tool ? ` met de naam ${values.tool}` : ''}.`);
    console.error(`\nDashboard-tools die deze sleutel ziet (${dash.length}):\n${dash.map(describeTool).join('\n') || '  geen'}`);
    console.error('\nGeen HTML-veld te zien? Laat dan je AI-assistent het dashboard plaatsen met de prompt in PROMPT.md.');
    process.exit(2);
  }

  const candidate = candidates[0];
  const { args, missing } = saveArgs(candidate, { html, name: values.name, setDefault: values.default, title: values.home || 'Homey Dashboard' });
  if (missing.length) {
    console.error(`✗ ${candidate.tool.name} vraagt ook om: ${missing.join(', ')}. Schema:\n${describeTool(candidate.tool)}`);
    process.exit(2);
  }

  console.log(`\nTool: ${candidate.tool.name}`);
  for (const [k, v] of Object.entries(args)) console.log(`  ${k}: ${k === candidate.htmlKey ? `<HTML, ${(Buffer.byteLength(v) / 1024).toFixed(0)} KB>` : short(v)}`);
  if (values['embed-key']) console.log('  ! De sleutel staat in de pagina. Gebruik een aparte sleutel met permissie Control only.');

  if (values['dry-run']) {
    console.log('\nDry run: niets verstuurd.');
    process.exit(0);
  }

  const result = await client.callTool(candidate.tool.name, args);
  const payload = C.extractPayload(result);
  console.log(`\n✓ Opgeslagen. Antwoord van de bridge:\n${short(payload, 800)}`);
  const host = new URL(opts.url);
  console.log(`\nOpenen: http://${host.hostname}:${host.port || 52199}/dashboard/${encodeURIComponent(values.name)}${values.default ? `  (of http://${host.hostname}:${host.port || 52199}/dashboard)` : ''}`);
  console.log('Blijft de pagina leeg of staat er "Voorbeeld" terwijl je hem via de bridge opent? Zie het hoofdstuk Problemen oplossen in README.md.');
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
