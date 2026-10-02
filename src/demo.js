/*
 * Homey Dashboard: voorbeeldwoning.
 * Alleen voor de demo-modus: zelfde vorm als de Homey Web API, zodat de echte
 * normalisatie meedraait. Bediening werkt op deze gegevens in het geheugen.
 */
(function (root) {
  'use strict';

  const ZONES = [
    { id: 'z-huis', name: 'Huis', parent: null },
    { id: 'z-woon', name: 'Woonkamer', parent: 'z-huis' },
    { id: 'z-keuken', name: 'Keuken', parent: 'z-huis' },
    { id: 'z-hal', name: 'Hal', parent: 'z-huis' },
    { id: 'z-meterkast', name: 'Meterkast', parent: 'z-huis' },
    { id: 'z-slaap', name: 'Slaapkamer', parent: 'z-huis' },
    { id: 'z-kind', name: 'Kinderkamer', parent: 'z-huis' },
    { id: 'z-bad', name: 'Badkamer', parent: 'z-huis' },
    { id: 'z-kantoor', name: 'Kantoor', parent: 'z-huis' },
    { id: 'z-zolder', name: 'Zolder', parent: 'z-huis' },
    { id: 'z-tuin', name: 'Tuin', parent: 'z-huis' },
    { id: 'z-garage', name: 'Garage', parent: 'z-huis' },
  ];

  // [naam, zone, klasse, capabilities, extra]
  const DEVICES = [
    ['Plafondlamp', 'z-woon', 'light', { onoff: true, dim: 0.72, light_temperature: 0.35 }],
    ['Staande lamp', 'z-woon', 'light', { onoff: true, dim: 0.45 }],
    ['Hue Play links', 'z-woon', 'light', { onoff: true, dim: 0.3, light_hue: 0.62, light_saturation: 0.8 }],
    ['Hue Play rechts', 'z-woon', 'light', { onoff: true, dim: 0.3, light_hue: 0.62, light_saturation: 0.8 }],
    ['Thermostaat woonkamer', 'z-woon', 'thermostat', { measure_temperature: 20.6, target_temperature: 21, thermostat_mode: 'heat', measure_humidity: 48 }],
    ['Sonos Arc', 'z-woon', 'speaker', { onoff: true, speaker_playing: true, speaker_track: 'Avond', speaker_artist: 'Boudewijn de Groot', volume_set: 0.24, speaker_next: null, speaker_prev: null }],
    ['Televisie', 'z-woon', 'tv', { onoff: false, volume_set: 0.18 }],
    ['Screen voorgevel', 'z-woon', 'windowcoverings', { windowcoverings_set: 0.4, windowcoverings_state: 'idle' }],
    ['Luchtkwaliteit', 'z-woon', 'sensor', { measure_co2: 640, measure_temperature: 20.9, measure_humidity: 47 }],
    ['Bewegingssensor woonkamer', 'z-woon', 'sensor', { alarm_motion: true, measure_luminance: 214, measure_battery: 82 }],

    ['Spots keuken', 'z-keuken', 'light', { onoff: true, dim: 0.85 }],
    ['Lamp kookeiland', 'z-keuken', 'light', { onoff: false, dim: 0.6 }],
    ['Vaatwasser', 'z-keuken', 'dishwasher', { onoff: true, measure_power: 1980 }],
    ['Koffiemachine', 'z-keuken', 'socket', { onoff: false, measure_power: 0 }],
    ['Koelkast', 'z-keuken', 'socket', { onoff: true, measure_power: 86 }],
    ['Waterlekmelder', 'z-keuken', 'sensor', { alarm_water: false, measure_battery: 64 }],

    ['Lamp hal', 'z-hal', 'light', { onoff: false, dim: 1 }],
    ['Lamp overloop', 'z-hal', 'light', { onoff: false, dim: 0.5 }, { available: false, unavailableMessage: 'Zigbee-apparaat reageert niet' }],
    ['Voordeur slot', 'z-hal', 'lock', { locked: true, measure_battery: 54 }],
    ['Voordeur', 'z-hal', 'sensor', { alarm_contact: false, measure_battery: 91 }],
    ['Deurbel', 'z-hal', 'doorbell', { alarm_generic: false, measure_battery: 77 }],
    ['Bewegingssensor hal', 'z-hal', 'sensor', { alarm_motion: false, measure_temperature: 19.4, measure_battery: 68 }],
    ['Alarmsysteem', 'z-hal', 'homealarm', { homealarm_state: 'disarmed' }],

    ['Slimme meter', 'z-meterkast', 'sensor', { measure_power: 2140, meter_power: 18234.6, meter_gas: 3421.5 }, { energyObj: { cumulative: true } }],
    ['Watermeter', 'z-meterkast', 'sensor', { meter_water: 512.3, measure_water: 0 }],

    ['Bedlampje links', 'z-slaap', 'light', { onoff: false, dim: 0.4 }],
    ['Plafondlamp slaapkamer', 'z-slaap', 'light', { onoff: false, dim: 0.8 }],
    ['Thermostaat slaapkamer', 'z-slaap', 'thermostat', { measure_temperature: 18.2, target_temperature: 17.5, thermostat_mode: 'auto' }],
    ['Rolluik slaapkamer', 'z-slaap', 'windowcoverings', { windowcoverings_set: 1, windowcoverings_state: 'idle' }],

    ['Nachtlampje', 'z-kind', 'light', { onoff: true, dim: 0.1 }],
    ['Thermostaat kinderkamer', 'z-kind', 'thermostat', { measure_temperature: 19.4, target_temperature: 19 }],
    ['Rookmelder kinderkamer', 'z-kind', 'smokealarm', { alarm_smoke: false, measure_battery: 91 }],

    ['Spiegelverlichting', 'z-bad', 'light', { onoff: false }],
    ['Vloerverwarming', 'z-bad', 'thermostat', { measure_temperature: 22.1, target_temperature: 22 }],
    ['Ventilator badkamer', 'z-bad', 'fan', { onoff: false, measure_humidity: 68 }],

    ['Bureaulamp', 'z-kantoor', 'light', { onoff: true, dim: 1, light_temperature: 0.1 }],
    ['Monitor', 'z-kantoor', 'socket', { onoff: true, measure_power: 46 }],
    ['Klimaatsensor kantoor', 'z-kantoor', 'sensor', { measure_temperature: 21.3, measure_humidity: 44, measure_battery: 12 }],

    ['Rookmelder zolder', 'z-zolder', 'smokealarm', { alarm_smoke: false, measure_battery: 9 }],
    ['Wasmachine', 'z-zolder', 'washer', { onoff: false, measure_power: 0 }],
    ['Droger', 'z-zolder', 'dryer', { onoff: false, measure_power: 0 }],
    ['Omvormer zonnepanelen', 'z-zolder', 'solarpanel', { measure_power: 2380, meter_power: 9412.8 }],
    ['Thuisbatterij', 'z-zolder', 'battery', { measure_battery: 76, measure_power: 820 }],

    ['Tuinverlichting', 'z-tuin', 'light', { onoff: false, dim: 0.7 }],
    ['Buitensensor', 'z-tuin', 'sensor', { measure_temperature: 13.8, measure_humidity: 81 }],
    ['Achterdeur', 'z-tuin', 'sensor', { alarm_contact: true, measure_battery: 88 }],
    ['Robotmaaier', 'z-tuin', 'lawnmower', { onoff: false, measure_battery: 100 }],

    ['Laadpaal', 'z-garage', 'evcharger', { onoff: true, measure_power: 3680, meter_power: 1532.4 }],
    ['Garagedeur', 'z-garage', 'garagedoor', { garagedoor_closed: true }],
    ['Robotstofzuiger', 'z-huis', 'vacuumcleaner', { onoff: false, vacuumcleaner_state: 'docked', measure_battery: 100 }],
    ['Gastenmodus', 'z-huis', 'other', { onoff: false }],
  ];

  const MOODS = [
    { id: 'mood-avond', name: 'Avondsfeer' },
    { id: 'mood-film', name: 'Film kijken' },
    { id: 'mood-ochtend', name: 'Goedemorgen' },
    { id: 'mood-uit', name: 'Alles uit' },
  ];

  const SETABLE = new Set([
    'onoff', 'dim', 'light_temperature', 'light_hue', 'light_saturation', 'target_temperature', 'thermostat_mode',
    'windowcoverings_set', 'windowcoverings_state', 'volume_set', 'speaker_playing', 'speaker_next', 'speaker_prev',
    'locked', 'homealarm_state', 'garagedoor_closed', 'vacuumcleaner_state',
  ]);

  const UNITS = {
    measure_temperature: '°C', target_temperature: '°C', measure_humidity: '%', measure_power: 'W', meter_power: 'kWh',
    meter_gas: 'm³', meter_water: 'm³', measure_water: 'L/min', measure_co2: 'ppm', measure_luminance: 'lx', measure_battery: '%',
  };

  function slug(s) {
    return s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function create() {
    const now = Date.now();
    const devices = DEVICES.map(([name, zone, cls, caps, extra], i) => {
      const capabilitiesObj = {};
      for (const [id, value] of Object.entries(caps)) {
        capabilitiesObj[id] = {
          id,
          value,
          units: UNITS[id] || undefined,
          setable: SETABLE.has(id),
          getable: !/^speaker_(next|prev)$/.test(id),
          min: id === 'target_temperature' ? 5 : undefined,
          max: id === 'target_temperature' ? 30 : undefined,
          step: id === 'target_temperature' ? 0.5 : undefined,
          lastUpdated: new Date(now - (i * 97 + 30) * 1000).toISOString(),
        };
      }
      return {
        id: `demo-${slug(name)}`,
        name,
        zone,
        class: cls,
        available: true,
        capabilities: Object.keys(caps),
        capabilitiesObj,
        ...(extra || {}),
      };
    });
    return { zones: ZONES.map((z) => ({ ...z })), devices, moods: MOODS.map((m) => ({ ...m })), ticks: 0 };
  }

  function find(house, id) {
    return house.devices.find((d) => d.id === id);
  }

  function setValue(house, deviceId, capId, value) {
    const d = find(house, deviceId);
    if (!d) throw new Error('Onbekend apparaat');
    if (d.available === false) throw new Error(`${d.name} is niet bereikbaar`);
    const caps = d.capabilitiesObj;
    if (capId === 'speaker_next' || capId === 'speaker_prev') {
      const tracks = [['Avond', 'Boudewijn de Groot'], ['Zoutelande', 'BLØF'], ['Het is een nacht', 'Guus Meeuwis'], ['Malle Babbe', 'Normaal']];
      const cur = tracks.findIndex((t) => t[0] === caps.speaker_track.value);
      const next = tracks[(cur + (capId === 'speaker_next' ? 1 : tracks.length - 1)) % tracks.length];
      caps.speaker_track.value = next[0];
      caps.speaker_artist.value = next[1];
      caps.speaker_playing.value = true;
      return;
    }
    if (!caps[capId]) throw new Error(`${d.name} heeft geen ${capId}`);
    caps[capId].value = value;
    caps[capId].lastUpdated = new Date().toISOString();
    if (capId === 'dim' && caps.onoff) caps.onoff.value = value > 0;
    if (capId === 'windowcoverings_state' && caps.windowcoverings_set && value !== 'idle') {
      caps.windowcoverings_set.value = value === 'up' ? 1 : 0;
      setTimeout(() => { caps.windowcoverings_state.value = 'idle'; }, 2500);
    }
    if (capId === 'onoff' && caps.measure_power && d.class !== 'socket') caps.measure_power.value = value ? 1200 : 0;
  }

  function activateMood(house, moodId) {
    const lights = house.devices.filter((d) => d.class === 'light' && d.available !== false);
    const set = (name, on, dim) => {
      const d = lights.find((l) => l.name === name);
      if (!d) return;
      d.capabilitiesObj.onoff.value = on;
      if (dim != null && d.capabilitiesObj.dim) d.capabilitiesObj.dim.value = dim;
    };
    if (moodId === 'mood-uit') lights.forEach((d) => { d.capabilitiesObj.onoff.value = false; });
    if (moodId === 'mood-avond') { set('Plafondlamp', true, 0.35); set('Staande lamp', true, 0.5); set('Hue Play links', true, 0.4); set('Hue Play rechts', true, 0.4); set('Spots keuken', true, 0.3); }
    if (moodId === 'mood-film') { lights.forEach((d) => { if (/woonkamer|Plafondlamp$|Staande/.test(d.name)) d.capabilitiesObj.onoff.value = false; }); set('Hue Play links', true, 0.2); set('Hue Play rechts', true, 0.2); }
    if (moodId === 'mood-ochtend') { set('Spots keuken', true, 1); set('Lamp hal', true, 1); set('Plafondlamp', true, 0.8); }
  }

  // Kleine schommelingen, zodat de demo leeft zoals een echt huis.
  function tick(house) {
    house.ticks += 1;
    const jitter = (v, pct) => v * (1 + (Math.random() * 2 - 1) * pct);
    for (const d of house.devices) {
      const c = d.capabilitiesObj;
      if (c.measure_temperature && c.target_temperature) {
        const diff = c.target_temperature.value - c.measure_temperature.value;
        c.measure_temperature.value = Math.round((c.measure_temperature.value + diff * 0.08 + (Math.random() - 0.5) * 0.06) * 10) / 10;
      }
      if (d.name === 'Omvormer zonnepanelen') c.measure_power.value = Math.max(0, Math.round(jitter(c.measure_power.value, 0.04)));
      if (d.name === 'Laadpaal' && c.onoff.value) c.measure_power.value = Math.round(jitter(3680, 0.01));
      if (d.name === 'Vaatwasser' && c.onoff.value) c.measure_power.value = Math.round(jitter(1980, 0.06));
    }
    const meter = house.devices.find((d) => d.name === 'Slimme meter');
    const solar = house.devices.find((d) => d.name === 'Omvormer zonnepanelen');
    const battery = house.devices.find((d) => d.name === 'Thuisbatterij');
    const usage = house.devices
      .filter((d) => d.capabilitiesObj.measure_power && !['sensor', 'solarpanel', 'battery'].includes(d.class))
      .reduce((s, d) => s + (d.capabilitiesObj.onoff && d.capabilitiesObj.onoff.value === false ? 0 : d.capabilitiesObj.measure_power.value), 0);
    const lightsOn = house.devices.filter((d) => d.class === 'light' && d.capabilitiesObj.onoff && d.capabilitiesObj.onoff.value).length;
    const base = 310 + lightsOn * 9;
    meter.capabilitiesObj.measure_power.value = Math.round(jitter(base + usage + battery.capabilitiesObj.measure_power.value - solar.capabilitiesObj.measure_power.value, 0.02));
    meter.capabilitiesObj.meter_power.value = Math.round((meter.capabilitiesObj.meter_power.value + 0.004) * 1000) / 1000;
  }

  root.HDDemo = { create, setValue, activateMood, tick };
})(typeof globalThis !== 'undefined' ? globalThis : this);
