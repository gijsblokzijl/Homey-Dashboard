/*
 * Homey Dashboard: minimale MCP-client (JSON-RPC over Streamable HTTP).
 * Praat met het /mcp-endpoint van MCP AI Bridge. Werkt in de browser en in Node 18+.
 */
(function (root) {
  'use strict';

  const PROTOCOL = '2025-11-25';

  class McpError extends Error {
    constructor(message, info) {
      super(message);
      this.name = 'McpError';
      Object.assign(this, info || {});
    }
  }

  function parseSse(text) {
    const messages = [];
    for (const block of String(text).split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      try { messages.push(JSON.parse(data)); } catch (e) { /* keep-alive of geen JSON */ }
    }
    return messages;
  }

  function httpMessage(status, body) {
    const detail = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const tail = detail ? ` (${detail})` : '';
    switch (status) {
      case 401: return 'De bridge vraagt om een geldige API-sleutel (401). Vul de sleutel in bij Instellingen.';
      case 403: return `De bridge weigert deze verbinding (403)${tail}. Controleer de sleutel, de toegangsmodus en de IP-whitelist in de app.`;
      case 404: return 'Op dit adres zit geen MCP-endpoint (404). Het adres eindigt op /mcp, bijvoorbeeld http://192.168.1.50:52199/mcp.';
      case 405: return 'Dit adres accepteert geen MCP-verzoeken (405). Gebruik het /mcp-adres van de bridge.';
      case 429: return 'Te veel verzoeken (429). Verhoog het verversinterval of de rate limit op de Security-tab.';
      default: return `De bridge antwoordde met HTTP ${status}${tail}.`;
    }
  }

  class McpClient {
    constructor(options) {
      const o = options || {};
      this.url = o.url;
      this.apiKey = o.apiKey || '';
      this.fetch = o.fetchImpl || root.fetch.bind(root);
      this.clientName = o.clientName || 'homey-dashboard';
      this.clientVersion = o.clientVersion || '1.0.0';
      this.timeoutMs = o.timeoutMs || 20000;
      this.sessionId = null;
      this.protocolVersion = null;
      this.serverInfo = null;
      this.instructions = null;
      this.tools = null;
      this._id = 0;
    }

    async _post(body, method) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
      if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
      if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
      let res;
      try {
        const init = { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined };
        if (typeof window !== 'undefined') init.cache = 'no-store';
        res = await this.fetch(this.url, init);
      } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        throw new McpError(
          aborted
            ? `De bridge reageerde niet binnen ${Math.round(this.timeoutMs / 1000)} seconden (${method}).`
            : 'Geen verbinding met de bridge. Klopt het adres, staat je Homey aan en zit dit apparaat op hetzelfde netwerk?',
          { status: 0, network: true, cause: err },
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      return res;
    }

    async _read(res, id, method) {
      const type = res.headers.get('content-type') || '';
      const text = await res.text();
      let messages;
      if (type.includes('text/event-stream')) messages = parseSse(text);
      else if (!text.trim()) messages = [];
      else {
        try {
          const json = JSON.parse(text);
          messages = Array.isArray(json) ? json : [json];
        } catch (e) {
          throw new McpError(`Onverwacht antwoord van de bridge op ${method}.`, { status: res.status });
        }
      }
      const msg = messages.find((m) => m && String(m.id) === String(id));
      if (!msg) throw new McpError(`Geen antwoord van de bridge op ${method}.`, { status: res.status });
      if (msg.error) {
        throw new McpError(msg.error.message || `De bridge gaf een fout op ${method}.`, { code: msg.error.code, data: msg.error.data, status: res.status });
      }
      return msg.result;
    }

    async request(method, params, retried) {
      const id = ++this._id;
      const res = await this._post({ jsonrpc: '2.0', id, method, params: params || {} }, method);
      if (res.status === 404 && this.sessionId && method !== 'initialize' && !retried) {
        // Sessie verlopen (bridge herstart): opnieuw verbinden en één keer herhalen.
        this.sessionId = null;
        await this.connect();
        return this.request(method, params, true);
      }
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch (e) { /* leeg */ }
        throw new McpError(httpMessage(res.status, body), { status: res.status });
      }
      return this._read(res, id, method);
    }

    async notify(method, params) {
      try {
        const res = await this._post({ jsonrpc: '2.0', method, params: params || {} }, method);
        try { await res.text(); } catch (e) { /* leeg */ }
      } catch (e) {
        /* een notificatie mag mislukken */
      }
    }

    async connect() {
      this.sessionId = null;
      this.protocolVersion = null;
      const result = await this.request('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: this.clientName, version: this.clientVersion },
      });
      this.protocolVersion = (result && result.protocolVersion) || PROTOCOL;
      this.serverInfo = (result && result.serverInfo) || null;
      this.instructions = (result && result.instructions) || null;
      await this.notify('notifications/initialized');
      return result;
    }

    async listTools() {
      const all = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const result = await this.request('tools/list', cursor ? { cursor } : {});
        all.push(...((result && result.tools) || []));
        cursor = result && result.nextCursor;
        if (!cursor) break;
      }
      this.tools = all;
      return all;
    }

    async callTool(name, args) {
      const result = await this.request('tools/call', { name, arguments: args || {} });
      if (result && result.isError) {
        const text = (result.content || []).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim();
        throw new McpError(text || `De tool ${name} gaf een fout.`, { tool: name, toolError: true });
      }
      return result;
    }
  }

  root.HDMcp = { McpClient, McpError, parseSse, httpMessage, PROTOCOL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
