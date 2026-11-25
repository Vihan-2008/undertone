'use strict';
const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen, Tray, Menu, globalShortcut, powerMonitor, shell, nativeTheme } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { Settings } = require('./settings');
const { Media } = require('./media');
const { Lyrics } = require('./lyrics');
const { Wallpaper } = require('./wallpaper');
const { Arrange } = require('./arrange');
const desktop = require('./desktop');
const { trayImage, appIcon } = require('./icon');

app.setName('Undertone');
app.setAppUserModelId('app.undertone');
// Development aids: a throwaway profile and console/screenshot capture.
// Dev-only hooks; an installed build ignores them.
const DEV = !app.isPackaged;
if (DEV && process.env.UT_USERDATA) app.setPath('userData', process.env.UT_USERDATA);
const DEV_DIR = (DEV && process.env.UT_DEV) || '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const WIDGETS = ['visualizer', 'clock'];
const STYLES = [['bars', 'Bars'], ['mirror', 'Mirror'], ['blocks', 'Blocks'], ['ring', 'Ring'], ['wave', 'Wave'], ['aurora', 'Aurora'], ['orb', 'Orb'], ['waterfall', 'Waterfall'], ['particles', 'Particles'], ['terrain', 'Terrain'], ['meters', 'Meters']];
const THEMES = [['ember', 'Ember'], ['paper', 'Paper'], ['tide', 'Tide'], ['moss', 'Moss'], ['sodium', 'Sodium'], ['prism', 'Prism'], ['custom', 'Custom'], ['cover', 'From cover']];
const CLOCK_PAD = 44; // room for the clock's text shadow around its content
const CLOCK_OUTLINE = { x: 16, y: 12 }; // arrange outline padding around the clock
const VIS_PAD = { x: 56, y: 28 }; // room for the now-playing ink wash, which must fade out inside the window

let settings, media, lyrics, wallpaper, arrange, tray;
let settingsWin = null;
let fullscreenWin = null;
const widgets = {}; // name -> { win, attached, covered, ready }
const run = { hidden: false, paused: false };
const geo = { vis: null, clock: null }; // live widget geometry, screen DIP
let clockBox = { w: 0, h: 0 };
let tone = 'paper';
let audioProblem = null; // { source, label }
let internalSourceChange = false;
let hotkeyState = {};
let capturing = false;
let lyricState = { key: null, status: 'off', synced: false, lines: [] };
let settingsWasOpen = false;
let quitting = false;
let taskbarLight = false;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const debounce = (fn, ms) => {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// ---------------------------------------------------------------- geometry

const displayById = (id) => screen.getAllDisplays().find((d) => d.id === id);
const displayAtRect = (r) => screen.getDisplayNearestPoint({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });

function defaultVis() {
  const wa = screen.getPrimaryDisplay().workArea;
  let w = 640, h = 220;
  if (wa.width < 1280) {
    w = Math.round(wa.width * 0.5);
    h = Math.round(w * 0.34);
  }
  return { x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + wa.height - 48 - h, w, h };
}

function defaultClock() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { anchor: 'ne', x: wa.x + wa.width - 64, y: wa.y + 64 };
}

function loadGeo() {
  const w = settings.get().widgets;
  const b = w.visualizer.bounds;
  geo.vis = b && displayById(b.display) ? { x: b.x, y: b.y, w: b.w, h: b.h } : defaultVis();
  const p = w.clock.position;
  geo.clock = p && displayById(p.display) ? { anchor: p.anchor || 'ne', x: p.x, y: p.y } : defaultClock();
}

function persistGeo() {
  const v = geo.vis;
  const c = clockContent();
  settings.set({
    widgets: {
      visualizer: { bounds: { display: displayAtRect(v).id, x: v.x, y: v.y, w: v.w, h: v.h } },
      clock: { position: { display: displayAtRect(c).id, anchor: geo.clock.anchor, x: geo.clock.x, y: geo.clock.y } },
    },
  });
}

function clockBoxSize() {
  if (clockBox.w) return clockBox;
  const s = settings.get().clock.size;
  return { w: Math.round(s * 2.6), h: Math.round(s * 1.3) };
}

function clockContent(pos = geo.clock) {
  const { w, h } = clockBoxSize();
  return {
    x: Math.round(pos.anchor[1] === 'e' ? pos.x - w : pos.x),
    y: Math.round(pos.anchor[0] === 's' ? pos.y - h : pos.y),
    w,
    h,
  };
}

