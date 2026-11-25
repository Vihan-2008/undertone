'use strict';
// Win32 glue: put a BrowserWindow into the wallpaper layer (behind the desktop
// icons), take it back out, and tell whether something covers it.
//
// Two desktop layouts exist:
//  - "Raised desktop" (Windows 11 24H2 and later): Progman has
//    WS_EX_NOREDIRECTIONBITMAP and owns both SHELLDLL_DefView (icons) and the
//    WorkerW that paints the wallpaper. We become a layered child of Progman,
//    z-ordered between the two.
//  - Older builds: after message 0x052C, a top-level WorkerW sits behind the
//    one that holds SHELLDLL_DefView. We become a child of that WorkerW.

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

koffi.struct('UT_RECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' });
koffi.struct('UT_POINT', { x: 'int', y: 'int' });
const EnumProc = koffi.proto('bool __stdcall UT_EnumProc(intptr hwnd, intptr lp)');

const api = {
  FindWindowW: user32.func('intptr __stdcall FindWindowW(str16 cls, str16 name)'),
  FindWindowExW: user32.func('intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)'),
  SendMessageTimeoutW: user32.func('intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint msg, uintptr wp, intptr lp, uint flags, uint timeout, _Out_ uintptr *res)'),
  GetWindowLongPtrW: user32.func('int64 __stdcall GetWindowLongPtrW(intptr hwnd, int idx)'),
  SetWindowLongPtrW: user32.func('int64 __stdcall SetWindowLongPtrW(intptr hwnd, int idx, int64 v)'),
  SetLayeredWindowAttributes: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr hwnd, uint32 key, uint8 alpha, uint32 flags)'),
  SetParent: user32.func('intptr __stdcall SetParent(intptr child, intptr parent)'),
  GetParent: user32.func('intptr __stdcall GetParent(intptr hwnd)'),
  IsWindow: user32.func('bool __stdcall IsWindow(intptr hwnd)'),
  IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
  IsIconic: user32.func('bool __stdcall IsIconic(intptr hwnd)'),
  SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ UT_RECT *r)'),
  ScreenToClient: user32.func('bool __stdcall ScreenToClient(intptr hwnd, _Inout_ UT_POINT *pt)'),
  EnumWindows: user32.func('bool __stdcall EnumWindows(UT_EnumProc *cb, intptr lp)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16_t *buf, int max)'),
  DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ int32 *val, uint32 size)'),
};

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
const LWA_ALPHA = 0x2;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x20;
const SWP_SHOWWINDOW = 0x40;
const HWND_TOPMOST = -1;
const DWMWA_CLOAKED = 14;

const u32 = (v) => Number(BigInt.asUintN(32, BigInt(v)));
const getStyle = (h) => u32(api.GetWindowLongPtrW(h, GWL_STYLE));
const getExStyle = (h) => u32(api.GetWindowLongPtrW(h, GWL_EXSTYLE));
const setStyle = (h, v) => api.SetWindowLongPtrW(h, GWL_STYLE, v >>> 0);
const setExStyle = (h, v) => api.SetWindowLongPtrW(h, GWL_EXSTYLE, v >>> 0);

function className(h) {
  const buf = new Uint16Array(128);
  const n = api.GetClassNameW(h, buf, 128);
  return String.fromCharCode(...buf.slice(0, n));
}

function rectOf(h) {
  const r = {};
  api.GetWindowRect(h, r);
  return r;
}

function hwndOf(win) {
  return Number(win.getNativeWindowHandle().readBigUInt64LE(0));
}

/** Find (and if needed, create) the layer the wallpaper lives in. */
function findDesktopLayer() {
  const progman = api.FindWindowW('Progman', null);
  if (!progman) return null;
  const raised = (getExStyle(progman) & WS_EX_NOREDIRECTIONBITMAP) !== 0;
  // Ask Progman to split the wallpaper out from the icon layer.
  api.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, [0]);

  if (raised) {
    const defView = api.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
    const workerW = api.FindWindowExW(progman, 0, 'WorkerW', null);
    return { raised, progman, defView, workerW, parent: progman };
  }
  let defView = 0;
  let workerW = 0;
  api.EnumWindows((top) => {
    const p = api.FindWindowExW(top, 0, 'SHELLDLL_DefView', null);
    if (p) {
      defView = p;
      workerW = api.FindWindowExW(0, top, 'WorkerW', null);
    }
    return true;
  }, 0);
  if (!workerW) return null;
  return { raised, progman, defView, workerW, parent: workerW };
}

