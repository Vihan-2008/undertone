// Full-screen player (DESIGN.md 6).
import { AudioTap } from '../shared/audio.js';
import { Stage, Loop } from '../shared/stage.js';
import { resolvePalette, THEME_NAMES } from '../shared/palette.js';
import { STYLES } from '../shared/visualizers.js';
import { NowPlaying } from '../shared/nowplaying.js';

const api = window.undertone;
const $ = (s) => document.querySelector(s);
const body = document.body;
const COLOUR_ORDER = ['cover', 'ember', 'paper', 'tide', 'moss', 'sodium', 'prism', 'custom'];

const audio = new AudioTap();
const np = new NowPlaying();
let settings = await api.settings.get();
let started = false;
api.settings.onChange((s) => (started ? applySettings(s) : (settings = s)));
let showLyrics = true; // L toggles this for the session
let lyricKey = null;
let current = -2;
let noneTimer = 0;
let lastMid = null;

const stage = new Stage($('.player__viz'), {
  style: settings.fullscreen.style,
  glow: settings.visualizer.glow,
  density: settings.visualizer.density,
  feather: false,
});
const loop = new Loop(audio, (f) => {
  stage.render(f);
  frame();
});

// ---------------------------------------------------------------- palette and style

function vis() {
  // The player's own style and colours, with the widget's custom accent.
  return { ...settings.visualizer, style: settings.fullscreen.style, theme: settings.fullscreen.theme };
}

function palette(fadeMs) {
  stage.setPalette(resolvePalette(vis(), np.coverStops, stage.stops), fadeMs);
  lastMid = stage.fade ? stage.fade.to[1] : stage.stops[1];
  body.style.setProperty('--wash', lastMid);
}

function applySettings(s) {
  settings = s;
  stage.setStyle(s.fullscreen.style);
  stage.setGlow(s.visualizer.glow);
  stage.setDensity(s.visualizer.density);
  palette(0);
  body.dataset.lyricsize = s.lyrics.size;
  audio.configure({ sensitivity: s.audio.sensitivity, smoothing: s.audio.smoothing, source: s.audio.source });
  loop.setCap(s.system.fpsCap);
  renderLyricsState();
}

// ---------------------------------------------------------------- track

function renderTrack() {
  const t = np.track;
  const nothing = !t || !t.title;
  body.dataset.track = nothing ? 'nothing' : '';
  $('.player__title').textContent = nothing ? 'Nothing playing' : t.title;
  $('.player__artist').textContent = nothing ? 'Start a track in any player and it shows up here.' : t.artist || '';
  document.title = nothing ? 'Undertone' : `${t.title} - Undertone`;
  renderPlayback();
  renderLyricsState();
}

function renderPlayback() {
  const paused = !np.playing;
  body.dataset.playback = paused ? 'paused' : '';
  $('.transport__play').setAttribute('aria-label', paused ? 'Play' : 'Pause');
  stage.setResting(paused);
}