/** Anchor the clock at the corner of its content nearest the display's corner. */
function settleClock() {
  const c = clockContent();
  const wa = displayAtRect(c).workArea;
  const anchor = (c.y + c.h / 2 > wa.y + wa.height / 2 ? 's' : 'n') + (c.x + c.w / 2 > wa.x + wa.width / 2 ? 'e' : 'w');
  geo.clock = { anchor, x: anchor[1] === 'e' ? c.x + c.w : c.x, y: anchor[0] === 's' ? c.y + c.h : c.y };
}

function windowRect(name) {
  if (name === 'visualizer') {
    const v = geo.vis;
    return { x: Math.round(v.x) - VIS_PAD.x, y: Math.round(v.y) - VIS_PAD.y, width: Math.round(v.w) + 2 * VIS_PAD.x, height: Math.round(v.h) + 2 * VIS_PAD.y };
  }
  const c = clockContent();
  return { x: c.x - CLOCK_PAD, y: c.y - CLOCK_PAD, width: c.w + 2 * CLOCK_PAD, height: c.h + 2 * CLOCK_PAD };
}

function clockAlign() {
  const c = clockContent();
  const d = displayAtRect(c).bounds;
  const t = (c.x + c.w / 2 - d.x) / d.width;
  return t > 2 / 3 ? 'right' : t < 1 / 3 ? 'left' : 'center';
}

/** Move a widget's window to its current geometry. */
function applyGeometry(name) {
  const e = widgets[name];
  if (!e || e.win.isDestroyed()) return;
  const dip = windowRect(name);
  if (e.attached) {
    desktop.detach(e.win, screen.dipToScreenRect(null, dip));
    e.attached = false;
    e.win.setBounds(dip);
    if (!arrange.active) placeWidget(name);
  } else {
    e.win.setBounds(dip);
  }
  if (name === 'clock') sendTo(e.win, 'clock:align', clockAlign());
  else updateTone();
}

// ---------------------------------------------------------------- widget windows

function webPrefs() {
  return {
    preload: PRELOAD,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: !(DEV && process.env.UT_NOSANDBOX),
    backgroundThrottling: false,
    spellcheck: false,
  };
}

function createWidget(name) {
  const win = new BrowserWindow({
    ...windowRect(name),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    type: 'toolbar',
    title: name === 'visualizer' ? 'Undertone visualizer' : 'Undertone clock',
    webPreferences: webPrefs(),
  });
  win.setMenu(null);
  const entry = { win, name, attached: false, covered: false, ready: false };
  widgets[name] = entry;
  entry.readyPromise = new Promise((res) => {
    win.once('ready-to-show', () => {
      entry.ready = true;
      if (arrange.active) arrange.refresh();
      else placeWidget(name);
      if (name === 'clock') sendTo(win, 'clock:align', clockAlign());
      else sendTo(win, 'widget:tone', tone);
      res();
    });
  });
  win.loadFile(path.join(RENDERER, name === 'visualizer' ? 'widget' : 'clock', 'index.html'), { query: { role: name } });
  win.on('closed', () => {
    if (widgets[name] && widgets[name].win === win) delete widgets[name];
    // Explorer restarting destroys children of its windows. Bring ours back.
    if (!quitting && settings.get()[name].enabled) setTimeout(() => !widgets[name] && createWidget(name), 1500);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.warn(`[${name}] renderer gone: ${d.reason} (${d.exitCode})`);
    if (!quitting) setTimeout(() => !win.isDestroyed() && win.reload(), 1000);
  });
  return entry;
}

/** Put a widget on the wallpaper (or hide it). */
function placeWidget(name) {
  const e = widgets[name];
  if (!e || e.win.isDestroyed() || !e.ready) return;
  if (arrange.active) return;
  const { win } = e;
  const dip = windowRect(name);
  if (e.attached) {
    desktop.detach(win, screen.dipToScreenRect(null, dip));
    e.attached = false;
  }
  win.setBounds(dip);
  if (run.hidden) {
    win.hide();
    return;
  }
  win.setAlwaysOnTop(false);
  win.setIgnoreMouseEvents(false);
  win.showInactive();
  const layer = desktop.attach(win, screen.dipToScreenRect(null, dip));
  e.attached = !!layer;
  if (!layer) console.warn(`[${name}] wallpaper layer not found; showing as a normal window`);
  e.covered = false;
  pushRun(name);
}

