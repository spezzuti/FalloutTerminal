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
import { noteActivity } from './idle'
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

interface TabInfo {
  id: string
  /** Container for this tab's (possibly split) panes. */
  root: HTMLDivElement
  sessionIds: string[]
  /** The session that has keyboard focus within this tab. */
  focusedId: string
}

let tabSeq = 0

/**
 * Manages terminal tabs and split panes: creation from profiles, closing,
 * switching, renaming, drag-reordering, splits, the tab bar DOM, keyboard
 * shortcuts, the profile picker, workspaces, and session persistence.
 */
export class TabManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly tabs = new Map<string, TabInfo>()
  private readonly sessionTab = new Map<string, string>()
  private readonly byPane = new Map<Element, TerminalSession>()
  private order: string[] = []
  private activeTabId: string | null = null
  private profiles: Profile[]
  private defaultProfileId: string
  private settings: AppSettings

  private readonly ro: ResizeObserver
  private settleTimer = 0

  /** Set by the shell to run the power-off animation before closing. */
  closeApp?: () => void
  /** Relays search result counts from the focused session to the search bar. */
  onSearchResults?: (index: number, count: number) => void

  constructor(
    private readonly dom: TabManagerDom,
    profiles: Profile[],
    defaultProfileId: string,
    settings: AppSettings
  ) {
    this.profiles = profiles
    this.defaultProfileId = defaultProfileId
    this.settings = settings

    window.term.onData((id, data) => {
      noteActivity() // shell output counts as activity for the idle screen
      this.sessions.get(id)?.write(data)
    })
    window.term.onExit((id) => this.closeSession(id))

    // Ctrl + mouse wheel zooms the font.
    this.dom.panes.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        this.zoomFont(e.deltaY < 0 ? 1 : -1)
      },
      { passive: false }
    )

    // Observe every terminal pane: fires for window resizes AND divider drags,
    // after layout settles (accurate on grow, unlike the window resize event).
    // Fit IMMEDIATELY so the terminal reflows live while dragging — the prompt
    // must stay pinned to the bottom edge, never get clipped.
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) this.byPane.get(e.target)?.fitResize()
      // Trailing settle pass guarantees a final exact fit after the gesture.
      window.clearTimeout(this.settleTimer)
      this.settleTimer = window.setTimeout(() => this.fitActiveTab(), 120)
    })

    this.dom.newTabBtn.addEventListener('click', () => void this.newTab())
    this.dom.profileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleProfileMenu()
    })
    document.addEventListener('click', () => this.hideProfileMenu())

    this.buildProfileMenu()
  }

  private fitActiveTab(): void {
    const tab = this.activeTab()
    if (!tab) return
    for (const sid of tab.sessionIds) this.sessions.get(sid)?.fitResize()
  }

  // ---- Accessors -------------------------------------------------------------

  private activeTab(): TabInfo | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
  }

  /** The focused session of the active tab. */
  active(): TerminalSession | undefined {
    const tab = this.activeTab()
    return tab ? this.sessions.get(tab.focusedId) : undefined
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

  /** Current open tabs as a persistable snapshot (primary pane per tab). */
  snapshot(): SavedTab[] {
    const out: SavedTab[] = []
    for (const tid of this.order) {
      const tab = this.tabs.get(tid)
      const s = tab && this.sessions.get(tab.sessionIds[0])
      if (s) out.push({ profileId: s.profile.id, title: s.displayTitle, cwd: s.cwd })
    }
    return out
  }

  // Public helpers (command palette etc.)

  cycleTab(dir: number): void {
    this.cycle(dir)
  }

  closeFocusedPane(): void {
    const tab = this.activeTab()
    if (tab) this.closeSession(tab.focusedId)
  }

  renameActiveTab(): void {
    const s = this.activeTab() && this.primarySession(this.activeTab()!)
    if (!s) return
    const label = this.dom.tabs.querySelector<HTMLElement>(
      `[data-tab-id="${this.activeTabId}"] .tab-label`
    )
    if (label) this.startRename(s, label)
  }

  // ---- Settings application ---------------------------------------------------

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

  // ---- Session / tab lifecycle ---------------------------------------------------

  private profileById(id: string): Profile {
    return (
      this.profiles.find((p) => p.id === id) ??
      this.profiles.find((p) => p.id === this.defaultProfileId) ??
      this.profiles[0]
    )
  }

  private createSession(
    tab: TabInfo,
    parent: HTMLElement,
    profile: Profile,
    title?: string
  ): TerminalSession {
    const s = new TerminalSession(parent, profile)
    s.onTitleChange = () => {
      this.renderTabs()
      this.persist()
    }
    s.keyHandler = (e) => {
      // Any keystroke marks this session as its tab's focused pane.
      const tid = this.sessionTab.get(s.id)
      if (tid) this.tabs.get(tid)!.focusedId = s.id
      return this.handleKey(e)
    }
    s.copyOnSelect = this.settings.copyOnSelect
    s.setCursor(this.settings.cursorStyle, this.settings.cursorBlink)
    if (this.settings.performanceMode) s.setWebgl(true)
    if (title && title !== profile.name) s.customTitle = title
    s.onSearchResults = (i, c) => this.onSearchResults?.(i, c)

    s.pane.addEventListener('mousedown', () => {
      const tid = this.sessionTab.get(s.id)
      if (tid) this.tabs.get(tid)!.focusedId = s.id
    })

    this.sessions.set(s.id, s)
    this.sessionTab.set(s.id, tab.id)
    this.byPane.set(s.pane, s)
    this.ro.observe(s.pane)
    return s
  }

  async newTab(
    profileId: string = this.defaultProfileId,
    cwd?: string,
    title?: string
  ): Promise<TerminalSession> {
    // New tabs inherit the focused shell's directory (shell integration).
    if (cwd === undefined && this.settings.openTabsInCwd) cwd = this.active()?.cwd
    const profile = this.profileById(profileId)
    const root = document.createElement('div')
    root.className = 'tab-pane hidden'
    this.dom.panes.appendChild(root)

    const tab: TabInfo = { id: `tab${tabSeq++}`, root, sessionIds: [], focusedId: '' }
    this.tabs.set(tab.id, tab)
    this.order.push(tab.id)

    const s = this.createSession(tab, root, profile, title)
    tab.sessionIds.push(s.id)
    tab.focusedId = s.id

    await s.start(cwd)
    this.renderTabs()
    this.activate(tab.id)
    this.persist()
    return s
  }

  /** Split the focused pane of the active tab; the new pane runs the same profile. */
  async splitActive(direction: 'row' | 'column'): Promise<void> {
    const tab = this.activeTab()
    if (!tab) return
    const target = this.sessions.get(tab.focusedId)
    if (!target) return

    const holder = target.pane.parentElement!
    const wrapper = document.createElement('div')
    wrapper.className = `split split-${direction}`
    holder.insertBefore(wrapper, target.pane)
    wrapper.appendChild(target.pane)

    const divider = document.createElement('div')
    divider.className = 'split-divider'
    this.wireDivider(divider, direction)
    wrapper.appendChild(divider)

    const s = this.createSession(tab, wrapper, target.profile)
    tab.sessionIds.push(s.id)
    await s.start(this.settings.openTabsInCwd ? target.cwd : undefined)
    tab.focusedId = s.id
    s.term.focus()
    target.fitResize()
    s.fitResize()
  }

  private wireDivider(divider: HTMLDivElement, direction: 'row' | 'column'): void {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const wrapper = divider.parentElement as HTMLElement
      const first = wrapper.firstElementChild as HTMLElement
      const horizontal = direction === 'row'
      const move = (ev: MouseEvent): void => {
        const r = wrapper.getBoundingClientRect()
        const pct = horizontal
          ? ((ev.clientX - r.left) / r.width) * 100
          : ((ev.clientY - r.top) / r.height) * 100
        first.style.flex = `0 0 ${Math.min(85, Math.max(15, pct))}%`
      }
      const up = (): void => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        this.fitActiveTab()
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }

  /** Remove empty split wrappers and orphaned dividers after a pane closes. */
  private cleanupSplits(root: HTMLElement): void {
    const splits = [...root.querySelectorAll<HTMLElement>('.split')].reverse()
    for (const sp of splits) {
      for (const child of [...sp.children]) {
        if (!child.classList.contains('split-divider')) continue
        const prev = child.previousElementSibling
        const next = child.nextElementSibling
        if (!prev || !next || prev.classList.contains('split-divider')) child.remove()
      }
      const content = [...sp.children].filter((c) => !c.classList.contains('split-divider'))
      if (content.length === 1) {
        const only = content[0] as HTMLElement
        only.style.flex = ''
        sp.replaceWith(only)
      } else if (content.length === 0) {
        sp.remove()
      }
    }
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
    for (const tid of old) this.closeWholeTab(tid)
  }

  activate(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.activeTabId = tabId
    for (const [tid, t] of this.tabs) t.root.classList.toggle('hidden', tid !== tabId)
    this.updateActiveClasses()
    this.fitActiveTab()
    this.sessions.get(tab.focusedId)?.term.focus()
  }

  /** Close one pane; closes the tab when it was the last pane. */
  closeSession(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    const tabId = this.sessionTab.get(sessionId)
    const tab = tabId ? this.tabs.get(tabId) : undefined

    s.dispose()
    this.sessions.delete(sessionId)
    this.sessionTab.delete(sessionId)
    this.byPane.delete(s.pane)
    if (!tab) return

    tab.sessionIds = tab.sessionIds.filter((x) => x !== sessionId)
    if (tab.sessionIds.length === 0) {
      this.removeTab(tab.id)
      return
    }
    this.cleanupSplits(tab.root)
    if (tab.focusedId === sessionId) {
      tab.focusedId = tab.sessionIds[0]
      if (tab.id === this.activeTabId) this.sessions.get(tab.focusedId)?.term.focus()
    }
    this.fitActiveTab()
    this.renderTabs()
    this.persist()
  }

  /** Close a whole tab (all its panes). */
  closeWholeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    for (const sid of [...tab.sessionIds]) {
      const s = this.sessions.get(sid)
      if (s) {
        s.dispose()
        this.sessions.delete(sid)
        this.sessionTab.delete(sid)
        this.byPane.delete(s.pane)
      }
    }
    tab.sessionIds = []
    this.removeTab(tabId)
  }

  private removeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const idx = this.order.indexOf(tabId)
    tab.root.remove()
    this.tabs.delete(tabId)
    this.order = this.order.filter((x) => x !== tabId)

    if (this.order.length === 0) {
      ;(this.closeApp ?? ((): void => window.win.close()))()
      return
    }
    if (this.activeTabId === tabId) {
      this.activate(this.order[Math.min(idx, this.order.length - 1)])
    }
    this.renderTabs()
    this.persist()
  }

  private cycle(dir: number): void {
    if (this.order.length < 2 || !this.activeTabId) return
    const i = this.order.indexOf(this.activeTabId)
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
      const tab = this.activeTab()
      if (tab) this.closeSession(tab.focusedId)
      return false
    }
    if (e.code === 'Tab') {
      this.cycle(e.shiftKey ? -1 : 1)
      return false
    }
    // Split panes: D = side by side, S = stacked.
    if (e.shiftKey && e.code === 'KeyD') {
      void this.splitActive('row')
      return false
    }
    if (e.shiftKey && e.code === 'KeyS') {
      void this.splitActive('column')
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
    if (e.shiftKey && e.code === 'KeyF') {
      document.dispatchEvent(new CustomEvent('app:search'))
      return false
    }
    if (e.shiftKey && e.code === 'KeyH') {
      document.dispatchEvent(new CustomEvent('app:hack'))
      return false
    }
    // Command palette.
    if (e.shiftKey && e.code === 'KeyP') {
      document.dispatchEvent(new CustomEvent('app:palette'))
      return false
    }
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

  private primarySession(tab: TabInfo): TerminalSession | undefined {
    return this.sessions.get(tab.sessionIds[0])
  }

  /** Toggle .active on existing tab elements without rebuilding the DOM
      (a rebuild would eat the second click of a rename double-click). */
  private updateActiveClasses(): void {
    for (const el of this.dom.tabs.children) {
      const he = el as HTMLElement
      he.classList.toggle('active', he.dataset.tabId === this.activeTabId)
    }
  }

  private startRename(s: TerminalSession, label: HTMLElement): void {
    const input = document.createElement('input')
    input.className = 'tab-rename'
    input.value = s.displayTitle
    label.replaceWith(input)
    input.select()
    input.focus()
    let committed = false
    const commit = (): void => {
      if (committed) return
      committed = true
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

  /** Small popup menu on tab right-click. */
  private showTabMenu(x: number, y: number, tid: string): void {
    document.getElementById('tab-menu')?.remove()
    const tab = this.tabs.get(tid)
    const s = tab && this.primarySession(tab)
    if (!tab || !s) return

    const menu = document.createElement('div')
    menu.id = 'tab-menu'
    const add = (label: string, fn: () => void): void => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        menu.remove()
        fn()
      })
      menu.appendChild(b)
    }
    add('Rename', () => {
      const label = this.dom.tabs.querySelector<HTMLElement>(
        `[data-tab-id="${tid}"] .tab-label`
      )
      if (label) this.startRename(s, label)
    })
    add('Duplicate', () => void this.newTab(s.profile.id))
    add('Close others', () => {
      for (const t of [...this.order]) if (t !== tid) this.closeWholeTab(t)
    })
    add('Close to the right', () => {
      const idx = this.order.indexOf(tid)
      for (const t of this.order.slice(idx + 1)) this.closeWholeTab(t)
    })
    add('Close', () => this.closeWholeTab(tid))

    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    document.body.appendChild(menu)
    window.setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true })
    }, 0)
  }

  private renderTabs(): void {
    this.dom.tabs.replaceChildren()
    for (const tid of this.order) {
      const tab = this.tabs.get(tid)!
      const s = this.primarySession(tab)
      if (!s) continue
      const el = document.createElement('div')
      el.className = 'tab' + (tid === this.activeTabId ? ' active' : '')
      el.dataset.tabId = tid
      if (s.profile.color) el.style.borderLeft = `2px solid ${s.profile.color}`
      const splitMark = tab.sessionIds.length > 1 ? ` ⊞` : ''
      el.title = (s.oscTitle || s.displayTitle) + splitMark + (s.cwd ? `\n${s.cwd}` : '')
      el.draggable = true

      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        this.showTabMenu(ev.clientX, ev.clientY, tid)
      })

      el.addEventListener('dragstart', (ev) => {
        ev.dataTransfer!.setData('text/plain', tid)
        ev.dataTransfer!.effectAllowed = 'move'
      })
      el.addEventListener('dragover', (ev) => ev.preventDefault())
      el.addEventListener('drop', (ev) => {
        ev.preventDefault()
        const src = ev.dataTransfer!.getData('text/plain')
        if (src) this.moveTab(src, tid)
      })

      const label = document.createElement('span')
      label.className = 'tab-label'
      label.textContent = s.displayTitle + splitMark
      el.appendChild(label)

      const close = document.createElement('button')
      close.className = 'tab-close'
      close.textContent = '✕'
      close.title = 'Close tab'
      close.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.closeWholeTab(tid)
      })
      el.appendChild(close)

      el.addEventListener('click', () => this.activate(tid))
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation()
        this.startRename(s, label)
      })
      this.dom.tabs.appendChild(el)
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
