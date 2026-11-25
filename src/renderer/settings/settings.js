// Settings window (DESIGN.md 7). Every control is found by data-setting and
// writes straight to the settings store; there is no Apply or Save.
import { AudioTap, listInputs, createFrame } from '../shared/audio.js';
import { Stage, Loop, synthFrame } from '../shared/stage.js';
import { resolvePalette, customStops, THEMES } from '../shared/palette.js';
import { STYLES } from '../shared/visualizers.js';
import { NowPlaying } from '../shared/nowplaying.js';
import { ClockFace } from '../shared/clockface.js';
import { WEIGHT_NAMES, FONT_WEIGHTS, fontKey, timeParts, timeInWords, dateText } from '../shared/timefmt.js';

const api = window.undertone;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const body = document.body;

let settings = await api.settings.get();
let started = false;
api.settings.onChange((s) => (started ? applySettings(s) : (settings = s)));
let info = await api.app.info();
let picture = null;
const np = new NowPlaying();
const audio = new AudioTap();

// ---------------------------------------------------------------- helpers

const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function patchOf(key, value) {
  const parts = key.split('.');
  const out = {};
  let o = out;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) o[p] = value;
    else o = o[p] = {};
  });
  return out;
}
const set = (key, value) => api.settings.set(patchOf(key, value));