/** Lift a widget above an arrange overlay, or drop it back to the wallpaper. */
function liftWidget(name, overlay) {
  const e = widgets[name];
  if (!e || e.win.isDestroyed()) return;
  const { win } = e;
  const dip = windowRect(name);
  if (overlay) {
    if (e.attached) {
      desktop.detach(win, screen.dipToScreenRect(null, dip), { topmost: true });
      e.attached = false;
    }
    win.setBounds(dip);
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.showInactive();
    desktop.setOwner(win, overlay);
    win.moveTop();
    e.covered = false;
    pushRun(name);
  } else {
    desktop.setOwner(win, null);
    win.setAlwaysOnTop(false);
    placeWidget(name);
  }
}

function ensureWidgets() {
  const s = settings.get();
  for (const name of WIDGETS) {
    const want = s[name].enabled;
    if (want && !widgets[name]) createWidget(name);
    if (!want && widgets[name]) {
      const { win } = widgets[name];
      delete widgets[name];
      if (!win.isDestroyed()) win.destroy();
      if (arrange.active) arrange.refresh();
    }
  }
}

function pushRun(name) {
  const e = widgets[name];
  if (!e) return;
  sendTo(e.win, 'widget:run', { covered: e.covered, paused: run.paused });
}

function setHidden(hidden) {
  run.hidden = !!hidden;
  if (hidden && arrange.active) arrange.end();
  for (const name of Object.keys(widgets)) placeWidget(name);
  changed();
}

function setPaused(paused) {
  run.paused = !!paused;
  for (const name of Object.keys(widgets)) pushRun(name);
  changed();
}

// ---------------------------------------------------------------- tone (paper or ink text on the wallpaper)

function updateTone() {
  if (!geo.vis || !wallpaper) return;
  const v = geo.vis;
  const d = displayAtRect(v);
  const L = wallpaper.luminance(d, { x: v.x - d.bounds.x, y: v.y + v.h - 60 - d.bounds.y, width: v.w, height: 60 });
  const next = L > 0.6 ? 'ink' : L < 0.5 ? 'paper' : tone;
  if (next !== tone) {
    tone = next;
    if (widgets.visualizer) sendTo(widgets.visualizer.win, 'widget:tone', tone);
  }
}
const updateToneSoon = debounce(updateTone, 300);

/** First run only: pick the clock's colour from the wallpaper under it. */
function firstRunClockColour() {
  const c = clockContent(defaultClock());
  const d = displayAtRect(c);
  const L = wallpaper.luminance(d, { x: c.x - d.bounds.x, y: c.y - d.bounds.y, width: c.w, height: c.h });
  if (L > 0.6) settings.set({ clock: { colourA: '#0D0D0C' } });
}

// ---------------------------------------------------------------- settings and full-screen windows

function settingsBounds() {
  const saved = settings.get().window.settings;
  const d = saved ? screen.getDisplayNearestPoint({ x: saved.x + 100, y: saved.y + 20 }) : screen.getPrimaryDisplay();
  const wa = d.workArea;
  const zoom = wa.width < 984 ? wa.width / 984 : 1;
  const width = Math.round(960 * zoom);
  const height = Math.round(clamp(wa.height - 24, 520, 680) * zoom);
  let x = wa.x + wa.width - width - 12, y = wa.y + wa.height - height - 12;
  if (saved && saved.x >= wa.x - 40 && saved.x <= wa.x + wa.width - 120 && saved.y >= wa.y && saved.y <= wa.y + wa.height - 60) {
    x = saved.x;
    y = clamp(saved.y, wa.y, wa.y + wa.height - height);
  }
  return { x, y, width, height, zoom };
}

function createSettings() {
  const b = settingsBounds();
  settingsWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Undertone',
    backgroundColor: '#0D0D0C',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0D0D0C', symbolColor: '#EFEBE2', height: 40 },
    icon: appIcon(64),
    webPreferences: webPrefs(),
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(RENDERER, 'settings', 'index.html'), { query: { role: 'settings' } });
  settingsWin.webContents.setZoomFactor(b.zoom);
  settingsWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    settingsWin.hide();
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.on('moved', () => {
    const [x, y] = settingsWin.getPosition();
    settings.set({ window: { settings: { x, y } } });
  });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return new Promise((res) => settingsWin.once('ready-to-show', res));
}

async function openSettings(tab) {
  if (arrange.active) {
    settingsWasOpen = true;
    return;
  }
  if (!settingsWin || settingsWin.isDestroyed()) await createSettings();
  const b = settingsBounds();
  settingsWin.setContentSize(b.width, b.height);
  sendTo(settingsWin, 'settings:open', { tab: tab || (audioProblem ? 'audio' : 'visualizer') });
  settingsWin.show();
  settingsWin.focus();
}

function hideSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
}

function toggleSettings() {
  if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) hideSettings();
  else openSettings();
}

/** Animate a window's opacity; enter 450 ms, leave 300 ms (DESIGN.md 1.4, 6.4). */
function fadeWindow(win, from, to, ms, done) {
  const t0 = Date.now();
  win.setOpacity(from);
  const iv = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(iv);
    const t = Math.min(1, (Date.now() - t0) / ms);
    const e = to > from ? 1 - (1 - t) ** 3 : t * t;
    win.setOpacity(from + (to - from) * e);
    if (t >= 1) {
      clearInterval(iv);
      if (done) done();
    }
  }, 16);
}

function closeFullscreen() {
  const win = fullscreenWin;
  if (!win || win.isDestroyed() || win.closing) return;
  win.closing = true;
  fadeWindow(win, win.getOpacity(), 0, 300, () => !win.isDestroyed() && win.close());
}

function toggleFullscreen() {
  if (fullscreenWin && !fullscreenWin.isDestroyed()) {
    closeFullscreen();
    return;
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  fullscreenWin = new BrowserWindow({
    ...d.bounds,
    frame: false,
    fullscreen: true,
    backgroundColor: '#0D0D0C',
    show: false,
    title: 'Undertone',
    icon: appIcon(64),
    webPreferences: webPrefs(),
  });
  fullscreenWin.setMenu(null);
  fullscreenWin.loadFile(path.join(RENDERER, 'fullscreen', 'index.html'), { query: { role: 'fullscreen' } });
  fullscreenWin.once('ready-to-show', () => {
    fullscreenWin.setOpacity(0);
    fullscreenWin.show();
    fullscreenWin.focus();
    fadeWindow(fullscreenWin, 0, 1, 450);
    coverLoop();
  });
  fullscreenWin.on('closed', () => {
    fullscreenWin = null;
    coverLoop();
  });
}

function nextStyle() {
  const ids = STYLES.map((s) => s[0]);
  const i = ids.indexOf(settings.get().visualizer.style);
  settings.set({ visualizer: { style: ids[(i + 1) % ids.length] } });
}

// ---------------------------------------------------------------- covered, watchdog

function coverLoop() {
  const s = settings.get().system;
  const list = Object.values(widgets).filter((e) => !e.win.isDestroyed() && e.win.isVisible());
  let covered = list.map(() => false);
  if (s.pauseWhenCovered && !arrange.active && list.length) {
    try {
      covered = desktop.coveredRects(list.map((e) => desktop.physicalRectOf(e.win)));
    } catch {
      return;
    }
    if (fullscreenWin && !fullscreenWin.isDestroyed()) {
      const fd = screen.getDisplayMatching(fullscreenWin.getBounds()).id;
      list.forEach((e, i) => {
        if (screen.getDisplayMatching(e.win.getBounds()).id === fd) covered[i] = true;
      });
    }
  }
  let any = false;
  list.forEach((e, i) => {
    if (covered[i] !== e.covered) {
      e.covered = covered[i];
      pushRun(e.name);
      any = true;
    }
  });
  if (any) changed();
}

function watchdog() {
  if (arrange.active || run.hidden) return;
  for (const [name, e] of Object.entries(widgets)) {
    if (e.win.isDestroyed() || !e.ready) continue;
    if (!e.attached || !desktop.isAttached(e.win)) {
      e.attached = false;
      placeWidget(name);
    }
  }
}

function validateGeo() {
  // A widget on a display that went away moves to the primary display's default.
  if (!screen.getAllDisplays().some((d) => rectsOverlap(d.bounds, geo.vis))) geo.vis = defaultVis();
  if (!screen.getAllDisplays().some((d) => rectsOverlap(d.bounds, clockContent()))) geo.clock = defaultClock();
  for (const name of Object.keys(widgets)) placeWidget(name);
  updateToneSoon();
}

function rectsOverlap(a, r) {
  return r.x < a.x + a.width && r.x + r.w > a.x && r.y < a.y + a.height && r.y + r.h > a.y;
}

// ---------------------------------------------------------------- tray

function readTaskbarTheme() {
  execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'], { windowsHide: true }, (err, out) => {
    const light = !err && /0x1\b/.test(String(out));
    if (light !== taskbarLight) {
      taskbarLight = light;
      updateTray();
    }
  });
}

