import { contextBridge, ipcRenderer, clipboard, webUtils } from 'electron'
import type {
  SpawnOptions,
  SpawnResult,
  AppConfig,
  SavedTab,
  AppSettings,
  Workspace,
  CustomFont,
  CustomTheme,
  Profile
} from '../shared/types'

// A minimal, explicit API surface exposed to the renderer. No raw Node/ipc.
const api = {
  spawn: (opts: SpawnOptions): Promise<SpawnResult> => ipcRenderer.invoke('pty:spawn', opts),

  write: (id: string, data: string): void => {
    ipcRenderer.send('pty:input', id, data)
  },

  resize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('pty:resize', id, cols, rows)
  },

  kill: (id: string): void => {
    ipcRenderer.send('pty:kill', id)
  },

  killAll: (): void => {
    ipcRenderer.send('pty:kill-all')
  },

  /** Acknowledge rendered output for flow control. */
  ack: (id: string, length: number): void => {
    ipcRenderer.send('pty:ack', id, length)
  },

  onData: (cb: (id: string, data: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string, data: string): void => cb(id, data)
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.removeListener('pty:data', listener)
  },

  onExit: (cb: (id: string, code: number) => void): (() => void) => {
    const listener = (_e: unknown, id: string, code: number): void => cb(id, code)
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.removeListener('pty:exit', listener)
  }
}

const win = {
  minimize: (): void => ipcRenderer.send('win:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('win:toggle-maximize'),
  close: (): void => ipcRenderer.send('win:close'),
  openExternal: (url: string): void => ipcRenderer.send('app:open-external', url),

  onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on('win:maximized', listener)
    return () => ipcRenderer.removeListener('win:maximized', listener)
  },

  /** Fired when the window is hidden to tray so the UI can undo close effects. */
  onResetUi: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('win:reset-ui', listener)
    return () => ipcRenderer.removeListener('win:reset-ui', listener)
  },

  openLog: (): void => ipcRenderer.send('app:open-log'),

  /** Fired when an app update has downloaded and is ready to install. */
  onUpdateReady: (cb: (version: string) => void): (() => void) => {
    const listener = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on('update:ready', listener)
    return () => ipcRenderer.removeListener('update:ready', listener)
  },

  installUpdate: (): void => ipcRenderer.send('update:install')
}

// File helpers usable from the sandboxed renderer.
const native = {
  /** Absolute filesystem path of a File from a drag-and-drop event. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

// System clipboard (more reliable than navigator.clipboard in this context).
const clip = {
  read: (): string => clipboard.readText(),
  write: (text: string): void => clipboard.writeText(text)
}

const config = {
  load: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveSession: (tabs: SavedTab[]): void => ipcRenderer.send('config:save-session', tabs),
  saveSettings: (settings: AppSettings): void => ipcRenderer.send('config:save-settings', settings),
  saveWorkspaces: (workspaces: Workspace[]): void =>
    ipcRenderer.send('config:save-workspaces', workspaces),
  saveCustomFonts: (fonts: CustomFont[]): void =>
    ipcRenderer.send('config:save-custom-fonts', fonts),
  saveCustomThemes: (themes: CustomTheme[]): void =>
    ipcRenderer.send('config:save-custom-themes', themes),
  saveProfiles: (customProfiles: Profile[], defaultProfileId: string): void =>
    ipcRenderer.send('config:save-profiles', customProfiles, defaultProfileId)
}

contextBridge.exposeInMainWorld('term', api)
contextBridge.exposeInMainWorld('win', win)
contextBridge.exposeInMainWorld('clip', clip)
contextBridge.exposeInMainWorld('config', config)
contextBridge.exposeInMainWorld('native', native)

export type TermApi = typeof api
export type WinApi = typeof win
export type ClipApi = typeof clip
export type ConfigApi = typeof config
export type NativeApi = typeof native