const DEFAULTS = {
  'visualizer.density': 50, 'audio.sensitivity': 100, 'visualizer.glow': 40, 'visualizer.backdrop': 0,
  'visualizer.opacity': 100, 'clock.size': 96, 'clock.weight': 300, 'clock.letterSpacing': 0,
  'clock.opacity': 100, 'lyrics.offset': 0, 'audio.smoothing': 60,
};

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const VALUE_TEXT = {
  'visualizer.density': (v) => String(v),
  'audio.sensitivity': (v) => `${v}%`,
  'visualizer.glow': (v) => String(v),
  'visualizer.backdrop': (v) => (v > 0 ? String(v) : 'Off'),
  'visualizer.opacity': (v) => `${v}%`,
  'clock.size': (v) => `${v} px`,
  'clock.weight': (v) => WEIGHT_NAMES[v] || String(v),
  'clock.letterSpacing': (v) => signed(v),
  'clock.opacity': (v) => `${v}%`,
  'lyrics.offset': (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${(Math.abs(v) / 1000).toFixed(1)} s`,
  'audio.smoothing': (v) => String(v),
};

function outputFor(input) {
  return input.id ? $(`output[for="${input.id}"]`) : null;
}

function setFill(input) {
  const min = Number(input.min), max = Number(input.max);
  input.style.setProperty('--fill', `${(((Number(input.value) - min) / (max - min)) * 100).toFixed(1)}%`);
}

function rowOf(el) {
  return el.closest('.row');
}

/** A row that does not apply right now: 40 % alpha, control disabled, value `n/a`. */
function disableRow(row, off) {
  if (!row) return;
  row.classList.toggle('is-disabled', off);
  for (const c of $$('input, select, button', row)) c.disabled = off;
  const out = $('output', row);
  if (out) {
    if (off) out.textContent = 'n/a';
  }
}

// ---------------------------------------------------------------- tabs

const tabs = $$('.tab');
function selectTab(name) {
  body.dataset.tab = name;
  for (const t of tabs) {
    const on = t.id === `tab-${name}`;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  renderPreview();
  animateTiles();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t.id.slice(4)));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    n.focus();
    selectTab(n.id.slice(4));
  });
});

// ---------------------------------------------------------------- controls → settings

for (const input of $$('input.slider[data-setting]')) {
  const key = input.dataset.setting;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    setFill(input);
    const out = outputFor(input);
    if (out) out.textContent = (VALUE_TEXT[key] || String)(v);
    if (key === 'lyrics.offset') return setOffset(v);
    // The twin sensitivity slider follows along.
    for (const twin of $$(`input.slider[data-setting="${key}"]`)) {
      if (twin === input) continue;
      twin.value = String(v);
      setFill(twin);
      const o = outputFor(twin);
      if (o) o.textContent = (VALUE_TEXT[key] || String)(v);
    }
    set(key, v);
  });
  // Double-click resets to the default.
  input.addEventListener('dblclick', () => {
    if (!(key in DEFAULTS)) return;
    input.value = String(DEFAULTS[key]);
    input.dispatchEvent(new Event('input'));
  });
}

for (const input of $$('input.switch[data-setting]')) {
  const key = input.dataset.setting;
  input.addEventListener('change', () => {
    const out = outputFor(input);
    if (out) out.textContent = input.checked ? 'On' : 'Off';
    if (key === 'system.launchAtLogin') api.app.setLaunchAtLogin(input.checked);
    set(key, input.checked);
  });
}

for (const sel of $$('select[data-setting]')) {
  sel.addEventListener('change', () => set(sel.dataset.setting, sel.value));
}

for (const group of $$('[role="radiogroup"][data-setting]')) {
  const key = group.dataset.setting;
  group.addEventListener('change', (e) => {
    const input = e.target.closest('input[type="radio"]');
    if (!input) return;
    if (key === 'audio.source') return chooseSource(input.value);
    set(key, input.value);
  });
}

// preview.over is a view option, remembered.
for (const r of $$('input[name="preview.over"]')) {
  r.addEventListener('change', () => set('preview.over', r.value));
}

// Colour wells + hex fields: a valid hex applies at once; an invalid one reverts on blur.
for (const well of $$('input.well[data-setting]')) {
  const key = well.dataset.setting;
  const hex = well.nextElementSibling && well.nextElementSibling.classList.contains('hexfield') ? well.nextElementSibling : null;
  well.addEventListener('input', () => {
    if (hex) hex.value = well.value.toUpperCase();
    set(key, well.value.toUpperCase());
  });
  if (!hex) continue;
  hex.addEventListener('input', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      well.value = v.toLowerCase();
      set(key, v.toUpperCase());
    }
  });
  hex.addEventListener('blur', () => {
    hex.value = String(get(settings, key) || well.value).toUpperCase();
  });
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hex.blur();
  });
}

// ---------------------------------------------------------------- settings → controls

function renderControls() {
  const s = settings;
  for (const input of $$('input.slider[data-setting]')) {
    const key = input.dataset.setting;
    if (document.activeElement === input && input.matches(':active')) continue;
    const v = key === 'lyrics.offset' ? currentOffset() : get(s, key);
    input.value = String(v);
    setFill(input);
    const out = outputFor(input);
    if (out) out.textContent = (VALUE_TEXT[key] || String)(Number(v));
  }
  for (const input of $$('input.switch[data-setting]')) {
    input.checked = !!get(s, input.dataset.setting);
    const out = outputFor(input);
    if (out) out.textContent = input.checked ? 'On' : 'Off';
  }
  for (const sel of $$('select[data-setting]')) sel.value = get(s, sel.dataset.setting);
  for (const group of $$('[role="radiogroup"][data-setting]')) {
    const key = group.dataset.setting;
    if (key === 'audio.source') continue;
    const v = String(get(s, key));
    for (const r of $$('input[type="radio"]', group)) r.checked = r.value === v;
  }
  for (const r of $$('input[name="preview.over"]')) r.checked = r.value === s.preview.over;
  for (const well of $$('input.well[data-setting]')) {
    const v = String(get(s, well.dataset.setting) || '#000000');
    well.value = v.toLowerCase();
    const hex = well.nextElementSibling;
    if (hex && hex.classList.contains('hexfield') && document.activeElement !== hex) hex.value = v.toUpperCase();
  }

  // Visualizer: conditional rows
  $('#row-custom-accent').hidden = s.visualizer.theme !== 'custom';
  $('#note-cover').hidden = s.visualizer.theme !== 'cover';
  const meters = s.visualizer.style === 'meters';
  const density = $('#visualizer-density');
  disableRow(rowOf(density), meters);
  if (!meters) outputFor(density).textContent = String(s.visualizer.density);

  // Clock
  const c = s.clock;
  const clockOff = !c.enabled;
  body.dataset.clock = clockOff ? 'off' : 'on';
  $('.face-grid').classList.toggle('is-disabled', clockOff);
  for (const r of $$('input', $('.face-grid'))) r.disabled = clockOff;
  for (const row of $$('#panel-clock .panel__tune .row')) {
    if ($('#clock-enabled', row)) continue;
    disableRow(row, clockOff);
  }
  if (!clockOff) {
    // Rows that do not apply to this face or font.
    const single = (FONT_WEIGHTS[fontKey(c.font)] || [1, 2]).length < 2;
    disableRow(rowOf($('#clock-weight')), single);
    disableRow(rowOf($('#clock-seconds')), c.face === 'minimal' || c.face === 'words' || c.face === 'stacked');
    disableRow(rowOf($('#clock-hour24')), c.face === 'words' || c.face === 'analog');
    disableRow(rowOf($('#clock-date-label')), c.face === 'minimal');
    renderControlsValues();
  }
  const mode = c.colourMode === 'match' ? 'visualizer' : c.colourMode;
  $('#row-clock-colours').hidden = mode === 'visualizer';
  const grad = mode === 'gradient';
  $('#clock-colour-b').hidden = !grad;
  $('#clock-colour-b').nextElementSibling.hidden = !grad;
  $('#clock-colour-a').setAttribute('aria-label', grad ? 'Top colour' : 'Colour');

  // Lyrics
  const lyricsOff = !s.lyrics.enabled;
  disableRow(rowOf($('#lyrics-offset')), lyricsOff);
  disableRow(rowOf($('#lyrics-size-label')), lyricsOff);
  if (!lyricsOff) outputFor($('#lyrics-offset')).textContent = VALUE_TEXT['lyrics.offset'](currentOffset());

  renderSwatches();
  renderHotkeys();
}

/** Re-write value texts that disableRow may have replaced with n/a. */
function renderControlsValues() {
  for (const input of $$('#panel-clock input.slider[data-setting]')) {
    const row = rowOf(input);
    if (row && row.classList.contains('is-disabled')) continue;
    const out = outputFor(input);
    if (out) out.textContent = VALUE_TEXT[input.dataset.setting](Number(input.value));
  }
  for (const input of $$('#panel-clock input.switch[data-setting]')) {
    const row = rowOf(input);
    if (row && row.classList.contains('is-disabled')) continue;
    const out = outputFor(input);
    if (out) out.textContent = input.checked ? 'On' : 'Off';
  }
}

// ---------------------------------------------------------------- lyrics offset (per track while it plays)

function currentOffset() {
  const t = np.track;
  const per = t && settings.lyrics.trackOffsets ? settings.lyrics.trackOffsets[t.key] : undefined;
  return per != null ? per : settings.lyrics.offset;
}

function setOffset(v) {
  const t = np.track;
  if (t && t.key && np.playing) {
    api.settings.set({ lyrics: { trackOffsets: { ...(settings.lyrics.trackOffsets || {}), [t.key]: v } } });
  } else {
    set('lyrics.offset', v);
  }
}

// ---------------------------------------------------------------- swatches

function renderSwatches() {
  const custom = customStops(settings.visualizer.customAccent);
  const chipC = $('input[name="visualizer.theme"][value="custom"]').parentElement.querySelector('.swatch__chip');
  chipC.style.setProperty('--a', custom[0]);
  chipC.style.setProperty('--b', custom[1]);
  chipC.style.setProperty('--c', custom[2]);
  const chipF = $('input[name="visualizer.theme"][value="cover"]').parentElement.querySelector('.swatch__chip');
  chipF.classList.toggle('swatch__chip--none', !np.coverStops);
  if (np.coverStops) {
    chipF.style.setProperty('--a', np.coverStops[0]);
    chipF.style.setProperty('--b', np.coverStops[1]);
    chipF.style.setProperty('--c', np.coverStops[2]);
  }
}

// ---------------------------------------------------------------- the preview

const preview = $('.preview');
const vizStage = new Stage($('.preview__viz'), {
  style: settings.visualizer.style,
  glow: settings.visualizer.glow,
  density: settings.visualizer.density,
});
const clockFace = new ClockFace($('.preview__clock-face'));

function palette(fadeMs = 0) {
  vizStage.setPalette(resolvePalette(settings.visualizer, np.coverStops, vizStage.stops), fadeMs);
}

/** Paint the wallpaper so that display rect `r` lands on preview rect `to`. */
function paintWall(r, to) {
  const wall = $('.preview__wall');
  if (!picture || !picture.image || !picture.placement) {
    wall.style.background = picture ? picture.bg : '#101214';
    return;
  }
  const k = to.w / r.w;
  const p = picture.placement;
  const x = to.x + (p.x - r.x) * k, y = to.y + (p.y - r.y) * k;
  wall.style.backgroundColor = picture.bg;
  wall.style.backgroundImage = `url("${picture.image}")`;
  wall.style.backgroundSize = `${p.w * k}px ${p.h * k}px`;
  wall.style.backgroundPosition = `${x}px ${y}px`;
  wall.style.backgroundRepeat = p.tile ? 'repeat' : 'no-repeat';
}

function renderPreview() {
  const s = settings;
  const tab = body.dataset.tab;
  preview.dataset.over = s.preview.over;
  const H = preview.clientHeight || 344;
  if (tab === 'clock') {
    renderClockPreview(H);
    return;
  }
  if (tab === 'lyrics') {
    renderPlayerPreview();
    return;
  }
  // Visualizer, Audio, System: the widget, 472 wide, its height from the user's aspect.
  const v = (picture && picture.visualizer) || { x: 640, y: 764, w: 640, h: 220 };
  const vizH = Math.round(Math.min(192, Math.max(80, (472 * v.h) / v.w)));
  preview.style.setProperty('--viz-h', `${vizH}px`);
  const top = H - 76 - vizH;
  paintWall(v, { x: 24, y: top, w: 472 });
  preview.dataset.tone = picture ? picture.tone : 'paper';
  const vs = s.visualizer;
  vizStage.setStyle(vs.style);
  vizStage.setGlow(vs.glow);
  vizStage.setDensity(vs.density);
  vizStage.setFeather(!(vs.backdrop > 0));
  palette(0);
  preview.dataset.backdrop = vs.backdrop > 0 ? 'on' : '';
  $('.preview__backdrop').style.opacity = String((vs.backdrop / 100) * 0.92);
  $('.preview__viz').style.opacity = String(vs.opacity / 100);
  $('.preview__np').style.opacity = String(vs.opacity / 100);
  preview.dataset.np = s.nowPlaying.layout;
  renderPreviewTrack();
}

function renderPreviewTrack() {
  const t = np.track;
  const line = $('.preview__np');
  line.hidden = !t || !t.title;
  if (line.hidden) return;
  $('.preview__np-title').textContent = t.title;
  $('.preview__np-artist').textContent = t.artist || '';
  const img = $('.preview__np-cover');
  if (np.cover) img.src = np.cover;
  else img.removeAttribute('src');
}

function renderClockPreview(H) {
  const c = settings.clock;
  // Around the clock's real position on the wallpaper, at the widget's preview scale.
  const r = (picture && picture.clock) || { x: 1600, y: 64, w: 250, h: 120 };
  const k = 0.7375;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  paintWall({ x: cx - 260 / k, y: cy - H / 2 / k, w: 520 / k }, { x: 0, y: 0, w: 520 });
  preview.dataset.tone = picture ? picture.tone : 'paper';
  if (!c.enabled) return;
  const stops = resolvePalette(settings.visualizer, np.coverStops, vizStage.stops);
  let size = Math.min(c.size, 96);
  clockFace.set(c, { stops, locale: info.locale, size });
  // Scale down until it fits the preview.
  const el = clockFace.root;
  for (let i = 0; i < 6; i++) {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w <= 472 && h <= H - 56) break;
    size = Math.max(12, Math.floor(size * Math.min(472 / w, (H - 56) / h)));
    clockFace.set(c, { stops, locale: info.locale, size });
  }
}

function renderPlayerPreview() {
  const light = $('.preview__player-light');
  if (np.cover) light.style.setProperty('--light-image', `url("${np.cover}")`);
  else light.style.removeProperty('--light-image');
  const img = $('.preview__player-cover');
  if (np.cover) img.src = np.cover;
  else img.removeAttribute('src');
  renderPlayerLyrics();
}

let playerLyricIndex = -3;
function renderPlayerLyrics(force) {
  const ol = $('.preview__player-lyrics');
  const L = np.lyrics;
  const ready = settings.lyrics.enabled && L && L.status === 'ready' && L.lines.length;
  if (!ready) {
    if (playerLyricIndex === -9 && !force) return;
    playerLyricIndex = -9;
    const li = document.createElement('li');
    li.className = 'is-empty';
    li.textContent = !np.track ? 'Nothing playing' : !settings.lyrics.enabled ? 'Lyrics are off' : 'No synced lyrics';
    ol.replaceChildren(li);
    return;
  }
  const i = np.lyricIndex(currentOffset() / 1000);
  if (i === playerLyricIndex && !force) return;
  playerLyricIndex = i;
  const lines = [];
  for (let k = Math.max(0, i - 1); k < Math.max(0, i - 1) + 4 && k < L.lines.length; k++) {
    const li = document.createElement('li');
    li.textContent = L.lines[k].text || '♪';
    if (k === i) li.setAttribute('aria-current', 'true');
    lines.push(li);
  }
  ol.replaceChildren(...lines);
}

// ---------------------------------------------------------------- lyrics picker (Lyrics tab)

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let peekIndex = -3;
function renderLyricsPicker(force) {
  const t = np.track;
  $('#lyrics-track').textContent = t && t.title ? [t.title, t.artist].filter(Boolean).join(', ') : '';
  const L = np.lyrics || { status: 'idle' };
  let state;
  if (!settings.lyrics.enabled) state = 'off';
  else if (!t || !t.title) state = 'idle';
  else if (L.status === 'ready' && L.lines.length) state = 'ready';
  else if (L.status === 'failed') state = 'failed';
  else if (L.status === 'none') state = 'none';
  else state = 'loading';
  body.dataset.lyrics = state;
  if (state !== 'ready') {
    peekIndex = -3;
    return;
  }
  const i = np.lyricIndex(currentOffset() / 1000);
  if (i === peekIndex && !force) return;
  peekIndex = i;
  const from = Math.max(0, Math.min(i - 2, L.lines.length - 5));
  const items = [];
  for (let k = from; k < Math.min(L.lines.length, from + 5); k++) {
    const li = document.createElement('li');
    const tm = document.createElement('time');
    tm.textContent = fmtTime(L.lines[k].t);
    const sp = document.createElement('span');
    sp.textContent = L.lines[k].text || '♪';
    li.append(tm, sp);
    if (k === i) li.setAttribute('aria-current', 'true');
    items.push(li);
  }
  $('.lyric-peek').replaceChildren(...items);
}

// ---------------------------------------------------------------- style tiles

const tiles = $$('.style-tile').map((label) => {
  const input = $('input', label);
  const stage = new Stage($('.style-tile__stage', label), { style: input.value, glow: 0, density: 50, scale: 1 });
  const frame = createFrame();
  return { label, input, stage, frame, t: 1.3 + Math.random(), hot: false, drawn: false };
});
for (const tile of tiles) {
  const on = () => { tile.hot = true; animateTiles(); };
  const off = () => { tile.hot = false; };
  tile.label.addEventListener('mouseenter', on);
  tile.label.addEventListener('mouseleave', off);
  tile.input.addEventListener('focus', on);
  tile.input.addEventListener('blur', off);
}

function tilePalette() {
  const stops = resolvePalette(settings.visualizer, np.coverStops, vizStage.stops);
  for (const tile of tiles) {
    tile.stage.setPalette(stops);
    tile.drawn = false;
  }
}

/** Selected tile always moves; others only while hovered or focused; the rest hold a still frame. */
function stepTiles(dt) {
  if (body.dataset.tab !== 'visualizer') return false;
  let any = false;
  for (const tile of tiles) {
    const live = tile.input.checked || tile.hot;
    if (!live && tile.drawn) continue;
    tile.stage.rest = 0;
    if (live) {
      tile.t += dt;
      synthFrame(tile.frame, tile.t, dt);
      tile.stage.render(tile.frame);
    } else {
      // A still frame: run the style for a moment so trails, rows and particles exist.
      for (let n = 0; n < 50; n++) {
        tile.t += 1 / 30;
        synthFrame(tile.frame, tile.t, 1 / 30);
        tile.stage.render(tile.frame);
      }
    }
    tile.drawn = true;
    any = any || live;
  }
  return any;
}

let tileRaf = 0;
function animateTiles() {
  if (tileRaf || document.hidden) return;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // The live preview loop also steps tiles while it runs.
    if (!loop.running && stepTiles(dt)) tileRaf = requestAnimationFrame(step);
    else tileRaf = 0;
  };
  tileRaf = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- audio: preview, meter, status

const peaks = [{ at: 0, v: -90 }, { at: 0, v: -90 }];
const levelBars = $$('.status__level i');
let silentSince = 0;

const loop = new Loop(audio, (f, dt) => {
  const tab = body.dataset.tab;
  if (tab !== 'clock' && tab !== 'lyrics') vizStage.render(f);
  if (tab === 'visualizer') stepTiles(dt);
  if (tab === 'audio') renderMeter(f);
  if (tab === 'lyrics') {
    renderLyricsPicker();
    renderPlayerLyrics();
  }
  renderLevel(f);
});

const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
function renderMeter(f) {
  const now = performance.now();
  const bars = $$('.meter__bar');
  const dbs = $$('.meter__db');
  [f.dbL, f.dbR].forEach((db, ch) => {
    const v = Number.isFinite(db) ? db : -90;
    const p = peaks[ch];
    if (v >= p.v || now - p.at > 1500) {
      p.v = v;
      p.at = now;
    }
    bars[ch].style.setProperty('--level', `${dbToPct(v).toFixed(1)}%`);
    bars[ch].style.setProperty('--peak', `${Math.min(99, dbToPct(p.v)).toFixed(1)}%`);
    dbs[ch].textContent = v <= -60 ? '-60 dB' : `${Math.round(v)} dB`;
  });
  $('.meter').setAttribute('aria-label', `Input level, left ${Math.round(Math.max(-60, f.dbL || -90))} dB, right ${Math.round(Math.max(-60, f.dbR || -90))} dB`);
}

function renderLevel(f) {
  if (f.silent) {
    if (!silentSince) silentSince = performance.now();
  } else silentSince = 0;
  const k = [0.08, 0.2, 0.42, 0.7];
  levelBars.forEach((bar, i) => {
    const band = f.bands[Math.floor(k[i] * f.bands.length)] || 0;
    bar.style.height = `${Math.max(15, Math.min(100, band * 110)).toFixed(0)}%`;
  });
  renderStatus();
}

// ---------------------------------------------------------------- audio sources

let devices = [];
function sourceLabel(id) {
  if (id === 'system') return 'System audio';
  const d = devices.find((x) => x.id === id);
  return d ? d.label : settings.audio.sourceLabel || 'the input device';
}

async function refreshDevices() {
  devices = await listInputs().catch(() => []);
  renderSources();
}

function renderSources() {
  const list = $('.sources__list');
  const problem = info.audioProblem;
  const items = devices.map((d) => {
    const label = document.createElement('label');
    label.className = 'source';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'audio.source';
    input.value = d.id;
    const name = document.createElement('span');
    name.className = 'source__name';
    name.textContent = d.label;
    name.title = d.label;
    label.append(input, name);
    if (problem && problem.source === d.id) {
      label.dataset.state = 'failed';
      const p = document.createElement('span');
      p.className = 'source__problem problem';
      p.innerHTML = '<span class="mark" aria-hidden="true">!</span><span>Couldn\'t open this device. Using System audio.</span>';
      const retry = document.createElement('button');
      retry.className = 'btn btn--quiet';
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', (e) => {
        e.preventDefault();
        api.app.retrySource();
      });
      p.append(retry);
      label.append(p);
    }
    return label;
  });
  list.replaceChildren(...items);
  if (devices.length) delete $('.sources').dataset.empty;
  else $('.sources').dataset.empty = '';
  const cur = settings.audio.source;
  for (const r of $$('input[name="audio.source"]')) r.checked = r.value === cur;
  $('#meter-source').textContent = sourceLabel(cur);
}

function chooseSource(id) {
  // Picking an input is the consent to open it (7.5).
  api.settings.set({ audio: { source: id, sourceLabel: id === 'system' ? '' : sourceLabel(id) } });
}
navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

// ---------------------------------------------------------------- hotkeys

const HOTKEY_IDS = ['fullscreen', 'arrange', 'toggleWidgets', 'nextStyle'];
const capsOf = (accel) => accel.split('+').map((k) => (k === 'Super' || k === 'Meta' ? 'Win' : k === 'CommandOrControl' ? 'Ctrl' : k));
let capturing = null;

function renderHotkeys() {
  let conflict = false;
  for (const btn of $$('.hotkey[data-setting]')) {
    const id = btn.dataset.setting.split('.')[1];
    const accel = settings.hotkeys[id];
    const row = btn.closest('.hotkey-row');
    const caps = $('.hotkey__caps', btn);
    caps.replaceChildren(...(accel ? capsOf(accel) : []).map((k) => {
      const kbd = document.createElement('kbd');
      kbd.textContent = k;
      return kbd;
    }));
    // kbd elements must be direct children for the mockup's capture rules.
    caps.style.display = 'contents';
    if (capturing === id) btn.dataset.state = 'capturing';
    else if (!accel) btn.dataset.state = 'none';
    else delete btn.dataset.state;
    const state = info.hotkeys && info.hotkeys[id];
    const bad = state === 'conflict' && accel && capturing !== id;
    if (bad) {
      row.dataset.state = 'conflict';
      $('.hotkey-row__msg', row).textContent = `Another app is using ${capsOf(accel).join('+')}. Select it to choose different keys.`;
      conflict = true;
    } else delete row.dataset.state;
  }
  $('#tab-system .mark').hidden = !conflict;
}

const KEY_NAMES = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
};
function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  if (/^Numpad\d$/.test(c)) return `num${c.slice(6)}`;
  return KEY_NAMES[c] || null;
}

function startCapture(id) {
  capturing = id;
  api.app.captureHotkeys(true);
  renderHotkeys();
}

function endCapture(value) {
  const id = capturing;
  capturing = null;
  if (value !== undefined && id) {
    const patch = { [id]: value };
    // Already used by another Undertone action: swap the two.
    if (value) {
      const other = HOTKEY_IDS.find((k) => k !== id && settings.hotkeys[k] === value);
      if (other) patch[other] = settings.hotkeys[id];
    }
    api.settings.set({ hotkeys: patch });
  }
  api.app.captureHotkeys(false);
  renderHotkeys();
}

for (const btn of $$('.hotkey[data-setting]')) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.setting.split('.')[1];
    if (capturing === id) return;
    if (capturing) endCapture();
    startCapture(id);
  });
  btn.addEventListener('blur', () => capturing && endCapture());
}

window.addEventListener('keydown', (e) => {
  if (capturing) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return endCapture();
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return endCapture(null);
    const name = keyName(e);
    if (!name) return; // a modifier on its own: keep waiting
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    if (!mods.length) return; // needs at least one modifier
    endCapture([...mods, name].join('+'));
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#system-reset-confirm').hidden) return cancelReset();
    api.app.hideSettings();
  }
}, true);

// ---------------------------------------------------------------- system: reset, quit

let resetTimer = 0;
function cancelReset() {
  clearTimeout(resetTimer);
  $('#system-reset').hidden = false;
  $('#system-reset-confirm').hidden = true;
}
$('#system-reset').addEventListener('click', () => {
  $('#system-reset').hidden = true;
  $('#system-reset-confirm').hidden = false;
  $('#system-reset-confirm [data-action="reset-cancel"]').focus();
  clearTimeout(resetTimer);
  resetTimer = setTimeout(cancelReset, 6000);
});
$('#system-reset-confirm').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  if (b.dataset.action === 'reset-confirm') api.settings.reset();
  cancelReset();
  $('#system-reset').focus();
});
$('#system-quit').addEventListener('click', () => api.app.quit());

// ---------------------------------------------------------------- status bar

function renderStatus() {
  const f = loop.frame;
  let status;
  if (info.audioProblem) status = 'source-failed';
  else if (info.hidden) status = 'hidden';
  else if (info.covered) status = 'covered';
  else if (audio.status !== 'live' || (silentSince && performance.now() - silentSince > 1500)) status = 'silent';
  else if (!np.track || !np.track.title) status = 'idle';
  else status = 'playing';
  if (body.dataset.status !== status) body.dataset.status = status;
  if (status === 'playing') {
    const t = np.track;
    const el = $('#status-track');
    const key = `${t.title}|${t.artist}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const b = document.createElement('b');
      b.textContent = t.title;
      el.replaceChildren(b, t.artist ? ` by ${t.artist}` : '');
    }
  } else if (status === 'source-failed') {
    const el = $('#status-failed');
    const b = document.createElement('b');
    b.textContent = `Couldn't open ${info.audioProblem.label || 'the input device'}.`;
    el.replaceChildren(b, ' Using System audio.');
  } else if (status === 'silent') {
    $('#status-silent').textContent = `Silent. Nothing is coming through ${sourceLabel(settings.audio.source)}.`;
  }
  void f;
}

