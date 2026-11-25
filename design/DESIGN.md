# Undertone design spec

A music visualizer that lives on the Windows wallpaper. This file is the source of truth for
tokens, sizes, behaviour, states and copy. The mockups in `design/mockups/` show the same things
rendered; where they disagree with this file, this file wins.

**Direction.** Ink black, paper-white type, one vermilion accent. Square corners, hairlines,
labeled rows. No glass, no blur panels, no glowing borders, no cards, no icon beside every label.
**Only the visualizer glows.** Three things look like effects but are content, and are allowed:
the blurred cover behind the full-screen player (it is the room's light), the drop shadow under a
cover image, and the shadow and ink wash under text that sits directly on the wallpaper
(legibility).

**The frequent task** is choosing how the visualizer looks while watching it. So in settings the
live preview and the style and colour pickers come first and get the space; everything occasional
sits in labeled rows or behind a tab. On the desktop there is no chrome at all.

All sizes are logical pixels at 100 % scaling unless marked `vh`.

Files:

| File | What it is |
|---|---|
| `mockups/tokens.css` | Tokens, base reset, focus rule. Ship it. (The `.wallpaper` and `.cover-art` classes at the bottom are mockup stand-ins.) |
| `mockups/settings.html` + `settings.css` | Settings window, real size 960 x 680. Wire this up; keep structure and class names. |
| `mockups/widget.html` + `desktop.css` | Both wallpaper widgets on a 1920 x 1080 desktop, and Arrange mode. |
| `mockups/fullscreen.html` + `fullscreen.css` | Full-screen player. |
| `mockups/mockup.js` | Mockup only: draws static visualizer stand-ins into `canvas[data-viz]`, and turns `?key=value` into `data-key="value"` on `<body>` so every state has a URL. Do not ship. |

State is always a `data-*` attribute on `<body>` (or on the row it concerns). The header comment
of each HTML file lists its attributes and example URLs.

---

## 1. Tokens

### 1.1 Colour

| Token | Hex | Use | Contrast on ink |
|---|---|---|---|
| `--ink` | `#0D0D0C` | Window background, arrange bar, readout tags | |
| `--ink-2` | `#171715` | Raised: tiles, inputs, hover fill | |
| `--ink-3` | `#22211F` | Pressed, meter track | |
| `--rule` | `#302F2B` | Hairlines, control borders | |
| `--rule-strong` | `#4A4843` | Control borders on hover, slider track, button border | |
| `--paper` | `#EFEBE2` | Primary text, slider fill, focus ring | 16 : 1 |
| `--paper-2` | `#AAA59B` | Secondary text, values, notes | 7.9 : 1 |
| `--paper-3` | `#77736B` | Tertiary: scale numbers, inactive lyric lines, off-state knob. Never body copy | 4.1 : 1 |
| `--vermilion` | `#EB4A22` | The one accent | 5.1 : 1 |
| `--vermilion-ink` | `#1A0803` | Text on a vermilion fill (not currently used) | |

Rules for vermilion. It means exactly three things:

1. **Current choice**: active tab underline, selected style / face / colour tile outline, selected
   segment underline, selected radio dot, a switch that is on, the current lyric's timestamp.
2. **Snapped**: guide lines in Arrange mode. Level-meter peak ticks.
3. **Problem**: only as the outline and glyph of the boxed `!` mark (`.mark`). Problem *text* is
   paper, never red. A problem is always mark + words, never colour alone.

Vermilion is never a button fill, a focus ring, a border on something unselected, or a gradient.

Focus is a 2 px solid `--paper` outline, offset 2 px (`:focus-visible`). No glow.

### 1.2 Type

Windows fonts only. Three families, one job each:

| Token | Stack | Job |
|---|---|---|
| `--font-ui` | `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif` | Labels, body, buttons, now-playing line |
| `--font-instrument` | `Bahnschrift, "Segoe UI Variable Display", "Segoe UI", sans-serif` | Anything that reads like an instrument: the app name, group titles, every number and readout, key caps, the clock |
| `--font-liner` | `"Sitka Display", "Sitka Heading", Sitka, "Sitka Text", Georgia, serif` | The music's own words: full-screen title, lyrics, the Words clock face |

Bahnschrift ships with Windows 10 1709 and later. Segoe UI Variable is Windows 11; Windows 10
falls through to Segoe UI. Sitka ships with 8.1 and later. Numbers always use
`font-variant-numeric: tabular-nums` (class `.num`).

Settings window scale (px / line-height / weight):

| Role | Size | Family | Weight |
|---|---|---|---|
| App name | 15 / 1 | instrument, `font-stretch: 87.5%`, tracking 0.01em | 600 |
| Group and picker titles | 15 / 20 | instrument, `font-stretch: 87.5%`, tracking 0.01em | 600 |
| Row labels, controls, tabs, status | 13 / 1.4 | ui | 400 |
| Values (`output`) | 13 | instrument, tabular | 400 |
| Notes, source sub-lines, key caps | 12 / 17 | ui (key caps: instrument) | 400 |
| Meter scale | 11 | instrument | 400 |

Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows.

### 1.3 Space and shape

4 px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32,
`--s-12` 48. Corners are square (`border-radius: 0`). Radio dots are the only round thing.
Borders are 1 px. Nothing in the chrome has a `box-shadow` except the inset 2 px underline on a
selected segment.

### 1.4 Motion

One curve for almost everything: `--ease: cubic-bezier(0.2, 0, 0, 1)`. Exits may use
`--ease-out: cubic-bezier(0.3, 0, 1, 1)`. No overshoot, no bounce, no ambient motion in chrome.

| Token | Duration | Use |
|---|---|---|
| `--t-quick` | 120 ms | Hover, press, switch knob, colour changes |
| `--t-standard` | 200 ms | Arrange mode lift and drop, toast, hint fades |
| `--t-slow` | 450 ms | Lyric advance, transport fade, cover / lyrics layout shift, full-screen enter (exit 300 ms) |

Other timed things: palette crossfade on track change 800 ms linear; cover drift 64 s
ease-in-out, alternate, infinite; transport hides after 2.5 s without mouse movement.
`prefers-reduced-motion`: all transitions 0 ms, cover drift off, lyric advance is a cut.
Tab changes in settings are instant (no transition).

---

## 2. Visualizer

### 2.1 Styles

Eleven styles, all free. Value and order used everywhere (grid, tray submenu, `V` key cycle):

| # | value | Name | Drawing | Density 0 to 100 maps to | Feather into wallpaper |
|---|---|---|---|---|---|
| 1 | `bars` | Bars | Vertical bars from the baseline, vertical gradient low to high | 16 to 128 bars | Left and right 8 % |
| 2 | `mirror` | Mirror | Bars mirrored about the horizontal centre line, bass in the middle | 12 to 96 bars per side | Left and right 8 % |
| 3 | `blocks` | Blocks | LED segments, 10 px rows, colour by row height | 12 to 64 columns | Left and right 8 % |
| 4 | `ring` | Ring | Spokes around a circle, radius 26 % of the short side | 32 to 180 spokes | None needed |
| 5 | `wave` | Wave | Oscilloscope line, 2.5 px, gradient left to right | 64 to 512 points | Amplitude envelope falls to 0 at both ends |
| 6 | `aurora` | Aurora | Three to five soft filled ribbons at 50 % alpha | 2 to 5 ribbons | Left and right 8 %, top 20 % |
| 7 | `orb` | Orb | Radial-gradient disc whose outline wobbles with the spectrum | 8 to 64 harmonics | None needed |
| 8 | `waterfall` | Waterfall | Scrolling spectrogram, newest row at the bottom | 24 to 128 columns | Left and right 8 %, rows fade to 30 % alpha at the top |
| 9 | `particles` | Particles | Dots thrown upward by band energy | 60 to 600 particles | Natural |
| 10 | `terrain` | Terrain | Stacked spectrum lines, oldest at the back | 6 to 24 lines | Left and right 8 %, back lines 35 % alpha |
| 11 | `meters` | Meters | Left and right VU bars with peak ticks | Not used. The Density row is disabled and its value reads `n/a` | Left and right 8 % |

"Feather" is an alpha mask on the canvas (`mask-image: linear-gradient(90deg, transparent,
#000 8%, #000 92%, transparent)`), so there is never a visible box. `mockup.js` contains a rough
reference drawing for each style.

Resting state (silence): every style settles over 600 ms to a single 2 px baseline at 50 % alpha
in the mid colour. It never disappears completely, so the user can still see where the widget is.

### 2.2 Colour themes

Every palette is three stops: **low** (quiet, base of a bar), **mid** (body, also the glow
colour), **high** (peaks). Interpolate in sRGB between adjacent stops.

| value | Name | low | mid | high |
|---|---|---|---|---|
| `ember` (default) | Ember | `#7A1E0A` | `#EB4A22` | `#FFC27A` |
| `paper` | Paper | `#6F6B64` | `#CFCAC0` | `#FFFFFF` |
| `tide` | Tide | `#0E3B5C` | `#1F9EC9` | `#B8F1FF` |
| `moss` | Moss | `#1F4D2E` | `#6FBF4A` | `#E6F58A` |
| `sodium` | Sodium | `#5C3B00` | `#F2A413` | `#FFF1B0` |
| `prism` | Prism | `#2B6BFF` | `#E0457B` | `#FFC94A` |
| `custom` | Custom | built from `visualizer.customAccent` | | |
| `cover` | From cover | built from the current cover | | |

**Custom accent rule.** Convert the accent to OKLCH `(L, C, h)`.

- If `C < 0.03` (a grey): low `oklch(0.42 0 0)`, mid `oklch(clamp(L, 0.60, 0.85) 0 0)`,
  high `oklch(0.98 0 0)`.
- Otherwise:
  - mid = `oklch(clamp(L, 0.58, 0.76)  clamp(C, 0.10, 0.22)  h)`
  - low = `oklch(0.34  midC x 0.75  h - 18deg)`
  - high = `oklch(0.90  midC x 0.45  h + 28deg)`
- Map each stop into sRGB by reducing chroma until it fits. The clamps mean a near-black or
  near-white accent still gives a readable three-step ramp.

The Custom swatch chip shows the three computed stops and updates as the colour is picked.

**From cover rule.** Downscale the cover to 32 x 32, convert to OKLCH, ignore pixels with
`L < 0.15` or `L > 0.95`. Bucket the rest into 12 hue bins weighted by chroma. The heaviest bin's
mean colour is the accent: run the Custom rule on it. If a second bin holds at least 20 % of the
heaviest bin's weight and is 60 degrees or more away in hue, use its mean (L forced to 0.88,
chroma x 0.6) as **high** instead. If the mean chroma of the kept pixels is under 0.03, use
Paper. If the track has no cover, keep the palette that was showing. Crossfade 800 ms on track
change. The From cover chip shows the current result; with no cover yet it shows the hatched
`.swatch__chip--none`.

