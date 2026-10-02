import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/core.js';
import '../src/demo.js';

const C = globalThis.HDCore;
const Demo = globalThis.HDDemo;

const homeyDevice = (overrides) => ({
  id: 'd1',
  name: 'Plafondlamp',
  zone: 'z1',
  class: 'light',
  available: true,
  capabilities: ['onoff', 'dim'],
  capabilitiesObj: {
    onoff: { id: 'onoff', value: true, setable: true, getable: true, type: 'boolean', title: 'Turned on' },
    dim: { id: 'dim', value: 0.5, setable: true, getable: true, type: 'number', min: 0, max: 1, units: '%' },
  },
  ...overrides,
});

const zones = C.normalizeZones({ items: [{ id: 'z1', name: 'Woonkamer' }, { id: 'z2', name: 'Tuin' }] });

test('normaliseert een apparaat in de vorm van de Homey Web API', () => {
  const d = C.normalizeDevice(homeyDevice(), zones);
  assert.equal(d.zoneName, 'Woonkamer');
  assert.equal(d.category, 'verlichting');
  assert.equal(d.caps.dim.fraction, true);
  assert.equal(d.caps.dim.value, 0.5);
  assert.equal(d.caps.onoff.setable, true);
  assert.equal(C.capLabel(d.caps.onoff), 'Aan/uit');
});

test('normaliseert een compacte lijst met alleen waardes', () => {
  const d = C.normalizeDevice({ id: 'x', name: 'Stekker', zone: 'Keuken', class: 'socket', capabilities: { onoff: false, measure_power: 12.4 } });
  assert.equal(d.zoneName, 'Keuken');
  assert.equal(d.category, 'schakelaars');
  assert.equal(d.caps.onoff.value, false);
  assert.equal(d.caps.onoff.setable, true, 'bekende bedienbare capability is bedienbaar zonder metadata');
  assert.equal(d.caps.measure_power.setable, false);
  assert.equal(C.toggleCapability(d), 'onoff');
});

test('virtualClass gaat voor de klasse', () => {
  const d = C.normalizeDevice({ id: 'x', name: 'Lamp via stekker', class: 'socket', virtualClass: 'light', capabilities: { onoff: true } });
  assert.equal(d.category, 'verlichting');
});

test('sensoren worden ingedeeld naar wat ze meten', () => {
  const cat = (caps, extra) => C.normalizeDevice({ id: 'x', name: 'Sensor', class: 'sensor', capabilities: caps, ...extra }).category;
  assert.equal(cat({ alarm_motion: false, measure_luminance: 20 }), 'sensoren');
  assert.equal(cat({ alarm_contact: true }), 'sensoren');
  assert.equal(cat({ measure_temperature: 20, measure_humidity: 50 }), 'klimaat');
  assert.equal(cat({ alarm_smoke: false, measure_battery: 90 }), 'beveiliging');
  assert.equal(cat({ measure_power: 300, meter_power: 1000 }, { name: 'P1 meter' }), 'energie');
  assert.equal(cat({ meter_gas: 10 }), 'energie');
  assert.equal(cat({}), 'sensoren');
});

test('klasse other valt terug op capabilities', () => {
  const cat = (caps) => C.normalizeDevice({ id: 'x', name: 'Iets', class: 'other', capabilities: caps }).category;
  assert.equal(cat({ onoff: true, dim: 1 }), 'verlichting');
  assert.equal(cat({ target_temperature: 20 }), 'klimaat');
  assert.equal(cat({ onoff: false }), 'schakelaars');
  assert.equal(cat({ windowcoverings_set: 0.5 }), 'zonwering');
  assert.equal(cat({ locked: true }), 'beveiliging');
  assert.equal(cat({ foo: 1 }), 'overig');
});

test('elke klasse uit de voorbeeldwoning landt in een categorie, niemand in Overig', () => {
  const house = Demo.create();
  const devices = C.normalizeDevices(house.devices, C.normalizeZones(house.zones));
  assert.equal(devices.length, house.devices.length);
  assert.deepEqual(devices.filter((d) => d.category === 'overig').map((d) => d.name), []);
  for (const d of devices) assert.ok(C.CATEGORY_BY_ID[d.category], d.name);
});

test('samenvatting van een gedimde lamp', () => {
  const s = C.deviceSummary(C.normalizeDevice(homeyDevice(), zones));
  assert.equal(s.headline, '50');
  assert.equal(s.unit, '%');
  assert.equal(s.tone, 'lit');
  assert.equal(s.on, true);
  assert.equal(s.level, 0.5);
});

