// Audio capture and analysis shared by every window that draws.
//
// 'system' uses Chromium's WASAPI loopback of the default output device (the
// main process answers getDisplayMedia with { audio: 'loopback' }). Any other
// source value is an input deviceId the user picked themselves. Nothing here
// ever falls back to a microphone on its own.

export const BANDS = 128;
const F_MIN = 32;
const F_MAX = 16000;
const FFT = 2048;

export function createFrame() {
  return {
    bands: new Float32Array(BANDS), // smoothed 0..1, log-spaced low -> high
    peaks: new Float32Array(BANDS), // falling caps
    raw: new Float32Array(BANDS), // unsmoothed 0..1
    wave: new Float32Array(FFT), // time domain -1..1
    level: 0, // overall loudness 0..1
    dbL: -90, // channel RMS in dBFS
    dbR: -90,
    left: 0,
    right: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0, // 1 on a kick, decays to 0
    beatCount: 0,
    silent: true,
    time: 0,
    dt: 1 / 60,
  };
}

export class AudioTap {
  constructor() {
    this.status = 'idle'; // idle | starting | live | failed
    this.error = '';
    this.listeners = new Set();
    this.sensitivity = 1;
    this.smoothing = 0.55;
    this.source = 'system';
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.splitL = null;
    this.splitR = null;
    this.db = new Float32Array(FFT / 2);
    this.tdL = new Float32Array(1024);
    this.tdR = new Float32Array(1024);
    this.agc = -40;
    this.bassAvg = 0;
    this.lastBeat = 0;
    this.quietFor = 0;
    this.restartTimer = null;
    this.gen = 0;
    this.buildBandMap(48000);
  }

