// The visualizer widget on the wallpaper (DESIGN.md 2 and 3).
import { AudioTap } from '../shared/audio.js';
import { Stage, Loop } from '../shared/stage.js';
import { resolvePalette } from '../shared/palette.js';
import { NowPlaying } from '../shared/nowplaying.js';

const api = window.undertone;
const $ = (s) => document.querySelector(s);
const body = document.body;
const widgetEl = $('.widget');
const npEl = $('.np');

const audio = new AudioTap();
const np = new NowPlaying();
let settings = await api.settings.get();
let started = false;
api.settings.onChange((s) => (started ? applySettings(s) : (settings = s)));
let run = { covered: false, paused: false };
let tone = 'paper';
let shownKey = null;

const stage = new Stage($('.viz'), {
  style: settings.visualizer.style,
  glow: settings.visualizer.glow,
  density: settings.visualizer.density,
});
const loop = new Loop(audio, (f) => stage.render(f));

// ---------------------------------------------------------------- settings

function palette(fadeMs) {
  stage.setPalette(resolvePalette(settings.visualizer, np.coverStops, stage.stops), fadeMs);
}

function applySettings(s) {
  settings = s;
  const v = s.visualizer;
  stage.setStyle(v.style);
  stage.setDensity(v.density);
  stage.setGlow(v.glow);
  palette(0);
  const backdrop = v.backdrop > 0;
  body.dataset.backdrop = backdrop ? 'on' : '';
  stage.setFeather(!backdrop);
  $('.widget__backdrop').style.opacity = String((v.backdrop / 100) * 0.92);
  widgetEl.style.opacity = String(Math.max(20, v.opacity) / 100);
  audio.configure({ sensitivity: s.audio.sensitivity, smoothing: s.audio.smoothing, source: s.audio.source });
  loop.setCap(s.system.fpsCap);
  layout();
  albumGlow();
}

/** The layout actually used at this size (3.1: cover needs 320 px, the line needs 120 px of height). */
function layout() {
  const r = widgetEl.getBoundingClientRect();
  let l = settings.nowPlaying.layout;
  if (r.height < 120) l = 'off';
  else if (l === 'cover' && r.width < 320) l = 'compact';
  if (body.dataset.np !== l) body.dataset.np = l;
}
new ResizeObserver(layout).observe(widgetEl);

function albumGlow() {
  const on = settings.visualizer.albumGlow && np.cover && np.coverStops;
  body.dataset.albumglow = on ? 'on' : '';
  if (on) widgetEl.style.setProperty('--glow-colour', np.coverStops[1]);
}

// ---------------------------------------------------------------- now playing line

function trackShown() {
  const t = np.track;
  if (!t || !t.title) return null;
  const st = np.timeline && np.timeline.status;
  if (st === 'Stopped' || st === 'Closed') return null;
  return t;
}

function fillLine(el, t) {
  el.querySelector('.np__title').textContent = t.title;
  el.querySelector('.np__artist').textContent = t.artist || '';
  const img = el.querySelector('.np__cover');
  if (np.cover) img.src = np.cover;
  else img.removeAttribute('src');
  el.dataset.tone = tone;
}

/** Cross-fade the line to the current track (200 ms). */
function renderLine() {
  const t = trackShown();
  const key = t ? `${t.title}\u0000${t.artist}` : null;
  if (key === shownKey) {
    if (t) fillLine(npEl, t);
    return;
  }
  const had = shownKey !== null && !npEl.hidden;
  shownKey = key;
  if (had) {
    const old = npEl.cloneNode(true);
    old.classList.add('np--leaving');
    old.removeAttribute('hidden');
    widgetEl.append(old);
    requestAnimationFrame(() => {
      old.style.opacity = '0';
      setTimeout(() => old.remove(), 220);
    });
  }
  if (!t) {
    npEl.hidden = true;
    return;
  }
  fillLine(npEl, t);
  npEl.hidden = false;
  npEl.classList.add('is-entering');
  requestAnimationFrame(() => requestAnimationFrame(() => npEl.classList.remove('is-entering')));
}

function renderCover() {
  const img = npEl.querySelector('.np__cover');
  if (np.cover) img.src = np.cover;
  else img.removeAttribute('src');
  // No cover: keep the palette that was showing (2.2).
  if (settings.visualizer.theme === 'cover' && np.coverStops) palette(800);
  albumGlow();
}

// ---------------------------------------------------------------- running state

function applyRun() {
  if (run.covered) {
    // Drawing stops; the last frame stays.
    loop.pause();
    return;
  }
  if (run.paused) {
    stage.setResting(true);
    loop.start();
    clearTimeout(applyRun.t);
    applyRun.t = setTimeout(() => run.paused && loop.pause(), 700);
    return;
  }
  clearTimeout(applyRun.t);
  stage.setResting(false);
  loop.start();
}

// ---------------------------------------------------------------- wiring

np.addEventListener('track', renderLine);
np.addEventListener('state', renderLine);
np.addEventListener('cover', renderCover);
await np.init();
started = true;
applySettings(settings);
renderLine();
renderCover();

api.widget.onRun((r) => {
  run = r;
  applyRun();
});
api.widget.onTone((t) => {
  tone = t;
  npEl.dataset.tone = t;
});

audio.onStatus((st, err) => {
  if (st === 'failed' && audio.source !== 'system') {
    api.app.audioFailed({ source: audio.source, label: settings.audio.sourceLabel, error: err });
  }
});
await audio.start();
applyRun();