function renderCover() {
  const img = $('.player__cover');
  if (np.cover) {
    img.src = np.cover;
    body.dataset.cover = '';
    $('.player__light').style.setProperty('--light-image', `url("${np.cover}")`);
  } else {
    img.removeAttribute('src');
    body.dataset.cover = 'none';
    $('.player__light').style.removeProperty('--light-image');
  }
  if (settings.fullscreen.theme === 'cover' && np.coverStops) palette(800);
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

let lastProgress = '';
function renderProgress() {
  const tl = np.timeline;
  const prog = $('.progress');
  if (!tl || !(tl.duration > 0)) {
    prog.style.visibility = 'hidden';
    return;
  }
  prog.style.visibility = '';
  const p = np.position();
  const key = `${Math.floor(p)}|${Math.floor(tl.duration)}`;
  const bar = $('.progress__bar');
  bar.style.setProperty('--at', `${((p / tl.duration) * 100).toFixed(2)}%`);
  if (key === lastProgress) return;
  lastProgress = key;
  $('.progress__at').textContent = fmt(p);
  $('.progress__total').textContent = fmt(tl.duration);
  bar.setAttribute('aria-valuemax', String(Math.round(tl.duration)));
  bar.setAttribute('aria-valuenow', String(Math.round(p)));
}

// ---------------------------------------------------------------- lyrics

function lyricOffset() {
  const t = np.track;
  const per = t && settings.lyrics.trackOffsets ? settings.lyrics.trackOffsets[t.key] : undefined;
  return (per != null ? per : settings.lyrics.offset) / 1000;
}

function renderLyricsState() {
  clearTimeout(noneTimer);
  const nothing = body.dataset.track === 'nothing';
  const L = np.lyrics || { status: 'idle' };
  let state;
  if (nothing || !settings.lyrics.enabled || !showLyrics) state = 'off';
  else if (L.status === 'ready' && L.lines && L.lines.length) state = 'ready';
  else if (L.status === 'loading' || L.status === 'idle') state = 'loading';
  else state = 'none';
  if (state === 'none') {
    // Say so for 4 s, then the column fades and the cover moves to the centre.
    if (body.dataset.lyrics !== 'none' && body.dataset.lyrics !== 'off') {
      body.dataset.lyrics = 'none';
      noneTimer = setTimeout(() => (body.dataset.lyrics = 'off'), 4000);
    } else if (body.dataset.lyrics !== 'off') {
      noneTimer = setTimeout(() => (body.dataset.lyrics = 'off'), 4000);
    }
    return;
  }
  body.dataset.lyrics = state;
  if (state === 'ready') buildLyrics();
}

function buildLyrics() {
  const L = np.lyrics;
  const key = `${np.track && np.track.key}|${L.lines.length}|${L.lines[0] && L.lines[0].t}`;
  if (key === lyricKey) return;
  lyricKey = key;
  current = -2;
  const ol = $('.lyrics__track');
  ol.replaceChildren(...L.lines.map((ln) => {
    const li = document.createElement('li');
    li.className = 'lyrics__line';
    li.textContent = ln.text || '♪';
    return li;
  }));
  ol.style.setProperty('--shift', '0px');
}

function advanceLyrics() {
  if (body.dataset.lyrics !== 'ready') return;
  const L = np.lyrics;
  const i = np.lyricIndex(lyricOffset());
  const lines = $('.lyrics__track').children;
  const cur = lines[Math.max(0, i)];
  if (i !== current) {
    current = i;
    for (let k = 0; k < lines.length; k++) {
      const at = k - i;
      if (i >= 0 && at >= -1 && at <= 3) lines[k].dataset.at = String(at);
      else if (i < 0 && k <= 3) lines[k].dataset.at = String(k + 1);
      else delete lines[k].dataset.at;
      lines[k].classList.remove('is-gap');
      if (k === i) lines[k].setAttribute('aria-current', 'true');
      else lines[k].removeAttribute('aria-current');
    }
    // Pin the current line's top at 32 vh once the sizes have settled.
    if (cur) requestAnimationFrame(() => shiftTo(i < 0 ? 0 : targetTop(lines, i)));
  }
  // An instrumental gap: once a line has been current for 8 s it drops to 0.52 until the next starts.
  if (i >= 0 && lines[i]) {
    const since = np.position() + lyricOffset() - L.lines[i].t;
    lines[i].classList.toggle('is-gap', since > 8);
  }
}

/** Where line i's top will be once the transition ends (sizes are known from the vars). */
function targetTop(lines, i) {
  const vh = window.innerHeight / 100;
  const size = getComputedStyle(body);
  const rest = parseFloat(size.getPropertyValue('--lyric-rest')) || 2.8;
  let y = 0;
  for (let k = 0; k < i; k++) {
    // Measure each earlier line's height at the resting size: its wrapped line count stays
    // the same, so scale the current height by the target font size.
    const el = lines[k];
    const fs = parseFloat(getComputedStyle(el).fontSize) || rest * vh;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || fs * 1.22;
    const rows = Math.max(1, Math.round(el.offsetHeight / lh));
    y += rows * rest * vh * 1.22 + 2.4 * vh;
  }
  return y;
}

function shiftTo(px) {
  $('.lyrics__track').style.setProperty('--shift', `${px}px`);
}

// ---------------------------------------------------------------- per-frame

function frame() {
  renderProgress();
  advanceLyrics();
}

// Progress and lyrics keep moving while the visualizer loop is idle (paused): tick slowly too.
setInterval(() => {
  if (!loop.running) frame();
}, 250);

// ---------------------------------------------------------------- chrome fade, toast, keys

let idleTimer = 0;
function wake() {
  body.dataset.controls = '';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => (body.dataset.controls = 'hidden'), 2500);
}
window.addEventListener('mousemove', wake);
window.addEventListener('pointerdown', wake);

let toastTimer = 0;
function toast(text) {
  $('.toast').textContent = text;
  body.dataset.toast = 'on';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (body.dataset.toast = ''), 1700);
}

const styleName = (id) => (STYLES.find((s) => s.id === id) || { name: id }).name;

function cycleStyle() {
  const ids = STYLES.map((s) => s.id);
  const next = ids[(ids.indexOf(settings.fullscreen.style) + 1) % ids.length];
  api.settings.set({ fullscreen: { style: next } });
  toast(`Visualizer: ${styleName(next)}`);
}

function cycleColours() {
  const next = COLOUR_ORDER[(COLOUR_ORDER.indexOf(settings.fullscreen.theme) + 1) % COLOUR_ORDER.length];
  api.settings.set({ fullscreen: { theme: next } });
  toast(`Colours: ${THEME_NAMES[next]}`);
}

function toggleLyrics() {
  if (!settings.lyrics.enabled) {
    toast('Lyrics are off in settings');
    return;
  }
  showLyrics = !showLyrics;
  toast(showLyrics ? 'Lyrics on' : 'Lyrics off');
  renderLyricsState();
}

let leaving = false;
function leave() {
  if (leaving) return;
  leaving = true;
  api.app.closeFullscreen();
}

window.addEventListener('keydown', (e) => {
  wake();
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (body.dataset.track !== 'nothing') api.media.command('toggle');
      break;
    case 'ArrowLeft':
      api.media.command('prev');
      break;
    case 'ArrowRight':
      api.media.command('next');
      break;
    case 'v': case 'V':
      cycleStyle();
      break;
    case 'c': case 'C':
      cycleColours();
      break;
    case 'l': case 'L':
      toggleLyrics();
      break;
    case 'Escape':
      leave();
      break;
    default:
      return;
  }
});

$('.transport').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  api.media.command({ prev: 'prev', next: 'next', 'play-pause': 'toggle' }[b.dataset.action]);
});

// ---------------------------------------------------------------- wiring

np.addEventListener('track', () => {
  lyricKey = null;
  renderTrack();
});
np.addEventListener('state', renderPlayback);
np.addEventListener('cover', renderCover);
np.addEventListener('lyrics', renderLyricsState);
await np.init();
started = true;
applySettings(settings);
renderTrack();
renderCover();
await audio.start();
loop.start();
wake();
