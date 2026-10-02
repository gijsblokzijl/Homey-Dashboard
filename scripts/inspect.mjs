#!/usr/bin/env node
// Kijkt mee met je bridge: welke tools het dashboard gebruikt en hoe je apparaten worden ingedeeld.
//   node scripts/inspect.mjs --url http://192.168.1.50:52199/mcp --key <API-sleutel>
//   --json apparaten.json   schrijft de genormaliseerde apparaten weg (alleen lokaal)
//   --raw                   toont een stukje van het ruwe antwoord van de apparaten-tool
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { C, bridgeOptions, connectBridge, fetchAll, describeTool, bridgeDashboardTools, short } from './lib/bridge.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    json: { type: 'string' },
    raw: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Gebruik: node scripts/inspect.mjs --url http://<homey-ip>:52199/mcp --key <API-sleutel> [--json apparaten.json] [--raw]');
  process.exit(0);
}

try {
  const opts = bridgeOptions(values);
  console.log(`Verbinden met ${opts.url} …`);
  const bridge = await connectBridge(opts);
  const { client, tools, map } = bridge;
  const info = client.serverInfo || {};
  console.log(`✓ ${info.name || 'MCP-server'} ${info.version || ''} · protocol ${client.protocolVersion} · ${tools.length} tools\n`);

  console.log('Tools die het dashboard gebruikt:');
  const roles = {
    listDevices: 'apparaten ophalen', setCapability: 'bedienen', listZones: 'ruimtes', getDevice: 'één apparaat (reserve)',
    listMoods: 'sferen ophalen', activateMood: 'sfeer aanzetten',
  };
  for (const [role, label] of Object.entries(roles)) {
    console.log(`  ${label.padEnd(24)} ${map[role] ? map[role].name : '— niet gevonden'}`);
  }

  const { devices, zones, firstPayload } = await fetchAll(bridge);
  console.log(`\n${devices.length} apparaten in ${zones.list.length || new Set(devices.map((d) => d.zoneName)).size} ruimtes:`);
  for (const cat of C.CATEGORIES) {
    const items = devices.filter((d) => d.category === cat.id);
    if (!items.length) continue;
    console.log(`  ${cat.label.padEnd(24)} ${String(items.length).padStart(3)}  ${short(items.map((d) => d.name).join(', '), 90)}`);
  }
  const withoutValues = devices.filter((d) => !Object.values(d.caps).some((c) => c.value !== null));
  if (withoutValues.length) console.log(`\n! ${withoutValues.length} apparaten zonder waardes in de lijst; het dashboard haalt die per apparaat op${map.getDevice ? ` met ${map.getDevice.name}` : ', maar er is geen tool voor gevonden'}.`);
  const unknown = devices.filter((d) => d.category === 'overig');
  if (unknown.length) console.log(`\nIn Overig (klasse onbekend of zonder herkenbare functies): ${unknown.map((d) => `${d.name} [${d.cls}]`).join(', ')}`);

  const ov = C.overview(devices);
  console.log(`\nNu: ${ov.lights.on}/${ov.lights.total} lampen aan` + (ov.indoor ? ` · binnen ${C.fmtNumber(ov.indoor.avg, 1)} °C` : '') + (ov.power ? ` · verbruik ${C.fmtPower(ov.power.watts).text} ${C.fmtPower(ov.power.watts).unit}` : '') + ` · ${ov.attentionCount} aandachtspunten`);

  const dash = bridgeDashboardTools(tools);
  console.log(`\nDashboard-tools van de bridge (${dash.length}):`);
  console.log(dash.length ? dash.map(describeTool).join('\n') : '  geen. Geef deze sleutel toegang tot de dashboard-tools om met deploy.mjs te publiceren.');

  if (values.raw) console.log(`\nRuw antwoord van ${map.listDevices.name}:\n${short(firstPayload, 1500)}`);
  if (values.json) {
    await writeFile(values.json, JSON.stringify(devices, null, 2));
    console.log(`\n✓ ${values.json} geschreven`);
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
