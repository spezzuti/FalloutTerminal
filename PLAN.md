# FalloutTerminal — Build Plan

A custom Windows terminal with full shell parity (PowerShell, cmd, and any other
shell), tabs/profiles you can save, and a Fallout/Pip-Boy CRT aesthetic. Behaves
like a normal Windows window (resize, drag, snap, minimize/maximize).

## 1. Tech Stack

| Concern | Choice | Why |
|---|---|---|
| App shell | **Electron** | Real Windows window (resize/drag/snap), Chromium renderer for shader-grade CRT effects, huge ecosystem. |
| Terminal rendering | **xterm.js** (+ `@xterm/addon-webgl`, `@xterm/addon-fit`) | Battle-tested emulator used by VS Code; WebGL renderer keeps CRT effects smooth. |
| PTY / real shell | **node-pty** | Spawns real `powershell.exe` / `pwsh.exe` / `cmd.exe` via Windows ConPTY. True shell parity. |
| Build / bundler | **Vite** + **electron-vite** | Fast HMR for the renderer while iterating on theme. |
| Packaging | **electron-builder** | Produces a portable `.exe` / NSIS installer for Windows. |
| Language | **TypeScript** | Safer IPC + config handling. |

> Alternatives considered: **Tauri** (smaller binary, but PTY + tab plumbing is
> hand-rolled and less proven for terminals) and **WinUI/.NET** (native feel, but
> CRT shaders are much harder outside a browser engine). Electron wins on
> theming control + speed of iteration for this specific goal.

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│ Main process (Node)                           │
│  • window lifecycle, custom frame             │
│  • node-pty: spawn/kill/resize shells         │
│  • config store (profiles, themes, fonts)     │
│  • IPC bridge (contextIsolation ON)           │
└───────────────▲───────────────────────────────┘
                │ IPC (typed channels)
┌───────────────┴───────────────────────────────┐
│ Renderer (Chromium)                            │
│  • Tab bar + custom title bar (drag region)    │
│  • xterm.js instance per tab (WebGL)           │
│  • CRT effect layer (CSS + shader overlay)     │
│  • Settings UI (theme/font/profile editor)     │
└────────────────────────────────────────────────┘
```

- **One PTY per tab**, keyed by id. PTY data ↔ xterm streamed over IPC.
- **contextIsolation on**, `nodeIntegration` off; expose a minimal `window.api`
  via a preload script. No raw Node in the renderer.
- **Config** lives in `%APPDATA%/FalloutTerminal/config.json` (profiles, saved
  tabs, active theme, fonts, CRT toggles).

## 3. Feature Checklist

**Terminal parity**
- [ ] Spawn PowerShell, pwsh (Core), cmd, and arbitrary shells (git-bash, WSL) via profiles
- [ ] Resize forwarding (xterm fit → PTY resize) on window/pane resize
- [ ] Copy/paste, clear, scrollback buffer, search-in-buffer
- [ ] Working directory + env + startup args per profile

**Tabs & sessions**
- [ ] New/close/reorder tabs, per-tab profile
- [ ] "Save layout" — persist open tabs (profile + cwd + title) and restore on launch
- [ ] Named saved workspaces (e.g. "Dev", "Admin")
- [ ] Keyboard shortcuts (Ctrl+T new, Ctrl+W close, Ctrl+Tab switch)

**Window behavior**
- [ ] Frameless window with custom Fallout-styled title bar
- [ ] Draggable via title bar (`-webkit-app-region: drag`), resizable, Win-snap, min/max/close
- [ ] Remember window size/position

**Theming (the Fallout part)**
- [ ] Green phosphor color scheme (+ amber variant) as default
- [ ] CRT overlay: scanlines, phosphor glow/bloom, vignette, subtle flicker, optional barrel curvature
- [ ] Boot-up sequence animation on launch (RobCo-style)
- [ ] Every effect individually toggleable + intensity sliders
- [ ] Bundled Fallout-style monospace font + **upload custom font (.ttf/.otf)**
- [ ] Full color-scheme editor (fg/bg/cursor/16-ANSI palette), import/export as JSON

## 4. Fallout Aesthetic — Technical Approach

- **Font:** Bundle a free monospace close to the Fallout terminal look (e.g.
  *Monofonto*, *Share Tech Mono*, or *VT323* for a chunkier CRT feel — verify
  license before shipping). Custom fonts loaded at runtime via `FontFace` API,
  files copied into the config dir.
- **CRT effects** as a stacked overlay above the xterm canvas:
  - Scanlines: repeating-linear-gradient overlay.
  - Phosphor glow: `text-shadow` + CSS `filter: blur/brightness` on a duplicated layer.
  - Flicker: keyframe animation on opacity/brightness (very subtle).
  - Curvature/vignette + chromatic aberration: a **WebGL/GLSL post-process shader**
    over the terminal texture (the "wow" layer; heavier, so it's optional).
  - Boot sequence: timed text reveal + power-on flash before the first prompt.
- Keep the terminal text on xterm's own WebGL canvas for crispness; apply effects
  as separate compositing layers so readability toggles cleanly.

## 5. Milestones

1. **Skeleton** — Electron + Vite + TS scaffold, single window, blank renderer.
2. **Real terminal** — xterm.js + node-pty wired over IPC; PowerShell runs, resizes, copy/paste. *(This is the make-or-break core.)*
3. **Tabs** — multi-tab with independent PTYs; new/close/switch.
4. **Custom window chrome** — frameless + draggable title bar + min/max/close + geometry persistence.
5. **Profiles & saved layouts** — config store, profile picker, restore-on-launch.
6. **Base theme** — Fallout green palette, bundled font, color-scheme editor.
7. **CRT effects** — scanlines → glow → flicker → shader curvature → boot sequence, each behind a toggle.
8. **Settings UI** — font upload, theme editor, effect sliders, import/export.
9. **Polish & package** — shortcuts, electron-builder portable exe.

Recommended order prioritizes a *working terminal early* (milestone 2), so the
project is useful before any theming lands.

## 6. Key Risks / Watch-outs

- **node-pty is a native module** — must be rebuilt for Electron's ABI
  (`electron-rebuild`). Plan for this in milestone 2.
- **ConPTY quirks** on Windows (resize timing, some TUI apps) — xterm+node-pty
  handle most, but test `vim`/`htop`-style apps.
- **Shader perf** — barrel curvature + bloom can cost GPU; keep it optional and
  test on the target machine.
- **Font licensing** — confirm redistribution rights before bundling any font.

## 7. Open Questions (defaults assumed)

- Stack: **Electron + xterm.js + node-pty** (assumed).
- Aesthetic: **Full CRT, toggleable** (assumed).
- Scope: **Personal use, no code-signing** (assumed).
- Panes/splits (tmux-style) — not in scope v1 unless wanted.