const anyCovered = () => Object.values(widgets).some((e) => e.covered);
const hotkeyConflict = () => Object.values(hotkeyState).includes('conflict');
const styleName = (id) => (STYLES.find((s) => s[0] === id) || STYLES[0])[1];
const themeName = (id) => (THEMES.find((s) => s[0] === id) || THEMES[0])[1];
const menuText = (t) => String(t).replace(/&/g, '&&');
const accelText = (id) => (hotkeyState[id] === 'ok' ? settings.get().hotkeys[id] : undefined);

let lastTrayMenu = '';
function updateTray() {
  if (!tray) return;
  const s = settings.get();
  const problem = audioProblem || hotkeyConflict();
  const quiet = run.paused || run.hidden || anyCovered();
  tray.setImage(trayImage(problem ? 'problem' : quiet ? 'paused' : 'normal', taskbarLight));
  let tip = `Undertone: ${styleName(s.visualizer.style)}, ${themeName(s.visualizer.theme)}`;
  if (audioProblem) tip = `Undertone: couldn't open ${audioProblem.label || 'the input device'}, using System audio`;
  else if (hotkeyConflict()) tip = 'Undertone: a hotkey is in use by another app';
  else if (run.hidden) tip = 'Undertone: widgets hidden';
  else if (run.paused) tip = 'Undertone: paused';
  else if (anyCovered()) tip = 'Undertone: paused, desktop covered';
  tray.setToolTip(tip.length > 127 ? tip.slice(0, 126) + '…' : tip);

  const t = media && media.state.track;
  let now = t && t.title ? (t.artist ? `${t.title} by ${t.artist}` : t.title) : 'Nothing playing';
  if (now.length > 48) now = now.slice(0, 47) + '…';
  // Rebuilding the menu while it is open closes it, so only rebuild when it would change.
  const sig = JSON.stringify([now, run.paused, run.hidden, s.visualizer.enabled, s.clock.enabled, s.visualizer.style, s.visualizer.theme, s.hotkeys]);
  if (sig === lastTrayMenu) return;
  lastTrayMenu = sig;
  const menu = Menu.buildFromTemplate([
    { label: menuText(now), enabled: false },
    { type: 'separator' },
    { label: 'Settings', click: () => openSettings() },
    { label: 'Full-screen player', accelerator: accelText('fullscreen'), registerAccelerator: false, click: toggleFullscreen },
    { label: 'Arrange widgets', accelerator: accelText('arrange'), registerAccelerator: false, click: () => arrange.start() },
    { type: 'separator' },
    { label: 'Show visualizer', type: 'checkbox', checked: s.visualizer.enabled && !run.hidden, click: (i) => toggleWidget('visualizer', i.checked) },
    { label: 'Show clock', type: 'checkbox', checked: s.clock.enabled && !run.hidden, click: (i) => toggleWidget('clock', i.checked) },
    { label: run.paused ? 'Resume' : 'Pause', click: () => setPaused(!run.paused) },
    { type: 'separator' },
    { label: 'Style', submenu: STYLES.map(([id, name]) => ({ label: name, type: 'radio', checked: s.visualizer.style === id, click: () => settings.set({ visualizer: { style: id } }) })) },
    { label: 'Colours', submenu: THEMES.map(([id, name]) => ({ label: name, type: 'radio', checked: s.visualizer.theme === id, click: () => settings.set({ visualizer: { theme: id } }) })) },
    { type: 'separator' },
    { label: 'Quit Undertone', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}
const updateTraySoon = debounce(updateTray, 120);

function toggleWidget(name, on) {
  if (run.hidden && on) {
    run.hidden = false;
    for (const n of Object.keys(widgets)) placeWidget(n);
  }
  settings.set({ [name]: { enabled: !!on } });
}

function createTray() {
  tray = new Tray(trayImage('normal', taskbarLight));
  tray.on('click', toggleSettings);
  updateTray();
}

// ---------------------------------------------------------------- hotkeys

function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyState = {};
  const keys = settings.get().hotkeys;
  const actions = {
    fullscreen: toggleFullscreen,
    arrange: () => arrange.toggle(),
    toggleWidgets: () => setHidden(!run.hidden),
    nextStyle,
  };
  for (const id of Object.keys(actions)) {
    const accel = keys[id];
    if (!accel) {
      hotkeyState[id] = 'none';
      continue;
    }
    if (capturing) {
      hotkeyState[id] = 'ok';
      continue;
    }
    let ok = false;
    try {
      ok = globalShortcut.register(accel, actions[id]);
    } catch {
      ok = false;
    }
    hotkeyState[id] = ok ? 'ok' : 'conflict';
    if (!ok) console.warn(`[hotkeys] ${accel} is in use by another app`);
  }
}

// ---------------------------------------------------------------- messaging

function sendTo(win, channel, ...args) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args);
}

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) sendTo(w, channel, ...args);
}

