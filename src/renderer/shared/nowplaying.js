// What's playing, as seen from a renderer: track, timeline, cover, cover
// palette and lyrics, kept in sync with the main process.
import { coverStops } from './palette.js';

export class NowPlaying extends EventTarget {
  constructor() {
    super();
    this.available = false;
    this.track = null;
    this.timeline = null;
    this.cover = null;
    this.coverImg = null;
    this.coverStops = null;
    this.lyrics = { status: 'idle', lines: [], synced: false };
  }

  async init() {
    const api = window.undertone.media;
    const s = await api.get();
    this.applyState(s);
    this.setCover(s.cover);
    this.lyrics = s.lyrics || this.lyrics;
    api.onState((st) => this.applyState(st));
    api.onCover((c) => this.setCover(c));
    api.onLyrics((l) => {
      this.lyrics = l;
      this.emit('lyrics');
    });
    this.emit('track');
    this.emit('lyrics');
    return this;
  }

  emit(type) {
    this.dispatchEvent(new Event(type));
  }

  applyState(st) {
    const prevKey = this.track && this.track.key;
    this.available = st.available;
    this.track = st.track;
    this.timeline = st.timeline;
    if ((this.track && this.track.key) !== prevKey) this.emit('track');
    this.emit('state');
  }

  setCover(dataUrl) {
    this.cover = dataUrl;
    if (!dataUrl) {
      this.coverImg = null;
      this.coverStops = null;
      this.emit('cover');
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (this.cover !== dataUrl) return;
      this.coverImg = img;
      try {
        this.coverStops = coverStops(img);
      } catch {
        this.coverStops = null;
      }
      this.emit('cover');
    };
    img.src = dataUrl;
  }

  get playing() {
    return !!(this.timeline && this.timeline.status === 'Playing');
  }

  /** Current playback position in seconds, extrapolated between updates. */
  position() {
    const tl = this.timeline;
    if (!tl) return 0;
    let p = tl.position;
    if (tl.status === 'Playing') p += (Date.now() - tl.updatedAt) / 1000;
    return tl.duration > 0 ? Math.min(p, tl.duration) : p;
  }

  /** Index of the current synced lyric line, or -1. */
  lyricIndex(offset = 0) {
    const L = this.lyrics;
    if (!L || L.status !== 'ready' || !L.lines.length) return -1;
    const t = this.position() + offset;
    let lo = 0, hi = L.lines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (L.lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
}
