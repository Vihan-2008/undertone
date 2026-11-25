// The desktop clock window (DESIGN.md 5).
import { ClockFace } from '../shared/clockface.js';
import { resolvePalette } from '../shared/palette.js';
import { NowPlaying } from '../shared/nowplaying.js';

const api = window.undertone;
const root = document.querySelector('.clock');
let settings = await api.settings.get();
let started = false;
api.settings.onChange((s) => {
  settings = s;
  if (started) apply();
});
let locale = (await api.app.info()).locale;
let lastStops = null;
const np = new NowPlaying();
const face = new ClockFace(root, { onSize: (w, h) => api.widget.reportSize(w, h) });

function apply() {
  lastStops = resolvePalette(settings.visualizer, np.coverStops, lastStops);
  face.set(settings.clock, { stops: lastStops, locale });
}

api.widget.onAlign((a) => {
  root.dataset.align = a;
});
api.app.onInfo((info) => {
  if (info.locale && info.locale !== locale) {
    locale = info.locale;
    apply();
  }
});
np.addEventListener('cover', () => root.dataset.fill === 'match' && apply());
await np.init();
started = true;
apply();

// Resync after sleep or a system clock change.
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  if (Math.abs(now - last - 30000) > 2000) face.schedule();
  last = now;
}, 30000);