$('.statusbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  switch (b.dataset.action) {
    case 'arrange': return api.app.arrange();
    case 'fullscreen': return api.app.toggleFullscreen();
    case 'open-audio': return selectTab('audio');
    case 'show-widgets': return api.app.setHidden(false);
    default:
  }
});

// ---------------------------------------------------------------- face tiles show the real time

function renderFaceTiles() {
  const d = new Date();
  const h24 = !!settings.clock.hour24;
  const t = timeParts(d, { h24 });
  const date = dateText(d, 'short', info.locale);
  const tile = (v) => $(`.face-tile input[value="${v}"]`).parentElement;
  $('.mini-digital b', tile('digital')).textContent = `${t.hh}:${t.mm}`;
  $('.mini-digital i', tile('digital')).textContent = date;
  const st = $$('.mini-stacked b', tile('stacked'));
  st[0].textContent = t.hh;
  st[1].textContent = t.mm;
  $('.mini-minimal', tile('minimal')).textContent = `${t.hh} ${t.mm}`;
  const w = timeInWords(d);
  const words = $('.mini-words', tile('words'));
  words.replaceChildren(w[0], ...(w[1] ? [document.createElement('br'), w[1]] : []));
  $('.mini-line b', tile('line')).textContent = `${t.hh}:${t.mm}`;
  const frac = (d.getHours() * 60 + d.getMinutes()) / 1440;
  $('.mini-line b', tile('line')).style.marginLeft = `${Math.max(0, Math.min(80, frac * 112 - 16))}px`;
  const svg = $('svg', tile('analog'));
  const paths = $$('path', svg);
  const m = d.getMinutes(), hh = (d.getHours() % 12) + m / 60;
  const hand = (len, deg) => `M0 0L${(Math.sin((deg * Math.PI) / 180) * len).toFixed(1)} ${(-Math.cos((deg * Math.PI) / 180) * len).toFixed(1)}`;
  paths[1].setAttribute('d', hand(15.3, hh * 30));
  paths[2].setAttribute('d', hand(25, m * 6));
}
setInterval(renderFaceTiles, 15000);

