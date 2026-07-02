import './settings.css'
import { THEMES, FONTS, addFontOption, loadCustomFont } from './theme'
import { CRT_LEVELS, runBootSequence } from './crt'
import type { TabManager } from './tabs'
import type { CrtLevel, CustomFont } from '../../shared/types'

/**
 * The settings panel: a modal for adjusting theme, font, size, CRT level, boot
 * and session behavior, and uploading custom fonts. All changes apply live and
 * persist through the TabManager / config bridge.
 */
export class SettingsPanel {
  private readonly overlay: HTMLDivElement
  private fontSelect!: HTMLSelectElement

  constructor(
    private readonly tabs: TabManager,
    private readonly customFonts: CustomFont[]
  ) {
    this.overlay = document.createElement('div')
    this.overlay.id = 'settings-overlay'
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })
    document.body.appendChild(this.overlay)
  }

  toggle(): void {
    if (this.overlay.classList.contains('open')) this.hide()
    else this.show()
  }

  show(): void {
    // Rebuild each open so controls always reflect the live settings
    // (they can change via keyboard shortcuts while the panel is closed).
    this.overlay.replaceChildren()
    this.build()
    this.overlay.classList.add('open')
  }

  hide(): void {
    this.overlay.classList.remove('open')
    this.tabs.active()?.term.focus()
  }

  private field(label: string, control: HTMLElement): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'settings-field'
    const l = document.createElement('label')
    l.textContent = label
    row.append(l, control)
    return row
  }

  private build(): void {
    const s = this.tabs.getSettings()

    const panel = document.createElement('div')
    panel.id = 'settings-panel'

    const header = document.createElement('div')
    header.className = 'settings-header'
    const title = document.createElement('span')
    title.textContent = 'SETTINGS'
    const close = document.createElement('button')
    close.className = 'settings-close'
    close.textContent = '✕'
    close.addEventListener('click', () => this.hide())
    header.append(title, close)
    panel.appendChild(header)

    // Theme
    const themeSel = document.createElement('select')
    for (const t of THEMES) {
      const o = document.createElement('option')
      o.value = t.id
      o.textContent = t.name
      if (t.id === s.themeId) o.selected = true
      themeSel.appendChild(o)
    }
    themeSel.addEventListener('change', () => this.tabs.applyTheme(themeSel.value))
    panel.appendChild(this.field('Theme', themeSel))

    // Font
    this.fontSelect = document.createElement('select')
    this.rebuildFontOptions(s.fontFamily)
    this.fontSelect.addEventListener('change', () =>
      this.tabs.applyFont(this.fontSelect.value, this.tabs.getSettings().fontSize)
    )
    panel.appendChild(this.field('Font', this.fontSelect))

    // Font size
    const sizeWrap = document.createElement('div')
    sizeWrap.className = 'settings-inline'
    const size = document.createElement('input')
    size.type = 'range'
    size.min = '10'
    size.max = '28'
    size.value = String(s.fontSize)
    const sizeVal = document.createElement('span')
    sizeVal.className = 'settings-val'
    sizeVal.textContent = String(s.fontSize)
    size.addEventListener('input', () => {
      sizeVal.textContent = size.value
      this.tabs.applyFont(this.tabs.getSettings().fontFamily, Number(size.value))
    })
    sizeWrap.append(size, sizeVal)
    panel.appendChild(this.field('Font size', sizeWrap))

    // Upload custom font
    const upload = document.createElement('input')
    upload.type = 'file'
    upload.accept = '.ttf,.otf,.woff,.woff2'
    upload.className = 'settings-file'
    upload.addEventListener('change', () => this.onUpload(upload))
    panel.appendChild(this.field('Upload font', upload))

    // CRT level
    const crtSel = document.createElement('select')
    for (const lvl of CRT_LEVELS) {
      const o = document.createElement('option')
      o.value = lvl
      o.textContent = lvl.toUpperCase()
      if (lvl === s.crtLevel) o.selected = true
      crtSel.appendChild(o)
    }
    crtSel.addEventListener('change', () => this.tabs.applyCrt(crtSel.value as CrtLevel))
    panel.appendChild(this.field('CRT effects', crtSel))

    // Boot sequence toggle
    const boot = document.createElement('input')
    boot.type = 'checkbox'
    boot.checked = s.bootSequence
    boot.addEventListener('change', () => this.tabs.updateSetting({ bootSequence: boot.checked }))
    panel.appendChild(this.field('Boot sequence on launch', boot))

    // Restore session toggle
    const restore = document.createElement('input')
    restore.type = 'checkbox'
    restore.checked = s.restoreSession
    restore.addEventListener('change', () =>
      this.tabs.updateSetting({ restoreSession: restore.checked })
    )
    panel.appendChild(this.field('Restore tabs on launch', restore))

    // Replay boot
    const replay = document.createElement('button')
    replay.className = 'settings-button'
    replay.textContent = 'Replay boot sequence'
    replay.addEventListener('click', () => {
      this.hide()
      runBootSequence()
    })
    panel.appendChild(replay)

    this.overlay.appendChild(panel)
  }

  private rebuildFontOptions(selected: string): void {
    this.fontSelect.replaceChildren()
    for (const f of FONTS) {
      const o = document.createElement('option')
      o.value = f.family
      o.textContent = f.name
      if (f.family === selected) o.selected = true
      this.fontSelect.appendChild(o)
    }
  }

  private async onUpload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0]
    if (!file) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

    const family = file.name.replace(/\.[^.]+$/, '')
    try {
      await loadCustomFont(family, dataUrl)
    } catch {
      return // invalid font file
    }

    // The selectable value is the CSS family string (with a monospace fallback).
    const value = `"${family}", monospace`
    addFontOption(value, `${family} (custom)`)
    this.customFonts.push({ family, dataUrl })
    window.config.saveCustomFonts(this.customFonts)

    // Refresh the dropdown, select the new font, and apply it live.
    this.rebuildFontOptions(value)
    this.tabs.applyFont(value, this.tabs.getSettings().fontSize)
    input.value = ''
  }
}
