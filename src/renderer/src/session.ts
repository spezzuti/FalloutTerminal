import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { currentXtermTheme, currentFontFamily, currentFontSize } from './theme'
import { keyClick } from './sound'
import { guardedPaste } from './paste-guard'
import type { ITheme } from '@xterm/xterm'
import type { Profile, CursorStyle } from '../../shared/types'

let seq = 0

/**
 * A single terminal tab: an xterm.js instance bound to one PTY session in the
 * main process. Data routing (pty -> term) is handled centrally by TabManager
 * so there is only one global IPC listener regardless of tab count.
 */
export class TerminalSession {
  readonly id: string
  readonly profile: Profile
  readonly pane: HTMLDivElement
  readonly term: Terminal
  private readonly fit: FitAddon
  private readonly search: SearchAddon
  private webgl?: WebglAddon
  private readonly disposers: Array<() => void> = []

  /** Clean label shown on the tab (the profile name). */
  title: string
  /** User-set label from tab rename (overrides `title` when present). */
  customTitle?: string
  /** Live title the shell reports via OSC (shown as the tab tooltip). */
  oscTitle = ''
  exited = false
  copyOnSelect = false

  /** Called when the shell reports a new title (OSC sequence). */
  onTitleChange?: (s: TerminalSession) => void
  /** Return false to swallow a key (we handled it as a shortcut). */
  keyHandler?: (e: KeyboardEvent) => boolean

  constructor(parent: HTMLElement, profile: Profile) {
    this.id = `t${Date.now()}-${seq++}`
    this.profile = profile
    this.title = profile.name

    this.pane = document.createElement('div')
    this.pane.className = 'terminal-pane'
    parent.appendChild(this.pane)

    this.term = new Terminal({
      fontFamily: currentFontFamily(),
      fontSize: currentFontSize(),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: currentXtermTheme()
    })

    this.fit = new FitAddon()
    this.term.loadAddon(this.fit)
    this.search = new SearchAddon()
    this.term.loadAddon(this.search)
    // Clickable URLs open in the system browser.
    this.term.loadAddon(new WebLinksAddon((_e, uri) => window.win.openExternal(uri)))
    // xterm's built-in DOM renderer: text is real DOM, so the CRT phosphor glow
    // (CSS text-shadow) applies per glyph. Fast enough for interactive use.
    this.term.open(this.pane)

    const titleSub = this.term.onTitleChange((t) => {
      this.oscTitle = t || ''
      this.onTitleChange?.(this)
    })
    this.disposers.push(() => titleSub.dispose())

    // Keystrokes -> shell (with an optional CRT key click)
    this.term.onData((data) => {
      keyClick()
      window.term.write(this.id, data)
    })

    // Copy-on-select (opt-in via settings).
    const selSub = this.term.onSelectionChange(() => {
      if (!this.copyOnSelect) return
      const sel = this.term.getSelection()
      if (sel) window.clip.write(sel)
    })
    this.disposers.push(() => selSub.dispose())

    // Intercept native paste (Ctrl+V) ahead of xterm so the paste guard can
    // vet multi-line text. Capture on the pane runs before xterm's handler.
    this.pane.addEventListener(
      'paste',
      (e) => {
        const text = e.clipboardData?.getData('text') ?? ''
        e.preventDefault()
        e.stopPropagation()
        void guardedPaste(text, (t) => this.term.paste(t))
      },
      true
    )

    // Let TabManager intercept tab shortcuts before xterm sends them to the shell.
    this.term.attachCustomKeyEventHandler((e) => (this.keyHandler ? this.keyHandler(e) : true))

    // Windows-Terminal-style right-click: copy the selection if there is one,
    // otherwise paste the clipboard.
    this.pane.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const sel = this.term.getSelection()
      if (sel) {
        window.clip.write(sel)
        this.term.clearSelection()
      } else {
        this.paste()
      }
    })
  }

  /** Tab label: the user's custom name, else the profile name. */
  get displayTitle(): string {
    return this.customTitle ?? this.title
  }

  async start(cwd?: string): Promise<void> {
    this.fit.fit()
    const result = await window.term.spawn({
      id: this.id,
      shell: this.profile.shell,
      args: this.profile.args,
      cwd: cwd ?? this.profile.cwd,
      cols: this.term.cols,
      rows: this.term.rows
    })
    if ('error' in result) {
      // Shell failed to start (missing/renamed executable): show why in-tab.
      this.exited = true
      this.term.write(
        `\x1b[1;31mFailed to start ${this.profile.name}\x1b[0m\r\n` +
          `\x1b[2m${result.error}\x1b[0m\r\n\r\n` +
          `\x1b[2mClose this tab with Ctrl+Shift+W.\x1b[0m\r\n`
      )
    }
  }

  copySelection(): boolean {
    const sel = this.term.getSelection()
    if (!sel) return false
    window.clip.write(sel)
    return true
  }

  paste(): void {
    void guardedPaste(window.clip.read(), (t) => this.term.paste(t))
  }

  setCursor(style: CursorStyle, blink: boolean): void {
    this.term.options.cursorStyle = style
    this.term.options.cursorBlink = blink
  }

  /** WebGL renderer: faster for heavy TUI output, but no per-glyph glow. */
  setWebgl(on: boolean): void {
    if (on && !this.webgl) {
      try {
        this.webgl = new WebglAddon()
        this.term.loadAddon(this.webgl)
      } catch {
        this.webgl = undefined
      }
    } else if (!on && this.webgl) {
      this.webgl.dispose()
      this.webgl = undefined
    }
  }

  findNext(query: string, incremental = false): void {
    if (query) this.search.findNext(query, { incremental })
  }

  findPrevious(query: string): void {
    if (query) this.search.findPrevious(query)
  }

  write(data: string): void {
    // Ack after xterm has actually processed the chunk (flow control).
    this.term.write(data, () => window.term.ack(this.id, data.length))
  }

  markExited(): void {
    this.exited = true
    this.term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
  }

  /** Refit the terminal to its container and inform the PTY of the new size. */
  fitResize(): void {
    // Skip while detached or hidden (zero-size fits corrupt the layout).
    if (!this.pane.isConnected || this.pane.offsetWidth === 0 || this.pane.offsetHeight === 0) {
      return
    }
    // If the view was pinned to the bottom, keep the prompt visible after refit.
    const buf = this.term.buffer.active
    const atBottom = buf.viewportY >= buf.baseY
    this.fit.fit()
    if (!this.exited) window.term.resize(this.id, this.term.cols, this.term.rows)
    if (atBottom) this.term.scrollToBottom()
  }

  setTheme(theme: ITheme): void {
    this.term.options.theme = theme
  }

  setFont(family: string, size: number): void {
    this.term.options.fontFamily = family
    this.term.options.fontSize = size
    this.fitResize()
  }


  dispose(): void {
    this.disposers.forEach((d) => d())
    if (!this.exited) window.term.kill(this.id)
    this.term.dispose()
    this.pane.remove()
  }
}