function appInfo() {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    locale: app.getSystemLocale ? app.getSystemLocale() : app.getLocale(),
    hotkeys: hotkeyState,
    hidden: run.hidden,
    paused: run.paused,
    covered: anyCovered(),
    arranging: arrange.active,
    audioProblem,
    tone,
    visualizer: geo.vis,
  };
}

const broadcastInfo = debounce(() => broadcast('app:info', appInfo()), 60);

/** Something the tray and status bar show has changed. */
function changed() {
  updateTraySoon();
  broadcastInfo();
}

// ---------------------------------------------------------------- lyrics

let lyricTimer = null;
function setLyrics(st) {
  lyricState = st;
  broadcast('lyrics:state', lyricState);
}

function refreshLyrics(track) {
  clearTimeout(lyricTimer);
  if (!settings.get().lyrics.enabled) return setLyrics({ key: track ? track.key : null, status: 'off', synced: false, lines: [] });
  if (!track || !track.title) return setLyrics({ key: null, status: 'idle', synced: false, lines: [] });
  setLyrics({ key: track.key, status: 'loading', synced: false, lines: [] });
  // Wait briefly for the timeline so the lookup can match on duration.
  lyricTimer = setTimeout(async () => {
    const tl = media.state.timeline;
    const res = await lyrics.get(track, tl ? tl.duration : 0);
    if (!media.state.track || media.state.track.key !== track.key) return;
    const status = res.status === 'error' ? 'failed' : res.status === 'found' && res.synced && res.lines.length ? 'ready' : 'none';
    setLyrics({ key: track.key, status, synced: !!res.synced, lines: status === 'ready' ? res.lines : [] });
  }, 700);
}

// ---------------------------------------------------------------- ipc

function applyLogin() {
  // Only the installed app registers itself; a dev run would register the
  // bare Electron binary.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get().system.launchAtLogin });
}

function wireIpc() {
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.on('settings:set', (_e, patch) => settings.set(patch || {}));
  ipcMain.on('settings:reset', () => {
    settings.reset();
    resolveRegionDefaults();
  });
  ipcMain.handle('media:get', () => ({ ...media.publicState(), cover: media.state.cover, lyrics: lyricState }));
  ipcMain.on('media:command', (_e, cmd) => media.command(cmd));
  ipcMain.handle('app:info', () => appInfo());
  ipcMain.handle('app:set-login', () => ({ packaged: app.isPackaged }));
  ipcMain.handle('wallpaper:get', () => {
    const d = displayAtRect(geo.vis);
    const rel = (r) => ({ x: r.x - d.bounds.x, y: r.y - d.bounds.y, w: r.w, h: r.h });
    return { ...wallpaper.picture(d), visualizer: rel(geo.vis), clock: rel(clockContent()), tone };
  });
  ipcMain.on('app:action', (e, name, arg) => {
    switch (name) {
      case 'open-settings': return openSettings(arg);
      case 'hide-settings': return hideSettings();
      case 'toggle-fullscreen': return toggleFullscreen();
      case 'close-fullscreen': return closeFullscreen();
      case 'arrange': return arrange.start();
      case 'set-hidden': return setHidden(arg);
      case 'set-paused': return setPaused(arg);
      case 'quit': return app.quit();
      case 'capture-hotkeys':
        capturing = !!arg;
        if (capturing) globalShortcut.unregisterAll();
        else registerHotkeys();
        return changed();
      case 'audio-failed':
        if (!arg || !arg.source || arg.source === 'system') return;
        if (settings.get().audio.source !== arg.source) return;
        audioProblem = { source: arg.source, label: arg.label || settings.get().audio.sourceLabel || 'the input device' };
        internalSourceChange = true;
        settings.set({ audio: { source: 'system' } });
        internalSourceChange = false;
        return changed();
      case 'retry-source': {
        if (!audioProblem) return;
        const { source, label } = audioProblem;
        audioProblem = null;
        internalSourceChange = true;
        settings.set({ audio: { source, sourceLabel: label } });
        internalSourceChange = false;
        return changed();
      }
      default:
        return undefined;
    }
  });
  ipcMain.on('clock:size', (_e, w, h) => {
    w = Math.ceil(w);
    h = Math.ceil(h);
    if (!w || !h || (Math.abs(w - clockBox.w) <= 1 && Math.abs(h - clockBox.h) <= 1)) return;
    clockBox = { w, h };
    applyGeometry('clock');
    arrange.refresh();
  });
  ipcMain.on('arrange:pointer', (e, ev) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const id = [...arrange.overlays.entries()].find(([, w]) => w === win);
    if (id) arrange.pointer(ev, id[0]);
  });
  ipcMain.on('arrange:action', (_e, a) => arrange.action(a));
}