The full-screen player always uses From cover by default (section 6).

### 2.3 Glow, backdrop, opacity, album glow

- **Glow** `0 to 100`, default 40: blur radius `glow / 100 x 24 px` (scaled by widget height / 220),
  glow alpha `glow / 100 x 0.8`, colour = mid. 0 draws flat.
- **Backdrop** `0 to 100`, default 0, value reads `Off` at 0: an ink (`#0D0D0C`) rectangle on the
  widget's bounds at alpha `backdrop / 100 x 0.92`. Square corners, no border. As soon as it is
  above 0: the edge feather is switched off, content is inset 16 px, and the now-playing ink wash
  is removed (the surface does that job).
- **Opacity** `20 to 100 %`, default 100: whole widget.
- **Album glow**, default off: a soft blob of the cover's mid colour behind the visualizer,
  80 % of the widget's width, 55 % alpha, blur 28 px. Follows the cover even when the theme is a
  preset. Hidden when there is no cover.

---

## 3. Wallpaper widget: visualizer and now-playing line

Mockup: `widget.html`. Default size 640 x 220. The window is transparent, click-through, and
shows no chrome of any kind. The wallpaper never shows a message, an error or a hint.

Inside the widget the visualizer takes the full width and all height above the now-playing line
(60 px reserved for Compact and Centred, 36 px for Text only, 0 for Off).

### 3.1 Now-playing layouts (`nowPlaying.layout`)

| value | Name | Layout |
|---|---|---|
| `compact` (default) | Compact | Bottom-left. 40 px cover, 12 px gap, title over artist |
| `centred` | Centred | Bottom-centre. No cover. Title over artist, centre aligned |
| `cover` | Cover | 96 px cover bottom-left, bottom-aligned with the text to its right. The visualizer starts 112 px in, so it sits beside the cover instead of above it |
| `text` | Text only | Bottom-left, one line: title, 10 px gap, artist. No cover |
| `off` | Off | Nothing. The visualizer takes the full height |

Type: title Segoe UI 600 15 / 20, `--paper`. Artist Segoe UI 400 13 / 18, paper at 88 % alpha.
Both single-line with ellipsis; the line can use the widget's full width and no more.
Below 320 px widget width Cover falls back to Compact. Below 120 px height the line hides.

### 3.2 Legibility without a box

Two layers, both always on unless Backdrop is above 0:

1. Text shadow `0 1px 2px rgba(0,0,0,.85), 0 0 14px rgba(0,0,0,.55)` (`--wall-shadow`).
2. **Ink wash**: a radial gradient behind the line only, `rgba(0,0,0,.44)` at the centre through
   `rgba(0,0,0,.2)` at 60 % to transparent, extending 26 px above and below and 56 px left and
   right of the line. It has no edge, so it reads as the wallpaper being slightly darker there,
   not as a panel.

The cover thumbnail gets `0 1px 3px rgba(0,0,0,.6)`.

