import type { ITheme } from '@xterm/xterm'
import type { ColorMode, CustomTheme } from '../../shared/types'

export interface Theme {
  id: string
  name: string
  /** UI chrome colors (title bar, tabs) exposed as CSS variables. */
  bg: string
  fg: string
  dim: string
  glow: string
  xterm: ITheme
  /** True for user-created themes (editable in settings). */
  custom?: boolean
}

/** Build a monochrome-phosphor xterm palette from a base fg/bg. */
function monoTheme(fg: string, bg: string, dim: string, bright: string): ITheme {
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: 'rgba(255, 255, 255, 0.25)',
    black: bg,
    red: dim,
    green: fg,
    yellow: bright,
    blue: dim,
    magenta: fg,
    cyan: bright,
    white: fg,
    brightBlack: dim,
    brightRed: bright,
    brightGreen: bright,
    brightYellow: bright,
    brightBlue: fg,
    brightMagenta: bright,
    brightCyan: bright,
    brightWhite: bright
  }
}

export const THEMES: Theme[] = [
  {
    id: 'pipboy',
    name: 'Pip-Boy',
    bg: '#06180c',
    fg: '#45ff8a',
    dim: '#1c8a3a',
    glow: 'rgba(69, 255, 138, 0.35)',
    xterm: monoTheme('#45ff8a', '#06180c', '#1c8a3a', '#9dffc0')
  },
  {
    id: 'terminal',
    name: 'Terminal',
    bg: '#001100',
    fg: '#25ff41',
    dim: '#0f9c22',
    glow: 'rgba(37, 255, 65, 0.4)',
    xterm: monoTheme('#25ff41', '#001100', '#0f9c22', '#88ff96')
  },
  {
    id: 'amber',
    name: 'Amber',
    bg: '#1a0f00',
    fg: '#ffb642',
    dim: '#a86a12',
    glow: 'rgba(255, 182, 66, 0.4)',
    xterm: monoTheme('#ffb642', '#1a0f00', '#a86a12', '#ffd591')
  }
]

export interface FontOption {
  id: string
  name: string
  family: string
}

export const FONTS: FontOption[] = [
  { id: 'monofonto', name: 'Monofonto (Fallout UI)', family: '"Monofonto", monospace' },
  { id: 'fixedsys', name: 'Fixedsys Excelsior', family: '"Fixedsys Excelsior", monospace' },
  { id: 'share-tech', name: 'Share Tech Mono', family: '"Share Tech Mono", monospace' },
  { id: 'vt323', name: 'VT323 (chunky CRT)', family: '"VT323", monospace' },
  { id: 'cascadia', name: 'Cascadia Mono', family: '"Cascadia Mono", "Consolas", monospace' },
  { id: 'consolas', name: 'Consolas', family: '"Consolas", monospace' }
]

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(69, 255, 138, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

/** Build a runtime Theme from a user-created custom theme. */
export function buildTheme(ct: CustomTheme): Theme {
  const xterm: ITheme = {
    background: ct.bg,
    foreground: ct.fg,
    cursor: ct.cursor,
    cursorAccent: ct.bg,
    selectionBackground: hexToRgba(ct.fg, 0.3)
  }
  ANSI_KEYS.forEach((k, i) => {
    ;(xterm as Record<string, string>)[k] = ct.ansi[i] ?? ct.fg
  })
  return {
    id: ct.id,
    name: ct.name,
    custom: true,
    bg: ct.bg,
    fg: ct.fg,
    dim: ct.dim,
    glow: hexToRgba(ct.glowColor, 0.38),
    xterm
  }
}

/** Replace the registered custom themes (built-ins are kept). */
export function registerCustomThemes(customs: CustomTheme[]): void {
  for (let i = THEMES.length - 1; i >= 0; i--) {
    if (THEMES[i].custom) THEMES.splice(i, 1)
  }
  for (const ct of customs) THEMES.push(buildTheme(ct))
}

/** Snapshot the current theme's values as a starting point for a new custom theme. */
export function themeToCustom(t: Theme, id: string, name: string): CustomTheme {
  const x = t.xterm as Record<string, string | undefined>
  return {
    id,
    name,
    bg: t.bg,
    fg: t.fg,
    dim: t.dim,
    glowColor: t.fg,
    cursor: x.cursor ?? t.fg,
    ansi: ANSI_KEYS.map((k) => x[k] ?? t.fg)
  }
}

export const ANSI_LABELS = ANSI_KEYS

/** Add a font to the selectable list (e.g. a user-uploaded custom font). */
export function addFontOption(family: string, name: string): void {
  if (!FONTS.some((f) => f.family === family)) {
    FONTS.push({ id: `custom-${FONTS.length}`, name, family })
  }
}

// Real ANSI colors (Windows Terminal "Campbell") for hybrid mode: keeps the
// phosphor background/glow but lets git diffs, ls, errors etc. stay colored.
const HYBRID_ANSI = {
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#3b78ff',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2'
}

// ---- Live theme/font state ------------------------------------------------

let _theme = THEMES[0]
let _fontFamily = FONTS[0].family
let _fontSize = 15
let _colorMode: ColorMode = 'mono'

export function setColorMode(mode: ColorMode): void {
  _colorMode = mode
}

export function currentXtermTheme(): ITheme {
  if (_colorMode === 'mono') return _theme.xterm
  return {
    background: _theme.bg,
    foreground: _theme.fg,
    cursor: _theme.fg,
    cursorAccent: _theme.bg,
    selectionBackground: 'rgba(255, 255, 255, 0.25)',
    ...HYBRID_ANSI
  }
}
export function currentFontFamily(): string {
  return _fontFamily
}
export function currentFontSize(): number {
  return _fontSize
}
export function currentThemeId(): string {
  return _theme.id
}

function applyThemeCss(theme: Theme): void {
  const r = document.documentElement.style
  r.setProperty('--crt-bg', theme.bg)
  r.setProperty('--crt-fg', theme.fg)
  r.setProperty('--crt-dim', theme.dim)
  r.setProperty('--crt-glow', theme.glow)
}

/** Set the active theme (updates CSS variables). */
export function setTheme(id: string): Theme {
  _theme = getTheme(id)
  applyThemeCss(_theme)
  return _theme
}

export function setFont(family: string, size: number): void {
  _fontFamily = family
  _fontSize = size
}

/** Register and load a user-supplied font from a data URL, returning its family. */
export async function loadCustomFont(family: string, dataUrl: string): Promise<void> {
  const face = new FontFace(family, `url(${dataUrl})`)
  await face.load()
  ;(document.fonts as FontFaceSet).add(face)
}