function resolveRegionDefaults() {
  if (settings.get().clock.hour24 !== null) return;
  execFile('reg', ['query', 'HKCU\\Control Panel\\International', '/v', 'sShortTime'], { windowsHide: true }, (err, out) => {
    const m = !err && String(out).match(/sShortTime\s+REG_SZ\s+(.*)/);
    settings.set({ clock: { hour24: m ? /H/.test(m[1]) : false } });
  });
}

// ---------------------------------------------------------------- lifecycle

function makeArrange() {
  return new Arrange({
    rendererDir: RENDERER,
    webPrefs,
    items: () => {
      const out = [];
      if (widgets.visualizer) {
        out.push({
          name: 'visualizer',
          label: 'Visualizer',
          kind: 'free',
          outline: () => ({ ...geo.vis }),
          place: (r) => {
            geo.vis = { x: r.x, y: r.y, w: r.w, h: r.h };
            applyGeometry('visualizer');
          },
        });
      }
      if (widgets.clock) {
        const P = CLOCK_OUTLINE;
        out.push({
          name: 'clock',
          label: 'Clock',
          kind: 'uniform',
          outline: () => {
            const c = clockContent();
            return { x: c.x - P.x, y: c.y - P.y, w: c.w + 2 * P.x, h: c.h + 2 * P.y };
          },
          place: (r) => {
            geo.clock = { anchor: 'nw', x: r.x + P.x, y: r.y + P.y };
            applyGeometry('clock');
          },
          settle: settleClock,
          size: () => settings.get().clock.size,
          setSize: (n, corner, point) => {
            geo.clock = { anchor: corner, x: point.x + (corner[1] === 'w' ? P.x : -P.x), y: point.y + (corner[0] === 'n' ? P.y : -P.y) };
            settings.set({ clock: { size: n } });
          },
          reset: () => {
            geo.clock = defaultClock();
            settings.set({ clock: { size: 96 } });
            applyGeometry('clock');
          },
        });
      }
      return out;
    },
    lift: liftWidget,
    defaults: (name) => (name === 'visualizer' ? { rect: defaultVis() } : { size: 96 }),
    hint: (firstRun) => {
      const base = 'Drag to move. Pull a corner to resize.';
      if (!firstRun) return `${base} Arrow keys nudge.`;
      const accel = settings.get().hotkeys.arrange;
      if (accel && hotkeyState.arrange === 'ok') return `${base} ${accel.replace(/Super/g, 'Win')} brings this back any time.`;
      return `${base} Arrange widgets in the tray menu brings this back any time.`;
    },
    onStart: () => {
      run.hidden = false;
      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
        settingsWasOpen = true;
        settingsWin.hide();
      }
      for (const e of Object.values(widgets)) {
        if (e.covered) {
          e.covered = false;
          pushRun(e.name);
        }
      }
      changed();
    },
    onEnd: (firstRun) => {
      persistGeo();
      if (firstRun) settings.set({ firstRun: false });
      updateTone();
      if (settingsWasOpen) {
        settingsWasOpen = false;
        openSettings();
      }
      changed();
    },
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new Settings(userData);
  media = new Media();
  lyrics = new Lyrics(userData, app.getVersion());
  wallpaper = new Wallpaper();
  arrange = makeArrange();
  loadGeo();
  resolveRegionDefaults();

  // System audio: Chromium's loopback of the default output device.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}));
  });
  const ownPage = (url) => typeof url === 'string' && url.startsWith('file://');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    cb(ownPage(details.requestingUrl || wc.getURL()) && ['media', 'display-capture'].includes(perm));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin, details) => {
    return ['media', 'display-capture'].includes(perm) && (ownPage(origin) || ownPage(details && details.requestingUrl) || origin === 'file:///');
  });

  wireIpc();
  settings.on('change', (data, patch) => {
    broadcast('settings:changed', data, patch);
    if ((patch.visualizer && 'enabled' in patch.visualizer) || (patch.clock && 'enabled' in patch.clock)) ensureWidgets();
    if (patch.lyrics && 'enabled' in patch.lyrics) refreshLyrics(media.state.track);
    if (patch.hotkeys) registerHotkeys();
    if (patch.audio && 'source' in patch.audio && !internalSourceChange) audioProblem = null;
    if (patch.system && 'launchAtLogin' in patch.system) applyLogin();
    if (patch.system && 'pauseWhenCovered' in patch.system) coverLoop();
    if (patch.widgets === undefined || Object.keys(patch).length > 1) changed();
  });

  media.on('state', (st) => {
    broadcast('media:state', st);
    updateTraySoon();
  });
  media.on('cover', (c) => broadcast('media:cover', c));
  media.on('track', (t) => {
    refreshLyrics(t);
    updateTraySoon();
  });
  media.start();

  await wallpaper.refresh();
  wallpaper.on('change', () => {
    updateTone();
    broadcast('wallpaper:changed');
  });
  const firstRun = settings.get().firstRun;
  if (firstRun && settings.fresh) firstRunClockColour();
  updateTone();

  registerHotkeys();
  readTaskbarTheme();
  createTray();
  ensureWidgets();
  createSettings(); // ready in the background so the first open is instant

  if (firstRun) {
    await Promise.race([Promise.all(Object.values(widgets).map((e) => e.readyPromise)), new Promise((r) => setTimeout(r, 5000))]);
    arrange.start({ firstRun: true });
  }

  setInterval(coverLoop, 1000);
  setInterval(watchdog, 3000);
  setInterval(() => wallpaper.refresh(), 20000);
  nativeTheme.on('updated', readTaskbarTheme);
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) {
    screen.on(ev, () => {
      if (arrange.active) arrange.end();
      setTimeout(validateGeo, 300);
    });
  }
  powerMonitor.on('lock-screen', () => Object.values(widgets).forEach((e) => { e.covered = true; pushRun(e.name); }));
  powerMonitor.on('unlock-screen', () => Object.values(widgets).forEach((e) => { e.covered = false; pushRun(e.name); }));
});

