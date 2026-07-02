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

export interface AppSettings {
  themeId: string
  fontFamily: string
  fontSize: number
  restoreSession: boolean
  crtLevel: CrtLevel
  /** Play the RobCo boot animation on launch. */
  bootSequence: boolean
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
  session: { tabs: SavedTab[] }
  workspaces: Workspace[]
  settings: AppSettings
  customFonts: CustomFont[]
}
