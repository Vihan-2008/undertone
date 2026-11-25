# Undertone

A music visualizer that lives on the Windows wallpaper: behind your icons and windows, reacting to whatever this PC plays.

## What it does

- **Visualizer on the wallpaper.** Eleven styles: Bars, Mirror, Blocks, Ring, Wave, Aurora, Orb, Waterfall, Particles, Terrain and Meters. Eight colour themes, including Custom and From cover. Glow, density, backdrop and opacity controls. It stays put through Win+D, and stops drawing while a full-size window covers the desktop.
- **Now playing.** The title, artist and cover from any player that shares them with Windows (Spotify, browsers, the Media Player app and others). Five layouts.
- **Desktop clock.** Six faces: Digital, Stacked, Minimal, Analog, Words and Day line. Set the font, weight, size, spacing, colour or gradient, and shadow.
- **Full-screen player.** The cover becomes the room's light, with synced lyrics and a visualizer along the bottom edge.
- **Arrange mode.** Drag widgets to move them and pull a corner to resize. Edges snap, and Ctrl+Z undoes.
- **Settings with a live preview** drawn over a copy of your own wallpaper.
- **Tray icon and global hotkeys.**

Everything is free and nothing is locked.

## Keys

| Keys | Does |
|---|---|
| `Ctrl+Alt+F` | Full-screen player |
| `Ctrl+Alt+A` | Arrange widgets |
| `Ctrl+Alt+H` | Show or hide widgets |
| `Ctrl+Alt+V` | Next visualizer style |

You can change any of these in Settings → System. If another app already uses a shortcut, Settings says so and you can pick another. In the full-screen player:

| Key | Does |
|---|---|
| `Space` | Play or pause |
| `Left` / `Right` | Previous or next track |
| `V` | Next style |
| `C` | Next colours |
| `L` | Lyrics on or off |
| `Esc` | Leave |

## Privacy

- **Audio.** Undertone listens to what this PC plays (system audio). It never opens a microphone or other input unless you pick one in Settings → Audio.
- **Lyrics** are off by default. When you turn them on, Undertone looks them up on lrclib.net using the song title and artist.
- **No accounts, no telemetry.**

## Install

Requires Windows 10 or 11.

1. Download `Undertone Setup 0.1.0.exe` from the [latest release](https://github.com/Vihan-2008/undertone/releases/latest).
2. Run it. It installs for the current user and starts Undertone. On first run Arrange mode opens so you can place the widgets.

The installer is not code-signed, so Windows SmartScreen may ask you to confirm with More info → Run anyway.

To start Undertone with Windows, turn on Settings → System → Launch at login.

## Develop

```powershell
npm install
npm start
```

```powershell
npm run dist
```

`npm run dist` builds the installer into `dist\`.

- `src/main/` is the main process:
  - `desktop.js` handles wallpaper-layer placement through user32;
  - `media.js` and `media-helper.ps1` read now playing;
  - `arrange.js`, `wallpaper.js` and `settings.js`;
  - tray, hotkeys and windows live in `main.js`.
- `src/renderer/` holds the pages: `widget`, `clock`, `arrange`, `fullscreen` and `settings`. `shared/` holds the audio analysis, visualizer styles, palettes and clock faces.
- `design/DESIGN.md` is the design spec. The mockups in `design/mockups/` are references and are not shipped.

Dev runs accept a few environment variables. A packaged build ignores all of them.

| Variable | Does |
|---|---|
| `UT_USERDATA` | Uses a separate profile |
| `UT_DEV` | Writes screenshots and state to the given folder every 3 s |
| `UT_DEV_SCRIPT` | Runs a test script with access to internals |

## License

[MIT](LICENSE)
