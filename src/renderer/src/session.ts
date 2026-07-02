import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { currentXtermTheme, currentFontFamily, currentFontSize } from './theme'
import type { ITheme } from '@xterm/xterm'
import type { Profile } from '../../shared/types'

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
  private readonly disposers: Array<() => void> = []

  /** Clean label shown on the tab (the profile name). */
  title: string
  /** Live title the shell reports via OSC (shown as the tab tooltip). */
  oscTitle = ''
  exited = false

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
    // xterm's built-in DOM renderer: text is real DOM, so the CRT phosphor glow
    // (CSS text-shadow) applies per glyph. Fast enough for interactive use.
    this.term.open(this.pane)

    const titleSub = this.term.onTitleChange((t) => {
      this.oscTitle = t || ''
      this.onTitleChange?.(this)
    })
    this.disposers.push(() => titleSub.dispose())

    // Keystrokes -> shell
    this.term.onData((data) => window.term.write(this.id, data))

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
        this.term.paste(window.clip.read())
      }
    })
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
    this.term.paste(window.clip.read())
  }

  findNext(query: string, incremental = false): void {
    if (query) this.search.findNext(query, { incremental })
  }

  findPrevious(query: string): void {
    if (query) this.search.findPrevious(query)
  }

  write(data: string): void {
    this.term.write(data)
  }

  markExited(): void {
    this.exited = true
    this.term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
  }

  /** Refit the terminal to its container and inform the PTY of the new size. */
  fitResize(): void {
    if (this.pane.style.display === 'none') return
    this.fit.fit()
    if (!this.exited) window.term.resize(this.id, this.term.cols, this.term.rows)
  }

  setTheme(theme: ITheme): void {
    this.term.options.theme = theme
  }

  setFont(family: string, size: number): void {
    this.term.options.fontFamily = family
    this.term.options.fontSize = size
    this.fitResize()
  }

  setVisible(visible: boolean): void {
    this.pane.style.display = visible ? 'block' : 'none'
    if (visible) {
      this.fitResize()
      this.term.focus()
    }
  }

  dispose(): void {
    this.disposers.forEach((d) => d())
    if (!this.exited) window.term.kill(this.id)
    this.term.dispose()
    this.pane.remove()
  }
}
