'use strict';
// Runs media-helper.ps1 and turns its JSON lines into app state.

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const HELPER = path.join(__dirname, 'media-helper.ps1').replace('app.asar', 'app.asar.unpacked');

class Media extends EventEmitter {
  constructor() {
    super();
    this.state = { available: false, track: null, timeline: null, cover: null, error: null };
    this.proc = null;
    this.buffer = '';
    this.restarts = 0;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    this.proc = spawn(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (d) => {
      this.state.error = String(d).trim().split('\n')[0];
    });
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopped) return;
      this.state.available = false;
      this.emit('state', this.publicState());
      // Back off: 1s, 2s, 4s ... capped at 30s.
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.restarts++, 5));
      setTimeout(() => !this.stopped && this.start(), delay);
      console.warn(`[media] helper exited (${code}); restarting in ${delay}ms`);
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      const p = this.proc;
      setTimeout(() => { try { p.kill(); } catch {} }, 1500);
    }
  }

  onData(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim();
      this.buffer = this.buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.handle(msg);
    }
  }

  handle(msg) {
    switch (msg.type) {
      case 'ready':
        this.restarts = 0;
        this.state.available = true;
        this.state.error = null;
        break;
      case 'none':
        this.state.track = null;
        this.state.timeline = null;
        this.state.cover = null;
        this.emit('cover', null);
        break;
      case 'track': {
        const { type, ...t } = msg;
        t.key = `${t.app}|${t.title}|${t.artist}|${t.album}`;
        this.state.track = t;
        this.state.cover = null;
        this.emit('track', t);
        this.emit('cover', null);
        break;
      }
      case 'timeline': {
        // Convert the helper's clock to ours so renderers can extrapolate.
        const skew = Date.now() - msg.now;
        this.state.timeline = {
          status: msg.status,
          position: msg.position,
          duration: Math.max(0, msg.end - msg.start),
          updatedAt: msg.updated > 0 ? msg.updated + skew : Date.now(),
        };
        break;
      }
      case 'cover':
        this.state.cover = msg.data ? `data:${msg.mime};base64,${msg.data}` : null;
        this.emit('cover', this.state.cover);
        return;
      case 'error':
        this.state.error = msg.message;
        console.warn('[media]', msg.message);
        break;
      default:
        return;
    }
    this.emit('state', this.publicState());
  }

  publicState() {
    const { available, track, timeline, error } = this.state;
    return { available, track, timeline, error };
  }

  command(cmd) {
    if (!['toggle', 'play', 'pause', 'next', 'prev'].includes(cmd)) return;
    if (this.proc) this.proc.stdin.write(cmd + '\n');
  }
}

module.exports = { Media };