app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => {
  // Keep running in the tray.
});
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (media) media.stop();
  if (settings) {
    if (geo.vis && !arrange.active) persistGeo();
    settings.flush();
  }
});

if (DEV_DIR) {
  const fs = require('fs');
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('console-message', (e) => {
      console.log(new Date().toISOString().slice(14, 23), `[${win.getTitle()}] ${e.message}`);
    });
  });
  app.whenReady().then(() => {
    if (process.env.UT_DEV_SCRIPT) {
      setTimeout(() => {
        require(process.env.UT_DEV_SCRIPT)({
          arrange, widgets, settings, desktop, screen, geo, run, toggleFullscreen, openSettings, hideSettings, setHidden, setPaused, appInfo, wallpaper,
          get fullscreenWin() { return fullscreenWin; },
          get settingsWin() { return settingsWin; },
          get tray() { return tray; },
          get clockBox() { return clockBox; },
          capture,
        }).catch((e) => console.log('dev script failed', e));
      }, 500);
    }
    setInterval(() => capture().catch((e) => console.log('dev capture failed', e.message)), 3000);
  });

  // The primary display as the user sees it, plus the settings and full-screen windows.
  async function capture(file = 'desktop.png') {
    const d = screen.getPrimaryDisplay();
    const sf = d.scaleFactor;
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) } });
    const src = srcs.find((s) => s.display_id === String(d.id)) || srcs[0];
    fs.writeFileSync(path.join(DEV_DIR, file), src.thumbnail.toPNG());
    for (const [name, w] of [['settings', settingsWin], ['fullscreen', fullscreenWin]]) {
      if (!w || w.isDestroyed() || !w.isVisible()) continue;
      try {
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(DEV_DIR, `${name}.png`), img.toPNG());
      } catch {}
    }
    fs.writeFileSync(path.join(DEV_DIR, 'state.json'), JSON.stringify({
      media: media && media.publicState(),
      lyrics: { status: lyricState.status, lines: lyricState.lines.length },
      widgets: Object.fromEntries(Object.entries(widgets).map(([n, e]) => [n, { attached: e.attached, covered: e.covered, visible: !e.win.isDestroyed() && e.win.isVisible(), rect: !e.win.isDestroyed() && desktop.physicalRectOf(e.win) }])),
      geo, clockBox, info: appInfo(),
    }, null, 2));
  }
}