  onStatus(cb) {
    this.listeners.add(cb);
    cb(this.status, this.error);
    return () => this.listeners.delete(cb);
  }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    for (const cb of this.listeners) cb(status, error);
  }

  /** sensitivity 0..200 (%), smoothing 0..100, source 'system' or a device id. */
  configure({ sensitivity, smoothing, source }) {
    if (sensitivity != null) this.sensitivity = Math.max(0.05, sensitivity / 100);
    if (smoothing != null) this.smoothing = Math.min(1, Math.max(0, smoothing / 100));
    if (source != null && source !== this.source) {
      this.source = source;
      if (this.status !== 'idle') this.start();
    }
  }

  buildBandMap(sampleRate) {
    this.sampleRate = sampleRate;
    const binHz = sampleRate / FFT;
    this.bandLo = new Float32Array(BANDS);
    this.bandHi = new Float32Array(BANDS);
    this.bandTilt = new Float32Array(BANDS);
    this.bandFreq = new Float32Array(BANDS);
    const ratio = F_MAX / F_MIN;
    for (let i = 0; i < BANDS; i++) {
      const lo = F_MIN * ratio ** (i / BANDS);
      const hi = F_MIN * ratio ** ((i + 1) / BANDS);
      this.bandLo[i] = lo / binHz;
      this.bandHi[i] = hi / binHz;
      const fc = Math.sqrt(lo * hi);
      this.bandFreq[i] = fc;
      // Music falls off ~3-4 dB per octave; tilt it back so highs move too.
      this.bandTilt[i] = 3.2 * Math.log2(fc / 400);
    }
  }

  async start() {
    const gen = ++this.gen;
    clearTimeout(this.restartTimer);
    this.teardown();
    this.setStatus('starting');
    try {
      let stream;
      if (this.source === 'system') {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) throw new Error('System audio is not available on this device.');
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: this.source }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      if (gen !== this.gen) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.buildBandMap(ctx.sampleRate);
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = FFT;
      an.smoothingTimeConstant = 0;
      an.minDecibels = -120;
      an.maxDecibels = 0;
      src.connect(an);
      const split = ctx.createChannelSplitter(2);
      src.connect(split);
      this.splitL = ctx.createAnalyser();
      this.splitR = ctx.createAnalyser();
      this.splitL.fftSize = this.splitR.fftSize = 1024;
      split.connect(this.splitL, 0);
      split.connect(this.splitR, 1);
      this.analyser = an;
      for (const t of stream.getAudioTracks()) {
        t.addEventListener('ended', () => this.scheduleRestart(), { once: true });
      }
      this.setStatus('live');
    } catch (e) {
      if (gen !== this.gen) return;
      const msg = e && e.name === 'OverconstrainedError' ? 'That input device is no longer connected.' : (e && e.message) || String(e);
      this.setStatus('failed', msg);
      // A chosen input that fails is reported; the app falls back to System audio.
      if (this.source === 'system') this.scheduleRestart(5000);
    }
  }

  scheduleRestart(delay = 1200) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.status !== 'idle' && this.start(), delay);
  }

  teardown() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
  }

  stop() {
    this.gen++;
    clearTimeout(this.restartTimer);
    this.teardown();
    this.setStatus('idle');
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** Fill `f` with the latest analysis. dt in seconds. */
  read(f, dt) {
    f.dt = dt;
    f.time += dt;
    const an = this.analyser;
    if (!an) {
      this.decay(f, dt);
      return f;
    }
    an.getFloatFrequencyData(this.db);
    an.getFloatTimeDomainData(f.wave);

    // Loudness and stereo levels
    let sum = 0;
    for (let i = 0; i < f.wave.length; i++) sum += f.wave[i] * f.wave[i];
    const rms = Math.sqrt(sum / f.wave.length);
    this.splitL.getFloatTimeDomainData(this.tdL);
    this.splitR.getFloatTimeDomainData(this.tdR);
    let sl = 0, sr = 0;
    for (let i = 0; i < 1024; i++) { sl += this.tdL[i] * this.tdL[i]; sr += this.tdR[i] * this.tdR[i]; }
    f.dbL = 20 * Math.log10(Math.sqrt(sl / 1024) + 1e-9);
    f.dbR = 20 * Math.log10(Math.sqrt(sr / 1024) + 1e-9);
    const toMeter = (r) => Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(r / 1024) + 1e-9) + 54) / 54));
    const lt = toMeter(sl), rt = toMeter(sr);
    f.left += (lt - f.left) * (lt > f.left ? 0.6 : Math.min(1, dt * 5));
    f.right += (rt - f.right) * (rt > f.right ? 0.6 : Math.min(1, dt * 5));

    this.quietFor = rms < 0.0004 ? this.quietFor + dt : 0;
    f.silent = this.quietFor > 1.5;

    // Bands: loudest bin in each log-spaced range, tilt-corrected.
    let frameMax = -200;
    const db = this.db;
    for (let i = 0; i < BANDS; i++) {
      const lo = this.bandLo[i], hi = this.bandHi[i];
      let v = -200;
      const a = Math.ceil(lo), b = Math.floor(hi);
      if (b >= a) {
        for (let k = a; k <= b && k < db.length; k++) if (db[k] > v) v = db[k];
      } else {
        // Band narrower than a bin: interpolate at its centre.
        const c = (lo + hi) / 2;
        const k = Math.floor(c), t = c - k;
        v = (db[k] ?? -200) * (1 - t) + (db[k + 1] ?? -200) * t;
      }
      v += this.bandTilt[i];
      this.tmp = this.tmp || new Float32Array(BANDS);
      this.tmp[i] = v;
      if (v > frameMax) frameMax = v;
    }
    // Automatic gain: follow the loudest band up instantly, ease down slowly,
    // and never amplify near-silence into noise.
    if (frameMax > this.agc) this.agc += (frameMax - this.agc) * 0.5;
    else this.agc -= Math.min(this.agc - frameMax, 9 * dt);
    this.agc = Math.max(this.agc, -62);
    const range = 46 / Math.sqrt(this.sensitivity);
    const floor = this.agc - range;
    const curve = 1.35 / this.sensitivity ** 0.35;
    const release = Math.min(1, dt * (2 + (1 - this.smoothing) * 22));
    const attack = Math.min(1, dt * (40 - this.smoothing * 22));
    const fall = dt * 0.55;
    for (let i = 0; i < BANDS; i++) {
      let v = (this.tmp[i] - floor) / range;
      v = v <= 0 ? 0 : v >= 1 ? 1 : v ** curve;
      if (f.silent) v = 0;
      f.raw[i] = v;
      const cur = f.bands[i];
      f.bands[i] = cur + (v - cur) * (v > cur ? attack : release);
      f.peaks[i] = Math.max(f.peaks[i] - fall, f.bands[i]);
    }

    const avg = (from, to) => {
      let s = 0, n = 0;
      for (let i = 0; i < BANDS; i++) {
        const fc = this.bandFreq[i];
        if (fc >= from && fc < to) { s += f.bands[i]; n++; }
      }
      return n ? s / n : 0;
    };
    const bassRaw = (() => {
      let s = 0, n = 0;
      for (let i = 0; i < BANDS; i++) if (this.bandFreq[i] < 140) { s += f.raw[i]; n++; }
      return n ? s / n : 0;
    })();
    f.bass = avg(0, 250);
    f.mid = avg(250, 4000);
    f.treble = avg(4000, 20000);
    f.level += ((f.silent ? 0 : Math.min(1, (f.bass + f.mid + f.treble) / 1.6)) - f.level) * Math.min(1, dt * 12);

    // Kick detection on the raw low end against its own running average.
    this.bassAvg += (bassRaw - this.bassAvg) * Math.min(1, dt * 2.5);
    const now = f.time;
    if (!f.silent && bassRaw > this.bassAvg * 1.28 + 0.06 && now - this.lastBeat > 0.22) {
      this.lastBeat = now;
      f.beat = Math.min(1, 0.55 + (bassRaw - this.bassAvg) * 2);
      f.beatCount++;
    } else {
      f.beat *= Math.exp(-dt / 0.22);
    }
    return f;
  }

  decay(f, dt) {
    const k = Math.exp(-dt * 6);
    for (let i = 0; i < BANDS; i++) {
      f.bands[i] *= k;
      f.raw[i] = 0;
      f.peaks[i] = Math.max(0, f.peaks[i] - dt * 0.55);
    }
    f.wave.fill(0);
    f.level *= k;
    f.left *= k;
    f.right *= k;
    f.bass *= k;
    f.mid *= k;
    f.treble *= k;
    f.beat *= k;
    f.dbL = f.dbR = -90;
    f.silent = true;
  }
}

/** Resample the 128 analysis bands to n display bands (averaging). */
export function resample(src, n, out) {
  if (!out || out.length !== n) out = new Float32Array(n);
  const step = src.length / n;
  for (let i = 0; i < n; i++) {
    const a = i * step, b = a + step;
    let s = 0, w = 0;
    for (let k = Math.floor(a); k < Math.ceil(b); k++) {
      const lo = Math.max(a, k), hi = Math.min(b, k + 1);
      const ww = hi - lo;
      if (ww > 0) { s += src[Math.min(k, src.length - 1)] * ww; w += ww; }
    }
    out[i] = w ? s / w : 0;
  }
  return out;
}

export async function listInputs() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      // Drop the trailing USB id, e.g. "Microphone (HyperX Quadcast) (0951:16df)".
      .map((d) => ({ id: d.deviceId, label: (d.label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || 'Input device' }));
  } catch {
    return [];
  }
}
