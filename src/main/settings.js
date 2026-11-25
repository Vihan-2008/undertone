'use strict';
// Settings live in %APPDATA%/Undertone/settings.json. Keys, ranges and
// defaults follow design/DESIGN.md section 9.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SCHEMA = 2;

const DEFAULTS = {
  schema: SCHEMA,
  firstRun: true,
  visualizer: {
    enabled: true,
    style: 'bars',
    theme: 'ember',
    customAccent: '#3B8FD9',
    density: 50,
    glow: 40,
    backdrop: 0,
    opacity: 100,
    albumGlow: false,
  },
  nowPlaying: { layout: 'compact' },
  clock: {
    enabled: true,
    face: 'digital',
    font: 'Bahnschrift',
    size: 96,
    weight: 300,
    letterSpacing: 0,
    colourMode: 'solid',
    colourA: '#EFEBE2',
    colourB: '#EB4A22',
    opacity: 100,
    shadow: true,
    hour24: null, // resolved from the Windows region on first load
    seconds: false,
    date: 'short',
  },
  lyrics: { enabled: false, offset: 0, size: 'medium', trackOffsets: {} },
  audio: { source: 'system', sourceLabel: '', sensitivity: 100, smoothing: 60 },
  system: { launchAtLogin: false, fpsCap: '60', pauseWhenCovered: true },
  hotkeys: {
    fullscreen: 'Ctrl+Alt+F',
    arrange: 'Ctrl+Alt+A',
    // The spec's Ctrl+Alt+H is taken on common setups; Shift keeps the H.
    toggleWidgets: 'Ctrl+Alt+H',
    nextStyle: 'Ctrl+Alt+V',
  },
  preview: { over: 'wallpaper' },
  fullscreen: { style: 'mirror', theme: 'cover' },
  widgets: { visualizer: { bounds: null }, clock: { position: null } },
  window: { settings: null },
};

// Values stored whole rather than merged key by key.
const FREE = new Set(['lyrics.trackOffsets', 'widgets.visualizer.bounds', 'widgets.clock.position', 'window.settings']);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over, at = '') {
  const out = { ...base };
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    const p = at ? `${at}.${k}` : k;
    if (v === undefined || !(k in base)) continue;
    if (FREE.has(p)) out[k] = v == null ? null : JSON.parse(JSON.stringify(v));
    else if (isObj(base[k])) out[k] = merge(base[k], v, p);
    else out[k] = v;
  }
  return out;
}

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'settings.json');
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {}
    // Profiles from before the schema was settled start over.
    if (!stored || stored.schema !== SCHEMA) stored = {};
    this.fresh = !Object.keys(stored).length;
    this.data = merge(DEFAULTS, stored);
    this.timer = null;
  }

  get() {
    return this.data;
  }

  /** Apply a patch like { visualizer: { style: 'ring' } }. */
  set(patch) {
    if (!isObj(patch)) return;
    this.data = merge(this.data, patch);
    this.emit('change', this.data, patch);
    this.persist();
  }

  /** Everything back to defaults except where the widgets are. */
  reset(keep = {}) {
    const { widgets, window } = this.data;
    this.data = merge(DEFAULTS, { ...keep, firstRun: false, widgets, window });
    this.emit('change', this.data, JSON.parse(JSON.stringify(this.data)));
    this.persist();
  }

  persist() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[settings] save failed', e);
    }
  }
}

module.exports = { Settings, DEFAULTS };
