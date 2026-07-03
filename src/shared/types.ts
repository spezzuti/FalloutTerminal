// Types shared across the main process, preload bridge, and renderer.
// Pure type declarations only — no runtime code.

export interface SpawnOptions {
  id: string
  shell?: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  env?: Record<string, string>
}

/** Result of spawning a shell: success info, or an error message to display. */
export type SpawnResult = { pid: number; shell: string } | { error: string }

export interface Profile {
  id: string
  name: string
  shell: string
  args: string[]
  cwd?: string
  color?: string
  /** True for user-created profiles (editable/deletable in settings). */
  custom?: boolean
}

export interface SavedTab {
  profileId: string
  cwd?: string
  title?: string
}

export interface Workspace {
  name: string
  tabs: SavedTab[]
}

export type CrtLevel = 'off' | 'low' | 'medium' | 'high'
/** 'mono' = authentic phosphor monochrome; 'hybrid' = real ANSI colors on the CRT. */
export type ColorMode = 'mono' | 'hybrid'
export type CursorStyle = 'block' | 'underline' | 'bar'

export interface AppSettings {
  themeId: string
  colorMode: ColorMode
  fontFamily: string
  fontSize: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  restoreSession: boolean
  crtLevel: CrtLevel
  /** Play the RobCo boot animation on launch. */
  bootSequence: boolean
  copyOnSelect: boolean
  /** Warn before pasting text that contains newlines. */
  pasteGuard: boolean
  soundEnabled: boolean
  /** 0..1 */
  soundVolume: number
  /** WebGL renderer: faster for heavy TUI apps, but disables the glyph glow. */
  performanceMode: boolean
  /** Global summon/dismiss hotkey (quake mode). */
  quakeEnabled: boolean
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+`". */
  quakeHotkey: string
  /** Closing the window hides to the system tray instead of quitting. */
  closeToTray: boolean
  /** Launch FalloutTerminal at Windows sign-in. */
  autoStart: boolean
  /** Show the PLEASE STAND BY screen after a period of inactivity. */
  idleScreen: boolean
  idleMinutes: number
  /** New tabs/splits start in the focused shell's current directory. */
  openTabsInCwd: boolean
}

/** A user-created color theme, editable in settings. */
export interface CustomTheme {
  id: string
  name: string
  bg: string
  fg: string
  /** UI accent (borders, inactive text). */
  dim: string
  /** Base color for the phosphor glow. */
  glowColor: string
  cursor: string
  /** The 16 ANSI colors: black..white, brightBlack..brightWhite. */
  ansi: string[]
}

export interface CustomFont {
  /** CSS font-family name to register and reference. */
  family: string
  /** data: URL of the font file (persisted so it survives restarts). */
  dataUrl: string
}

export interface AppConfig {
  version: number
  profiles: Profile[]
  defaultProfileId: string
  /** User-created profiles (persisted; detected shells are re-scanned each launch). */
  customProfiles: Profile[]
  session: { tabs: SavedTab[] }
  workspaces: Workspace[]
  settings: AppSettings
  customFonts: CustomFont[]
  customThemes: CustomTheme[]
}
