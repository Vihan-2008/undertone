// Time and date formatting for the desktop clock (DESIGN.md 5.1, 5.2).

const ONES = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const STEPS = { 5: 'five', 10: 'ten', 15: 'quarter', 20: 'twenty', 25: 'twenty-five', 30: 'half' };

/**
 * Time in words, rounded to the nearest five minutes, always 12-hour.
 * Returns two lines: ['quarter', 'to ten'], ['twenty-five', 'to eleven'], ['ten', "o'clock"].
 */
export function timeInWords(d) {
  let total = d.getHours() * 60 + d.getMinutes() + (d.getSeconds() >= 30 ? 1 : 0);
  total = Math.round(total / 5) * 5;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  if (m === 0 && h === 12) return ['noon'];
  if (m === 0 && h === 0) return ['midnight'];
  if (m === 0) return [ONES[h % 12], "o'clock"];
  const past = m <= 30;
  const step = STEPS[past ? m : 60 - m];
  const hour = ONES[(past ? h : h + 1) % 12];
  const rel = past ? 'past' : 'to';
  // Break before past / to when the first part is one word, otherwise after it.
  return [step, `${rel} ${hour}`];
}

export function timeParts(d, { h24 = false, seconds = false } = {}) {
  let h = d.getHours();
  if (!h24) h = h % 12 || 12;
  return {
    hh: h24 ? String(h).padStart(2, '0') : String(h),
    mm: String(d.getMinutes()).padStart(2, '0'),
    ss: seconds ? String(d.getSeconds()).padStart(2, '0') : '',
  };
}

/** Long 'Tuesday 24 November', Short 'Tue 24 Nov', None ''. Day-month order follows the region. */
export function dateText(d, mode, locale) {
  if (!mode || mode === 'none' || mode === 'off') return '';
  const long = mode === 'long';
  const opts = { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short' };
  let parts;
  try {
    parts = new Intl.DateTimeFormat(locale || undefined, opts).formatToParts(d);
  } catch {
    parts = new Intl.DateTimeFormat(undefined, opts).formatToParts(d);
  }
  const want = parts.filter((p) => p.type === 'weekday' || p.type === 'day' || p.type === 'month');
  const weekday = want.find((p) => p.type === 'weekday');
  const rest = want.filter((p) => p.type !== 'weekday').map((p) => p.value.replace(/\.$/, ''));
  return [weekday && weekday.value.replace(/\.$/, ''), ...rest].filter(Boolean).join(' ');
}

export const WEIGHT_NAMES = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black',
};

/** Weights each clock font really has; anything else snaps to the nearest. */
export const FONT_WEIGHTS = {
  Bahnschrift: [300, 350, 400, 600, 700],
  'Segoe UI': [300, 400, 600, 700, 900],
  Sitka: [400, 700],
  Georgia: [400, 700],
  Cambria: [400, 700],
  'Cascadia Mono': [200, 300, 400, 600, 700],
  Consolas: [400, 700],
  Impact: [400],
};

/** The settings list stores family names; these are the ones with a shorter display name. */
export function fontKey(font) {
  if (/^Segoe UI/.test(font)) return 'Segoe UI';
  if (/^Sitka/.test(font)) return 'Sitka';
  return font;
}

export function snapWeight(font, w) {
  const list = FONT_WEIGHTS[fontKey(font)];
  if (!list) return w;
  return list.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
}

/** CSS font-family stack for a clock font name. */
export function fontStack(font) {
  switch (fontKey(font)) {
    case 'Segoe UI': return '"Segoe UI Variable Display", "Segoe UI", sans-serif';
    case 'Sitka': return '"Sitka Display", "Sitka Heading", Sitka, "Sitka Text", Georgia, serif';
    case 'Cascadia Mono': return '"Cascadia Mono", "Cascadia Code", Consolas, monospace';
    case 'Bahnschrift': return 'Bahnschrift, "Segoe UI", sans-serif';
    default: return `"${font}", Bahnschrift, "Segoe UI", sans-serif`;
  }
}
