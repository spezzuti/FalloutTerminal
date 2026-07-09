import '@xterm/xterm/css/xterm.css'
import './fonts.css'
import './style.css'
import { TabManager } from './tabs'
import {
  setTheme,
  setFont,
  setColorMode,
  addFontOption,
  loadCustomFont,
  registerCustomThemes
} from './theme'
import { initCrtOverlays, setCrtLevel, runBootSequence } from './crt'
import { SettingsPanel } from './settings'
import { configureSound, bootSound, powerOffSound } from './sound'
import { setPasteGuardEnabled } from './paste-guard'
import { launchHack, updateStreakBadge } from './hack'
import { configureIdle } from './idle'
import { initPalette } from './palette'

function wireWindowControls(powerOffClose: () => void): void {
  document.getElementById('btn-min')?.addEventListener('click', () => window.win.minimize())
  document.getElementById('btn-max')?.addEventListener('click', () => window.win.toggleMaximize())
  document.getElementById('btn-close')?.addEventListener('click', powerOffClose)

  // Swap the maximize button glyph to "restore" while maximized.
  window.win.onMaximizeChange((maximized) => {
    const btn = document.getElementById('btn-max')
    if (btn) btn.textContent = maximized ? '❐' : '▢'
  })
}

/** Windows resume-from-sleep can leave WebGL contexts dead; force fresh ones. */
function wirePowerResume(tabs: TabManager): void {
  // Cast guards against the preload API not declaring this yet (added
  // alongside main-process resume detection) so typecheck passes either way.
  ;(window.term as { onPowerResume?: (cb: () => void) => void }).onPowerResume?.(() =>
    tabs.refreshWebgl()
  )
}

function wireSearchBar(tabs: TabManager): void {
  const getActive = (): import('./session').TerminalSession | undefined => tabs.active()
  const bar = document.getElementById('search-bar')!
  const input = document.getElementById('search-input') as HTMLInputElement
  const count = document.getElementById('search-count')!

  tabs.onSearchResults = (index, total) => {
    count.textContent = total > 0 ? `${index + 1}/${total}` : input.value ? '0/0' : ''
  }

  const close = (): void => {
    bar.classList.remove('open')
    count.textContent = ''
    getActive()?.clearSearch()
    getActive()?.term.focus()
  }

  document.addEventListener('app:search', () => {
    bar.classList.add('open')
    input.select()
    input.focus()
  })

  input.addEventListener('input', () => getActive()?.findNext(input.value, true))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) getActive()?.findPrevious(input.value)
      else getActive()?.findNext(input.value)
    } else if (e.key === 'Escape') {
      close()
    }
  })
  document.getElementById('search-close')?.addEventListener('click', close)
}

async function boot(): Promise<void> {
  const cfg = await window.config.load()

  // CRT power-off close: collapse animation + blip, then actually close.
  let closing = false
  const powerOffClose = (): void => {
    if (closing) return
    closing = true
    powerOffSound()
    document.getElementById('app')?.classList.add('power-off')
    window.setTimeout(() => window.win.close(), 440)
  }

  // If close-to-tray hid the window instead, undo the power-off state so the
  // screen isn't collapsed when summoned again.
  window.win.onResetUi(() => {
    closing = false
    document.getElementById('app')?.classList.remove('power-off')
  })

  wireWindowControls(powerOffClose)

  // Re-register any user-uploaded fonts so they're available before terminals start.
  for (const cf of cfg.customFonts) {
    try {
      await loadCustomFont(cf.family, cf.dataUrl)
      addFontOption(`"${cf.family}", monospace`, `${cf.family} (custom)`)
    } catch {
      /* skip a font that fails to load */
    }
  }

  // Apply saved appearance/behavior before creating any terminals.
  registerCustomThemes(cfg.customThemes)
  setTheme(cfg.settings.themeId)
  setColorMode(cfg.settings.colorMode)
  setFont(cfg.settings.fontFamily, cfg.settings.fontSize)
  setPasteGuardEnabled(cfg.settings.pasteGuard)
  configureSound(cfg.settings.soundEnabled, cfg.settings.soundVolume)
  configureIdle(cfg.settings.idleScreen, cfg.settings.idleMinutes)

  // CRT effect layers + level.
  const terminalsEl = document.getElementById('terminals')!
  initCrtOverlays(terminalsEl)
  setCrtLevel(cfg.settings.crtLevel)
  if (cfg.settings.performanceMode) {
    document.getElementById('app')?.classList.add('perf-mode')
  }
  if (cfg.settings.bootSequence && cfg.settings.crtLevel !== 'off') {
    runBootSequence()
    bootSound()
  }

  const tabs = new TabManager(
    {
      tabs: document.getElementById('tabs')!,
      panes: document.getElementById('terminals')!,
      newTabBtn: document.getElementById('new-tab')!,
      profileMenuBtn: document.getElementById('profile-menu-btn')!,
      profileMenu: document.getElementById('profile-menu')!
    },
    cfg.profiles,
    cfg.defaultProfileId,
    cfg.settings
  )
  tabs.closeApp = powerOffClose
  wirePowerResume(tabs)

  // Settings panel (gear button in the tab bar).
  const settings = new SettingsPanel(tabs, cfg.customFonts, cfg.workspaces, cfg.customThemes)
  document.getElementById('btn-settings')?.addEventListener('click', () => settings.toggle())

  // Search in scrollback (Ctrl+Shift+F) and the hacking minigame (Ctrl+Shift+H).
  wireSearchBar(tabs)
  document.addEventListener('app:hack', () => launchHack())
  updateStreakBadge()

  // Command palette (Ctrl+Shift+P).
  initPalette({ tabs, openSettings: () => settings.show() })

  // RobCo-styled prompt when an update has downloaded and is ready.
  window.win.onUpdateReady((version) => {
    if (document.getElementById('update-overlay')) return
    const overlay = document.createElement('div')
    overlay.id = 'update-overlay'
    const panel = document.createElement('div')
    panel.id = 'update-panel'
    const title = document.createElement('div')
    title.className = 'paste-title'
    title.textContent = `ROBCO SYSTEM UPDATE v${version} READY`
    const note = document.createElement('div')
    note.className = 'paste-note'
    note.textContent = 'Install now and restart, or keep working and update on next launch.'
    const row = document.createElement('div')
    row.className = 'paste-buttons'
    const install = document.createElement('button')
    install.textContent = 'INSTALL NOW'
    install.addEventListener('click', () => window.win.installUpdate())
    const later = document.createElement('button')
    later.textContent = 'LATER'
    later.addEventListener('click', () => overlay.remove())
    row.append(install, later)
    panel.append(title, note, row)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
  })

  if (cfg.settings.restoreSession && cfg.session.tabs.length > 0) {
    await tabs.restore(cfg.session.tabs)
  } else {
    await tabs.newTab()
  }

  // Custom fonts (e.g. Monofonto) load asynchronously; once ready, re-fit so the
  // column count matches the real glyph width (otherwise text overruns the edge).
  // Refit every tab/pane, not just the active one — background tabs were
  // measured against the fallback font too.
  document.fonts.ready.then(() => tabs.fitAll())
}

boot()
