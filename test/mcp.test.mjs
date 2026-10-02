import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/mcp.js';
import '../src/core.js';
import { startFakeBridge } from './fake-bridge.mjs';

const { McpClient, parseSse } = globalThis.HDMcp;
const C = globalThis.HDCore;

test('parseSse leest berichten en slaat keep-alives over', () => {
  const msgs = parseSse(': ping\n\nevent: message\ndata: {"id":1,"result":{}}\n\ndata: {"id":2,\ndata: "result":true}\n\n');
  assert.deepEqual(msgs, [{ id: 1, result: {} }, { id: 2, result: true }]);
});

for (const sse of [false, true]) {
  test(`verbinden, tools ophalen en bedienen (${sse ? 'SSE' : 'JSON'})`, async () => {
    const bridge = await startFakeBridge({ sse });
    try {
      const client = new McpClient({ url: bridge.url, apiKey: 'test-key' });
      await client.connect();
      assert.equal(client.serverInfo.name, 'MCP AI Bridge');
      assert.ok(client.sessionId);
      const tools = await client.listTools();
      assert.equal(tools.length, 11, 'beide pagina’s van tools/list');
      const map = C.pickTools(tools);
      assert.equal(map.listDevices.name, 'devices_list');

      const res = await client.callTool('devices_list', C.listArgs(map.listDevices));
      const payload = C.extractPayload(res);
      assert.equal(C.extractList(payload).length, 30);
      assert.equal(payload.truncated, true);

      const lamp = { id: 'demo-lamp-hal', name: 'Lamp hal' };
      await client.callTool('devices_set_capability', C.setCapabilityArgs(map.setCapability, lamp, 'onoff', true));
      assert.equal(bridge.house.devices.find((d) => d.id === 'demo-lamp-hal').capabilitiesObj.onoff.value, true);
    } finally {
      await bridge.close();
    }
  });
}

test('een fout van een tool wordt een leesbare melding', async () => {
  const bridge = await startFakeBridge();
  try {
    const client = new McpClient({ url: bridge.url, apiKey: 'test-key' });
    await client.connect();
    await assert.rejects(client.callTool('devices_set_capability', { deviceId: 'demo-lamp-overloop', capabilityId: 'onoff', value: true }), /niet bereikbaar/);
  } finally {
    await bridge.close();
  }
});

test('zonder geldige sleutel volgt een duidelijke 401-melding', async () => {
  const bridge = await startFakeBridge();
  try {
    const client = new McpClient({ url: bridge.url, apiKey: 'fout' });
    await assert.rejects(client.connect(), (err) => err.status === 401 && /API-sleutel/.test(err.message));
  } finally {
    await bridge.close();
  }
});

test('een verlopen sessie wordt automatisch vernieuwd', async () => {
  const bridge = await startFakeBridge();
  try {
    const client = new McpClient({ url: bridge.url, apiKey: 'test-key' });
    await client.connect();
    const first = client.sessionId;
    bridge.sessions.clear();
    const tools = await client.listTools();
    assert.ok(tools.length > 0);
    assert.notEqual(client.sessionId, first);
  } finally {
    await bridge.close();
  }
});

test('een onbereikbare bridge geeft een netwerkmelding', async () => {
  const client = new McpClient({ url: 'http://127.0.0.1:9/mcp', timeoutMs: 2000 });
  await assert.rejects(client.connect(), (err) => err.status === 0 && /Geen verbinding/.test(err.message));
});