const original = new Map(); // hwnd -> { style, exStyle }

/**
 * Move a window into the wallpaper layer at the given screen rectangle
 * (physical pixels). Returns the layer it attached to, or null.
 */
function attach(win, screenRect) {
  const h = hwndOf(win);
  const layer = findDesktopLayer();
  if (!layer) return null;
  if (!original.has(h)) original.set(h, { style: getStyle(h), exStyle: getExStyle(h) });

  const base = original.get(h);
  setStyle(h, (base.style & ~WS_POPUP) | WS_CHILD);
  if (layer.raised) {
    // Must be layered before SetParent; alpha 255 keeps per-pixel alpha working.
    setExStyle(h, base.exStyle | WS_EX_LAYERED);
    api.SetLayeredWindowAttributes(h, 0, 255, LWA_ALPHA);
  }
  if (!api.SetParent(h, layer.parent)) return null;
  place(win, screenRect, layer);
  return layer;
}

/** Position an attached window, given a screen rectangle in physical pixels. */
function place(win, screenRect, layer = findDesktopLayer()) {
  if (!layer) return;
  const h = hwndOf(win);
  const pt = { x: screenRect.x, y: screenRect.y };
  api.ScreenToClient(layer.parent, pt);
  if (layer.raised) {
    // Sit directly under the icon layer, above the wallpaper WorkerW.
    api.SetWindowPos(h, layer.defView, pt.x, pt.y, screenRect.width, screenRect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
  } else {
    api.SetWindowPos(h, 0, pt.x, pt.y, screenRect.width, screenRect.height, SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW);
  }
}

/** Take a window back out of the wallpaper layer as a normal top-level window. */
function detach(win, screenRect, { topmost = false } = {}) {
  const h = hwndOf(win);
  const base = original.get(h);
  if (!base) return;
  api.SetParent(h, 0);
  setStyle(h, base.style);
  setExStyle(h, base.exStyle);
  original.delete(h);
  api.SetWindowPos(h, topmost ? HWND_TOPMOST : 0, screenRect.x, screenRect.y, screenRect.width, screenRect.height,
    SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW | (topmost ? 0 : SWP_NOZORDER));
}

/** Is the window still where we put it (Explorer restarts replace Progman)? */
function isAttached(win) {
  const h = hwndOf(win);
  if (!original.has(h)) return false;
  const layer = findDesktopLayer();
  return !!layer && api.GetParent(h) === layer.parent;
}

function isCloaked(h) {
  const v = [0];
  return api.DwmGetWindowAttribute(h, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
}

const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'TopLevelWindowForOverflowXamlIsland']);

/**
 * For each target rectangle (physical px), report whether a visible top-level
 * window of another process covers it completely.
 */
function coveredRects(rects) {
  const pid = process.pid;
  const out = rects.map(() => false);
  if (!rects.length) return out;
  api.EnumWindows((h) => {
    if (!api.IsWindowVisible(h) || api.IsIconic(h)) return true;
    const ex = getExStyle(h);
    if (ex & (WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW)) return true;
    const owner = [0];
    api.GetWindowThreadProcessId(h, owner);
    if (owner[0] === pid) return true;
    if (IGNORED_CLASSES.has(className(h))) return true;
    if (isCloaked(h)) return true;
    const r = rectOf(h);
    rects.forEach((t, i) => {
      if (out[i]) return;
      if (r.left <= t.x && r.top <= t.y && r.right >= t.x + t.width && r.bottom >= t.y + t.height) out[i] = true;
    });
    return !out.every(Boolean);
  }, 0);
  return out;
}

/** Set (or clear) a window's owner. An owned window always stays above its owner. */
function setOwner(win, ownerWin) {
  api.SetWindowLongPtrW(hwndOf(win), -8, ownerWin ? hwndOf(ownerWin) : 0);
}

function physicalRectOf(win) {
  const r = rectOf(hwndOf(win));
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

module.exports = { attach, detach, place, isAttached, coveredRects, physicalRectOf, findDesktopLayer, hwndOf, setOwner };
