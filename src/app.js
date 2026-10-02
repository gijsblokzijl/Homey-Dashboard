/*
 * Homey Dashboard: de interface.
 * Haalt apparaten op via MCP AI Bridge (of de voorbeeldwoning), deelt ze in per
 * categorie of ruimte en stuurt bediening terug naar de bridge.
 */
(function () {
  'use strict';

  const C = globalThis.HDCore;
  const M = globalThis.HDMcp;
  const Demo = globalThis.HDDemo;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ESC[ch]);
  const cssEsc = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const icon = (name, extra) => `<svg class="i${extra ? ' ' + extra : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('homey-dashboard:' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('homey-dashboard:' + key, JSON.stringify(value)); } catch (e) { /* opslag niet beschikbaar */ }
    },
  };

  // ------------------------------------------------------------------ configuratie

  const BRIDGE_PORT = '52199';

  function readEmbeddedConfig() {
    try {
      const el = document.getElementById('hd-config');
      const parsed = el ? JSON.parse(el.textContent || '{}') : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }

  function autoEndpoint(embedded) {
    if (embedded.endpoint) {
      try { return new URL(embedded.endpoint, location.href).href; } catch (e) { return ''; }
    }
    if (/^https?:$/.test(location.protocol) && (location.port === BRIDGE_PORT || /^\/dashboard(\/|$)/.test(location.pathname))) {
      return location.origin + '/mcp';
    }
    return '';
  }

  function loadConfig() {
    const embedded = readEmbeddedConfig();
    const saved = store.get('config', {});
    const cfg = {
      homeName: 'Thuis',
      endpoint: '',
      apiKey: '',
      interval: 10,
      demo: false,
      ...pick(embedded, ['homeName', 'apiKey', 'interval', 'demo']),
      ...saved,
    };
    cfg.auto = autoEndpoint(embedded);
    cfg.proxied = !!embedded.proxied;
    return cfg;
  }

  function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') out[k] = obj[k];
    return out;
  }

  function endpointOf(cfg) {
    return (cfg.endpoint || '').trim() || cfg.auto || '';
  }

  // ------------------------------------------------------------------ bronnen

  class DemoSource {
    constructor() {
      this.kind = 'demo';
      this.house = Demo.create();
      this.zones = C.normalizeZones(this.house.zones);
      this.label = 'Voorbeeldwoning';
    }
    async init() {}
    async load() {
      Demo.tick(this.house);
      const raw = JSON.parse(JSON.stringify(this.house.devices));
      return { devices: C.normalizeDevices(raw, this.zones), zones: this.zones, moods: this.house.moods.slice(), full: true };
    }
    // Verloop van het verbruik voor de grafiek, zodat de voorbeeldwoning meteen een lijn heeft.
    history(points, stepMs) {
      const copy = JSON.parse(JSON.stringify(this.house));
      const now = Date.now();
      const out = [];
      for (let i = points; i > 0; i--) {
        Demo.tick(copy);
        const ov = C.overview(C.normalizeDevices(copy.devices, this.zones));
        if (ov.power) out.push({ t: now - i * stepMs, w: ov.power.watts });
      }
      return out;
    }

    async setCapability(device, capId, value) {
      await sleep(180);
      Demo.setValue(this.house, device.id, capId, value);
    }
    async activateMood(mood) {
      await sleep(220);
      Demo.activateMood(this.house, mood.id);
    }
    describe() {
      return 'voorbeeldgegevens';
    }
  }

  class LiveSource {
    constructor(endpoint, apiKey) {
      this.kind = 'live';
      this.endpoint = endpoint;
      this.client = new M.McpClient({ url: endpoint, apiKey, clientName: 'homey-dashboard' });
      this.map = null;
      this.zones = C.normalizeZones(null);
      this.moods = [];
      this.lastFull = 0;
    }

    async init() {
      await this.client.connect();
      const tools = await this.client.listTools();
      this.map = C.pickTools(tools);
      if (!this.map.listDevices) {
        throw new M.McpError(`De bridge biedt geen tool om apparaten op te halen (${tools.length} tools gezien). Geef deze API-sleutel toegang tot de apparaten-tools.`, { setup: true });
      }
      this.label = [this.client.serverInfo && this.client.serverInfo.name, this.client.serverInfo && this.client.serverInfo.version].filter(Boolean).join(' ') || 'MCP AI Bridge';
    }

    async load(prev) {
      const full = !prev || !prev.length || Date.now() - this.lastFull > 5 * 60 * 1000;
      if (full) {
        await Promise.all([this.loadZones(), this.loadMoods()]);
      }
      let devices = await this.fetchDevices(full);
      if (full) {
        devices = await this.fillMissingValues(devices);
        this.lastFull = Date.now();
      }
      return { devices: full ? devices : C.mergeDevices(prev, devices), zones: this.zones, moods: this.moods, full };
    }

    async loadZones() {
      if (!this.map.listZones) return;
      try {
        const res = await this.client.callTool(this.map.listZones.name, C.listArgs(this.map.listZones));
        this.zones = C.normalizeZones(C.extractPayload(res));
      } catch (e) { /* ruimtes zijn een extraatje */ }
    }

    async loadMoods() {
      if (!this.map.listMoods || !this.map.activateMood) return;
      try {
        const res = await this.client.callTool(this.map.listMoods.name, C.listArgs(this.map.listMoods));
        this.moods = C.normalizeMoods(C.extractPayload(res));
      } catch (e) { this.moods = []; }
    }

    async fetchDevices(detailed) {
      const tool = this.map.listDevices;
      let args = C.listArgs(tool, { detailed });
      const all = [];
      for (let page = 0; page < 50; page++) {
        const res = await this.client.callTool(tool.name, args);
        const payload = C.extractPayload(res);
        const items = C.extractList(payload);
        all.push(...items);
        const next = C.nextPageArgs(tool, args, payload, items.length);
        if (!next) break;
        args = next;
      }
      if (!all.length) throw new M.McpError(`De tool ${tool.name} gaf geen apparaten terug.`);
      return C.normalizeDevices(all, this.zones);
    }

    // Sommige lijsten geven alleen namen; dan per apparaat de waardes ophalen.
    async fillMissingValues(devices) {
      const hasValues = devices.some((d) => Object.values(d.caps).some((c) => c.value !== null));
      if (hasValues || !this.map.getDevice) return devices;
      const tool = this.map.getDevice;
      const out = devices.slice();
      let i = 0;
      const worker = async () => {
        while (i < out.length) {
          const idx = i++;
          try {
            const res = await this.client.callTool(tool.name, C.deviceRefArgs(tool, out[idx]));
            const payload = C.extractPayload(res);
            const raw = payload && payload.device ? payload.device : payload;
            const d = C.normalizeDevice({ id: out[idx].id, name: out[idx].name, zone: out[idx].zoneId, class: out[idx].cls, ...raw }, this.zones);
            if (d) out[idx] = d;
          } catch (e) { /* dit apparaat houdt zijn lege waardes */ }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      return out;
    }

    async setCapability(device, capId, value) {
      if (!this.map.setCapability) throw new M.McpError('Deze API-sleutel mag niets bedienen. Geef de sleutel permissie Control only of hoger.');
      const tool = this.map.setCapability;
      await this.client.callTool(tool.name, C.setCapabilityArgs(tool, device, capId, value));
    }

    async activateMood(mood) {
      const tool = this.map.activateMood;
      await this.client.callTool(tool.name, C.moodArgs(tool, mood));
    }

    describe() {
      const m = this.map || {};
      return [this.label, m.listDevices && m.listDevices.name, m.setCapability && m.setCapability.name].filter(Boolean).join(' · ');
    }
  }

  // ------------------------------------------------------------------ toestand

  const state = {
    cfg: loadConfig(),
    source: null,
    status: 'connecting',
    error: null,
    devices: [],
    zones: C.normalizeZones(null),
    moods: [],
    view: store.get('view', 'category'),
    filter: store.get('filter', 'all'),
    query: '',
    lastUpdate: null,
    powerHistory: [],
    loading: true,
    fallbackDemo: false,
  };

  const pending = new Map();
  const busy = new Set();
  let pollTimer = null;
  let refreshing = false;
  let detailsId = null;
  let confirmUnlock = null;
  let activeRange = null;
  const tileCache = new Map();
  let layoutSig = '';
  const stepTimers = new Map();

  // ------------------------------------------------------------------ data

  // Een bediende waarde blijft staan zolang de opdracht onderweg is; een lijst die daarna is
  // opgehaald is leidend, ook als iets anders (een flow, een sfeer) de waarde intussen veranderde.
  function applyData(data, startedAt) {
    const now = Date.now();
    for (const [key, p] of pending) if (p.until < now) pending.delete(key);
    for (const d of data.devices) {
      for (const [capId, cap] of Object.entries(d.caps)) {
        const key = d.id + '|' + capId;
        const p = pending.get(key);
        if (!p) continue;
        if (cap.value === p.value || (p.settledAt && startedAt >= p.settledAt)) pending.delete(key);
        else cap.value = p.value;
      }
    }
    state.devices = data.devices;
    state.zones = data.zones && data.zones.list.length ? data.zones : state.zones;
    state.moods = data.moods || [];
    state.lastUpdate = new Date();
    const ov = C.overview(state.devices);
    if (ov.power) {
      state.powerHistory.push({ t: now, w: ov.power.watts });
      if (state.powerHistory.length > 90) state.powerHistory.shift();
    }
  }

  async function connect() {
    clearTimeout(pollTimer);
    const cfg = state.cfg;
    const endpoint = endpointOf(cfg);
    const hadLiveData = state.devices.length > 0 && !state.fallbackDemo && state.source && state.source.kind === 'live';
    const retrying = state.fallbackDemo && state.status === 'error';
    state.loading = true;
    if (!retrying) state.error = null;
    if (!hadLiveData) state.powerHistory = [];
    if (cfg.demo || !endpoint) {
      state.source = new DemoSource();
      state.status = 'demo';
      state.error = null;
    } else {
      state.source = new LiveSource(endpoint, cfg.apiKey);
      // Bij opnieuw proberen blijft de foutmelding staan tot er een nieuwe uitkomst is.
      state.status = retrying ? 'error' : 'connecting';
    }
    render();
    try {
      await state.source.init();
      const startedAt = Date.now();
      const data = await state.source.load(null);
      state.fallbackDemo = false;
      state.error = null;
      if (state.source.kind === 'demo') state.powerHistory = state.source.history(36, (Number(cfg.interval) || 10) * 1000);
      applyData(data, startedAt);
      state.status = state.source.kind === 'demo' ? 'demo' : 'live';
    } catch (err) {
      state.status = 'error';
      state.error = err;
      if (!hadLiveData) {
        // Toon de voorbeeldwoning zolang de echte verbinding niet lukt.
        const demo = new DemoSource();
        state.powerHistory = demo.history(36, 10000);
        applyData(await demo.load(), Date.now());
        state.fallbackDemo = true;
      }
    }
    state.loading = false;
    render();
    schedule();
  }

  async function refresh(manual) {
    if (refreshing || !state.source) return;
    if (state.fallbackDemo) { if (manual) connect(); return; }
    refreshing = true;
    const btn = $('#btn-refresh');
    if (manual && btn) btn.classList.add('is-spinning');
    const startedAt = Date.now();
    try {
      const data = await state.source.load(state.devices);
      applyData(data, startedAt);
      state.status = state.source.kind === 'demo' ? 'demo' : 'live';
      state.error = null;
    } catch (err) {
      state.status = 'error';
      state.error = err;
      if (err && err.status === 0 && state.source.kind === 'live') {
        // Netwerk weg: bij terugkeer opnieuw verbinden in plaats van op een oude sessie te blijven hangen.
        state.source.lastFull = 0;
      }
    } finally {
      refreshing = false;
      if (btn) btn.classList.remove('is-spinning');
    }
    render();
  }

  function schedule() {
    clearTimeout(pollTimer);
    const seconds = Math.max(3, Number(state.cfg.interval) || 10);
    const delay = state.fallbackDemo ? 30000 : seconds * 1000;
    pollTimer = setTimeout(async () => {
      if (document.hidden) { schedule(); return; }
      if (state.fallbackDemo) await connect();
      else { await refresh(false); schedule(); }
    }, delay);
  }

  function soonRefresh() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await refresh(false); schedule(); }, 1200);
  }

  function deviceById(id) {
    return state.devices.find((d) => d.id === id);
  }

  async function setCap(device, capId, value, options) {
    const opts = options || {};
    const cap = device.caps[capId];
    const key = device.id + '|' + capId;
    const before = cap ? cap.value : null;
    if (cap && !opts.momentary) {
      cap.value = value;
      pending.set(key, { value, until: Date.now() + 6000 });
    }
    busy.add(device.id);
    render();
    try {
      await state.source.setCapability(device, capId, value);
      const p = pending.get(key);
      if (p) p.settledAt = Date.now();
      if (opts.success) toast(opts.success);
      soonRefresh();
    } catch (err) {
      pending.delete(key);
      if (cap && !opts.momentary) cap.value = before;
      toast(`${device.name}: ${errorText(err)}`, 'crit');
    } finally {
      busy.delete(device.id);
      render();
    }
  }

  function errorText(err) {
    if (!err) return 'Onbekende fout';
    return err.message || String(err);
  }

  // ------------------------------------------------------------------ groeperen

  function zoneOrder(name) {
    const z = state.zones.list.findIndex((x) => x.name === name);
    return z < 0 ? 999 : z;
  }

  function sortDevices(list, by) {
    const catIndex = (id) => C.CATEGORIES.findIndex((c) => c.id === id);
    return list.slice().sort((a, b) => {
      if (by === 'zone') {
        const z = zoneOrder(a.zoneName) - zoneOrder(b.zoneName) || String(a.zoneName || '~').localeCompare(String(b.zoneName || '~'), 'nl');
        if (z) return z;
      } else {
        const c = catIndex(a.category) - catIndex(b.category);
        if (c) return c;
      }
      return a.name.localeCompare(b.name, 'nl', { numeric: true });
    });
  }

  function matchesQuery(d, q) {
    if (!q) return true;
    const cat = C.CATEGORY_BY_ID[d.category];
    const hay = [d.name, d.zoneName, cat && cat.label, d.cls].join(' ').toLowerCase();
    return q.split(/\s+/).every((part) => hay.includes(part));
  }

  function allGroups() {
    const q = state.query.trim().toLowerCase();
    const list = state.devices.filter((d) => matchesQuery(d, q));
    const groups = [];
    if (state.view === 'zone') {
      const names = [];
      for (const z of state.zones.list) if (!names.includes(z.name)) names.push(z.name);
      for (const d of list) {
        const n = d.zoneName || 'Zonder ruimte';
        if (!names.includes(n)) names.push(n);
      }
      for (const name of names) {
        const items = list.filter((d) => (d.zoneName || 'Zonder ruimte') === name);
        if (items.length) groups.push({ id: 'zone:' + name, title: name, icon: 'home', items: sortDevices(items, 'category') });
      }
    } else {
      for (const cat of C.CATEGORIES) {
        const items = list.filter((d) => d.category === cat.id);
        if (items.length) groups.push({ id: cat.id, title: cat.label, icon: cat.icon, items: sortDevices(items, 'zone') });
      }
    }
    return groups;
  }

  function visibleGroups(groups) {
    if (state.filter === 'all') return groups;
    const g = groups.filter((x) => x.id === state.filter);
    return g.length ? g : groups;
  }

  // ------------------------------------------------------------------ render

  function render() {
    renderMast();
    renderBanner();
    renderOverview();
    renderAttention();
    renderMoods();
    const groups = allGroups();
    if (state.filter !== 'all' && !groups.some((g) => g.id === state.filter) && !state.query) state.filter = 'all';
    renderFilters(groups);
    renderSections(visibleGroups(groups));
    renderFooter();
    if (detailsId) renderDetails(false);
  }

  function renderMast() {
    const name = state.cfg.homeName || 'Thuis';
    const h1 = $('#home-name');
    if (h1.textContent !== name) h1.textContent = name;
    document.title = name === 'Thuis' ? 'Homey Dashboard' : `${name} · Homey Dashboard`;

    const st = $('#status');
    const labels = { live: 'Live', demo: 'Voorbeeld', connecting: 'Verbinden', error: 'Geen verbinding' };
    let text = labels[state.status] || state.status;
    if (state.status === 'live' && state.lastUpdate) text += ' · ' + timeOf(state.lastUpdate, true);
    st.dataset.state = state.status;
    st.textContent = text;
    st.title = state.error ? errorText(state.error) : '';

    const ov = C.overview(state.devices);
    const out = $('#outdoor');
    out.textContent = ov.outdoor ? `Buiten ${C.fmtNumber(ov.outdoor.value, 1)} °C` : '';
  }

  function renderBanner() {
    const el = $('#banner');
    let html = '';
    let tone = 'info';
    const endpoint = endpointOf(state.cfg);
    if (state.status === 'error' && state.fallbackDemo) {
      tone = 'crit';
      html = `${icon('alert')}<p><strong>Geen verbinding met je bridge.</strong> ${esc(errorText(state.error))} Je ziet nu de voorbeeldwoning; het dashboard probeert het elke 30 seconden opnieuw.</p><button type="button" class="btn" data-action="settings">Instellingen</button>`;
    } else if (state.status === 'error') {
      tone = 'crit';
      html = `${icon('alert')}<p><strong>Verbinding even weg.</strong> ${esc(errorText(state.error))} Je ziet de stand van ${esc(state.lastUpdate ? timeOf(state.lastUpdate, true) : 'eerder')}.</p><button type="button" class="btn" data-action="refresh">Opnieuw proberen</button>`;
    } else if (state.source && state.source.kind === 'demo') {
      html = state.cfg.demo
        ? `${icon('sparkle')}<p><strong>Voorbeeldmodus staat aan.</strong> Alles hieronder is een verzonnen woning. Zet de voorbeeldmodus uit in de instellingen om je eigen Homey te zien.</p><button type="button" class="btn" data-action="settings">Instellingen</button>`
        : `${icon('sparkle')}<p><strong>Dit is een voorbeeldwoning.</strong> ${endpoint ? '' : 'Open dit dashboard via MCP AI Bridge op je Homey, of vul het adres en een API-sleutel van je bridge in om je eigen apparaten te zien.'}</p><button type="button" class="btn btn--primary" data-action="settings">Verbinden met mijn Homey</button>`;
    }
    el.hidden = !html;
    el.dataset.tone = tone;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function sparkline(history) {
    if (history.length < 2) return '';
    const w = 200;
    const h = 34;
    const pad = 4;
    const vals = history.map((p) => p.w);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 50) { const mid = (hi + lo) / 2; lo = mid - 25; hi = mid + 25; }
    const x = (i) => pad + (i / (history.length - 1)) * (w - pad * 2);
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const pts = history.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`);
    const last = history[history.length - 1];
    const minutes = Math.max(1, Math.round((last.t - history[0].t) / 60000));
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Verbruik in de laatste ${minutes} minuten">
      <line class="spark-base" x1="${pad}" x2="${w - pad}" y1="${h - 0.5}" y2="${h - 0.5}"/>
      <path class="spark-area" d="M${pts[0]} L${pts.join(' L')} L${x(history.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z"/>
      <polyline class="spark-line" vector-effect="non-scaling-stroke" points="${pts.join(' ')}"/>
    </svg>`;
  }

  function stat(label, iconName, value, unit, sub, tone, extra) {
    return `<div class="stat"${tone ? ` data-tone="${tone}"` : ''}>
      <span class="stat-label">${icon(iconName)}${esc(label)}</span>
      <span class="stat-value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
      <span class="stat-sub">${esc(sub || '')}</span>${extra || ''}
    </div>`;
  }

  function renderOverview() {
    const el = $('#overview');
    if (state.loading && !state.devices.length) {
      el.innerHTML = stat('Verlichting', 'bulb', '—', '', 'Apparaten ophalen…') + stat('Binnen', 'thermo', '—', '', '') + stat('Verbruik nu', 'bolt', '—', '', '') + stat('Aandacht', 'alert', '—', '', '');
      return;
    }
    const ov = C.overview(state.devices);
    const parts = [];
    parts.push(stat('Verlichting aan', 'bulb', String(ov.lights.on), `van ${ov.lights.total}`, ov.lights.on ? `${ov.lights.total - ov.lights.on} uit` : 'Alles is uit'));
    if (ov.indoor) {
      const range = ov.indoor.count > 1 ? `${C.fmtNumber(ov.indoor.min, 1)} tot ${C.fmtNumber(ov.indoor.max, 1)} °C over ${ov.indoor.count} meters` : '1 meter';
      parts.push(stat('Binnen gemiddeld', 'thermo', C.fmtNumber(ov.indoor.avg, 1), '°C', range));
    } else parts.push(stat('Binnen gemiddeld', 'thermo', '—', '', 'Geen temperatuurmeters'));
    if (ov.power) {
      const p = C.fmtPower(ov.power.watts);
      const subBits = [];
      if (ov.power.source === 'meter') subBits.push(ov.power.watts < 0 ? 'Teruglevering' : 'Slimme meter');
      else subBits.push(`Som van ${ov.power.count} apparaten`);
      if (ov.solar) { const s = C.fmtPower(ov.solar.watts); subBits.push(`zon ${s.text} ${s.unit}`); }
      parts.push(stat('Verbruik nu', 'bolt', p.text, p.unit, subBits.join(' · '), '', sparkline(state.powerHistory)));
    } else parts.push(stat('Verbruik nu', 'bolt', '—', '', 'Geen vermogensmeters'));
    const tone = ov.critical ? 'crit' : ov.attentionCount ? 'warn' : 'good';
    const first = ov.attention.find((a) => a.severity === 'crit' || a.severity === 'warn');
    parts.push(stat('Aandacht', ov.critical ? 'alert' : 'shield', ov.attentionCount ? String(ov.attentionCount) : 'Alles rustig', '', first ? `${first.device.name}: ${first.text}` : `${ov.total} apparaten gecontroleerd`, tone));
    const html = parts.join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderAttention() {
    const el = $('#attention');
    const items = state.loading ? [] : C.attentionItems(state.devices);
    const visible = items.slice(0, 14);
    const html = visible.length
      ? `<span class="strip-label">Let op</span>` + visible.map((a) => `<button type="button" class="chip" data-sev="${a.severity}" data-action="details" data-id="${esc(a.device.id)}"><span class="dot"></span><span><b>${esc(a.device.name)}</b> ${esc(a.text)}</span></button>`).join('')
        + (items.length > visible.length ? `<span class="strip-label">+${items.length - visible.length}</span>` : '')
      : '';
    el.hidden = !html;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderMoods() {
    const el = $('#moods');
    const html = state.moods.length
      ? `<span class="strip-label">Sferen</span>` + state.moods.slice(0, 16).map((m) => `<button type="button" class="chip${busy.has('mood:' + m.id) ? ' is-busy' : ''}" data-action="mood" data-id="${esc(m.id)}">${icon('sparkle')}<span>${esc(m.name)}</span></button>`).join('')
      : '';
    el.hidden = !html;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderFilters(groups) {
    const el = $('#filters');
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    const chip = (id, label, iconName, count) =>
      `<button type="button" class="filter" data-action="filter" data-value="${esc(id)}" aria-pressed="${state.filter === id}">${icon(iconName)}<span>${esc(label)}</span><span class="count">${count}</span></button>`;
    const html = chip('all', 'Alles', 'grid', total) + groups.map((g) => chip(g.id, g.title, g.icon, g.items.length)).join('');
    if (el.innerHTML !== html) {
      el.innerHTML = html;
      const active = el.querySelector('[aria-pressed="true"]');
      if (active && active.offsetLeft + active.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = active.offsetLeft - 16;
    }
    updateFilterEdges();
    $('#view-category').setAttribute('aria-pressed', String(state.view === 'category'));
    $('#view-zone').setAttribute('aria-pressed', String(state.view === 'zone'));
  }

  // Vervaagde randen laten zien dat er meer categorieën naast de zichtbare staan.
  function updateFilterEdges() {
    const el = $('#filters');
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('has-more-start', el.scrollLeft > 4);
    el.classList.toggle('has-more-end', max - el.scrollLeft > 4);
  }

  function skeleton() {
    const tile = `<div class="tile skeleton" aria-hidden="true"><div class="tile-top"><span class="tile-icon"></span></div><div class="skeleton-lines"><div class="bar bar--long"></div><div class="bar bar--short"></div></div></div>`;
    return `<section class="bay"><div class="bay-head">${icon('home')}<h2>Apparaten ophalen</h2><span class="bay-meta">Verbinden met de bridge…</span></div><div class="grid">${tile.repeat(8)}</div></section>`;
  }

  function sectionHTML(g) {
    return `<section class="bay" data-group="${esc(g.id)}" aria-labelledby="h-${esc(slugId(g.id))}">
      <div class="bay-head">${icon(g.icon)}<h2 id="h-${esc(slugId(g.id))}">${esc(g.title)}</h2><span class="bay-meta">${esc(groupMeta(g))}</span></div>
      <div class="grid">${g.items.map((d) => { const html = tileHTML(d); tileCache.set(d.id, html); return html; }).join('')}</div>
    </section>`;
  }

  function slugId(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function groupMeta(g) {
    return C.groupMeta(g.items, state.view === 'category' ? g.id : null);
  }

  function renderSections(groups) {
    const host = $('#sections');
    if (state.loading && !state.devices.length) {
      layoutSig = 'loading';
      host.innerHTML = skeleton();
      return;
    }
    const sig = state.view + '|' + groups.map((g) => g.id + ':' + g.items.map((d) => d.id).join(',')).join(';');
    if (sig !== layoutSig) {
      layoutSig = sig;
      tileCache.clear();
      if (!groups.length) {
        host.innerHTML = state.query
          ? `<div class="empty"><strong>Niets gevonden voor “${esc(state.query)}”</strong><span>Zoek op een apparaatnaam, ruimte of categorie.</span></div>`
          : `<div class="empty"><strong>Geen apparaten</strong><span>De bridge gaf geen apparaten terug. Controleer welke tools deze API-sleutel mag gebruiken.</span></div>`;
        return;
      }
      host.innerHTML = groups.map(sectionHTML).join('');
      decorate(host);
      return;
    }
    for (const g of groups) {
      const section = host.querySelector(`[data-group="${cssEsc(g.id)}"]`);
      if (!section) continue;
      const meta = section.querySelector('.bay-meta');
      const text = groupMeta(g);
      if (meta && meta.textContent !== text) meta.textContent = text;
      for (const d of g.items) {
        const html = tileHTML(d);
        if (tileCache.get(d.id) === html) continue;
        const el = section.querySelector(`.tile[data-id="${cssEsc(d.id)}"]`);
        if (!el || activeRange === d.id) continue;
        const focusKey = focusSignature(el);
        const tpl = document.createElement('template');
        tpl.innerHTML = html.trim();
        const fresh = tpl.content.firstElementChild;
        el.replaceWith(fresh);
        decorate(fresh);
        tileCache.set(d.id, html);
        if (focusKey) restoreFocus(fresh, focusKey);
      }
    }
  }

  function focusSignature(el) {
    const a = document.activeElement;
    if (!a || !el.contains(a)) return null;
    return { action: a.getAttribute('data-action'), cap: a.getAttribute('data-cap'), value: a.getAttribute('data-value'), cls: a.className };
  }

  function restoreFocus(el, key) {
    const candidates = $$('button, input, select', el);
    const match = candidates.find((c) => c.getAttribute('data-action') === key.action && c.getAttribute('data-cap') === key.cap && c.getAttribute('data-value') === key.value)
      || candidates.find((c) => c.className === key.cls);
    if (match) match.focus({ preventScroll: true });
  }

  // Inline-stijlen via CSSOM, zodat een strenge Content-Security-Policy ze niet tegenhoudt.
  function decorate(root) {
    const tiles = root.matches && root.matches('.tile') ? [root] : $$('.tile[data-lvl]', root);
    for (const t of tiles) if (t.dataset.lvl) t.style.setProperty('--lvl', t.dataset.lvl);
    for (const r of $$('input.range', root)) paintRange(r);
  }

  function paintRange(r) {
    const min = Number(r.min) || 0;
    const max = Number(r.max) || 100;
    const pct = max > min ? ((Number(r.value) - min) / (max - min)) * 100 : 0;
    r.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  function renderFooter() {
    const el = $('#footer');
    const zones = new Set(state.devices.map((d) => d.zoneName).filter(Boolean));
    const bits = [];
    bits.push(`${state.devices.length} apparaten in ${zones.size} ruimtes`);
    if (state.lastUpdate) bits.push(`bijgewerkt ${timeOf(state.lastUpdate, true)}`);
    if (state.source && !state.fallbackDemo) bits.push(state.source.describe());
    bits.push(`elke ${state.cfg.interval} s`);
    const html = bits.map((b) => `<span>${esc(b)}</span>`).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ------------------------------------------------------------------ tegels

  function tileHTML(d) {
    const s = C.deviceSummary(d);
    const kind = C.tileKind(d);
    const offline = !d.available;
    const isBusy = busy.has(d.id);
    const tcap = C.toggleCapability(d);
    const classes = ['tile', 'tile--' + kind, 'tone-' + s.tone];
    if (offline) classes.push('is-offline');
    if (s.on) classes.push('is-on');
    if (isBusy) classes.push('is-busy');
    const lvl = s.level != null ? s.level : s.on ? 1 : 0;

    const alarms = C.activeAlarms(d).filter((a) => a.severity);
    let badge = '';
    if (offline) badge = '';
    else if (alarms.some((a) => a.severity === 'crit')) badge = '<span class="badge" data-sev="crit">Alarm</span>';
    else {
      const batt = C.capValue(d, 'measure_battery');
      if (typeof batt === 'number' && batt <= 15) badge = `<span class="badge" data-sev="warn">${icon('battery')} ${C.fmtNumber(batt, 0)}%</span>`;
    }

    const where = state.view === 'zone' ? (C.CATEGORY_BY_ID[d.category] || {}).label : d.zoneName || 'Zonder ruimte';
    let main;
    if (tcap && !offline) {
      const pressed = !!C.capValue(d, tcap);
      const label = `${d.name}: ${pressed ? 'zet uit' : 'zet aan'}`;
      main = `<button type="button" class="tile-main" data-action="toggle" data-cap="${tcap}" aria-pressed="${pressed}" aria-label="${esc(label)}" title="${esc(label)}">`;
    } else {
      main = `<button type="button" class="tile-main" data-action="details" aria-label="${esc(d.name)}: details">`;
    }
    const controls = offline ? '' : controlsHTML(d, kind);
    const coverLevel = kind === 'cover' && s.level != null ? '<span class="tile-cover-level" aria-hidden="true"></span>' : '';

    return `<article class="${classes.join(' ')}" data-id="${esc(d.id)}" data-lvl="${lvl.toFixed(3)}">${coverLevel}
      <div class="tile-top"><span class="tile-icon" aria-hidden="true">${icon(C.deviceIcon(d))}</span>${badge}<button type="button" class="tile-more" data-action="details" aria-label="Alle gegevens van ${esc(d.name)}">${icon('more')}</button></div>
      ${main}
        <span class="tile-name">${esc(d.name)}</span>
        <span class="tile-zone">${esc(where)}</span>
        <span class="tile-state"><span class="val${isTextual(s.headline) ? ' val--text' : ''}">${esc(s.headline)}</span>${s.unit ? `<span class="unit">${esc(s.unit)}</span>` : ''}</span>
        ${s.sub ? `<span class="tile-sub">${esc(s.sub)}</span>` : ''}
      </button>
      ${controls ? `<div class="tile-controls">${controls}</div>` : ''}
    </article>`;
  }

  function isTextual(text) {
    return String(text).length > 8 && !/^[-+]?[\d.,]+$/.test(text);
  }

  function setable(d, id) {
    const c = d.caps[id];
    return c && c.setable ? c : null;
  }

  function rangeHTML(d, cap, label) {
    const r = C.sliderRange(cap);
    const v = C.valueToSlider(cap);
    const shown = cap.fraction ? `${Math.round(v)}%` : C.formatFull(cap);
    return `<input class="range" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" data-cap="${cap.id}" aria-label="${esc(label + ' ' + d.name)}"><span class="range-val">${esc(shown)}</span>`;
  }

  function controlsHTML(d, kind) {
    switch (kind) {
      case 'light': {
        const dim = setable(d, 'dim');
        return dim ? rangeHTML(d, dim, 'Helderheid') : '';
      }
      case 'thermostat': {
        const t = setable(d, 'target_temperature');
        if (!t) return '';
        const val = typeof t.value === 'number' ? C.fmtNumber(t.value, 1) + '°' : '—';
        return `<div class="stepper">
          <button type="button" class="ctl" data-action="step" data-cap="target_temperature" data-value="-1" aria-label="Doeltemperatuur ${esc(d.name)} lager">${icon('minus')}</button>
          <span class="stepper-val"><small>Doel</small>${esc(val)}</span>
          <button type="button" class="ctl" data-action="step" data-cap="target_temperature" data-value="1" aria-label="Doeltemperatuur ${esc(d.name)} hoger">${icon('plus')}</button>
        </div>`;
      }
      case 'cover': {
        const st = setable(d, 'windowcoverings_state');
        const pos = setable(d, 'windowcoverings_set');
        if (st) {
          return ['up', 'idle', 'down'].map((v) => {
            const label = { up: 'Omhoog', idle: 'Stop', down: 'Omlaag' }[v];
            return `<button type="button" class="ctl" data-action="set" data-cap="windowcoverings_state" data-value="${v}" aria-label="${label} ${esc(d.name)}" title="${label}">${icon(v === 'idle' ? 'stop' : v)}</button>`;
          }).join('');
        }
        return pos ? rangeHTML(d, pos, 'Positie') : '';
      }
      case 'media': {
        const parts = [];
        if (d.caps.speaker_prev) parts.push(`<button type="button" class="ctl" data-action="press" data-cap="speaker_prev" aria-label="Vorige op ${esc(d.name)}">${icon('prev')}</button>`);
        const play = setable(d, 'speaker_playing');
        if (play) {
          const playing = play.value === true;
          parts.push(`<button type="button" class="ctl" data-action="toggle" data-cap="speaker_playing" aria-pressed="${playing}" aria-label="${playing ? 'Pauzeer' : 'Speel'} ${esc(d.name)}">${icon(playing ? 'pause' : 'play')}</button>`);
        }
        if (d.caps.speaker_next) parts.push(`<button type="button" class="ctl" data-action="press" data-cap="speaker_next" aria-label="Volgende op ${esc(d.name)}">${icon('next')}</button>`);
        const vol = setable(d, 'volume_set');
        if (vol && !parts.length) return rangeHTML(d, vol, 'Volume');
        if (vol) parts.push(`<input class="range" type="range" min="0" max="100" step="1" value="${C.valueToSlider(vol)}" data-cap="volume_set" aria-label="Volume ${esc(d.name)}">`);
        return parts.join('');
      }
      case 'lock': {
        const lock = setable(d, 'locked');
        if (!lock) return '';
        if (lock.value === true) {
          const confirming = confirmUnlock && confirmUnlock.id === d.id && confirmUnlock.until > Date.now();
          return confirming
            ? `<button type="button" class="ctl ctl--wide ctl--confirm" data-action="unlock" data-cap="locked" data-value="confirm">${icon('unlock')}Tik nogmaals om te openen</button>`
            : `<button type="button" class="ctl ctl--wide" data-action="unlock" data-cap="locked">${icon('unlock')}Ontgrendelen</button>`;
        }
        return `<button type="button" class="ctl ctl--wide" data-action="set" data-cap="locked" data-value="true">${icon('lock')}Vergrendelen</button>`;
      }
      case 'alarm': {
        const al = setable(d, 'homealarm_state');
        if (!al) return '';
        const opts = [['disarmed', 'Uit'], ['partially_armed', 'Deels'], ['armed', 'Aan']];
        return `<div class="segmented" role="group" aria-label="Alarmsysteem ${esc(d.name)}">${opts.map(([v, l]) => `<button type="button" data-action="set" data-cap="homealarm_state" data-value="${v}" aria-pressed="${al.value === v}">${l}</button>`).join('')}</div>`;
      }
      default:
        return '';
    }
  }

  // ------------------------------------------------------------------ details

  function capControlHTML(d, cap) {
    if (!cap.setable || !d.available) return '';
    const meta = C.capMeta(cap.id) || {};
    if (cap.kind === 'button') {
      return `<button type="button" class="btn" data-action="press" data-cap="${esc(cap.id)}">${esc(meta.label || C.capLabel(cap))}</button>`;
    }
    if (cap.kind === 'bool') {
      if (cap.id === 'locked' && cap.value === true) return `<button type="button" class="btn" data-action="unlock" data-cap="locked">${icon('unlock')}Ontgrendelen</button>`;
      return `<button type="button" class="switch" role="switch" data-action="toggle" data-cap="${esc(cap.id)}" aria-checked="${cap.value === true}" aria-label="${esc(C.capLabel(cap))}"></button>`;
    }
    if (cap.kind === 'enum' && cap.values) {
      const opts = Object.entries(cap.values).map(([v, l]) => `<option value="${esc(v)}"${String(cap.value) === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
      return `<select data-cap="${esc(cap.id)}" aria-label="${esc(C.capLabel(cap))}">${opts}</select>`;
    }
    if (cap.kind === 'number') {
      if (cap.id === 'target_temperature') {
        return `<div class="stepper"><button type="button" class="ctl" data-action="step" data-cap="target_temperature" data-value="-1" aria-label="Lager">${icon('minus')}</button><span class="stepper-val">${esc(C.formatFull(cap))}</span><button type="button" class="ctl" data-action="step" data-cap="target_temperature" data-value="1" aria-label="Hoger">${icon('plus')}</button></div>`;
      }
      if (cap.fraction || (cap.min != null && cap.max != null)) {
        const r = C.sliderRange(cap);
        return `<input class="range" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${C.valueToSlider(cap)}" data-cap="${esc(cap.id)}" aria-label="${esc(C.capLabel(cap))}">`;
      }
    }
    return '';
  }

  function relTime(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'zojuist';
    if (s < 3600) return `${Math.round(s / 60)} min geleden`;
    if (s < 86400) return `${Math.round(s / 3600)} uur geleden`;
    return new Date(t).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  function renderDetails(open) {
    const dlg = $('#details');
    const d = deviceById(detailsId);
    if (!d) { if (dlg.open) dlg.close(); detailsId = null; return; }
    if (!open && dlg.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    const s = C.deviceSummary(d);
    const cat = C.CATEGORY_BY_ID[d.category] || C.CATEGORY_BY_ID.overig;
    const rows = d.capOrder.map((id) => {
      const cap = d.caps[id];
      if (cap.kind === 'button' && !cap.setable) return '';
      const meta = C.capMeta(id) || {};
      const sev = cap.value === true && meta.alarm ? meta.alarm : '';
      const value = cap.kind === 'button' ? '' : esc(C.formatFull(cap));
      const control = capControlHTML(d, cap);
      const when = cap.lastUpdated ? `<span class="cap-time">${esc(relTime(cap.lastUpdated))}</span>` : '';
      return `<div class="cap-row"><div class="cap-label">${esc(C.capLabel(cap))}<span class="cap-id">${esc(id)}</span></div><div class="cap-value"${sev ? ` data-sev="${sev}"` : ''}>${value}</div>${control ? `<div class="cap-control">${control}</div>` : ''}${when}</div>`;
    }).join('');
    const offline = d.available ? '' : `<div class="banner" data-tone="crit">${icon('alert')}<p><strong>Niet bereikbaar.</strong> ${esc(d.unavailableMessage || 'Homey krijgt geen contact met dit apparaat.')}</p></div>`;
    const html = `
      <div class="sheet-head">
        <span class="tile-icon" aria-hidden="true">${icon(C.deviceIcon(d))}</span>
        <div class="sheet-title">
          <h2 id="details-title">${esc(d.name)}</h2>
          <p>${esc([d.zoneName || 'Zonder ruimte', cat.label, s.headline + (s.unit ? ' ' + s.unit : '')].join(' · '))}</p>
        </div>
        <button type="button" class="tile-more" data-action="close-dialog" aria-label="Sluiten">${icon('close')}</button>
      </div>
      <div class="sheet-body" data-id="${esc(d.id)}">
        ${offline}
        <div class="cap-list">${rows || '<p>Dit apparaat meldt geen gegevens.</p>'}</div>
      </div>
      <div class="sheet-foot">
        <span>Homey-klasse <code>${esc(d.cls)}</code></span>
        <span class="spacer"></span>
        <code>${esc(d.id)}</code>
        <button type="button" class="tile-more" data-action="copy" data-value="${esc(d.id)}" aria-label="Apparaat-id kopiëren">${icon('copy')}</button>
      </div>`;
    if (dlg.dataset.html !== html) {
      const scroll = $('.sheet-body', dlg) ? $('.sheet-body', dlg).scrollTop : 0;
      dlg.innerHTML = html;
      dlg.dataset.html = html;
      decorate(dlg);
      const body = $('.sheet-body', dlg);
      if (body && !open) body.scrollTop = scroll;
    }
    if (open && !dlg.open) {
      try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
    }
  }

  function openDetails(id) {
    detailsId = id;
    renderDetails(true);
  }

  // ------------------------------------------------------------------ acties

  function deviceFrom(el) {
    const host = el.closest('[data-id]');
    if (!host) return null;
    const own = el.getAttribute('data-id');
    return deviceById(own || host.getAttribute('data-id'));
  }

  function onClick(ev) {
    const el = ev.target.closest('[data-action]');
    if (!el) {
      const dlg = ev.target.closest('dialog');
      if (dlg && ev.target === dlg) dlg.close();
      return;
    }
    const action = el.getAttribute('data-action');
    const cap = el.getAttribute('data-cap');
    const value = el.getAttribute('data-value');

    switch (action) {
      case 'filter':
        state.filter = value;
        store.set('filter', value);
        render();
        scrollToSections();
        return;
      case 'view':
        state.view = value;
        state.filter = 'all';
        store.set('view', value);
        store.set('filter', 'all');
        render();
        return;
      case 'refresh':
        if (state.status === 'error' && state.source && state.source.kind === 'live' && !state.fallbackDemo) { connect(); return; }
        refresh(true).then(schedule);
        return;
      case 'theme': cycleTheme(); return;
      case 'fullscreen': toggleFullscreen(); return;
      case 'settings': openSettings(); return;
      case 'close-dialog': { const dlg = el.closest('dialog'); if (dlg) dlg.close(); return; }
      case 'test-connection': testConnection(); return;
      case 'copy': copyText(value); return;
      case 'mood': {
        const mood = state.moods.find((m) => m.id === el.getAttribute('data-id'));
        if (!mood) return;
        busy.add('mood:' + mood.id);
        renderMoods();
        state.source.activateMood(mood)
          .then(() => { toast(`Sfeer “${mood.name}” staat aan`); soonRefresh(); })
          .catch((err) => toast(`${mood.name}: ${errorText(err)}`, 'crit'))
          .finally(() => { busy.delete('mood:' + mood.id); renderMoods(); });
        return;
      }
      default:
        break;
    }

    const d = deviceFrom(el);
    if (!d) return;
    if (action === 'details') { openDetails(d.id); return; }
    if (!d.available) { toast(`${d.name} is niet bereikbaar`, 'crit'); return; }

    if (action === 'toggle') {
      const current = C.capValue(d, cap);
      setCap(d, cap, !(current === true));
    } else if (action === 'set') {
      const v = value === 'true' ? true : value === 'false' ? false : value;
      setCap(d, cap, v);
    } else if (action === 'press') {
      setCap(d, cap, true, { momentary: true });
    } else if (action === 'unlock') {
      if (value === 'confirm' || (el.closest('dialog') && confirmUnlock && confirmUnlock.id === d.id && confirmUnlock.until > Date.now())) {
        confirmUnlock = null;
        setCap(d, 'locked', false, { success: `${d.name} is ontgrendeld` });
      } else {
        confirmUnlock = { id: d.id, until: Date.now() + 5000 };
        if (el.closest('dialog')) toast('Tik nogmaals op Ontgrendelen om te bevestigen');
        render();
        setTimeout(() => { if (confirmUnlock && confirmUnlock.until <= Date.now()) { confirmUnlock = null; render(); } }, 5100);
      }
    } else if (action === 'step') {
      stepTarget(d, Number(value));
    }
  }

  function stepTarget(d, direction) {
    const cap = d.caps.target_temperature;
    if (!cap) return;
    const step = cap.step || 0.5;
    const min = cap.min != null ? cap.min : 5;
    const max = cap.max != null ? cap.max : 35;
    const base = typeof cap.value === 'number' ? cap.value : 20;
    const next = C.clamp(Math.round((base + direction * step) / step) * step, min, max);
    cap.value = next;
    pending.set(d.id + '|target_temperature', { value: next, until: Date.now() + 8000 });
    render();
    clearTimeout(stepTimers.get(d.id));
    stepTimers.set(d.id, setTimeout(() => {
      stepTimers.delete(d.id);
      setCap(d, 'target_temperature', next);
    }, 700));
  }

  function onInput(ev) {
    const el = ev.target;
    if (el.matches('#search')) {
      state.query = el.value;
      render();
      return;
    }
    if (el.matches('input.range')) {
      paintRange(el);
      const d = deviceFrom(el);
      if (d) activeRange = d.id;
      const out = el.nextElementSibling;
      if (out && out.classList.contains('range-val')) {
        const cap = d && d.caps[el.getAttribute('data-cap')];
        out.textContent = cap && !cap.fraction ? C.formatFull({ ...cap, value: Number(el.value) }) : `${el.value}%`;
      }
    }
  }

  function onChange(ev) {
    const el = ev.target;
    const capId = el.getAttribute('data-cap');
    if (!capId || el.matches('#search')) return;
    const d = deviceFrom(el);
    activeRange = null;
    if (!d || !d.caps[capId]) return;
    if (el.matches('input.range')) setCap(d, capId, C.sliderToValue(d.caps[capId], el.value));
    else if (el.matches('select')) {
      const cap = d.caps[capId];
      const raw = el.value;
      setCap(d, capId, cap.kind === 'number' ? Number(raw) : raw);
    }
  }

  function onPointerDown(ev) {
    const r = ev.target.closest && ev.target.closest('input.range');
    if (!r) return;
    const d = deviceFrom(r);
    if (d) activeRange = d.id;
  }

  function onPointerUp() {
    setTimeout(() => { activeRange = null; }, 400);
  }

  function onKey(ev) {
    if (ev.key === '/' && !ev.target.matches('input, select, textarea')) {
      ev.preventDefault();
      $('#search').focus();
    }
    if (ev.key === 'Escape' && ev.target.matches('#search') && ev.target.value) {
      ev.target.value = '';
      state.query = '';
      render();
    }
  }

  // ------------------------------------------------------------------ instellingen

  function openSettings() {
    const cfg = state.cfg;
    $('#set-home').value = cfg.homeName || '';
    $('#set-endpoint').value = cfg.endpoint || '';
    $('#set-endpoint').placeholder = cfg.auto || 'http://192.168.1.50:52199/mcp';
    $('#set-key').value = cfg.apiKey || '';
    $('#set-interval').value = String(cfg.interval || 10);
    $('#set-demo').checked = !!cfg.demo;
    const hint = $('#set-endpoint-hint');
    hint.textContent = cfg.auto
      ? `Leeg laten gebruikt automatisch ${cfg.auto}.`
      : 'Het MCP-adres van MCP AI Bridge, te vinden op de Status-tab in de app-instellingen. Het eindigt op /mcp.';
    const result = $('#test-result');
    result.hidden = true;
    const dlg = $('#settings');
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }

  function formConfig() {
    return {
      homeName: $('#set-home').value.trim() || 'Thuis',
      endpoint: $('#set-endpoint').value.trim(),
      apiKey: $('#set-key').value.trim(),
      interval: Number($('#set-interval').value) || 10,
      demo: $('#set-demo').checked,
    };
  }

  async function testConnection() {
    const out = $('#test-result');
    const f = formConfig();
    const endpoint = f.endpoint || state.cfg.auto;
    out.hidden = false;
    out.dataset.tone = '';
    if (!endpoint) { out.dataset.tone = 'crit'; out.textContent = 'Vul eerst het adres van de bridge in.'; return; }
    out.textContent = `Verbinden met ${endpoint}…`;
    const src = new LiveSource(endpoint, f.apiKey);
    try {
      await src.init();
      const data = await src.load(null);
      const counts = {};
      for (const d of data.devices) counts[d.category] = (counts[d.category] || 0) + 1;
      const lines = [
        `Verbonden met ${src.label}`,
        `${src.client.tools.length} tools beschikbaar voor deze sleutel`,
        `Apparaten ophalen: ${src.map.listDevices.name}`,
        `Bedienen: ${src.map.setCapability ? src.map.setCapability.name : 'niet toegestaan met deze sleutel'}`,
        `Ruimtes: ${src.map.listZones ? src.map.listZones.name : 'niet beschikbaar'}`,
        `${data.devices.length} apparaten: ` + C.CATEGORIES.filter((c) => counts[c.id]).map((c) => `${c.label.toLowerCase()} ${counts[c.id]}`).join(', '),
      ];
      out.dataset.tone = 'good';
      out.textContent = lines.join('\n');
    } catch (err) {
      out.dataset.tone = 'crit';
      out.textContent = errorText(err) + (err && err.status === 0 && location.origin !== safeOrigin(endpoint)
        ? '\n\nDraait dit dashboard op een ander adres dan de bridge? Dan blokkeert de browser de verbinding vaak. Open het dashboard via de bridge zelf, of start scripts/serve.mjs.'
        : '');
    }
  }

  function safeOrigin(url) {
    try { return new URL(url).origin; } catch (e) { return ''; }
  }

  function saveSettings(ev) {
    ev.preventDefault();
    const f = formConfig();
    const changedConnection = f.endpoint !== state.cfg.endpoint || f.apiKey !== state.cfg.apiKey || f.demo !== state.cfg.demo;
    state.cfg = { ...state.cfg, ...f };
    store.set('config', f);
    $('#settings').close();
    if (changedConnection) { state.devices = []; connect(); }
    else { render(); schedule(); }
    toast('Instellingen opgeslagen');
  }

  // ------------------------------------------------------------------ thema, scherm, klok

  const hostTheme = document.documentElement.getAttribute('data-theme');

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else if (hostTheme) root.setAttribute('data-theme', hostTheme);
    else root.removeAttribute('data-theme');
    const label = { light: 'Thema: licht', dark: 'Thema: donker' }[mode] || 'Thema: volgt systeem';
    const btn = $('#btn-theme');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const cur = store.get('theme', 'system');
    const next = order[(order.indexOf(cur) + 1) % order.length];
    store.set('theme', next);
    applyTheme(next);
    toast({ system: 'Thema volgt het systeem', light: 'Licht thema', dark: 'Donker thema' }[next]);
  }

  let wakeLock = null;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
        try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
      }
    } catch (e) {
      toast('Schermvullend wordt hier niet ondersteund', 'crit');
    }
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  });

  function timeOf(date, seconds) {
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  }

  function tickClock() {
    const now = new Date();
    $('#clock').textContent = timeOf(now, false);
    $('#date').textContent = now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  let toastTimer = null;
  function toast(text, tone) {
    const el = $('#toast');
    $('#toast-text').textContent = text;
    el.dataset.tone = tone || '';
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), tone === 'crit' ? 5200 : 2800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Gekopieerd');
    } catch (e) {
      const code = $('#details .sheet-foot code:last-of-type');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      toast('Selecteer en kopieer het id handmatig');
    }
  }

  // Na het kiezen van een filter: terug naar het begin van de vakken, onder de vaste balk.
  function scrollToSections() {
    const toolbar = $('#toolbar');
    const top = $('#sections').getBoundingClientRect().top + scrollY - toolbar.offsetHeight - 12;
    if (scrollY > top) scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function prefersReducedMotion() {
    return globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ------------------------------------------------------------------ start

  function bind() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('keydown', onKey);
    $('#settings-form').addEventListener('submit', saveSettings);
    const filters = $('#filters');
    filters.addEventListener('scroll', updateFilterEdges, { passive: true });
    filters.addEventListener('wheel', (ev) => {
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || filters.scrollWidth <= filters.clientWidth) return;
      ev.preventDefault();
      filters.scrollLeft += ev.deltaY;
    }, { passive: false });
    addEventListener('resize', updateFilterEdges, { passive: true });
    $('#details').addEventListener('close', () => { detailsId = null; $('#details').dataset.html = ''; });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.source && !state.loading) refresh(false).then(schedule);
    });
    if (!document.fullscreenEnabled) $('#btn-fullscreen').hidden = true;
    const toolbar = $('#toolbar');
    if ('IntersectionObserver' in globalThis) {
      new IntersectionObserver(([e]) => toolbar.classList.toggle('is-stuck', e.intersectionRatio < 1), { threshold: [1], rootMargin: '-1px 0px 0px 0px' }).observe(toolbar);
    }
  }

  function start() {
    bind();
    applyTheme(store.get('theme', 'system'));
    tickClock();
    setInterval(tickClock, 15000);
    $('#search').value = '';
    render();
    connect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
