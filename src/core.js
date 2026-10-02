/*
 * Homey Dashboard: kernlogica.
 * Geen DOM, geen netwerk: normaliseren van wat MCP AI Bridge teruggeeft, indelen
 * in categorieën, samenvattingen per apparaat en het herkennen van de juiste tools.
 * Draait als klassiek script in de browser en als module in Node (tests, scripts).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- categorieën

  const CATEGORIES = [
    { id: 'verlichting', label: 'Verlichting', icon: 'bulb' },
    { id: 'klimaat', label: 'Klimaat', icon: 'thermo' },
    { id: 'schakelaars', label: 'Stekkers & schakelaars', icon: 'plug' },
    { id: 'zonwering', label: 'Zonwering & gordijnen', icon: 'blinds' },
    { id: 'media', label: 'Media', icon: 'speaker' },
    { id: 'beveiliging', label: 'Beveiliging', icon: 'shield' },
    { id: 'sensoren', label: 'Sensoren', icon: 'sensor' },
    { id: 'energie', label: 'Energie', icon: 'bolt' },
    { id: 'huishouden', label: 'Huishouden', icon: 'appliance' },
    { id: 'overig', label: 'Overig', icon: 'cube' },
  ];
  const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // Homey device classes, zoals de Homey Web API ze teruggeeft.
  const CLASS_TO_CATEGORY = {
    light: 'verlichting',

    socket: 'schakelaars', button: 'schakelaars', remote: 'schakelaars',

    thermostat: 'klimaat', heater: 'klimaat', radiator: 'klimaat', airconditioning: 'klimaat',
    fan: 'klimaat', airpurifier: 'klimaat', airtreatment: 'klimaat', dehumidifier: 'klimaat',
    humidifier: 'klimaat', boiler: 'klimaat', heatpump: 'klimaat', fireplace: 'klimaat',
    waterheater: 'klimaat',

    windowcoverings: 'zonwering', blinds: 'zonwering', curtain: 'zonwering', sunshade: 'zonwering',
    shutterblinds: 'zonwering', awning: 'zonwering',

    speaker: 'media', tv: 'media', amplifier: 'media', mediaplayer: 'media', settopbox: 'media',
    gameconsole: 'media', soundbar: 'media', projector: 'media',

    lock: 'beveiliging', homealarm: 'beveiliging', camera: 'beveiliging', doorbell: 'beveiliging',
    smokealarm: 'beveiliging', smokedetector: 'beveiliging', siren: 'beveiliging', garagedoor: 'beveiliging',

    solarpanel: 'energie', battery: 'energie', evcharger: 'energie', car: 'energie', energy: 'energie',
    meter: 'energie', inverter: 'energie',

    vacuumcleaner: 'huishouden', mop: 'huishouden', washer: 'huishouden', dryer: 'huishouden',
    washer_and_dryer: 'huishouden', dishwasher: 'huishouden', oven: 'huishouden', microwave: 'huishouden',
    coffeemachine: 'huishouden', kettle: 'huishouden', fridge: 'huishouden', freezer: 'huishouden',
    fridge_and_freezer: 'huishouden', cooktop: 'huishouden', hood: 'huishouden', airfryer: 'huishouden',
    fryer: 'huishouden', grill: 'huishouden', multicooker: 'huishouden', lawnmower: 'huishouden',
    petfeeder: 'huishouden', sprinkler: 'huishouden', faucet: 'huishouden', waterpurifier: 'huishouden',
    scale: 'huishouden',
  };

  const CLASS_ICON = {
    light: 'bulb', socket: 'plug', button: 'button', remote: 'button',
    thermostat: 'thermo', heater: 'flame', radiator: 'flame', boiler: 'flame', waterheater: 'flame',
    fireplace: 'flame', heatpump: 'thermo', airconditioning: 'fan', fan: 'fan', airpurifier: 'fan',
    airtreatment: 'fan', dehumidifier: 'drop', humidifier: 'drop',
    windowcoverings: 'blinds', blinds: 'blinds', curtain: 'blinds', sunshade: 'blinds',
    shutterblinds: 'blinds', awning: 'blinds',
    speaker: 'speaker', amplifier: 'speaker', soundbar: 'speaker', tv: 'tv', mediaplayer: 'tv',
    settopbox: 'tv', gameconsole: 'tv', projector: 'tv',
    lock: 'lock', homealarm: 'shield', camera: 'camera', doorbell: 'bell', smokealarm: 'smoke',
    smokedetector: 'smoke', siren: 'bell', garagedoor: 'garage',
    solarpanel: 'sun', battery: 'battery', evcharger: 'car', car: 'car', energy: 'bolt', meter: 'bolt',
    inverter: 'bolt',
    vacuumcleaner: 'vacuum', mop: 'vacuum', washer: 'washer', dryer: 'washer', washer_and_dryer: 'washer',
    dishwasher: 'washer', lawnmower: 'leaf', sprinkler: 'drop', faucet: 'drop',
  };

  // ---------------------------------------------------------------- capabilities

  const BOOL = 'bool';
  const NUM = 'number';
  const ENUM = 'enum';
  const STR = 'string';
  const BTN = 'button';

  const CAPS = {
    onoff: { label: 'Aan/uit', kind: BOOL, on: 'Aan', off: 'Uit', setable: true },
    dim: { label: 'Helderheid', kind: NUM, fraction: true, setable: true },
    light_temperature: { label: 'Kleurtemperatuur', kind: NUM, fraction: true, setable: true },
    light_hue: { label: 'Kleurtoon', kind: NUM, fraction: true, setable: true },
    light_saturation: { label: 'Verzadiging', kind: NUM, fraction: true, setable: true },
    light_mode: { label: 'Lichtmodus', kind: ENUM, values: { color: 'Kleur', temperature: 'Wit' }, setable: true },

    target_temperature: { label: 'Doeltemperatuur', kind: NUM, unit: '°C', decimals: 1, min: 5, max: 35, step: 0.5, setable: true },
    thermostat_mode: { label: 'Modus', kind: ENUM, values: { auto: 'Automatisch', heat: 'Verwarmen', cool: 'Koelen', off: 'Uit' }, setable: true },
    measure_temperature: { label: 'Temperatuur', kind: NUM, unit: '°C', decimals: 1 },
    measure_humidity: { label: 'Luchtvochtigheid', kind: NUM, unit: '%', decimals: 0 },
    measure_co2: { label: 'CO₂', kind: NUM, unit: 'ppm', decimals: 0 },
    measure_co: { label: 'CO', kind: NUM, unit: 'ppm', decimals: 0 },
    measure_pm25: { label: 'Fijnstof PM2,5', kind: NUM, unit: 'µg/m³', decimals: 0 },
    measure_pm10: { label: 'Fijnstof PM10', kind: NUM, unit: 'µg/m³', decimals: 0 },
    measure_tvoc: { label: 'VOC', kind: NUM, unit: 'ppb', decimals: 0 },
    measure_voc: { label: 'VOC', kind: NUM, unit: 'ppb', decimals: 0 },
    measure_luminance: { label: 'Lichtsterkte', kind: NUM, unit: 'lx', decimals: 0 },
    measure_noise: { label: 'Geluid', kind: NUM, unit: 'dB', decimals: 0 },
    measure_pressure: { label: 'Luchtdruk', kind: NUM, unit: 'mbar', decimals: 0 },
    measure_rain: { label: 'Neerslag', kind: NUM, unit: 'mm/u', decimals: 1 },
    measure_wind_strength: { label: 'Windsnelheid', kind: NUM, unit: 'km/u', decimals: 0 },
    measure_gust_strength: { label: 'Windstoten', kind: NUM, unit: 'km/u', decimals: 0 },
    measure_wind_angle: { label: 'Windrichting', kind: NUM, unit: '°', decimals: 0 },
    measure_ultraviolet: { label: 'UV-index', kind: NUM, decimals: 0 },
    measure_power: { label: 'Vermogen', kind: NUM, unit: 'W', decimals: 0, power: true },
    measure_voltage: { label: 'Spanning', kind: NUM, unit: 'V', decimals: 0 },
    measure_current: { label: 'Stroom', kind: NUM, unit: 'A', decimals: 2 },
    measure_water: { label: 'Waterdoorstroming', kind: NUM, unit: 'L/min', decimals: 1 },
    measure_gas: { label: 'Gasverbruik', kind: NUM, unit: 'm³/u', decimals: 2 },
    measure_battery: { label: 'Batterij', kind: NUM, unit: '%', decimals: 0 },
    meter_power: { label: 'Energie totaal', kind: NUM, unit: 'kWh', decimals: 1 },
    meter_gas: { label: 'Gas totaal', kind: NUM, unit: 'm³', decimals: 1 },
    meter_water: { label: 'Water totaal', kind: NUM, unit: 'm³', decimals: 1 },

    alarm_motion: { label: 'Beweging', kind: BOOL, on: 'Beweging', off: 'Rustig' },
    alarm_presence: { label: 'Aanwezigheid', kind: BOOL, on: 'Aanwezig', off: 'Niemand' },
    alarm_occupancy: { label: 'Bezetting', kind: BOOL, on: 'Bezet', off: 'Vrij' },
    alarm_vibration: { label: 'Trilling', kind: BOOL, on: 'Trilling', off: 'Rustig' },
    alarm_contact: { label: 'Contact', kind: BOOL, on: 'Open', off: 'Dicht', alarm: 'warn' },
    alarm_water: { label: 'Waterlek', kind: BOOL, on: 'Lekkage', off: 'Droog', alarm: 'crit' },
    alarm_smoke: { label: 'Rook', kind: BOOL, on: 'Rook gedetecteerd', off: 'Geen rook', alarm: 'crit' },
    alarm_fire: { label: 'Brand', kind: BOOL, on: 'Brand', off: 'Geen brand', alarm: 'crit' },
    alarm_heat: { label: 'Hitte', kind: BOOL, on: 'Te heet', off: 'Normaal', alarm: 'crit' },
    alarm_co: { label: 'Koolmonoxide', kind: BOOL, on: 'CO gedetecteerd', off: 'Geen CO', alarm: 'crit' },
    alarm_co2: { label: 'CO₂-alarm', kind: BOOL, on: 'CO₂ te hoog', off: 'Normaal', alarm: 'warn' },
    alarm_pm25: { label: 'Fijnstofalarm', kind: BOOL, on: 'Fijnstof te hoog', off: 'Normaal', alarm: 'warn' },
    alarm_tamper: { label: 'Sabotage', kind: BOOL, on: 'Gesaboteerd', off: 'In orde', alarm: 'warn' },
    alarm_battery: { label: 'Batterijalarm', kind: BOOL, on: 'Batterij bijna leeg', off: 'In orde', alarm: 'warn' },
    alarm_generic: { label: 'Alarm', kind: BOOL, on: 'Alarm', off: 'Rustig', alarm: 'warn' },
    alarm_night: { label: 'Nacht', kind: BOOL, on: 'Nacht', off: 'Dag' },

    locked: { label: 'Slot', kind: BOOL, on: 'Vergrendeld', off: 'Ontgrendeld', setable: true },
    garagedoor_closed: { label: 'Garagedeur', kind: BOOL, on: 'Dicht', off: 'Open', setable: true },
    homealarm_state: { label: 'Alarmsysteem', kind: ENUM, values: { armed: 'Ingeschakeld', partially_armed: 'Deels ingeschakeld', disarmed: 'Uitgeschakeld' }, setable: true },

    windowcoverings_set: { label: 'Positie', kind: NUM, fraction: true, setable: true },
    windowcoverings_tilt_set: { label: 'Kanteling', kind: NUM, fraction: true, setable: true },
    windowcoverings_state: { label: 'Beweging', kind: ENUM, values: { up: 'Omhoog', idle: 'Stil', down: 'Omlaag' }, setable: true },
    windowcoverings_closed: { label: 'Gesloten', kind: BOOL, on: 'Dicht', off: 'Open', setable: true },

    volume_set: { label: 'Volume', kind: NUM, fraction: true, setable: true },
    volume_mute: { label: 'Geluid', kind: BOOL, on: 'Gedempt', off: 'Aan', setable: true },
    volume_up: { label: 'Volume hoger', kind: BTN, setable: true },
    volume_down: { label: 'Volume lager', kind: BTN, setable: true },
    channel_up: { label: 'Zender hoger', kind: BTN, setable: true },
    channel_down: { label: 'Zender lager', kind: BTN, setable: true },
    speaker_playing: { label: 'Afspelen', kind: BOOL, on: 'Speelt', off: 'Gepauzeerd', setable: true },
    speaker_next: { label: 'Volgende', kind: BTN, setable: true },
    speaker_prev: { label: 'Vorige', kind: BTN, setable: true },
    speaker_shuffle: { label: 'Shuffle', kind: BOOL, on: 'Aan', off: 'Uit', setable: true },
    speaker_repeat: { label: 'Herhalen', kind: ENUM, values: { none: 'Uit', track: 'Nummer', playlist: 'Afspeellijst' }, setable: true },
    speaker_track: { label: 'Nummer', kind: STR },
    speaker_artist: { label: 'Artiest', kind: STR },
    speaker_album: { label: 'Album', kind: STR },
    speaker_duration: { label: 'Duur', kind: NUM, unit: 's', decimals: 0 },
    speaker_position: { label: 'Positie', kind: NUM, unit: 's', decimals: 0 },

    vacuumcleaner_state: { label: 'Status', kind: ENUM, values: { cleaning: 'Aan het zuigen', spot_cleaning: 'Plek zuigen', docked: 'In basisstation', charging: 'Laden', stopped: 'Gestopt' }, setable: true },
    evcharger_charging: { label: 'Laden', kind: BOOL, on: 'Laadt', off: 'Laadt niet', setable: true },
    evcharger_charging_state: { label: 'Laadstatus', kind: ENUM, values: { plugged_in_charging: 'Laden', plugged_in: 'Aangesloten', plugged_out: 'Niet aangesloten', plugged_in_paused: 'Gepauzeerd', plugged_in_discharging: 'Ontladen' } },
    button: { label: 'Knop', kind: BTN, setable: true },
  };

  const SUFFIX_LABEL = {
    imported: 'afname', exported: 'teruglevering', delivered: 'teruglevering', consumed: 'afname',
    produced: 'opwek', today: 'vandaag', daily: 'vandaag', total: 'totaal', t1: 'dal', t2: 'normaal',
    l1: 'fase 1', l2: 'fase 2', l3: 'fase 3', inside: 'binnen', outside: 'buiten', indoor: 'binnen',
    outdoor: 'buiten', floor: 'vloer', water: 'water', target: 'doel',
  };

  // Volgorde waarin capabilities in details en samenvattingen verschijnen.
  const CAP_ORDER = [
    'onoff', 'dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode',
    'target_temperature', 'measure_temperature', 'thermostat_mode', 'measure_humidity',
    'windowcoverings_set', 'windowcoverings_state', 'windowcoverings_tilt_set',
    'speaker_playing', 'speaker_track', 'speaker_artist', 'speaker_album', 'volume_set', 'volume_mute',
    'locked', 'homealarm_state', 'garagedoor_closed',
    'measure_power', 'meter_power', 'meter_gas', 'meter_water',
  ];

  function baseCap(id) {
    return String(id).split('.')[0];
  }

  function capMeta(id) {
    const base = baseCap(id);
    const known = CAPS[id] || CAPS[base];
    if (known) return known;
    if (base.startsWith('alarm_')) return { label: humanize(base.slice(6)), kind: BOOL, on: 'Alarm', off: 'Rustig', alarm: 'warn' };
    if (base.startsWith('measure_') || base.startsWith('meter_')) return { label: humanize(base.replace(/^(measure|meter)_/, '')), kind: NUM };
    return null;
  }

  function humanize(s) {
    const t = String(s || '').replace(/[_.]+/g, ' ').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  function textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.nl || v.en || Object.values(v).find((x) => typeof x === 'string') || '';
    return String(v);
  }

  function capLabel(cap) {
    const meta = capMeta(cap.id);
    const parts = String(cap.id).split('.');
    if (parts.length > 1) {
      if (cap.title) return cap.title;
      const suffix = parts.slice(1).map((p) => SUFFIX_LABEL[p.toLowerCase()] || p).join(' ');
      return `${meta ? meta.label : humanize(parts[0])} (${suffix})`;
    }
    if (meta) return meta.label;
    return cap.title || humanize(cap.id);
  }

  function inferKind(value) {
    if (typeof value === 'boolean') return BOOL;
    if (typeof value === 'number') return NUM;
    if (typeof value === 'string') return STR;
    return null;
  }

  function normalizeCap(id, src) {
    const meta = capMeta(id) || {};
    const isObj = src !== null && typeof src === 'object' && !Array.isArray(src);
    const raw = isObj ? src : { value: src };
    const value = 'value' in raw ? raw.value : undefined;
    const cap = {
      id,
      value: value === undefined ? null : value,
      title: textOf(raw.title) || null,
      units: textOf(raw.units) || meta.unit || '',
      kind: meta.kind || typeToKind(raw.type) || inferKind(value) || STR,
      min: num(raw.min, meta.min),
      max: num(raw.max, meta.max),
      step: num(raw.step, meta.step),
      decimals: num(raw.decimals, meta.decimals),
      setable: typeof raw.setable === 'boolean' ? raw.setable : !!meta.setable,
      getable: raw.getable !== false,
      values: normalizeEnumValues(raw.values, meta.values),
      lastUpdated: toTime(raw.lastUpdated || raw.last_updated || raw.updatedAt),
    };
    cap.fraction = !!meta.fraction && (cap.max == null || cap.max <= 1);
    if (meta.kind === NUM && typeof cap.value === 'string' && cap.value.trim() !== '' && !isNaN(+cap.value)) cap.value = +cap.value;
    return cap;
  }

  function typeToKind(t) {
    if (t === 'boolean') return BOOL;
    if (t === 'number') return NUM;
    if (t === 'enum') return ENUM;
    if (t === 'string') return STR;
    return null;
  }

  function normalizeEnumValues(list, fallback) {
    if (Array.isArray(list) && list.length) {
      const out = {};
      for (const v of list) {
        if (v && typeof v === 'object') out[v.id] = (fallback && fallback[v.id]) || textOf(v.title) || String(v.id);
        else out[v] = (fallback && fallback[v]) || String(v);
      }
      return out;
    }
    return fallback ? { ...fallback } : null;
  }

  function num(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return fallback == null ? null : fallback;
  }

  function toTime(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  // ---------------------------------------------------------------- zones

  function normalizeZones(payload) {
    const list = [];
    const byId = {};
    for (const z of extractList(payload)) {
      if (!z || typeof z !== 'object') continue;
      const id = z.id || z.zoneId || z.uuid;
      if (!id) continue;
      const zone = { id: String(id), name: textOf(z.name) || 'Ruimte', parent: z.parent || z.parentId || null, order: list.length };
      list.push(zone);
      byId[zone.id] = zone;
    }
    return { list, byId };
  }

  // ---------------------------------------------------------------- devices

  const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

  function normalizeDevice(raw, zones) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id || raw.deviceId || raw.device_id || raw.uuid;
    if (!id) return null;
    const zoneIndex = (zones && zones.byId) || {};

    let zoneId = null;
    let zoneName = null;
    if (raw.zone && typeof raw.zone === 'object') {
      zoneId = raw.zone.id || null;
      zoneName = textOf(raw.zone.name) || null;
    } else if (typeof raw.zone === 'string') {
      if (zoneIndex[raw.zone]) zoneId = raw.zone;
      else if (!UUIDISH.test(raw.zone)) zoneName = raw.zone;
      else zoneId = raw.zone;
    }
    zoneId = zoneId || raw.zoneId || raw.zone_id || null;
    zoneName = zoneName || textOf(raw.zoneName || raw.zone_name || raw.room || raw.roomName) || null;
    if (!zoneName && zoneId && zoneIndex[zoneId]) zoneName = zoneIndex[zoneId].name;

    const caps = {};
    const addCaps = (src) => {
      if (!src) return;
      if (Array.isArray(src)) {
        for (const c of src) {
          if (typeof c === 'string') { if (!caps[c]) caps[c] = normalizeCap(c, { value: null }); }
          else if (c && typeof c === 'object' && (c.id || c.capability || c.capabilityId)) {
            const cid = c.id || c.capability || c.capabilityId;
            caps[cid] = normalizeCap(cid, c);
          }
        }
        return;
      }
      if (typeof src === 'object') {
        for (const [cid, v] of Object.entries(src)) {
          const fresh = normalizeCap(cid, v);
          caps[cid] = caps[cid] && fresh.value === null ? caps[cid] : fresh;
        }
      }
    };
    addCaps(raw.capabilitiesObj);
    if (raw.capabilities && !Array.isArray(raw.capabilities)) addCaps(raw.capabilities);
    for (const key of ['values', 'state', 'capabilityValues', 'capability_values', 'caps']) {
      const v = raw[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [cid, val] of Object.entries(v)) {
          if (caps[cid]) {
            const plain = val !== null && typeof val === 'object' && 'value' in val ? val.value : val;
            if (plain === null || typeof plain !== 'object') caps[cid].value = plain;
          } else caps[cid] = normalizeCap(cid, val);
        }
      }
    }
    if (Array.isArray(raw.capabilities)) addCaps(raw.capabilities);

    const cls = String(raw.virtualClass || raw.class || raw.deviceClass || raw.device_class || 'other');
    const available = !(raw.available === false || raw.unavailable === true || raw.status === 'unavailable' || raw.ready === false && raw.available == null);

    const device = {
      id: String(id),
      name: textOf(raw.name) || 'Naamloos apparaat',
      zoneId: zoneId ? String(zoneId) : null,
      zoneName,
      cls,
      baseClass: String(raw.class || cls),
      available,
      unavailableMessage: textOf(raw.unavailableMessage || raw.unavailable_message) || null,
      energy: raw.energyObj || raw.energy || null,
      driver: textOf(raw.driverId || raw.driverUri || raw.driver) || null,
      caps,
      capOrder: orderCaps(Object.keys(caps)),
      category: 'overig',
    };
    device.category = categorize(device);
    return device;
  }

  function orderCaps(ids) {
    const rank = (id) => {
      const i = CAP_ORDER.indexOf(id);
      if (i >= 0) return i;
      const b = CAP_ORDER.indexOf(baseCap(id));
      if (b >= 0) return b + 0.5;
      if (id.startsWith('alarm_')) return 100;
      if (id.startsWith('measure_')) return 200;
      if (id.startsWith('meter_')) return 300;
      return 400;
    };
    return ids.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  function normalizeDevices(payload, zones) {
    const out = [];
    const seen = new Set();
    for (const raw of extractList(payload)) {
      const d = normalizeDevice(raw, zones);
      if (d && !seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
    }
    return out;
  }

  // Een compacte lijst draagt soms alleen waardes; de metadata van de laatste volledige lijst blijft staan.
  function mergeDevices(prev, next, { dropMissing = false } = {}) {
    const prevById = new Map((prev || []).map((d) => [d.id, d]));
    const merged = [];
    const seen = new Set();
    for (const d of next) {
      seen.add(d.id);
      const old = prevById.get(d.id);
      if (!old) { merged.push(d); continue; }
      const caps = {};
      for (const [cid, oldCap] of Object.entries(old.caps)) caps[cid] = { ...oldCap };
      for (const [cid, cap] of Object.entries(d.caps)) {
        if (caps[cid]) {
          caps[cid].value = cap.value;
          if (cap.lastUpdated) caps[cid].lastUpdated = cap.lastUpdated;
        } else caps[cid] = cap;
      }
      const keepClass = d.cls === 'other' && old.cls !== 'other';
      const m = {
        ...old,
        name: d.name || old.name,
        available: d.available,
        unavailableMessage: d.unavailableMessage,
        zoneId: d.zoneId || old.zoneId,
        zoneName: d.zoneName || old.zoneName,
        cls: keepClass ? old.cls : d.cls,
        baseClass: keepClass ? old.baseClass : d.baseClass,
        energy: d.energy || old.energy,
        caps,
        capOrder: orderCaps(Object.keys(caps)),
      };
      m.category = categorize(m);
      merged.push(m);
    }
    if (!dropMissing) for (const old of prev || []) if (!seen.has(old.id)) merged.push(old);
    return merged;
  }

  // ---------------------------------------------------------------- indeling

  const SECURITY_ALARMS = ['alarm_smoke', 'alarm_co', 'alarm_fire', 'alarm_heat'];
  const SENSOR_ALARMS = ['alarm_motion', 'alarm_contact', 'alarm_vibration', 'alarm_water', 'alarm_tamper', 'alarm_presence', 'alarm_occupancy'];
  const CLIMATE_MEASURES = ['measure_temperature', 'measure_humidity', 'measure_co2', 'measure_pm25', 'measure_pm10', 'measure_tvoc', 'measure_voc'];

  function hasCap(d, id) {
    return Object.prototype.hasOwnProperty.call(d.caps, id) || Object.keys(d.caps).some((c) => baseCap(c) === id);
  }

  function capValue(d, id) {
    if (d.caps[id]) return d.caps[id].value;
    const key = Object.keys(d.caps).find((c) => baseCap(c) === id);
    return key ? d.caps[key].value : null;
  }

  function isMeterDevice(d) {
    const name = d.name.toLowerCase();
    return !!(d.energy && (d.energy.cumulative === true || d.energy.cumulativeImportedCapability))
      || /\b(p1|slimme meter|smart ?meter|energiemeter|kwh[- ]?meter|hoofdmeter)\b/.test(name)
      || d.cls === 'meter';
  }

  function categorize(d) {
    const direct = CLASS_TO_CATEGORY[d.cls] || CLASS_TO_CATEGORY[d.baseClass];
    if (direct && !(d.cls === 'other' || d.cls === 'sensor')) return direct;

    if (SECURITY_ALARMS.some((c) => hasCap(d, c))) return 'beveiliging';
    if (hasCap(d, 'locked') || hasCap(d, 'homealarm_state') || hasCap(d, 'garagedoor_closed')) return 'beveiliging';
    if (d.cls === 'sensor') {
      if (SENSOR_ALARMS.some((c) => hasCap(d, c))) return 'sensoren';
      if (isMeterDevice(d) || hasCap(d, 'meter_gas') || hasCap(d, 'meter_water') || (hasCap(d, 'meter_power') && !hasCap(d, 'onoff'))) return 'energie';
      if (CLIMATE_MEASURES.some((c) => hasCap(d, c))) return 'klimaat';
      return 'sensoren';
    }
    // Klasse 'other' of onbekend: lees het af aan wat het apparaat kan.
    if (hasCap(d, 'dim') || hasCap(d, 'light_hue') || hasCap(d, 'light_temperature')) return 'verlichting';
    if (hasCap(d, 'target_temperature')) return 'klimaat';
    if (hasCap(d, 'windowcoverings_set') || hasCap(d, 'windowcoverings_state')) return 'zonwering';
    if (hasCap(d, 'speaker_playing') || hasCap(d, 'volume_set')) return 'media';
    if (SENSOR_ALARMS.some((c) => hasCap(d, c))) return 'sensoren';
    if (isMeterDevice(d) || hasCap(d, 'meter_gas') || hasCap(d, 'meter_water')) return 'energie';
    if (hasCap(d, 'onoff')) return 'schakelaars';
    if (CLIMATE_MEASURES.some((c) => hasCap(d, c))) return 'klimaat';
    if (hasCap(d, 'measure_power') || hasCap(d, 'meter_power')) return 'energie';
    return 'overig';
  }

  function deviceIcon(d) {
    if (CLASS_ICON[d.cls]) return CLASS_ICON[d.cls];
    if (hasCap(d, 'alarm_contact')) return 'door';
    if (hasCap(d, 'alarm_motion')) return 'motion';
    if (hasCap(d, 'alarm_water')) return 'drop';
    if (hasCap(d, 'measure_temperature')) return 'thermo';
    if (hasCap(d, 'measure_power') || hasCap(d, 'meter_power')) return 'bolt';
    return (CATEGORY_BY_ID[d.category] || CATEGORY_BY_ID.overig).icon;
  }

  // Welke vorm de tegel krijgt.
  function tileKind(d) {
    if (hasCap(d, 'homealarm_state')) return 'alarm';
    if (hasCap(d, 'locked')) return 'lock';
    if (d.category === 'verlichting') return 'light';
    if (hasCap(d, 'target_temperature')) return 'thermostat';
    if (hasCap(d, 'windowcoverings_set') || hasCap(d, 'windowcoverings_state')) return 'cover';
    if (hasCap(d, 'speaker_playing') || (d.category === 'media' && hasCap(d, 'volume_set'))) return 'media';
    if (d.category === 'energie') return 'energy';
    if (toggleCapability(d)) return 'switch';
    return 'sensor';
  }

  function toggleCapability(d) {
    for (const id of ['onoff', 'garagedoor_closed', 'evcharger_charging', 'windowcoverings_closed']) {
      const cap = d.caps[id];
      if (cap && cap.setable && cap.kind === BOOL) return id;
    }
    return null;
  }

  // ---------------------------------------------------------------- opmaak

  const nfCache = new Map();
  function fmtNumber(v, decimals) {
    const key = decimals;
    if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
    return nfCache.get(key).format(v);
  }

  function fmtPower(watts) {
    const abs = Math.abs(watts);
    if (abs >= 1000) return { text: fmtNumber(watts / 1000, abs >= 10000 ? 1 : 2), unit: 'kW' };
    return { text: fmtNumber(watts, 0), unit: 'W' };
  }

  function formatCap(cap) {
    const v = cap.value;
    if (v === null || v === undefined || v === '') return { text: '—', unit: '' };
    const meta = capMeta(cap.id) || {};
    if (cap.kind === BOOL || typeof v === 'boolean') {
      const on = v === true || v === 'true' || v === 1;
      return { text: on ? meta.on || 'Ja' : meta.off || 'Nee', unit: '' };
    }
    if (cap.kind === ENUM) {
      const label = (cap.values && cap.values[v]) || (meta.values && meta.values[v]);
      return { text: label || humanize(v), unit: '' };
    }
    if (typeof v === 'number') {
      if (cap.fraction) return { text: fmtNumber(Math.round(v * 100), 0), unit: '%' };
      if (meta.power && (cap.units === 'W' || !cap.units)) return fmtPower(v);
      const decimals = cap.decimals != null ? Math.min(cap.decimals, 3) : Number.isInteger(v) ? 0 : 1;
      return { text: fmtNumber(v, decimals), unit: cap.units || '' };
    }
    return { text: String(v), unit: '' };
  }

  function formatFull(cap) {
    const f = formatCap(cap);
    if (!f.unit) return f.text;
    return f.unit === '%' || f.unit === '°' ? f.text + f.unit : `${f.text} ${f.unit}`;
  }

  const SUMMARY_MEASURES = [
    'measure_temperature', 'measure_power', 'measure_humidity', 'measure_co2', 'measure_luminance',
    'measure_pm25', 'measure_noise', 'measure_wind_strength', 'measure_rain', 'measure_pressure',
    'meter_power', 'meter_gas', 'meter_water', 'measure_battery',
  ];

  function firstCap(d, ids) {
    for (const id of ids) {
      if (d.caps[id] && d.caps[id].value != null) return d.caps[id];
      const key = Object.keys(d.caps).find((c) => baseCap(c) === id && d.caps[c].value != null);
      if (key) return d.caps[key];
    }
    return null;
  }

  function activeAlarms(d) {
    const out = [];
    for (const cap of Object.values(d.caps)) {
      if (!baseCap(cap.id).startsWith('alarm_') || cap.value !== true) continue;
      const meta = capMeta(cap.id) || {};
      out.push({ cap, severity: meta.alarm || null, text: meta.on || capLabel(cap) });
    }
    const rank = { crit: 0, warn: 1 };
    return out.sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2));
  }

  function batteryLevel(d) {
    const v = capValue(d, 'measure_battery');
    return typeof v === 'number' ? v : null;
  }

  // Wat een tegel in één oogopslag laat zien.
  function deviceSummary(d) {
    const kind = tileKind(d);
    const on = capValue(d, 'onoff');
    const res = { headline: '—', unit: '', sub: '', tone: 'neutral', on: false, level: null };
    const sub = [];

    if (!d.available) {
      res.tone = 'offline';
      res.headline = 'Offline';
      res.sub = d.unavailableMessage || 'Niet bereikbaar';
      return res;
    }

    const alarms = activeAlarms(d);
    const loud = alarms.find((a) => a.severity === 'crit' || a.severity === 'warn');

    switch (kind) {
      case 'light': {
        const dim = capValue(d, 'dim');
        res.on = on !== false && (on === true || (typeof dim === 'number' && dim > 0));
        if (res.on) {
          res.tone = 'lit';
          res.level = typeof dim === 'number' ? clamp(dim, 0.04, 1) : 1;
          if (typeof dim === 'number') { res.headline = fmtNumber(Math.round(dim * 100), 0); res.unit = '%'; }
          else res.headline = 'Aan';
        } else {
          res.tone = 'off';
          res.headline = 'Uit';
        }
        break;
      }
      case 'thermostat': {
        const cur = firstCap(d, ['measure_temperature']);
        const target = d.caps.target_temperature;
        const shown = cur || target;
        if (shown) { const f = formatCap(shown); res.headline = f.text; res.unit = f.unit; }
        if (target && target.value != null) sub.push(`Doel ${formatFull(target)}`);
        const mode = d.caps.thermostat_mode;
        if (mode && mode.value != null) sub.push(formatCap(mode).text);
        const hum = firstCap(d, ['measure_humidity']);
        if (hum && cur) sub.push(formatFull(hum));
        const heating = cur && target && typeof cur.value === 'number' && typeof target.value === 'number' && target.value - cur.value >= 0.3;
        res.tone = on === false || (mode && mode.value === 'off') ? 'off' : heating ? 'heat' : 'calm';
        res.on = heating;
        break;
      }
      case 'cover': {
        const pos = capValue(d, 'windowcoverings_set');
        const st = capValue(d, 'windowcoverings_state');
        if (st === 'up' || st === 'down') { res.headline = st === 'up' ? 'Gaat omhoog' : 'Gaat omlaag'; res.tone = 'active'; }
        if (typeof pos === 'number') {
          const pct = Math.round(pos * 100);
          if (res.tone !== 'active') { res.headline = pct >= 99 ? 'Open' : pct <= 1 ? 'Dicht' : fmtNumber(pct, 0); res.unit = pct > 1 && pct < 99 ? '% open' : ''; }
          else sub.push(`${fmtNumber(pct, 0)}% open`);
          res.level = pos;
          res.on = pct > 1;
          if (res.tone !== 'active') res.tone = res.on ? 'open' : 'off';
        } else if (res.tone !== 'active') {
          const closed = capValue(d, 'windowcoverings_closed');
          res.headline = closed === true ? 'Dicht' : closed === false ? 'Open' : 'Stil';
          res.tone = 'neutral';
        }
        break;
      }
      case 'media': {
        const playing = capValue(d, 'speaker_playing');
        const track = capValue(d, 'speaker_track');
        const artist = capValue(d, 'speaker_artist');
        if (on === false) { res.headline = 'Uit'; res.tone = 'off'; }
        else if (playing === true) { res.headline = 'Speelt'; res.tone = 'active'; res.on = true; }
        else if (playing === false) { res.headline = 'Gepauzeerd'; res.tone = 'off'; }
        else { res.headline = on === true ? 'Aan' : '—'; res.tone = on === true ? 'active' : 'neutral'; res.on = on === true; }
        if (track) sub.push(artist ? `${track} · ${artist}` : String(track));
        const vol = capValue(d, 'volume_set');
        if (!track && typeof vol === 'number' && on !== false) sub.push(`Volume ${fmtNumber(Math.round(vol * 100), 0)}%`);
        break;
      }
      case 'lock': {
        const locked = capValue(d, 'locked');
        res.headline = locked === true ? 'Vergrendeld' : locked === false ? 'Ontgrendeld' : '—';
        res.tone = locked === true ? 'secure' : locked === false ? 'warn' : 'neutral';
        res.on = locked === true;
        break;
      }
      case 'alarm': {
        const st = capValue(d, 'homealarm_state');
        res.headline = formatCap(d.caps.homealarm_state || { id: 'homealarm_state', value: st, kind: ENUM }).text;
        res.tone = st === 'armed' ? 'secure' : st === 'partially_armed' ? 'active' : 'off';
        res.on = st === 'armed' || st === 'partially_armed';
        break;
      }
      case 'energy': {
        const power = firstCap(d, ['measure_power']);
        const pct = capValue(d, 'measure_battery');
        if (d.cls === 'battery' && typeof pct === 'number') {
          res.headline = fmtNumber(pct, 0); res.unit = '%';
          res.level = clamp(pct / 100, 0, 1);
          if (power && typeof power.value === 'number' && power.value !== 0) sub.push(`${power.value > 0 ? 'Laadt' : 'Ontlaadt'} ${formatFull({ ...power, value: Math.abs(power.value) })}`);
        } else if (power) {
          const f = formatCap(power); res.headline = f.text; res.unit = f.unit;
          if (d.cls === 'solarpanel') sub.push('Opwek nu');
        } else {
          const meter = firstCap(d, ['meter_power', 'meter_gas', 'meter_water']);
          if (meter) { const f = formatCap(meter); res.headline = f.text; res.unit = f.unit; }
        }
        for (const id of ['meter_power', 'meter_gas', 'meter_water']) {
          const c = d.caps[id];
          if (c && c.value != null && !(res.unit === c.units && !power)) sub.push(formatFull(c));
        }
        if (on === false) { res.tone = 'off'; sub.unshift('Uit'); }
        else res.tone = power && typeof power.value === 'number' && Math.abs(power.value) > 1 ? 'active' : 'calm';
        res.on = res.tone === 'active';
        break;
      }
      case 'switch': {
        const tcap = toggleCapability(d);
        const v = capValue(d, tcap);
        res.headline = formatCap(d.caps[tcap]).text;
        res.on = tcap === 'garagedoor_closed' ? v === false : v === true;
        res.tone = res.on ? 'active' : 'off';
        const power = firstCap(d, ['measure_power']);
        if (power && (res.on || power.value)) sub.push(formatFull(power));
        break;
      }
      default: {
        const measure = firstCap(d, SUMMARY_MEASURES.filter((m) => m !== 'measure_battery' || Object.keys(d.caps).length === 1));
        const primaryAlarm = alarms[0];
        if (loud) {
          res.headline = loud.text;
          res.tone = loud.severity === 'crit' ? 'crit' : 'warn';
          if (measure) sub.push(formatFull(measure));
        } else if (measure) {
          const f = formatCap(measure); res.headline = f.text; res.unit = f.unit;
          if (primaryAlarm) sub.push(primaryAlarm.text);
          res.tone = primaryAlarm ? 'active' : 'calm';
          const second = firstCap(d, SUMMARY_MEASURES.filter((m) => baseCap(m) !== baseCap(measure.id) && m !== 'measure_battery'));
          if (second) sub.push(formatFull(second));
        } else {
          const boolCap = Object.values(d.caps).find((c) => c.kind === BOOL && c.value != null);
          if (boolCap) { res.headline = formatCap(boolCap).text; res.tone = boolCap.value ? 'active' : 'calm'; }
          else {
            const anyCap = Object.values(d.caps).find((c) => c.value != null && c.kind !== BTN);
            if (anyCap) { const f = formatCap(anyCap); res.headline = f.text; res.unit = f.unit; }
            else res.headline = Object.keys(d.caps).length ? 'Geen waarde' : 'Geen gegevens';
            res.tone = 'calm';
          }
        }
        res.on = res.tone === 'active';
      }
    }

    if (loud && kind !== 'sensor') {
      res.tone = loud.severity === 'crit' ? 'crit' : 'warn';
      sub.unshift(loud.text);
    }
    const battery = batteryLevel(d);
    if (battery != null && battery <= 15 && kind !== 'energy') sub.push(`Batterij ${fmtNumber(battery, 0)}%`);
    res.sub = sub.filter(Boolean).slice(0, 2).join(' · ');
    return res;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // ---------------------------------------------------------------- overzicht

  const LOW_BATTERY = 15;

  function attentionItems(devices) {
    const items = [];
    for (const d of devices) {
      if (!d.available) {
        items.push({ device: d, severity: 'muted', text: 'niet bereikbaar' });
        continue;
      }
      const alarms = activeAlarms(d).filter((a) => a.severity);
      for (const a of alarms) items.push({ device: d, severity: a.severity, text: a.text.toLowerCase() });
      const battery = batteryLevel(d);
      if (battery != null && battery <= LOW_BATTERY && !alarms.some((a) => baseCap(a.cap.id) === 'alarm_battery')) {
        items.push({ device: d, severity: 'warn', text: `batterij ${fmtNumber(battery, 0)}%` });
      }
      if (capValue(d, 'locked') === false) items.push({ device: d, severity: 'info', text: 'ontgrendeld' });
      if (capValue(d, 'garagedoor_closed') === false) items.push({ device: d, severity: 'info', text: 'open' });
    }
    const rank = { crit: 0, warn: 1, info: 2, muted: 3 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.device.name.localeCompare(b.device.name, 'nl'));
  }

  // Zonder woordgrens aan het eind: Nederlandse samenstellingen als 'Buitensensor' of 'Achtertuin' tellen mee.
  const OUTDOOR = /(buiten|tuin|outdoor|garden|terras|balkon|veranda|oprit|weather|\bweer\b)/i;

  function isOutdoor(d) {
    return OUTDOOR.test(d.name) || (d.zoneName && OUTDOOR.test(d.zoneName));
  }

  function overview(devices) {
    const live = devices.filter((d) => d.available);
    const lights = devices.filter((d) => d.category === 'verlichting');
    const lightsOn = lights.filter((d) => d.available && deviceSummary(d).on).length;

    const indoorTemps = [];
    let outdoor = null;
    for (const d of live) {
      if (!['klimaat', 'sensoren', 'beveiliging'].includes(d.category)) continue;
      const t = capValue(d, 'measure_temperature');
      if (typeof t !== 'number') continue;
      if (isOutdoor(d)) { if (outdoor == null) outdoor = { value: t, device: d }; continue; }
      indoorTemps.push(t);
    }
    const indoor = indoorTemps.length
      ? { avg: indoorTemps.reduce((s, v) => s + v, 0) / indoorTemps.length, min: Math.min(...indoorTemps), max: Math.max(...indoorTemps), count: indoorTemps.length }
      : null;

    const withPower = live.filter((d) => typeof capValue(d, 'measure_power') === 'number');
    const meters = withPower.filter(isMeterDevice);
    let power = null;
    if (meters.length) power = { watts: meters.reduce((s, d) => s + capValue(d, 'measure_power'), 0), source: 'meter', count: meters.length };
    else {
      const consumers = withPower.filter((d) => !['solarpanel', 'battery', 'inverter'].includes(d.cls));
      if (consumers.length) power = { watts: consumers.reduce((s, d) => s + Math.max(0, capValue(d, 'measure_power')), 0), source: 'sum', count: consumers.length };
    }
    const solarDevices = withPower.filter((d) => d.cls === 'solarpanel');
    const solar = solarDevices.length ? { watts: solarDevices.reduce((s, d) => s + Math.abs(capValue(d, 'measure_power')), 0) } : null;

    const attention = attentionItems(devices);
    return {
      total: devices.length,
      lights: { on: lightsOn, total: lights.length },
      indoor,
      outdoor,
      power,
      solar,
      attention,
      attentionCount: attention.filter((a) => a.severity === 'crit' || a.severity === 'warn').length,
      critical: attention.filter((a) => a.severity === 'crit').length,
    };
  }

  function groupMeta(items, groupId) {
    const n = items.length;
    const base = `${n} ${n === 1 ? 'apparaat' : 'apparaten'}`;
    const live = items.filter((d) => d.available);
    if (groupId === 'verlichting') {
      const on = live.filter((d) => deviceSummary(d).on).length;
      return on ? `${on} van ${n} aan` : `alle ${n} uit`;
    }
    if (groupId === 'klimaat') {
      const temps = live.map((d) => capValue(d, 'measure_temperature')).filter((t) => typeof t === 'number');
      if (temps.length) return `${base} · gem. ${fmtNumber(temps.reduce((s, v) => s + v, 0) / temps.length, 1)} °C`;
    }
    if (groupId === 'beveiliging' || groupId === 'sensoren') {
      const open = live.filter((d) => capValue(d, 'alarm_contact') === true || capValue(d, 'locked') === false).length;
      const alarm = live.filter((d) => activeAlarms(d).some((a) => a.severity === 'crit')).length;
      if (alarm) return `${base} · ${alarm} alarm`;
      if (open) return `${base} · ${open} open`;
    }
    if (groupId === 'energie') {
      const w = live.filter((d) => !isMeterDevice(d) && d.cls !== 'solarpanel').map((d) => capValue(d, 'measure_power')).filter((x) => typeof x === 'number');
      if (w.length) { const p = fmtPower(w.reduce((s, v) => s + Math.max(0, v), 0)); return `${base} · ${p.text} ${p.unit} in gebruik`; }
    }
    if (['schakelaars', 'media', 'huishouden'].includes(groupId)) {
      const on = live.filter((d) => deviceSummary(d).on).length;
      if (on) return `${base} · ${on} aan`;
    }
    const offline = items.length - live.length;
    return offline ? `${base} · ${offline} offline` : base;
  }

  // ---------------------------------------------------------------- MCP-resultaten

  function extractPayload(result) {
    if (result == null) return null;
    if (result.structuredContent != null) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content : null;
    if (content) {
      const texts = content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text);
      for (const t of texts) {
        const s = t.trim();
        if (s.startsWith('{') || s.startsWith('[')) {
          try { return JSON.parse(s); } catch (e) { /* geen JSON */ }
        }
      }
      const resource = content.find((c) => c && c.type === 'resource' && c.resource && typeof c.resource.text === 'string');
      if (resource) { try { return JSON.parse(resource.resource.text); } catch (e) { /* geen JSON */ } }
      return texts.join('\n');
    }
    return result;
  }

  const LIST_KEYS = ['items', 'devices', 'zones', 'moods', 'results', 'data', 'list', 'records', 'entries', 'value'];

  function looksLikeEntity(o) {
    return o && typeof o === 'object' && !Array.isArray(o) && ('id' in o || 'deviceId' in o || 'uuid' in o) && ('name' in o || 'class' in o || 'capabilities' in o);
  }

  function extractList(payload, depth = 0) {
    if (payload == null || depth > 4) return [];
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object') return [];
    for (const key of LIST_KEYS) {
      const v = payload[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const inner = extractList(v, depth + 1);
        if (inner.length) return inner;
      }
    }
    const values = Object.values(payload);
    if (values.length && values.every(looksLikeEntity)) return values;
    for (const v of values) {
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) return v;
    }
    return [];
  }

  // ---------------------------------------------------------------- tools herkennen

  const TOOL_NAMES = {
    listDevices: ['devices_list', 'list_devices', 'homey_devices_list', 'get_devices', 'devices_get_all', 'device_list', 'devices'],
    setCapability: ['devices_set_capability', 'device_set_capability', 'set_capability', 'set_device_capability', 'devices_set_capability_value', 'device_capability_set', 'capability_set', 'devices_control', 'device_control', 'control_device'],
    getDevice: ['devices_get', 'device_get', 'get_device', 'devices_get_state', 'device_get_state', 'devices_state', 'device_state'],
    listZones: ['zones_list', 'list_zones', 'homey_zones_list', 'get_zones', 'zone_list'],
    listMoods: ['moods_list', 'list_moods', 'mood_list', 'homey_moods_list'],
    activateMood: ['moods_activate', 'mood_activate', 'activate_mood', 'moods_set_active', 'moods_run'],
  };

  const TOOL_PATTERNS = {
    listDevices: { must: /device/, any: /list|all|get_devices/, not: /zone|flow|capab|setting|driver|group|energy|insight|log|icon|event|watch|resolve|history|card|widget|dashboard|offline|battery/ },
    setCapability: { must: /capab|control/, any: /set|control|write|change/, not: /setting|icon|rename|zone|insight|log|list|watch|subscribe|flow|describe|guardrail|history/ },
    getDevice: { must: /device/, any: /get|state|read/, not: /list|zone|flow|setting|insight|log|icon|history|driver|resolve/ },
    listZones: { must: /zone/, any: /list|all/, not: /device|activity|flow/ },
    listMoods: { must: /mood/, any: /list|all/, not: /create|update|delete|activate/ },
    activateMood: { must: /mood/, any: /activate|run|set_active|trigger|start/, not: /list|create|update|delete/ },
  };

  function schemaProps(tool) {
    return (tool && tool.inputSchema && tool.inputSchema.properties) || {};
  }

  function findKey(props, candidates) {
    const keys = Object.keys(props);
    for (const c of candidates) if (keys.includes(c)) return c;
    const lower = keys.map((k) => k.toLowerCase());
    for (const c of candidates) {
      const i = lower.indexOf(c.toLowerCase());
      if (i >= 0) return keys[i];
    }
    return null;
  }

  const ID_KEYS = ['deviceId', 'device_id', 'id', 'device', 'uuid', 'deviceID'];
  const NAME_KEYS = ['device_name', 'deviceName', 'name'];
  const CAP_KEYS = ['capabilityId', 'capability_id', 'capability', 'capabilityID', 'cap'];
  const VALUE_KEYS = ['value', 'val', 'state', 'newValue', 'new_value'];

  function scoreTool(role, tool) {
    const name = String(tool.name || '').toLowerCase();
    const props = schemaProps(tool);
    const required = (tool.inputSchema && tool.inputSchema.required) || [];
    let score = 0;
    const exact = TOOL_NAMES[role].indexOf(name);
    if (exact >= 0) score = 1000 - exact;
    else {
      const p = TOOL_PATTERNS[role];
      if (!p.must.test(name) || !p.any.test(name) || p.not.test(name)) return 0;
      score = 100;
    }
    if (role === 'listDevices' || role === 'listZones' || role === 'listMoods') {
      if (required.length) score -= 60;
    }
    if (role === 'setCapability') {
      if (findKey(props, CAP_KEYS)) score += 20; else if (exact < 0) score -= 40;
      if (findKey(props, VALUE_KEYS)) score += 20; else if (exact < 0) score -= 40;
      if (findKey(props, ID_KEYS) || findKey(props, NAME_KEYS)) score += 10;
    }
    if (role === 'getDevice' && !(findKey(props, ID_KEYS) || findKey(props, NAME_KEYS))) score -= 60;
    if (role === 'activateMood' && !findKey(props, ['moodId', 'mood_id', 'id', 'mood', 'name'])) score -= 60;
    return score;
  }

  function pickTools(tools) {
    const out = {};
    for (const role of Object.keys(TOOL_NAMES)) {
      let best = null;
      let bestScore = 0;
      for (const t of tools || []) {
        const s = scoreTool(role, t);
        if (s > bestScore) { best = t; bestScore = s; }
      }
      out[role] = best;
    }
    return out;
  }

  function listArgs(tool, { detailed = true } = {}) {
    const props = schemaProps(tool);
    const args = {};
    for (const key of ['detailed', 'detail', 'verbose', 'full', 'include_capabilities', 'includeCapabilities', 'include_values', 'with_capabilities', 'include_state']) {
      if (props[key] && props[key].type === 'boolean') args[key] = key.startsWith('include') || key.startsWith('with') ? true : detailed;
    }
    if (props.compact && props.compact.type === 'boolean') args.compact = !detailed;
    for (const key of ['limit', 'max_results', 'maxResults', 'page_size', 'pageSize', 'per_page']) {
      const p = props[key];
      if (p && (p.type === 'integer' || p.type === 'number')) args[key] = p.maximum != null ? p.maximum : 1000;
    }
    return args;
  }

  function nextPageArgs(tool, args, payload, received) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !received) return null;
    const props = schemaProps(tool);
    const cursor = payload.next_cursor || payload.nextCursor || payload.next || payload.cursor_next || null;
    if (cursor && typeof cursor === 'string') {
      const key = findKey(props, ['cursor', 'after', 'page_token', 'pageToken', 'next_cursor']);
      if (key) return { ...args, [key]: cursor };
    }
    const truncated = payload.truncated === true || payload.has_more === true || payload.hasMore === true;
    const offsetKey = findKey(props, ['offset', 'skip', 'start']);
    if (truncated && offsetKey) return { ...args, [offsetKey]: (args[offsetKey] || 0) + received };
    const pageKey = findKey(props, ['page']);
    if (truncated && pageKey) return { ...args, [pageKey]: (args[pageKey] || 1) + 1 };
    return null;
  }

  function deviceRefArgs(tool, device) {
    const props = schemaProps(tool);
    const args = {};
    const idKey = findKey(props, ID_KEYS);
    const nameKey = idKey ? null : findKey(props, NAME_KEYS);
    if (idKey) args[idKey] = device.id;
    else if (nameKey) args[nameKey] = device.name;
    else args.deviceId = device.id;
    return args;
  }

  function setCapabilityArgs(tool, device, capId, value) {
    const props = schemaProps(tool);
    const args = deviceRefArgs(tool, device);
    const capKey = findKey(props, CAP_KEYS) || 'capabilityId';
    const valKey = findKey(props, VALUE_KEYS) || 'value';
    args[capKey] = capId;
    const vp = props[valKey];
    const types = vp ? [].concat(vp.type || []) : [];
    args[valKey] = types.length === 1 && types[0] === 'string' && typeof value !== 'string' ? String(value) : value;
    return args;
  }

  function moodArgs(tool, mood) {
    const props = schemaProps(tool);
    const idKey = findKey(props, ['moodId', 'mood_id', 'id', 'mood']);
    if (idKey) return { [idKey]: mood.id };
    const nameKey = findKey(props, ['name', 'mood_name']);
    return nameKey ? { [nameKey]: mood.name } : { id: mood.id };
  }

  function normalizeMoods(payload) {
    return extractList(payload)
      .filter((m) => m && typeof m === 'object' && (m.id || m.name))
      .map((m) => ({ id: String(m.id || m.name), name: textOf(m.name) || 'Sfeer', zoneName: textOf(m.zoneName || (m.zone && m.zone.name)) || null }));
  }

  // Waarde die bij een schuif of knop hoort, terug naar de eenheid van Homey.
  function sliderToValue(cap, sliderValue) {
    const n = Number(sliderValue);
    if (cap.fraction) return clamp(Math.round(n) / 100, 0, 1);
    return n;
  }

  function valueToSlider(cap) {
    const v = typeof cap.value === 'number' ? cap.value : 0;
    return cap.fraction ? Math.round(v * 100) : v;
  }

  function sliderRange(cap) {
    if (cap.fraction) return { min: 0, max: 100, step: 1 };
    const min = cap.min != null ? cap.min : 0;
    const max = cap.max != null ? cap.max : 100;
    const step = cap.step != null ? cap.step : cap.decimals === 0 ? 1 : (max - min) <= 50 ? 0.5 : 1;
    return { min, max, step };
  }

  const api = {
    CATEGORIES, CATEGORY_BY_ID, CLASS_TO_CATEGORY, CAPS,
    baseCap, capMeta, capLabel, normalizeCap, normalizeZones, normalizeDevice, normalizeDevices, mergeDevices,
    categorize, deviceIcon, tileKind, toggleCapability, hasCap, capValue, isMeterDevice, isOutdoor,
    fmtNumber, fmtPower, formatCap, formatFull, deviceSummary, activeAlarms, attentionItems, overview, groupMeta,
    extractPayload, extractList, pickTools, scoreTool, listArgs, nextPageArgs, deviceRefArgs, setCapabilityArgs,
    moodArgs, normalizeMoods, sliderToValue, valueToSlider, sliderRange, clamp,
  };

  root.HDCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