test('samenvatting van een thermostaat die verwarmt', () => {
  const d = C.normalizeDevice({ id: 't', name: 'Thermostaat', class: 'thermostat', capabilities: { measure_temperature: 19.4, target_temperature: 21, thermostat_mode: 'heat' } });
  const s = C.deviceSummary(d);
  assert.equal(s.headline, '19,4');
  assert.equal(s.unit, '°C');
  assert.equal(s.tone, 'heat');
  assert.match(s.sub, /Doel 21,0 °C/);
  assert.equal(C.tileKind(d), 'thermostat');
});

test('open deur en lege batterij vragen aandacht, beweging niet', () => {
  const devices = C.normalizeDevices([
    { id: 'a', name: 'Achterdeur', class: 'sensor', capabilities: { alarm_contact: true } },
    { id: 'b', name: 'Rookmelder', class: 'smokealarm', capabilities: { alarm_smoke: false, measure_battery: 8 } },
    { id: 'c', name: 'Hal', class: 'sensor', capabilities: { alarm_motion: true } },
    { id: 'd', name: 'Waterlek', class: 'sensor', capabilities: { alarm_water: true } },
    { id: 'e', name: 'Lamp', class: 'light', available: false, capabilities: { onoff: false } },
  ]);
  const items = C.attentionItems(devices);
  assert.deepEqual(items.map((i) => [i.device.id, i.severity]), [['d', 'crit'], ['a', 'warn'], ['b', 'warn'], ['e', 'muted']]);
  const ov = C.overview(devices);
  assert.equal(ov.attentionCount, 3);
  assert.equal(ov.critical, 1);
});

test('overzicht neemt de slimme meter voor het verbruik en houdt buiten apart', () => {
  const devices = C.normalizeDevices([
    { id: 'm', name: 'Slimme meter', class: 'sensor', capabilities: { measure_power: 1500 } },
    { id: 's', name: 'Stekker', class: 'socket', capabilities: { onoff: true, measure_power: 900 } },
    { id: 'z', name: 'Zonnepanelen', class: 'solarpanel', capabilities: { measure_power: 2000 } },
    { id: 't1', name: 'Woonkamer', class: 'sensor', capabilities: { measure_temperature: 20 } },
    { id: 't2', name: 'Slaapkamer', class: 'thermostat', capabilities: { measure_temperature: 18, target_temperature: 18 } },
    { id: 't3', name: 'Buitensensor', class: 'sensor', capabilities: { measure_temperature: 9 } },
  ]);
  const ov = C.overview(devices);
  assert.equal(ov.power.watts, 1500);
  assert.equal(ov.power.source, 'meter');
  assert.equal(ov.solar.watts, 2000);
  assert.equal(ov.indoor.avg, 19);
  assert.equal(ov.outdoor.value, 9);
});

test('getallen in Nederlandse notatie', () => {
  assert.deepEqual(C.fmtPower(845), { text: '845', unit: 'W' });
  assert.deepEqual(C.fmtPower(1240), { text: '1,24', unit: 'kW' });
  assert.equal(C.formatFull({ id: 'meter_power', value: 18234.56, kind: 'number', units: 'kWh', decimals: 1 }), '18.234,6 kWh');
  assert.equal(C.formatFull(C.normalizeCap('alarm_contact', true)), 'Open');
  assert.equal(C.formatFull(C.normalizeCap('homealarm_state', 'partially_armed')), 'Deels ingeschakeld');
});

test('sub-capabilities krijgen een leesbaar label', () => {
  const cap = C.normalizeCap('meter_power.exported', 12);
  assert.equal(C.capLabel(cap), 'Energie totaal (teruglevering)');
  assert.equal(C.capLabel(C.normalizeCap('measure_temperature.inside', { value: 1, title: 'Binnen' })), 'Binnen');
});

test('extractList vindt de lijst in veelvoorkomende vormen', () => {
  const list = [{ id: 'a', name: 'A' }];
  assert.deepEqual(C.extractList(list), list);
  assert.deepEqual(C.extractList({ items: list, count: 1 }), list);
  assert.deepEqual(C.extractList({ data: { devices: list } }), list);
  assert.deepEqual(C.extractList({ a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } }).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(C.extractList('niets'), []);
});

