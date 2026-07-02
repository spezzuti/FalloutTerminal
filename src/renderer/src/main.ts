import '@xterm/xterm/css/xterm.css'
import './fonts.css'
import './style.css'
import { TabManager } from './tabs'
import { setTheme, setFont, addFontOption, loadCustomFont } from './theme'
import { initCrtOverlays, setCrtLevel, runBootSequence } from './crt'
import { SettingsPanel } from './settings'

function wireWindowControls(): void {
  document.getElementById('btn-min')?.addEventListener('click', () => window.win.minimize())
  document.getElementById('btn-max')?.addEventListener('click', () => window.win.toggleMaximize())
  document.getElementById('btn-close')?.addEventListener('click', () => window.win.close())

  // Swap the maximize button glyph to "restore" while maximized.
  window.win.onMaximizeChange((maximized) => {
    const btn = document.getElementById('btn-max')
    if (btn) btn.textContent = maximized ? '❐' : '▢'
  })
}

function wireSearchBar(getActive: () => import('./session').TerminalSession | undefined): void {
  const bar = document.getElementById('search-bar')!
  const input = document.getElementById('search-input') as HTMLInputElement

  const close = (): void => {
    bar.classList.remove('open')
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
  wireWindowControls()

  const cfg = await window.config.load()

  // Re-register any user-uploaded fonts so they're available before terminals start.
  for (const cf of cfg.customFonts) {
    try {
      await loadCustomFont(cf.family, cf.dataUrl)
      addFontOption(`"${cf.family}", monospace`, `${cf.family} (custom)`)
    } catch {
      /* skip a font that fails to load */
    }
  }

  // Apply saved theme + font before creating any terminals so they start correct.
  setTheme(cfg.settings.themeId)
  setFont(cfg.settings.fontFamily, cfg.settings.fontSize)

  // CRT effect layers + level.
  const terminalsEl = document.getElementById('terminals')!
  initCrtOverlays(terminalsEl)
  setCrtLevel(cfg.settings.crtLevel)
  if (cfg.settings.bootSequence && cfg.settings.crtLevel !== 'off') {
    runBootSequence()
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

  // Settings panel (gear button in the tab bar).
  const settings = new SettingsPanel(tabs, cfg.customFonts)
  document.getElementById('btn-settings')?.addEventListener('click', () => settings.toggle())

  // Search in scrollback (Ctrl+Shift+F).
  wireSearchBar(() => tabs.active())

  if (cfg.settings.restoreSession && cfg.session.tabs.length > 0) {
    await tabs.restore(cfg.session.tabs)
  } else {
    await tabs.newTab()
  }

  // Custom fonts (e.g. Monofonto) load asynchronously; once ready, re-fit so the
  // column count matches the real glyph width (otherwise text overruns the edge).
  document.fonts.ready.then(() => tabs.active()?.fitResize())
}

boot()