// ---------------------------------------------------------------- wiring

function applySettings(s) {
  settings = s;
  audio.configure({ sensitivity: s.audio.sensitivity, smoothing: s.audio.smoothing, source: s.audio.source });
  loop.setCap(s.system.fpsCap);
  renderControls();
  renderPreview();
  tilePalette();
  for (const tile of tiles) tile.stage.setDensity(s.visualizer.density);
  renderSources();
  renderLyricsPicker(true);
  renderPlayerLyrics(true);
  renderFaceTiles();
  animateTiles();
}

np.addEventListener('track', () => {
  renderPreviewTrack();
  renderLyricsPicker(true);
  renderPlayerPreview();
  renderControls();
});
np.addEventListener('state', () => renderLyricsPicker());
np.addEventListener('cover', () => {
  renderPreviewTrack();
  renderSwatches();
  if (settings.visualizer.theme === 'cover' && np.coverStops) palette(800);
  tilePalette();
  renderPlayerPreview();
  if (body.dataset.tab === 'clock') renderPreview();
  animateTiles();
});
np.addEventListener('lyrics', () => {
  renderLyricsPicker(true);
  renderPlayerLyrics(true);
});

api.app.onInfo((i) => {
  const hotkeysChanged = JSON.stringify(i.hotkeys) !== JSON.stringify(info.hotkeys);
  const problemChanged = JSON.stringify(i.audioProblem) !== JSON.stringify(info.audioProblem);
  const toneChanged = i.tone !== info.tone;
  info = i;
  if (hotkeysChanged) renderHotkeys();
  if (problemChanged) renderSources();
  if (toneChanged && picture) {
    picture.tone = i.tone;
    renderPreview();
  }
  renderStatus();
});
api.app.onOpen((o) => {
  selectTab(o && o.tab ? o.tab : 'visualizer');
  loadWallpaper();
});
api.app.onWallpaper(loadWallpaper);

async function loadWallpaper() {
  try {
    picture = await api.app.wallpaper();
  } catch {
    picture = null;
  }
  renderPreview();
}

// Only listen and draw while the window is showing.
async function visibility() {
  if (document.hidden) {
    loop.pause();
    clockFace.stop();
    if (capturing) endCapture();
  } else {
    if (audio.status === 'idle') await audio.start();
    loop.start();
    renderPreview();
    animateTiles();
  }
}
document.addEventListener('visibilitychange', visibility);

$('#system-version').textContent = info.version;
await np.init();
started = true;
applySettings(settings);
await loadWallpaper();
await refreshDevices();
selectTab(body.dataset.tab);
if (!document.hidden) visibility();