test('extractPayload leest structuredContent, JSON-tekst en platte tekst', () => {
  assert.deepEqual(C.extractPayload({ structuredContent: { a: 1 }, content: [] }), { a: 1 });
  assert.deepEqual(C.extractPayload({ content: [{ type: 'text', text: '{"b":2}' }] }), { b: 2 });
  assert.equal(C.extractPayload({ content: [{ type: 'text', text: 'klaar' }] }), 'klaar');
});

test('pickTools kiest de juiste tools en laat lijkende tools liggen', () => {
  const t = (name, props, required) => ({ name, inputSchema: { type: 'object', properties: props || {}, required } });
  const tools = [
    t('devices_get_offline'), t('devices_list_by_zone', { zone: { type: 'string' } }, ['zone']), t('devices_list', { detailed: { type: 'boolean' } }),
    t('devices_set_setting', { deviceId: {}, setting: {}, value: {} }), t('devices_set_capability', { deviceId: {}, capabilityId: {}, value: {} }),
    t('zones_list'), t('zones_get_activity'), t('moods_list'), t('moods_activate', { moodId: {} }), t('devices_get', { deviceId: {} }, ['deviceId']),
  ];
  const m = C.pickTools(tools);
  assert.equal(m.listDevices.name, 'devices_list');
  assert.equal(m.setCapability.name, 'devices_set_capability');
  assert.equal(m.listZones.name, 'zones_list');
  assert.equal(m.activateMood.name, 'moods_activate');
  assert.equal(m.getDevice.name, 'devices_get');
});

test('pickTools herkent afwijkende namen aan hun schema', () => {
  const tools = [
    { name: 'homey_get_all_devices', inputSchema: { properties: {} } },
    { name: 'homey_device_write_capability', inputSchema: { properties: { device_id: {}, capability: {}, value: {} } } },
  ];
  const m = C.pickTools(tools);
  assert.equal(m.listDevices.name, 'homey_get_all_devices');
  assert.equal(m.setCapability.name, 'homey_device_write_capability');
  const d = { id: 'abc', name: 'Lamp' };
  assert.deepEqual(C.setCapabilityArgs(m.setCapability, d, 'onoff', true), { device_id: 'abc', capability: 'onoff', value: true });
});

test('argumenten voor lijsten en paginering', () => {
  const tool = { name: 'devices_list', inputSchema: { properties: { detailed: { type: 'boolean' }, limit: { type: 'integer', maximum: 200 }, offset: { type: 'integer' } } } };
  assert.deepEqual(C.listArgs(tool, { detailed: true }), { detailed: true, limit: 200 });
  assert.deepEqual(C.listArgs(tool, { detailed: false }), { detailed: false, limit: 200 });
  assert.deepEqual(C.nextPageArgs(tool, { limit: 200 }, { items: [], truncated: true }, 200), { limit: 200, offset: 200 });
  assert.equal(C.nextPageArgs(tool, { limit: 200 }, { items: [], truncated: false }, 12), null);
  const cursorTool = { name: 'x', inputSchema: { properties: { cursor: { type: 'string' } } } };
  assert.deepEqual(C.nextPageArgs(cursorTool, {}, { items: [], next_cursor: 'abc' }, 5), { cursor: 'abc' });
});

test('mergeDevices houdt metadata van de volledige lijst vast', () => {
  const full = C.normalizeDevices([homeyDevice()], zones);
  const compact = C.normalizeDevices([{ id: 'd1', name: 'Plafondlamp', class: 'other', capabilities: { onoff: false, dim: 0.2 } }]);
  const merged = C.mergeDevices(full, compact);
  assert.equal(merged[0].cls, 'light');
  assert.equal(merged[0].zoneName, 'Woonkamer');
  assert.equal(merged[0].caps.dim.value, 0.2);
  assert.equal(merged[0].caps.dim.max, 1);
  assert.equal(merged[0].caps.onoff.value, false);
});

test('schuifwaardes worden terugvertaald naar de eenheid van Homey', () => {
  const dim = C.normalizeCap('dim', { value: 0.3, max: 1 });
  assert.equal(C.valueToSlider(dim), 30);
  assert.equal(C.sliderToValue(dim, '75'), 0.75);
  const target = C.normalizeCap('target_temperature', { value: 20, min: 5, max: 30, step: 0.5 });
  assert.deepEqual(C.sliderRange(target), { min: 5, max: 30, step: 0.5 });
  assert.equal(C.sliderToValue(target, '21.5'), 21.5);
});
