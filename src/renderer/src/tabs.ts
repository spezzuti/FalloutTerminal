import { TerminalSession } from './session'
import {
  THEMES,
  setTheme,
  setFont,
  setColorMode,
  currentXtermTheme,
  currentThemeId
} from './theme'
import { CRT_LEVELS, setCrtLevel } from './crt'
import { configureSound } from './sound'
import { setPasteGuardEnabled } from './paste-guard'
import type {
  Profile,
  SavedTab,
  Workspace,
  AppSettings,
  CrtLevel,
  ColorMode,
  CursorStyle
} from '../../shared/types'

export interface TabManagerDom {
  tabs: HTMLElement
  panes: HTMLElement
  newTabBtn: HTMLElement
  profileMenuBtn: HTMLElement
  profileMenu: HTMLElement
}

/**
 * Manages open terminal tabs: creation from profiles, closing, switching,
 * renaming, drag-reordering, the tab bar DOM, keyboard shortcuts, the profile
 * picker, workspaces, and session persistence.
 */
export class TabManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private order: string[] = []
  private activeId: string | null = null
  private profiles: Profile[]
  private defaultProfileId: string
  private settings: AppSettings

  /** Set by the shell to run the power-off animation before closing. */
  closeApp?: () => void

  constructor(
    private readonly dom: TabManagerDom,
    profiles: Profile[],
    defaultProfileId: string,
    settings: AppSettings
  ) {
    this.profiles = profiles
    this.defaultProfileId = defaultProfileId
    this.settings = settings

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

  // ---- Accessors -------------------------------------------------------------

  active(): TerminalSession | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined
  }

  getSettings(): AppSettings {
    return this.settings
  }

  getProfiles(): Profile[] {
    return this.profiles
  }

  getDefaultProfileId(): string {
    return this.defaultProfileId
  }

  /** Current open tabs as a persistable snapshot. */
  snapshot(): SavedTab[] {
    return this.order.map((id) => {
      const s = this.sessions.get(id)!
      return { profileId: s.profile.id, title: s.displayTitle }
    })
  }

  // ---- Settings application ---------------------------------------------------

  /** Merge and persist a partial settings change (e.g. boot/restore toggles). */
  updateSetting(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial }
    window.config.saveSettings(this.settings)
  }

  applyTheme(id: string): void {
    setTheme(id)
    const xt = currentXtermTheme()
    for (const s of this.sessions.values()) s.setTheme(xt)
    this.updateSetting({ themeId: id })
  }

  applyColorMode(mode: ColorMode): void {
    setColorMode(mode)
    const xt = currentXtermTheme()
    for (const s of this.sessions.values()) s.setTheme(xt)
    this.updateSetting({ colorMode: mode })
  }

  applyFont(family: string, size: number): void {
    setFont(family, size)
    for (const s of this.sessions.values()) s.setFont(family, size)
    this.updateSetting({ fontFamily: family, fontSize: size })
  }

  applyCursor(style: CursorStyle, blink: boolean): void {
    for (const s of this.sessions.values()) s.setCursor(style, blink)
    this.updateSetting({ cursorStyle: style, cursorBlink: blink })
  }

  applyCrt(level: CrtLevel): void {
    setCrtLevel(level)
    this.updateSetting({ crtLevel: level })
  }

  applySound(on: boolean, volume: number): void {
    configureSound(on, volume)
    this.updateSetting({ soundEnabled: on, soundVolume: volume })
  }

  applyPasteGuard(on: boolean): void {
    setPasteGuardEnabled(on)
    this.updateSetting({ pasteGuard: on })
  }

  applyCopyOnSelect(on: boolean): void {
    for (const s of this.sessions.values()) s.copyOnSelect = on
    this.updateSetting({ copyOnSelect: on })
  }

  applyPerformance(on: boolean): void {
    for (const s of this.sessions.values()) s.setWebgl(on)
    document.getElementById('app')?.classList.toggle('perf-mode', on)
    this.updateSetting({ performanceMode: on })
  }

  setProfiles(profiles: Profile[], defaultProfileId: string): void {
    this.profiles = profiles
    this.defaultProfileId = profiles.some((p) => p.id === defaultProfileId)
      ? defaultProfileId
      : (profiles[0]?.id ?? this.defaultProfileId)
    this.buildProfileMenu()
  }

  private cycleTheme(): void {
    const i = THEMES.findIndex((t) => t.id === currentThemeId())
    this.applyTheme(THEMES[(i + 1) % THEMES.length].id)
  }

  private cycleCrt(): void {
    const i = CRT_LEVELS.indexOf(this.settings.crtLevel)
    this.applyCrt(CRT_LEVELS[(i + 1) % CRT_LEVELS.length])
  }

  private zoomFont(delta: number): void {
    const size = Math.min(28, Math.max(10, this.settings.fontSize + delta))
    if (size !== this.settings.fontSize) this.applyFont(this.settings.fontFamily, size)
  }

  // ---- Tab lifecycle -----------------------------------------------------------

  private profileById(id: string): Profile {
    return (
      this.profiles.find((p) => p.id === id) ??
      this.profiles.find((p) => p.id === this.defaultProfileId) ??
      this.profiles[0]
    )
  }

  async newTab(
    profileId: string = this.defaultProfileId,
    cwd?: string,
    title?: string
  ): Promise<TerminalSession> {
    const profile = this.profileById(profileId)
    const s = new TerminalSession(this.dom.panes, profile)
    s.onTitleChange = () => {
      this.renderTabs()
      this.persist()
    }
    s.keyHandler = (e) => this.handleKey(e)
    s.copyOnSelect = this.settings.copyOnSelect
    s.setCursor(this.settings.cursorStyle, this.settings.cursorBlink)
    if (this.settings.performanceMode) s.setWebgl(true)
    if (title && title !== profile.name) s.customTitle = title
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
    for (const t of valid) await this.newTab(t.profileId, t.cwd, t.title)
    if (this.order[0]) this.activate(this.order[0])
  }

  /** Replace the current tab set with a workspace's tabs. */
  async loadWorkspace(ws: Workspace): Promise<void> {
    if (!ws.tabs.length) return
    const old = [...this.order]
    for (const t of ws.tabs) await this.newTab(t.profileId, t.cwd, t.title)
    for (const id of old) this.closeTab(id)
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
      // Last tab closed -> quit the app, like a normal terminal.
      ;(this.closeApp ?? ((): void => window.win.close()))()
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

  private moveTab(srcId: string, destId: string): void {
    if (srcId === destId) return
    const from = this.order.indexOf(srcId)
    const to = this.order.indexOf(destId)
    if (from < 0 || to < 0) return
    this.order.splice(from, 1)
    this.order.splice(to, 0, srcId)
    this.renderTabs()
    this.persist()
  }

  // ---- Keyboard ---------------------------------------------------------------

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
    // RobCo hacking minigame.
    if (e.shiftKey && e.code === 'KeyH') {
      document.dispatchEvent(new CustomEvent('app:hack'))
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
    // Ctrl+Shift+. cycles theme; Ctrl+Shift+, cycles CRT level.
    if (e.shiftKey && e.code === 'Period') {
      this.cycleTheme()
      return false
    }
    if (e.shiftKey && e.code === 'Comma') {
      this.cycleCrt()
      return false
    }
    return true
  }

  // ---- Persistence --------------------------------------------------------------

  private persist(): void {
    window.config.saveSession(this.snapshot())
  }

  // ---- DOM ------------------------------------------------------------------------

  private startRename(s: TerminalSession, label: HTMLElement): void {
    const input = document.createElement('input')
    input.className = 'tab-rename'
    input.value = s.displayTitle
    label.replaceWith(input)
    input.select()
    input.focus()
    const commit = (): void => {
      const v = input.value.trim()
      s.customTitle = v && v !== s.title ? v : undefined
      this.renderTabs()
      this.persist()
      this.active()?.term.focus()
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Enter') input.blur()
      if (ev.key === 'Escape') {
        input.value = s.displayTitle
        input.blur()
      }
    })
  }

  private renderTabs(): void {
    this.dom.tabs.replaceChildren()
    for (const id of this.order) {
      const s = this.sessions.get(id)!
      const tab = document.createElement('div')
      tab.className = 'tab' + (id === this.activeId ? ' active' : '')
      tab.title = s.oscTitle || s.displayTitle
      tab.draggable = true

      tab.addEventListener('dragstart', (ev) => {
        ev.dataTransfer!.setData('text/plain', id)
        ev.dataTransfer!.effectAllowed = 'move'
      })
      tab.addEventListener('dragover', (ev) => ev.preventDefault())
      tab.addEventListener('drop', (ev) => {
        ev.preventDefault()
        const src = ev.dataTransfer!.getData('text/plain')
        if (src) this.moveTab(src, id)
      })

      const label = document.createElement('span')
      label.className = 'tab-label'
      label.textContent = s.displayTitle
      label.addEventListener('dblclick', (ev) => {
        ev.stopPropagation()
        this.startRename(s, label)
      })
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
      item.textContent = p.id === this.defaultProfileId ? `${p.name} ★` : p.name
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