**Tone.** Paper text cannot hold on a near-white wallpaper however much shadow it gets (checked
in the Light preview). So the line picks its tone from the wallpaper behind it: take the mean
relative luminance of the wallpaper inside the line's bounds; above 0.60 switch to **ink tone**,
back to paper below 0.50 (the gap stops flicker when the widget is dragged). Ink tone
(`data-tone="ink"` on `.np`): text `#0D0D0C`, artist at 80 % alpha, shadow
`0 1px 2px rgba(255,255,255,.8), 0 0 14px rgba(255,255,255,.6)` (`--wall-shadow-ink`), and the
wash turns white: `rgba(255,255,255,.5)` to transparent. Re-evaluate when the widget moves, the
wallpaper changes, or a slideshow advances. The settings preview follows the same rule; its
`Light` option shows ink tone.

### 3.3 States on the wallpaper

| Situation | What the widget shows |
|---|---|
| Playing, track known | Visualizer + now-playing line |
| Audio but no media session | Visualizer only. The line is absent |
| Silence | Resting baseline (2.1). Line stays if a track is known and paused, otherwise absent |
| Track changes | Line cross-fades 200 ms; palette (if From cover) 800 ms |
| Covered by a maximised or full-screen window | Drawing stops. Last frame stays. Resumes within one frame of being uncovered |
| Audio source failed | Falls back to System audio and keeps drawing. The problem is reported in settings and the tray only |

---

## 4. Arrange mode

Mockup: `widget.html?mode=arrange` and `?mode=first-run`.

Wallpaper-layer windows get no mouse input, so moving and resizing happen in a separate mode.

**Enter**: `Ctrl+Alt+A` (rebindable), tray menu **Arrange widgets**, or the **Arrange widgets**
button in the settings status bar. If settings is open it hides, and comes back when the mode ends.
**Leave**: **Done**, `Enter`, `Esc`, or the hotkey again. All four keep the changes; changes
apply live and there is no cancel. `Ctrl+Z` steps back through moves and resizes made in this
session of the mode (10 steps).

### 4.1 What appears

One transparent, always-on-top overlay window per display.

| Element | Spec |
|---|---|
| Scrim | `rgba(13,13,12,.5)` over every display, so widgets read against any wallpaper. Icons and windows underneath are not clickable while the mode is on |
| Widgets | Lift above the scrim at full brightness and keep animating. Each gets a 1 px outline: `rgba(239,235,226,.5)` normally, solid `--paper` when selected. Cursor `move` |
| Handles | Selected widget only, four corners. Visible 9 x 9 px paper square with a 1 px ink border, centred on the corner. Hit area 28 x 28 px. Cursors `nwse-resize` / `nesw-resize` |
| Readout tag | Above the top-left corner, 8 px gap. Ink fill, 22 px tall, 8 px side padding, Bahnschrift 12 tabular. Visualizer: `Visualizer  640 x 220` (name weight 600, use the real multiplication sign). Clock: `Clock  96 px`. While dragging it switches to position: `x 640  y 764`. If the tag would leave the display it moves below the bottom-left corner |
| Snap guides | 1 px `--vermilion` lines spanning the display's work area, shown only while a snap is engaged |
| Arrange bar | Top-centre of the primary display's work area, 24 px from the top. If the selected widget's outline comes within 16 px of it, it moves to bottom-centre, 24 px above the work-area bottom. 44 px tall, ink fill, 1 px `--rule-strong` border, no shadow |

Arrange bar contents, left to right: **Arranging** (Bahnschrift 600 15) / hint (paper-2) / hairline /
`Centre` / `Reset` / **Done** `Enter` (paper fill, ink text, weight 600; the only filled button in
the product).

- Hint, usual: `Drag to move. Pull a corner to resize. Arrow keys nudge.`
- Hint, first run: `Drag to move. Pull a corner to resize. Ctrl+Alt+A brings this back any time.`
  (substitute the current binding; if the hotkey is unassigned or in conflict:
  `...Arrange widgets in the tray menu brings this back any time.`)
- `Centre`: centres the selected widget horizontally in its display's work area.
- `Reset`: selected widget back to its default size and position (section 8).

### 4.2 Moving and resizing

- Click selects, drag anywhere on a widget moves it. The visualizer is selected on entry.
- **Visualizer** resizes freely. Min 240 x 80, max the work area of its display. `Shift` while
  dragging a handle locks the aspect ratio.
- **Clock** always scales uniformly: dragging a handle changes `clock.size` (24 to 320 px).
- **Snapping**, threshold 8 px, engaged per axis. Targets, for the widget's edges and centre:
  the work-area edges, a 48 px margin inside each work-area edge, the work area's horizontal and
  vertical centre, and the other widget's edges and centres. `Alt` held disables snapping.
- Widgets cannot leave the union of the displays; at least 48 px of a widget stays on a display.
  Snap targets come from the display under the widget's centre. A widget on a display that is
  later unplugged moves to the primary display's default position.
- Keyboard: `Tab` / `Shift+Tab` switch widget. Arrows nudge 1 px, `Shift`+arrows 10 px.
  `Ctrl`+arrows resize 1 px from the bottom-right, `Ctrl+Shift`+arrows 10 px (clock: 2 px of size).
  `C` centre, `R` reset, `Enter` or `Esc` done.

### 4.3 Motion

Enter (200 ms, `--ease`): scrim fades 0 to 0.5; outlines, handles and tags fade in together; the
bar fades in and moves down 8 px into place. Widgets themselves do not scale or bounce.
Snap: the widget jumps to the target with no easing and the guide appears instantly; guides fade
out over 120 ms when released. Leave (200 ms, `--ease-out`): everything fades, widgets drop back
to the wallpaper layer at the end of the fade.

---

## 5. Desktop clock

Mockup: `widget.html?face=...`. A second wallpaper widget with the same rules: no box, no chrome,
click-through, placed in Arrange mode. `S` below is `clock.size`.

### 5.1 Faces (`clock.face`)

| value | Name | Layout |
|---|---|---|
| `digital` (default) | Digital | `21:47` at S. Date below at max(13 px, 0.19 S), gap 0.1 S. Seconds, if on, at 0.45 em and 70 % alpha after the minutes |
| `stacked` | Stacked | Hours over minutes, each at S, line-height 0.84, weight forced to at least 600, minutes at 60 % alpha (or the second gradient colour). Date below |
| `minimal` | Minimal | `21 47` with a space instead of a colon, tracking +0.06 em, weight forced to at most 300. Never shows date or seconds; those rows are disabled with value `n/a` |
| `analog` | Analog | Dial of diameter 2 S. Four quarter ticks (2.5 px) and eight minor ticks (1 px, 70 %), no numerals, no ring. Hour hand 5 px to 52 % radius, minute hand 2.5 px to 80 %, optional second hand 1 px to 88 %. Date centred below. Font options only affect the date |
| `words` | Words | Time in words on two lines at 0.5 S in `--font-liner` unless another font is chosen, lower-case. Date below |
| `line` | Day line | A 1 px line 5 S wide for the 24 hours, ticks at 0, 6, 12, 18 and 24, a 2 px marker at the current time, the digital time at 0.34 S centred above the marker, date above the line's left end in the clock colour (`clock.colourA`, never the fill), moving to the right end whenever the time label would touch it. Gradient and Match fills colour the time label only |

