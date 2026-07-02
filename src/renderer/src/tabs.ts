import { TerminalSession } from './session'
import {
  THEMES,
  setTheme,
  setFont,
  currentXtermTheme,
  currentThemeId
} from './theme'
import { CRT_LEVELS, setCrtLevel } from './crt'
import type { Profile, SavedTab, AppSettings, CrtLevel } from '../../shared/types'

export interface TabManagerDom {
  tabs: HTMLElement
  panes: HTMLElement
  newTabBtn: HTMLElement
  profileMenuBtn: HTMLElement
  profileMenu: HTMLElement
}

/**
 * Manages open terminal tabs: creation from profiles, closing, switching, the
 * tab bar DOM, keyboard shortcuts, the profile picker, and session persistence.
 */
export class TabManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private order: string[] = []
  private activeId: string | null = null

  constructor(
    private readonly dom: TabManagerDom,
    private readonly profiles: Profile[],
    private readonly defaultProfileId: string,
    private settings: AppSettings
  ) {
    window.term.onData((id, data) => this.sessions.get(id)?.write(data))
    window.term.onExit((id) => this.handleExit(id))

    // A ResizeObserver fits *after* the layout settles, so growing the window
    // fits accurately (the window 'resize' event fires too early on grow).
    // Coalesce bursts of resize events into one fit per frame.
    let fitQueued = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(fitQueued)
      fitQueued = requestAnimationFrame(() => this.active()?.fitResize())
    })
    ro.observe(this.dom.panes)

    this.dom.newTabBtn.addEventListener('click', () => void this.newTab())
    this.dom.profileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleProfileMenu()
    })
    document.addEventListener('click', () => this.hideProfileMenu())

    this.buildProfileMenu()
  }

  active(): TerminalSession | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined
  }

  /** Apply a theme to every open tab and persist the choice. */
  applyTheme(id: string): void {
    setTheme(id)
    const xt = currentXtermTheme()
    for (const s of this.sessions.values()) s.setTheme(xt)
    this.settings = { ...this.settings, themeId: id }
    window.config.saveSettings(this.settings)
  }

  /** Apply a font family + size to every open tab and persist. */
  applyFont(family: string, size: number): void {
    setFont(family, size)
    for (const s of this.sessions.values()) s.setFont(family, size)
    this.settings = { ...this.settings, fontFamily: family, fontSize: size }
    window.config.saveSettings(this.settings)
  }

  private cycleTheme(): void {
    const i = THEMES.findIndex((t) => t.id === currentThemeId())
    this.applyTheme(THEMES[(i + 1) % THEMES.length].id)
  }

  /** Set the CRT effect level on all tabs and persist. */
  applyCrt(level: CrtLevel): void {
    setCrtLevel(level)
    this.settings = { ...this.settings, crtLevel: level }
    window.config.saveSettings(this.settings)
  }

  private cycleCrt(): void {
    const i = CRT_LEVELS.indexOf(this.settings.crtLevel)
    this.applyCrt(CRT_LEVELS[(i + 1) % CRT_LEVELS.length])
  }

  getSettings(): AppSettings {
    return this.settings
  }

  /** Merge and persist a partial settings change (e.g. boot/restore toggles). */
  updateSetting(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial }
    window.config.saveSettings(this.settings)
  }

  private profileById(id: string): Profile {
    return (
      this.profiles.find((p) => p.id === id) ??
      this.profiles.find((p) => p.id === this.defaultProfileId) ??
      this.profiles[0]
    )
  }

  async newTab(profileId: string = this.defaultProfileId, cwd?: string): Promise<TerminalSession> {
    const profile = this.profileById(profileId)
    const s = new TerminalSession(this.dom.panes, profile)
    s.onTitleChange = () => {
      this.renderTabs()
      this.persist()
    }
    s.keyHandler = (e) => this.handleKey(e)
    this.sessions.set(s.id, s)
    this.order.push(s.id)
    await s.start(cwd)
    this.activate(s.id)
    this.persist()
    return s
  }

  /** Rebuild tabs from a saved session; falls back to a default tab if empty. */
  async restore(tabs: SavedTab[]): Promise<void> {
    const valid = tabs.filter((t) => this.profiles.some((p) => p.id === t.profileId))
    if (valid.length === 0) {
      await this.newTab()
      return
    }
    for (const t of valid) await this.newTab(t.profileId, t.cwd)
    // Activate the first restored tab.
    if (this.order[0]) this.activate(this.order[0])
  }

  activate(id: string): void {
    if (!this.sessions.has(id)) return
    this.activeId = id
    for (const [sid, s] of this.sessions) s.setVisible(sid === id)
    this.renderTabs()
  }

  closeTab(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    const idx = this.order.indexOf(id)
    s.dispose()
    this.sessions.delete(id)
    this.order = this.order.filter((x) => x !== id)

    if (this.order.length === 0) {
      window.win.close()
      return
    }
    if (this.activeId === id) {
      this.activate(this.order[Math.min(idx, this.order.length - 1)])
    } else {
      this.renderTabs()
    }
    this.persist()
  }

  private handleExit(id: string): void {
    this.closeTab(id)
  }

  private cycle(dir: number): void {
    if (this.order.length < 2 || !this.activeId) return
    const i = this.order.indexOf(this.activeId)
    this.activate(this.order[(i + dir + this.order.length) % this.order.length])
  }

  private zoomFont(delta: number): void {
    const size = Math.min(28, Math.max(10, this.settings.fontSize + delta))
    if (size !== this.settings.fontSize) this.applyFont(this.settings.fontFamily, size)
  }

  private handleKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown' || !e.ctrlKey) return true
    if (e.shiftKey && e.code === 'KeyT') {
      void this.newTab()
      return false
    }
    if (e.shiftKey && e.code === 'KeyW') {
      if (this.activeId) this.closeTab(this.activeId)
      return false
    }
    if (e.code === 'Tab') {
      this.cycle(e.shiftKey ? -1 : 1)
      return false
    }
    // Copy the selection; with nothing selected let the key pass to the shell.
    if (e.shiftKey && e.code === 'KeyC') {
      return !this.active()?.copySelection()
    }
    if (e.shiftKey && e.code === 'KeyV') {
      this.active()?.paste()
      return false
    }
    // Search in scrollback.
    if (e.shiftKey && e.code === 'KeyF') {
      document.dispatchEvent(new CustomEvent('app:search'))
      return false
    }
    // Font zoom: Ctrl +/- and Ctrl+0 to reset.
    if (!e.shiftKey && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
      this.zoomFont(1)
      return false
    }
    if (!e.shiftKey && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
      this.zoomFont(-1)
      return false
    }
    if (!e.shiftKey && e.code === 'Digit0') {
      this.applyFont(this.settings.fontFamily, 16)
      return false
    }
    // Ctrl+Shift+. cycles the color theme (proper picker arrives in settings).
    if (e.shiftKey && e.code === 'Period') {
      this.cycleTheme()
      return false
    }
    // Ctrl+Shift+, cycles the CRT effect level (off/low/medium/high).
    if (e.shiftKey && e.code === 'Comma') {
      this.cycleCrt()
      return false
    }
    return true
  }

  /** Persist the current tab set so it can be restored next launch. */
  private persist(): void {
    const tabs: SavedTab[] = this.order.map((id) => {
      const s = this.sessions.get(id)!
      return { profileId: s.profile.id, title: s.title }
    })
    window.config.saveSession(tabs)
  }

  private renderTabs(): void {
    this.dom.tabs.replaceChildren()
    for (const id of this.order) {
      const s = this.sessions.get(id)!
      const tab = document.createElement('div')
      tab.className = 'tab' + (id === this.activeId ? ' active' : '')
      tab.title = s.oscTitle || s.title

      const label = document.createElement('span')
      label.className = 'tab-label'
      label.textContent = s.title
      tab.appendChild(label)

      const close = document.createElement('button')
      close.className = 'tab-close'
      close.textContent = '✕'
      close.title = 'Close tab'
      close.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.closeTab(id)
      })
      tab.appendChild(close)

      tab.addEventListener('click', () => this.activate(id))
      this.dom.tabs.appendChild(tab)
    }
  }

  private buildProfileMenu(): void {
    this.dom.profileMenu.replaceChildren()
    for (const p of this.profiles) {
      const item = document.createElement('button')
      item.className = 'profile-item'
      item.textContent = p.name
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        this.hideProfileMenu()
        void this.newTab(p.id)
      })
      this.dom.profileMenu.appendChild(item)
    }
  }

  private toggleProfileMenu(): void {
    this.dom.profileMenu.classList.toggle('open')
  }

  private hideProfileMenu(): void {
    this.dom.profileMenu.classList.remove('open')
  }
}
