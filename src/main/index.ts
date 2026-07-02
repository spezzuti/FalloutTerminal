import { app, shell, BrowserWindow, ipcMain, IpcMainEvent, Menu, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, appendFileSync, statSync } from 'fs'
import { registerPtyHandlers, disposeAllPtys } from './pty'
import { loadConfig, saveConfig } from './config'
import type { SavedTab, AppSettings, Workspace, CustomFont, Profile } from '../shared/types'

// ---- Error logging ----------------------------------------------------------
// Main-process failures are otherwise invisible; keep a small rotating log.

function logPath(): string {
  return join(app.getPath('userData'), 'error.log')
}

function logError(tag: string, err: unknown): void {
  try {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    try {
      if (statSync(logPath()).size > 512 * 1024) writeFileSync(logPath(), '')
    } catch {
      /* no log yet */
    }
    appendFileSync(logPath(), `[${new Date().toISOString()}] ${tag}: ${detail}\n`)
  } catch {
    /* never let logging crash the app */
  }
}

process.on('uncaughtException', (e) => logError('uncaughtException', e))
process.on('unhandledRejection', (r) => logError('unhandledRejection', r))

// ---- Window geometry persistence -------------------------------------------

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState | null {
  try {
    return JSON.parse(readFileSync(windowStatePath(), 'utf-8')) as WindowState
  } catch {
    return null
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    writeFileSync(windowStatePath(), JSON.stringify(state))
  } catch {
    /* best-effort */
  }
}

// ---- IPC handlers -----------------------------------------------------------

function registerConfigHandlers(): void {
  ipcMain.handle('config:load', () => loadConfig())

  ipcMain.on('config:save-session', (_e, tabs: SavedTab[]) => {
    const cfg = loadConfig()
    cfg.session = { tabs }
    saveConfig(cfg)
  })

  ipcMain.on('config:save-settings', (_e, settings: AppSettings) => {
    const cfg = loadConfig()
    cfg.settings = { ...cfg.settings, ...settings }
    saveConfig(cfg)
  })

  ipcMain.on('config:save-workspaces', (_e, workspaces: Workspace[]) => {
    const cfg = loadConfig()
    cfg.workspaces = workspaces
    saveConfig(cfg)
  })

  ipcMain.on('config:save-custom-fonts', (_e, fonts: CustomFont[]) => {
    const cfg = loadConfig()
    cfg.customFonts = fonts
    saveConfig(cfg)
  })

  ipcMain.on(
    'config:save-profiles',
    (_e, customProfiles: Profile[], defaultProfileId: string) => {
      const cfg = loadConfig()
      cfg.customProfiles = customProfiles.map((p) => ({ ...p, custom: true }))
      cfg.profiles = [
        ...cfg.profiles.filter((p) => !p.custom),
        ...cfg.customProfiles
      ]
      cfg.defaultProfileId = cfg.profiles.some((p) => p.id === defaultProfileId)
        ? defaultProfileId
        : cfg.defaultProfileId
      saveConfig(cfg)
    }
  )

  // Open http(s) links from terminal output in the system browser.
  ipcMain.on('app:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
  })
}

function registerWindowHandlers(): void {
  const winFrom = (e: IpcMainEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)

  ipcMain.on('win:minimize', (e) => winFrom(e)?.minimize())
  ipcMain.on('win:toggle-maximize', (e) => {
    const w = winFrom(e)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('win:close', (e) => winFrom(e)?.close())
}

// ---- Window -----------------------------------------------------------------

function createWindow(): void {
  const state = loadWindowState()

  // Only reuse a saved position if it still lands on a connected display
  // (e.g. a monitor may have been unplugged since last run).
  const onScreen =
    state?.x !== undefined &&
    state?.y !== undefined &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        state.x! >= a.x - 100 &&
        state.y! >= a.y - 20 &&
        state.x! < a.x + a.width - 100 &&
        state.y! < a.y + a.height - 100
      )
    })

  const mainWindow = new BrowserWindow({
    width: state?.width ?? 1000,
    height: state?.height ?? 680,
    ...(onScreen ? { x: state!.x, y: state!.y } : {}),
    minWidth: 480,
    minHeight: 320,
    show: false,
    frame: false,
    backgroundColor: '#0b1c0f',
    title: 'FalloutTerminal',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (state?.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => saveWindowState(mainWindow))

  // Let the renderer swap the maximize/restore button glyph.
  mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximized', false))

  // The app has no menu (so no hidden accelerators steal shell keys like
  // Ctrl+R); keep devtools reachable via F12 for troubleshooting.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  // Open external links in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In dev, load the vite dev server; in prod, load the built HTML file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Remove the default application menu entirely: a frameless terminal must
  // not have invisible accelerators (Ctrl+R = reload, Ctrl+W = close, ...)
  // intercepting keystrokes meant for the shell.
  Menu.setApplicationMenu(null)

  registerPtyHandlers(ipcMain)
  registerWindowHandlers()
  registerConfigHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  disposeAllPtys()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeAllPtys()
})