Text alignment follows the widget's position: right-aligned when its centre is in the right
third of the display, centred in the middle third, left-aligned in the left third.

**Words rules.** Round to the nearest five minutes. `:00` is `ten o'clock`; `:05` to `:30` are
`five past ten`, `ten past`, `quarter past`, `twenty past`, `twenty-five past`, `half past`;
`:35` to `:55` count to the next hour: `twenty-five to eleven`, `twenty to`, `quarter to`,
`ten to`, `five to`. 12:00 is `noon`, 00:00 is `midnight`. Always 12-hour words, no am or pm.
Line break before `past` / `to` when the first part is one word (`quarter` / `to ten`), otherwise
after it (`twenty-five` / `to eleven`). Seconds and 24-hour do not apply (rows disabled, `n/a`).

### 5.2 Options

See the schema in section 9. Notes:

- **Font** list (Windows only): Bahnschrift, Segoe UI, Sitka, Georgia, Cambria, Cascadia Mono,
  Consolas, Impact. If a font is missing (Cascadia Mono on a stock Windows 10), leave it out of the list.
- **Weight** 100 to 900 in steps of 100; the value reads the name (`Thin`, `Extra light`, `Light`,
  `Regular`, `Medium`, `Semibold`, `Bold`, `Extra bold`, `Black`). Snap to the nearest weight the
  chosen font has; for single-weight fonts (Impact, Consolas has two) disable the row, value `n/a`.
- **Letter spacing** -5 to 30, in hundredths of an em.
- **Fill**: Solid (one colour), Gradient (two colours, top to bottom), Match visualizer (uses the
  visualizer's mid stop top, high stop bottom, and follows it live). The colour row hides for Match
  visualizer; the second well and hex field show only for Gradient.
- **Shadow** on by default: `0 1px 2px rgba(0,0,0,.6), 0 2px 12px rgba(0,0,0,.45), 0 0 40px rgba(0,0,0,.35)`.
  This is the legibility layer; with it off the user is trusting their wallpaper. The shadow is
  dark when the clock colour's luminance is above 0.5 and white (`rgba(255,255,255,.7 / .5 / .4)`,
  same offsets) when it is below, so a dark clock on a bright wallpaper is also covered.
- **Default colour on first run** is chosen once from the wallpaper under the clock's default
  position, using the tone rule in 3.2: `#EFEBE2` normally, `#0D0D0C` when that area is bright.
  After that the colour is the user's; it does not change by itself.
- **24-hour** defaults to the Windows region setting. 12-hour shows no am / pm on Digital and Stacked.
- **Date**: Long `Tuesday 24 November`, Short `Tue 24 Nov`, None. Day-month order follows the Windows region.

---

## 6. Full-screen player

Mockup: `fullscreen.html`. Global hotkey `Ctrl+Alt+F` toggles it on the display under the mouse.
All sizes in `vh` (1 vh = 10.8 px at 1080p).

### 6.1 Layers, back to front

1. **Room light**: the cover scaled to 150 % of the screen, `blur(9vh) saturate(1.25)`, 78 % alpha,
   drifting: translate from (-3 %, -2 %) to (3 %, 2 %), scale 1 to 1.12, rotate 0 to 6 degrees, 64 s
   ease-in-out, alternate. Paused when playback is paused.
2. **Shade**: vertical ink gradient, alpha 0.38 at the top, 0.52 at 55 %, 0.78 at the bottom, so
   text always sits on something dark.
3. **Visualizer**: a horizon along the bottom edge, full width, 24 vh tall, 85 % alpha, top 30 %
   masked to transparent. It sits under the cover and lyrics, never behind text. Default style
   Mirror. Drops to 25 % alpha when paused.
4. **Now column**, **lyrics column**, **keys**.

### 6.2 Layout

Everything in the now column hangs off the cover's left edge.

| Element | Lyrics showing | No lyrics (off, not found, nothing playing) |
|---|---|---|
| Cover, 40 vh square, shadow `0 2.4vh 6vh rgba(0,0,0,.45)` | left 12.5 vw, top 15 vh | left `50vw - 20vh` (dead centre), top 15 vh |
| Title: Sitka 3.5 vh / 1.14, two lines max then ellipsis | 3.2 vh under the cover, width max(40 vh, 30 vw) | width 40 vh |
| Artist: Segoe UI 1.9 vh, paper 78 %, one line, ellipsis | 0.9 vh under the title | same |
| Progress: `1:42` hairline `4:07`, Bahnschrift 1.4 vh, bar 2 px, width 40 vh | 2.6 vh under the artist | same |
| Transport: previous, play / pause, next | 1.4 vh under progress, pulled left 1.5 vh so the first glyph sits on the cover's edge | same |
| Lyrics column | left 52 vw, right 7 vw | hidden |
| Keys row | top 5 vh, left aligned with the cover | same |

The move between the two layouts takes 450 ms (`left` on the now column, lyrics fade).

**Transport.** Three bare glyphs, no circles, no fills: hit area 5.2 vh square, glyph 2.4 vh
(play / pause 3.2 vh), paper at 82 % alpha, 100 % on hover, 60 % pressed. Focus ring as elsewhere.
The progress bar is display only (media sessions do not all allow seeking).

**Fade.** Progress, transport and the keys row are one group (`.player__chrome`). It is visible
on entry, fades out over 450 ms after 2.5 s without mouse movement (cursor hides too), and fades
back in 120 ms on any mouse movement or key press. Title, artist, cover and lyrics never fade.

### 6.3 Lyrics

Sitka. The current line's top is pinned at 32 vh; the list slides under it.

| Line | Size (Medium) | Opacity |
|---|---|---|
| Previous | 2.8 vh / 1.22 | 0.30 |
| **Current** | **4.6 vh / 1.12** | **1** |
| Next | 2.8 vh | 0.52 |
| Next + 1 | 2.8 vh | 0.34 |
| Next + 2 | 2.8 vh | 0.20 |
| Others | 2.8 vh | 0.20 (clipped by the column) |

Gap 2.4 vh between lines (2.8 vh after the current one). Long lines wrap with
`text-wrap: balance`. Size setting: Small 3.6 / 2.3 vh, Medium 4.6 / 2.8 vh, Large 5.8 / 3.3 vh.
Advance: the list translates and the two lines change size and opacity together, 450 ms `--ease`.
Emphasis is size and opacity only: no colour change, no karaoke fill, no glow.
During an instrumental gap of more than 8 s the current line drops to 0.52 until the next line starts.

### 6.4 Keys

