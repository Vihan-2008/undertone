'use strict';
// Synced lyrics from lrclib.net (free, no key). Only the song title, artist,
// album and length are sent. Results are cached on disk so a song is looked
// up once.

const { net } = require('electron');
const fs = require('fs');
const path = require('path');

const API = 'https://lrclib.net/api';
const MAX_CACHE = 400;

class Lyrics {
  constructor(dir, version) {
    this.file = path.join(dir, 'lyrics-cache.json');
    this.ua = `Undertone/${version} (desktop music visualizer)`;
    this.cache = new Map();
    this.inflight = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of raw) this.cache.set(k, v);
    } catch {}
    this.saveTimer = null;
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const entries = [...this.cache.entries()].slice(-MAX_CACHE);
      fs.promises.writeFile(this.file, JSON.stringify(entries)).catch(() => {});
    }, 2000);
  }

  /** Returns { status: 'found'|'none'|'error', synced, lines: [{t, text}], plain } */
  async get(track, duration) {
    const q = cleanQuery(track);
    if (!q.title) return { status: 'none', synced: false, lines: [] };
    const key = `${q.artist}|${q.title}`.toLowerCase();
    if (this.cache.has(key)) {
      const v = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, v);
      return v;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this.lookup(q, duration).then((res) => {
      this.inflight.delete(key);
      if (res.status !== 'error') {
        this.cache.set(key, res);
        this.save();
      }
      return res;
    });
    this.inflight.set(key, p);
    return p;
  }

  async lookup(q, duration) {
    try {
      const params = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
      if (q.album) params.set('album_name', q.album);
      if (duration > 0) params.set('duration', String(Math.round(duration)));
      let rec = await this.fetchJson(`${API}/get?${params}`);
      if (!rec || (!rec.syncedLyrics && !rec.plainLyrics && !rec.instrumental)) {
        const s = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
        const list = (await this.fetchJson(`${API}/search?${s}`)) || [];
        const near = (r) => !(duration > 0) || !r.duration || Math.abs(r.duration - duration) < 8;
        rec = list.find((r) => r.syncedLyrics && near(r)) || list.find((r) => r.plainLyrics && near(r)) || rec;
      }
      if (!rec) return { status: 'none', synced: false, lines: [] };
      if (rec.instrumental) return { status: 'none', instrumental: true, synced: false, lines: [] };
      if (rec.syncedLyrics) return { status: 'found', synced: true, lines: parseLrc(rec.syncedLyrics) };
      if (rec.plainLyrics) {
        return { status: 'found', synced: false, lines: rec.plainLyrics.split(/\r?\n/).map((text) => ({ t: -1, text })) };
      }
      return { status: 'none', synced: false, lines: [] };
    } catch (e) {
      return { status: 'error', message: String(e.message || e), synced: false, lines: [] };
    }
  }

  async fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': this.ua, Accept: 'application/json' }, signal: ctrl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`lrclib ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseLrc(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: line });
  }
  return out.sort((a, b) => a.t - b.t);
}

const NOISE = /\s*[([](official|lyric|lyrics|audio|video|visualizer|visualiser|hd|hq|4k|mv|m\/v|explicit|clean|remaster(ed)?|live|color coded)[^)\]]*[)\]]/gi;

/** Media sessions from browsers carry YouTube-style titles; tidy them up. */
function cleanQuery(track) {
  let title = String(track.title || '').trim();
  let artist = String(track.artist || '').trim();
  const album = String(track.album || '').trim();
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  title = title.replace(NOISE, '').replace(/\s+-\s+(\d{4}\s+)?remaster(ed)?.*$/i, '').trim();
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && (!artist || dash[1].toLowerCase().includes(artist.toLowerCase()) || artist.toLowerCase().includes(dash[1].toLowerCase()) || /youtube|browser|chrome|edge|firefox/i.test(track.app || ''))) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }
  title = title.replace(/\s*[([]\s*(feat|ft)\.?[^)\]]*[)\]]/i, '').trim();
  return { title, artist, album };
}

module.exports = { Lyrics, parseLrc, cleanQuery };
