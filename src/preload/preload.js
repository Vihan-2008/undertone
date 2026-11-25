'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
const act = (name) => (arg) => ipcRenderer.send('app:action', name, arg);
const params = new URLSearchParams(location.search);

contextBridge.exposeInMainWorld('undertone', {
  role: params.get('role') || '',
  param: (k) => params.get(k),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.send('settings:set', patch),
    reset: () => ipcRenderer.send('settings:reset'),
    onChange: on('settings:changed'),
  },
  media: {
    get: () => ipcRenderer.invoke('media:get'),
    command: (cmd) => ipcRenderer.send('media:command', cmd),
    onState: on('media:state'),
    onCover: on('media:cover'),
    onLyrics: on('lyrics:state'),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    onInfo: on('app:info'),
    openSettings: act('open-settings'),
    hideSettings: act('hide-settings'),
    toggleFullscreen: act('toggle-fullscreen'),
    closeFullscreen: act('close-fullscreen'),
    arrange: act('arrange'),
    setHidden: act('set-hidden'),
    setPaused: act('set-paused'),
    quit: act('quit'),
    retrySource: act('retry-source'),
    captureHotkeys: act('capture-hotkeys'),
    audioFailed: act('audio-failed'),
    setLaunchAtLogin: (v) => ipcRenderer.invoke('app:set-login', v),
    wallpaper: () => ipcRenderer.invoke('wallpaper:get'),
    onWallpaper: on('wallpaper:changed'),
    onOpen: on('settings:open'),
  },
  widget: {
    onRun: on('widget:run'),
    onTone: on('widget:tone'),
    onAlign: on('clock:align'),
    reportSize: (w, h) => ipcRenderer.send('clock:size', w, h),
  },
  arrange: {
    pointer: (ev) => ipcRenderer.send('arrange:pointer', ev),
    key: (ev) => ipcRenderer.send('arrange:key', ev),
    action: (a) => ipcRenderer.send('arrange:action', a),
    onState: on('arrange:state'),
  },
});