| Key | Does | Feedback |
|---|---|---|
| `Space` | Play or pause | Glyph swaps |
| Left / Right | Previous / next track | |
| `V` | Next visualizer style | Toast `Visualizer: Mirror` |
| `C` | Next colours. Order: From cover, Ember, Paper, Tide, Moss, Sodium, Prism, Custom | Toast `Colours: From cover` |
| `L` | Lyrics on or off | Layout shifts; toast `Lyrics off` / `Lyrics on` |
| `Esc` | Leave | 300 ms fade to the desktop |

Keys row copy: `Space` Play or pause / `Left` `Right` Previous, next / `V` Visualizer / `C` Colours /
`L` Lyrics / `Esc` Leave. Toast: Bahnschrift 1.6 vh, paper, top-right (top 5.4 vh, right 7 vw, on the
keys row's line), in 200 ms, holds 1.5 s, out 200 ms. It shows even while the transport is hidden. `V` and `C` here change only the full-screen
player (`fullscreen.style`, `fullscreen.theme`), not the wallpaper widget.

If lyrics are disabled in settings, `L` shows the toast `Lyrics are off in settings` and does nothing else.

### 6.5 States

| State | What shows |
|---|---|
| Lyrics loading | Lyrics column shows `Looking up lyrics…` (Segoe UI 2.2 vh, paper 60 %) at 34 vh. Layout stays two-column |
| Lyrics not found | `No synced lyrics for this track.` for 4 s, then the column fades and the cover moves to the centre |
| Lyrics off | Centred layout |
| Paused | Play glyph; room light stops drifting; visualizer at 25 % |
| Nothing playing | Room light off (plain ink). Empty cover: a 1 px `rgba(239,235,226,.28)` square. Title `Nothing playing`. Line below: `Start a track in any player and it shows up here.` Progress hidden, transport at 30 % and inert. Centred layout |
| Track has no cover | Empty cover square as above; room light uses the last palette's mid colour as a flat wash at 30 % |
| Silent but a track is known | As Paused |

---

## 7. Settings window

Mockup: `settings.html`. Wire this file; keep its structure and class names.

### 7.1 Window

- **960 x 680**, not resizable by the user (`resizable: false`, `maximizable: false`).
  Background `#0D0D0C`.
- **Short screens.** 680 does not fit every work area (1920 x 1080 at 150 % leaves 672;
  1366 x 768 at 125 % leaves 566). Window height = `clamp(workArea.height - 24, 520, 680)`,
  set when the window is shown. The CSS already adapts to the viewport height: the preview gives
  up height first, `clamp(240px, 100vh - 336px, 344px)`, and below that the picker scrolls
  (`.panel__pick` is `overflow-y: auto`). The right column always scrolls on its own. Width stays 960;
  on a work area narrower than 984 px, scale the window with `zoomFactor = workArea.width / 984`.
- **Title bar decision: a hidden title bar with the native caption-button overlay.**
  `titleBarStyle: 'hidden'`, `titleBarOverlay: { color: '#0D0D0C', symbolColor: '#EFEBE2', height: 40 }`.
  Rationale: the five section tabs live in the bar, which gives the preview 40 px more height than
  a native bar plus a tab row would; the native minimise and close buttons keep their Windows 11
  behaviour and hit sizes; the bar matches the ink instead of the system's grey. Rejected: a full
  native title bar (wrong colour on Windows 10, wastes a row) and fully custom caption buttons
  (re-implements what Windows already does well). `.titlebar` is the drag region
  (`-webkit-app-region: drag`); `.tabs` is `no-drag`. Leave the right 138 px empty: delete
  `.titlebar__caption`, which only stands in for the overlay in the mockup.
- **Opens** on a left click of the tray icon, bottom-right of the work area with a 12 px gap
  (above the tray); remembers its position if moved. Clicking the tray icon again, the close
  button or `Esc` hides it. Closing never quits.
- Always opens on the Visualizer tab unless a problem needs attention (source failed opens Audio).

### 7.2 Layout

```
+--------------------------------------------------------------------------+
| Undertone   Visualizer  Clock  Lyrics  Audio  System            _  [] X  |  40
+--------------------------------------+-----------------------------------+
|                                      |  Colours                          |
|   LIVE PREVIEW  520 x 344            |  [ember][paper][tide ][moss ]     |
|   over the user's wallpaper          |  [sodi ][prism][cust ][cover]     |
|                                      |  -------------------------------  |
+--------------------------------------+  Shape                            |  604
|  Style                               |  Density      ----|-------    50  |
|  [bars ][mirr ][block][ring ]        |  Sensitivity  ----|-------  100%  |
|  [wave ][auror][orb  ][water]        |  ...                              |
|  [parti][terra][meter]               |                                   |
+--------------------------------------+-----------------------------------+
| ||| Salt Lines by Okono Vale               Arrange widgets  Full screen  |  36
+--------------------------------------------------------------------------+
        520 "see": preview + picker                440 "tune": labeled rows
```

- **Left column, 520 px, "see".** The preview is flush to the window's left edge and to the title
  bar: no padding, no frame. At 520 x 344 it is the largest single thing in the window. Under it,
  260 px for the tab's main picker (padding 16 top, 20 sides).
- **Right column, 440 px, "tune".** Hairline on its left edge. Padding 4 / 24 / 24. Scrolls
  vertically on its own if a section is longer than 604 px (only Clock is: 659 px). The right
  column is a list to scan, not something to look at, so it is kept narrow and dense and the
  width goes to the left.
- Groups are separated by a hairline and a title, never boxed. First group in a column has no
  hairline above it.
- **Row** (`.row`): grid `136px | 1fr | 52px` (label, control, value), 12 px gaps, 36 px min height.
  Controls without a value span columns 2 and 3 (`.row__control--full`). Notes are 12 px paper-2,
  max 56 characters wide; `.note--row` aligns a note under the control column.
- Tab order: tabs (one stop, arrows move between them), preview-over, picker, right column top to
  bottom, status bar actions. Radio groups are one stop each with arrow keys inside.

### 7.3 The preview

Always visible, always live, always the real engine.

- It draws over a **copy of the user's actual wallpaper**, cropped from the area behind the
  widget, so feathering and text legibility are honest. The small segmented control in its
  top-left corner (`Wallpaper` / `Dark` / `Light`, 22 px tall, on ink) swaps that for flat
  `#101214` or `#E9E6DF` to check extremes. It is a view option, not a saved look
  (`preview.over`, remembered).
- Visualizer, Audio and System tabs: the visualizer at 472 x 162, 24 px in from the left, with the
  now-playing line under it: the 640 x 220 desktop widget at 74 % scale. When the user's widget has
  a different aspect ratio, fit it inside 472 x 248, bottom-left anchored.
- Clock tab: the clock, centred, at up to 96 px (scaled down to fit when `clock.size` is larger).
- Lyrics tab: a miniature of the full-screen player (room light, cover, four lyric lines). The
  preview-over control hides.
- With no audio the preview shows the resting baseline, not a fake animation.

### 7.4 Controls

| Control | Class | Spec |
|---|---|---|
| Slider | `.slider` | Native `input[type=range]`. Track 2 px: `--paper` up to the thumb, `--rule-strong` after (set `--fill: NN%` inline on input). Thumb 6 x 16 paper bar, 6 x 20 on hover. 24 px tall hit area. Value in an `<output>` to the right. Double-click the thumb resets to default. Arrow keys step once, `Shift`+arrows ten steps |
| Switch | `.switch` | `input[type=checkbox][role=switch]`, 32 x 16, 1 px border, 10 px square knob. Off: knob `--paper-3`. On: border and knob `--vermilion`, knob moves 16 px in 120 ms. The value column reads `On` / `Off`. The row label is the `<label>`, so clicking it toggles |
| Segmented | `.seg` | Radio group. 28 px tall (26 px line + border), options padded 10 px, hairline between. Selected: paper text, `--ink-2` fill, 2 px vermilion underline inside. `.seg--small` is 24 px tall with 8 px padding and 12 px text |
| Select | `.select` | Native `<select>`, 28 px, `--ink-2` fill, 1 px `--rule`, chevron at right |
| Button | `.btn` | 28 px, 12 px side padding, 1 px `--rule-strong` border, transparent; hover `--ink-2`, pressed `--ink-3`. `.btn--quiet`: no border, paper-2 text, paper on hover |
| Colour well | `.well` + `.hexfield` | 28 px square native colour input, plus a 76 px hex field (Bahnschrift, upper case). Invalid hex: field keeps focus, reverts on blur |
| Style tile | `.style-tile` | Radio. Thumb 111 x 44 on `--ink-2`, name below (13 px, 20 px line). Selected: 2 px vermilion outline inside the thumb, name in paper. Grid 4 x 111 px, gaps 12 / 8 |
| Face tile | `.face-tile` | Radio. Thumb 152 x 72, same selection rule. Grid 3 x 152 px |
| Swatch | `.swatch` | Radio. Chip 20 px tall showing the three stops as hard thirds, name below. Selected: 2 px vermilion outline offset 2 px. Grid of 4 |
| Hotkey | `.hotkey` | Button showing key caps (`kbd`: 1 px border, Bahnschrift 12, 20 px line) |

**Style tile previews animate** with a looped synthetic signal: the selected tile always, any
other tile only while hovered or focused. Others hold a still frame. Tiles use the current colour
theme with glow off. Choosing a style applies instantly; there is no Apply or Save anywhere.

Disabled rows (for example Density with Meters): add `.is-disabled` to the `.row` (label and
control drop to 40 % alpha), set the control `disabled`, and set the value text to `n/a`.

### 7.5 Sections

**Visualizer.** Picker: **Style** grid, 11 tiles. Right column:

- **Colours**: 8 swatches (6 presets, Custom, From cover).
  - Custom selected: a row appears under the grid, label `Accent`, colour well + hex field.
  - From cover selected: a note appears: `Colours follow each track's cover. A cover with no colour uses Paper.`
- **Shape**: Density, Sensitivity, Glow, Backdrop, Opacity.
  - Sensitivity here and in Audio are the same setting (`audio.sensitivity`); it is repeated because
    "the bars are too small" is noticed here.
- **Now playing**: Layout (select: Compact, Centred, Cover, Text only, Off), Album glow (switch).

**Clock.** Picker: **Face** grid, 6 tiles. Right column: `Show clock` switch / **Type**: Font, Size,
Weight, Letter spacing / **Colour**: Fill (Solid, Gradient, Match visualizer), Colour, Opacity,
Shadow / **Time and date**: 24-hour, Seconds, Date (Long, Short, None). With Show clock off, every
other row and the Face grid are disabled and the preview shows the wallpaper alone.

**Lyrics.** Picker: **This track** with the track name at the right (`Salt Lines, Okono Vale`),
then five lines around the current one with timestamps (`.lyric-peek`): current line in paper at
18 px with a vermilion timestamp, others `--paper-3` at 15 px. This is where the Offset slider is
judged. Right column:

- `Show lyrics` switch, default **off**, with the disclosure directly under it, always visible:
  `Looks up lyrics on lrclib.net using the song title and artist.`
- **In the full-screen player**: Offset (-5.0 to +5.0 s, step 0.1, value like `+0.3 s`, note
  `Lines too early? Move right. Too late? Move left.`), Size (Small, Medium, Large).
- Offset is stored per track when changed while that track plays, falling back to the global value.

Picker states (`data-lyrics` on body):

| value | Picker shows |
|---|---|
| `ready` | The five lines |
| `loading` | `Looking up lyrics…` |
| `none` | `No synced lyrics found for this track. The full-screen player shows the cover on its own.` |
| `off` | `Lyrics are off. Nothing is looked up.` Offset and Size rows disabled |
| `idle` | `Nothing is playing. Lyrics appear here when a track starts.` |
| `failed` | `Couldn't reach lrclib.net. Undertone will try again on the next track.` (offline, or lrclib unreachable). The full-screen player treats this as not found |

**Audio.** Picker: **Level** with the active source name at the right, a stereo meter (two 10 px
bars, paper fill, 2 px vermilion peak-hold tick held 1.5 s, dB readout per channel, scale -60 to 0),
and under it the statement, always visible:
`Undertone listens to what this PC plays. It never opens a microphone or any other input unless you pick one in the list.`
Right column:

- **Source**: a radio list, not a dropdown, so device names are readable and a failed one can carry
  its own message. First `System audio` with the sub-line `Everything this PC plays`. Then the
  small heading `Input devices` and one radio per device, name on one line with ellipsis and the
  full name in `title`. No devices: `No input devices found.` The list updates live as devices
  come and go.
- **Response**: Sensitivity (0 to 200 %, step 5), Smoothing (0 to 100).

Choosing an input device is the consent to open it. Undertone opens an input only while it is
the selected source, closes it the moment another source is chosen, and never switches to an
input by itself: if the chosen input fails it falls back to System audio.

Source failed (`data-state="failed"` on the `.source`): under the device name, mark +
`Couldn't open this device. Using System audio.` + quiet button `Try again`. The radio moves to
System audio. The status bar repeats it (7.6).

**System.** Picker: **Hotkeys** with the aside `Select one to change it`. Four rows:

| Action | Default | Key |
|---|---|---|
| Full-screen player | `Ctrl` `Alt` `F` | `hotkeys.fullscreen` |
| Arrange widgets | `Ctrl` `Alt` `A` | `hotkeys.arrange` |
| Show or hide widgets | `Ctrl` `Alt` `H` | `hotkeys.toggleWidgets` |
| Next visualizer style | `Ctrl` `Alt` `V` | `hotkeys.nextStyle` |

- Default: caps on a transparent button; hover shows a 1 px border.
- Capturing (`data-state="capturing"` on `.hotkey`): paper border, caps replaced by
  `Press keys… Esc cancels`. Needs at least one of Ctrl / Alt / Shift / Win plus one other key.
  `Backspace` clears the binding (`data-state="none"` on `.hotkey`; it then reads `None`). Clicking elsewhere cancels.
- Conflict (`data-state="conflict"` on `.hotkey-row`): caps struck through in `--paper-3`, and
  under the row: mark + `Another app is using Ctrl+Alt+A. Select it to choose different keys.`
  The System tab label has a trailing `.mark` (in the markup, `hidden`); unhide it while any hotkey is in conflict.
- Choosing a combination already used by another Undertone action swaps the two.

Right column: **Startup**: Launch at login / **Performance**: Frame rate cap (30, 60, Display rate),
Pause when covered with the note `Stops drawing while a maximised or full-screen window hides the desktop.` /
**Undertone**: Version (`0.1.0`, Bahnschrift), Settings `Reset to defaults`, App `Quit Undertone`.

- `Reset to defaults` asks once, inline: hide `#system-reset`, unhide `#system-reset-confirm`
  (`Reset every setting?` `Reset` `Keep`) for 6 s, then revert. Widget positions are kept.
- `Quit Undertone` quits immediately, no confirmation.

### 7.6 Status bar

One line, 36 px, hairline above. Left: a state glyph and one sentence. Right: two quiet buttons,
`Arrange widgets` and `Full screen`. The sentence truncates with an ellipsis; the buttons never move.

| `data-status` | Glyph | Text | Extra |
|---|---|---|---|
| `playing` | Four small live level bars (paper) | **Salt Lines** by Okono Vale (title in paper, rest paper-2) | |
| `idle` | Level bars | `Hearing audio. The player isn't sharing track details.` | |
| `silent` | A 14 x 2 px flat line (`--paper-3`) | `Silent. Nothing is coming through System audio.` (source name substituted) | |
| `source-failed` | `.mark` | **Couldn't open {device}.** Using System audio. | Quiet button `Choose source` opens the Audio tab |
| `covered` | Flat line | `Paused while a full-size window covers the desktop.` | |
| `hidden` | Flat line | `Widgets are hidden.` | Quiet button `Show` |

Priority when several apply: source-failed, hidden, covered, silent, idle, playing.
The bar is `role="status"`; changes are announced politely.

---

## 8. Tray, first run, and where states surface

### 8.1 Tray icon

16 px monochrome glyph: three vertical bars of unequal height (light on a dark taskbar, dark on a
light one). Paused or hidden: three equal short bars. Problem (source failed, hotkey conflict):
the normal glyph with a small filled square in the top-right corner.

Left click: show or hide the settings window. Right click: the menu.

Tooltip, one line:

- `Undertone: Bars, Ember`
- `Undertone: paused, desktop covered`
- `Undertone: widgets hidden`
- `Undertone: couldn't open {device}, using System audio`
- `Undertone: a hotkey is in use by another app`

### 8.2 Tray menu

Native Windows menu; nothing to style. Order, types and wording:

| # | Label | Type | Notes |
|---|---|---|---|
| 1 | `{Title} by {Artist}` | Disabled label | `Nothing playing` when there is no media session. Truncate at 48 characters |
| | separator | | |
| 2 | `Settings` | Normal, default (bold) | Same as left click |
| 3 | `Full-screen player` | Normal | Accelerator text: current binding |
| 4 | `Arrange widgets` | Normal | Accelerator text: current binding |
| | separator | | |
| 5 | `Show visualizer` | Checkbox | |
| 6 | `Show clock` | Checkbox | |
| 7 | `Pause` / `Resume` | Normal | Stops drawing, keeps widgets on screen at their resting state |
| | separator | | |
| 8 | `Style` | Submenu, radio | The 11 styles in order |
| 9 | `Colours` | Submenu, radio | Ember, Paper, Tide, Moss, Sodium, Prism, Custom, From cover |
| | separator | | |
| 10 | `Quit Undertone` | Normal | |

Hotkeys in conflict show no accelerator text. No icons in the menu.

### 8.3 First run

No welcome window, no banner, no tour.

1. The widgets appear on the primary display at their defaults:
   - Visualizer: 640 x 220, horizontally centred in the work area, bottom edge 48 px above the
     work-area bottom (on 1920 x 1080 with a 48 px taskbar: x 640, y 764). Bars, Ember, Compact.
   - Clock: Digital, 96 px, Bahnschrift Light, top-right, 64 px from the work area's top and right edges.
2. Undertone starts **in Arrange mode** (section 4) with the first-run hint in the bar:
   `Drag to move. Pull a corner to resize. Ctrl+Alt+A brings this back any time.`
   The mode itself is the lesson: the user sees the widgets, sees they can be placed, and learns
   the way back. Pressing Done drops them onto the wallpaper.
3. Settings does not open by itself. The tray icon is there; the tooltip names the app.
4. If nothing is playing, the visualizer shows its resting baseline inside the outline, so there
   is still something to place.
5. Lyrics are off until the user turns them on (the lookup sends the title and artist to lrclib.net).
   Launch at login is off.

If a display is smaller than 1280 px wide, the default visualizer is 50 % of the work-area width
by 34 % of that width high.

### 8.4 State matrix

| State | Wallpaper | Settings | Full screen | Tray |
|---|---|---|---|---|
| No audio detected | Resting baseline | Status `silent`; meter empty at -60 | Visualizer at 25 % | Normal icon |
| Nothing playing (no media session) | Visualizer only, no line | Status `idle` (or `silent`); Lyrics picker `idle` | `Nothing playing` layout | Menu item 1 `Nothing playing` |
| Lyrics loading | | Lyrics picker `loading` | `Looking up lyrics…` | |
| Lyrics not found | | Lyrics picker `none` | Notice 4 s, then centred | |
| Lyrics turned off | | Lyrics picker `off` | Centred; `L` shows `Lyrics are off in settings` | |
| Audio source failed | Keeps drawing from System audio | Opens on Audio; failed row + status `source-failed` | Unaffected | Problem icon + tooltip |
| Hotkey not registered | | Conflict row on System; mark on the System tab | | Problem icon + tooltip; menu shows no accelerator |
| Paused while covered | Frozen frame, nothing drawn | Status `covered` | Not applicable (full screen is itself the cover; it keeps drawing) | Paused icon + tooltip |
| Widgets hidden | Nothing | Status `hidden` with `Show` | Unaffected | Paused icon; checkboxes unticked |
| First run | Arrange mode | Closed | | Normal icon |

Recovery is always one click from where the problem is shown: `Try again`, `Choose source`,
`Show`, or selecting the struck-through hotkey.

---

## 9. Settings schema

Every control in `settings.html` carries `data-setting` with one of these keys: **select controls
by `data-setting`**, not by id. Ids exist for `<label for>` and `<output for>`; they are the key
with dots and camel case turned into hyphens (`visualizer-album-glow`, `now-playing-layout`),
except the Sensitivity slider on the Visualizer tab, which is `visualizer-sensitivity` because
`audio-sensitivity` is taken by its twin on the Audio tab (both carry
`data-setting="audio.sensitivity"`; keep them in sync). Radio groups put `data-setting` on the
group element and use the key as each input's `name`. Sliders need `--fill` updated inline as a
percentage of their range.

| Key | Control | Values | Default | Value text |
|---|---|---|---|---|
| `visualizer.style` | Style grid | `bars` `mirror` `blocks` `ring` `wave` `aurora` `orb` `waterfall` `particles` `terrain` `meters` | `bars` | |
| `visualizer.theme` | Swatches | `ember` `paper` `tide` `moss` `sodium` `prism` `custom` `cover` | `ember` | |
| `visualizer.customAccent` | Colour well + hex | `#RRGGBB` | `#3B8FD9` | |
| `visualizer.density` | Slider | 0 to 100, step 1 | 50 | `50` |
| `audio.sensitivity` | Slider (Visualizer and Audio) | 0 to 200, step 5 | 100 | `100%` |
| `visualizer.glow` | Slider | 0 to 100, step 1 | 40 | `40` |
| `visualizer.backdrop` | Slider | 0 to 100, step 1 | 0 | `Off` at 0, else `35` |
| `visualizer.opacity` | Slider | 20 to 100, step 1 | 100 | `100%` |
| `nowPlaying.layout` | Select | `compact` `centred` `cover` `text` `off` | `compact` | |
| `visualizer.albumGlow` | Switch | bool | false | `On` / `Off` |
| `visualizer.enabled` | Tray checkbox only | bool | true | |
| `clock.enabled` | Switch | bool | true | `On` / `Off` |
| `clock.face` | Face grid | `digital` `stacked` `minimal` `analog` `words` `line` | `digital` | |
| `clock.font` | Select | font family name | `Bahnschrift` | |
| `clock.size` | Slider | 24 to 320, step 2 | 96 | `96 px` |
| `clock.weight` | Slider | 100 to 900, step 100 | 300 | weight name |
| `clock.letterSpacing` | Slider | -5 to 30, step 1 (0.01 em) | 0 | `0`, `+4`, `-2` |
| `clock.colourMode` | Segmented | `solid` `gradient` `visualizer` | `solid` | |
| `clock.colourA` | Colour well + hex | `#RRGGBB` | `#EFEBE2` | |
| `clock.colourB` | Colour well + hex | `#RRGGBB` | `#EB4A22` | |
| `clock.opacity` | Slider | 20 to 100, step 1 | 100 | `100%` |
| `clock.shadow` | Switch | bool | true | `On` / `Off` |
| `clock.hour24` | Switch | bool | Windows region | `On` / `Off` |
| `clock.seconds` | Switch | bool | false | `On` / `Off` |
| `clock.date` | Segmented | `long` `short` `none` | `short` | |
| `lyrics.enabled` | Switch | bool | false | `On` / `Off` |
| `lyrics.offset` | Slider | -5000 to 5000 ms, step 100 | 0 | `0.0 s`, `+0.3 s`, `-1.2 s` |
| `lyrics.size` | Segmented | `small` `medium` `large` | `medium` | |
| `audio.source` | Radio list | `system` or a device id | `system` | |
| `audio.smoothing` | Slider | 0 to 100, step 1 | 60 | `60` |
| `system.launchAtLogin` | Switch | bool | false | `On` / `Off` |
| `system.fpsCap` | Segmented | `30` `60` `display` | `60` | |
| `system.pauseWhenCovered` | Switch | bool | true | `On` / `Off` |
| `hotkeys.fullscreen` | Hotkey | accelerator or null | `Ctrl+Alt+F` | |
| `hotkeys.arrange` | Hotkey | accelerator or null | `Ctrl+Alt+A` | |
| `hotkeys.toggleWidgets` | Hotkey | accelerator or null | `Ctrl+Alt+H` | If another app holds it, the row shows the conflict |
| `hotkeys.nextStyle` | Hotkey | accelerator or null | `Ctrl+Alt+V` | |
| `preview.over` | Segmented (small) | `wallpaper` `dark` `light` | `wallpaper` | |
| `fullscreen.style` | `V` key only | a style value | `mirror` | |
| `fullscreen.theme` | `C` key only | a theme value | `cover` | |
| `widgets.visualizer.bounds` | Arrange mode | `{display, x, y, w, h}` | section 8.3 | |
| `widgets.clock.position` | Arrange mode | `{display, x, y}` (anchor = nearest corner) | section 8.3 | |

The mockup's `lyrics.enabled` and `clock.hour24` are shown switched on so the populated states
are visible; the defaults above are what ships.

---

## 10. Copy rules

- Sentence case. Plain verbs. No exclamation marks, no "please", no "oops", no apologies.
- Name things as the user sees them: "System audio", "Input devices", "Arrange widgets",
  "Full-screen player". Never "loopback", "WASAPI", "media session", "overlay".
- A problem line says what happened and what Undertone did about it, then offers one action:
  `Couldn't open this device. Using System audio.` + `Try again`.
- An action keeps one name everywhere: **Arrange widgets** (tray, status bar, hotkey list),
  **Full-screen player** (tray, hotkey list; the status-bar button shortens to `Full screen`).
- The ellipsis is the single character `…`. Key combinations are written `Ctrl+Alt+A` in
  sentences and as separate caps in the hotkey list.
- British spelling in UI copy (Colours, Centre, Centred), to match the brief.

---

## 11. What the mockups do and do not show

Rendered and checked in Chromium at real size: all five settings tabs (960 x 680, and 960 x 560 for
the short-screen rule), keyboard focus ring, every status-bar state, source failed, hotkey conflict
and capture, the Light preview (ink tone); the desktop at 1920 x 1080 with all five now-playing
layouts, Backdrop, Album glow, silence, long titles, Arrange mode and first run; Digital,
Stacked, Analog, Words and Day line faces; full screen with lyrics, without, loading, paused,
nothing playing, long titles, toast. Not rendered at full size: the Minimal face (its tile only)
and the full-screen "not found" notice.

Specified here but **not drawn in the mockups** (build from the text):

- Arrange mode: the position readout while dragging (same tag, different text), the bar's
  bottom-centre position, guides other than centre and bottom margin.
- Settings: the disabled-row look in use (class exists: `.row.is-disabled`), the Reset confirm
  (markup exists, `hidden`), the mark on the System tab (markup exists, `hidden`), the hotkey
  `None` state (`data-state="none"`), Clock rows changing with Fill, the weight names.
- Tray icon glyphs and the tray menu (native).
- Lyric advance, transport fade, cover drift and every other motion: the mockups are static.
- Windows 10 font fallbacks (Segoe UI in place of Segoe UI Variable) were not rendered.

Mockup stand-ins to delete or replace when wiring: `.titlebar__caption`, `.wallpaper`,
`.cover-art`, `.fake-icons`, `.fake-taskbar`, `mockup.js`, the inline `<script>` blocks, and the
sample text (track, lyrics, device names, times).
