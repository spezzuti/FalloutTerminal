import './settings.css'
import {
  THEMES,
  FONTS,
  addFontOption,
  loadCustomFont,
  registerCustomThemes,
  themeToCustom,
  getTheme,
  ANSI_LABELS
} from './theme'
import { CRT_LEVELS, runBootSequence } from './crt'
import { launchHack } from './hack'
import { configureIdle } from './idle'
import type { TabManager } from './tabs'
import type {
  CrtLevel,
  ColorMode,
  CursorStyle,
  CustomFont,
  CustomTheme,
  Profile,
  Workspace
} from '../../shared/types'

/**
 * The settings panel: theme, colors, fonts, CRT, behavior, profiles,
 * workspaces, and data import/export. Rebuilt on every open so controls always
 * reflect live values; all changes apply immediately and persist.
 */
export class SettingsPanel {
  private readonly overlay: HTMLDivElement
  private fontSelect!: HTMLSelectElement
  private workspaces: Workspace[] = []

  private customThemes: CustomTheme[]

  constructor(
    private readonly tabs: TabManager,
    private readonly customFonts: CustomFont[],
    workspaces: Workspace[],
    customThemes: CustomTheme[]
  ) {
    this.customThemes = customThemes
    this.workspaces = workspaces
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
    this.overlay.replaceChildren()
    this.build()
    this.overlay.classList.add('open')
  }

  hide(): void {
    this.overlay.classList.remove('open')
    this.tabs.active()?.term.focus()
  }

  // ---- UI helpers -------------------------------------------------------------

  private field(label: string, control: HTMLElement): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'settings-field'
    const l = document.createElement('label')
    l.textContent = label
    row.append(l, control)
    return row
  }

  private section(title: string): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'settings-section'
    el.textContent = title
    return el
  }

  private select(
    options: Array<{ value: string; label: string }>,
    selected: string,
    onChange: (v: string) => void
  ): HTMLSelectElement {
    const sel = document.createElement('select')
    for (const o of options) {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      if (o.value === selected) opt.selected = true
      sel.appendChild(opt)
    }
    sel.addEventListener('change', () => onChange(sel.value))
    return sel
  }

  private checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    box.addEventListener('change', () => onChange(box.checked))
    return box
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'settings-button'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  // ---- Panel ------------------------------------------------------------------

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

    // ---- DISPLAY ----
    panel.appendChild(this.section('DISPLAY'))
    panel.appendChild(
      this.field(
        'Theme',
        this.select(
          THEMES.map((t) => ({ value: t.id, label: t.name })),
          s.themeId,
          (v) => this.tabs.applyTheme(v)
        )
      )
    )
    panel.appendChild(
      this.field(
        'Color mode',
        this.select(
          [
            { value: 'mono', label: 'Authentic mono' },
            { value: 'hybrid', label: 'Hybrid ANSI colors' }
          ],
          s.colorMode,
          (v) => this.tabs.applyColorMode(v as ColorMode)
        )
      )
    )
    panel.appendChild(
      this.field(
        'CRT effects',
        this.select(
          CRT_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() })),
          s.crtLevel,
          (v) => this.tabs.applyCrt(v as CrtLevel)
        )
      )
    )
    panel.appendChild(
      this.field(
        'Performance renderer (less glow)',
        this.checkbox(s.performanceMode, (v) => this.tabs.applyPerformance(v))
      )
    )

    // Custom themes: list + editor
    for (const ct of this.customThemes) {
      const row = document.createElement('div')
      row.className = 'settings-field'
      const label = document.createElement('label')
      label.textContent = `◈ ${ct.name}`
      const btns = document.createElement('div')
      btns.className = 'settings-inline'
      const edit = this.button('EDIT', () => this.openThemeEditor(panel, { ...ct }, false))
      edit.classList.add('settings-button-inline')
      const del = this.button('✕', () => {
        this.customThemes = this.customThemes.filter((t) => t.id !== ct.id)
        this.persistThemes()
        if (this.tabs.getSettings().themeId === ct.id) this.tabs.applyTheme(THEMES[0].id)
        this.show()
      })
      del.classList.add('settings-button-inline', 'settings-button-danger')
      btns.append(edit, del)
      row.append(label, btns)
      panel.appendChild(row)
    }
    panel.appendChild(
      this.button('+ NEW THEME (copy current)', () => {
        const cur = getTheme(this.tabs.getSettings().themeId)
        const ct = themeToCustom(cur, `theme-${Date.now()}`, `${cur.name} Custom`)
        this.openThemeEditor(panel, ct, true)
      })
    )

    // ---- TEXT ----
    panel.appendChild(this.section('TEXT'))
    this.fontSelect = this.select(
      FONTS.map((f) => ({ value: f.family, label: f.name })),
      s.fontFamily,
      (v) => this.tabs.applyFont(v, this.tabs.getSettings().fontSize)
    )
    panel.appendChild(this.field('Font', this.fontSelect))

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

    const upload = document.createElement('input')
    upload.type = 'file'
    upload.accept = '.ttf,.otf,.woff,.woff2'
    upload.className = 'settings-file'
    upload.addEventListener('change', () => void this.onUpload(upload))
    panel.appendChild(this.field('Upload font', upload))

    panel.appendChild(
      this.field(
        'Cursor style',
        this.select(
          [
            { value: 'block', label: 'Block' },
            { value: 'underline', label: 'Underline' },
            { value: 'bar', label: 'Bar' }
          ],
          s.cursorStyle,
          (v) => this.tabs.applyCursor(v as CursorStyle, this.tabs.getSettings().cursorBlink)
        )
      )
    )
    panel.appendChild(
      this.field(
        'Cursor blink',
        this.checkbox(s.cursorBlink, (v) =>
          this.tabs.applyCursor(this.tabs.getSettings().cursorStyle, v)
        )
      )
    )

    // ---- BEHAVIOR ----
    panel.appendChild(this.section('BEHAVIOR'))
    panel.appendChild(
      this.field(
        'Copy on select',
        this.checkbox(s.copyOnSelect, (v) => this.tabs.applyCopyOnSelect(v))
      )
    )
    panel.appendChild(
      this.field(
        'Warn on multi-line paste',
        this.checkbox(s.pasteGuard, (v) => this.tabs.applyPasteGuard(v))
      )
    )
    panel.appendChild(
      this.field(
        'Restore tabs on launch',
        this.checkbox(s.restoreSession, (v) => this.tabs.updateSetting({ restoreSession: v }))
      )
    )
    panel.appendChild(
      this.field(
        'Open new tabs in current directory',
        this.checkbox(s.openTabsInCwd, (v) => this.tabs.updateSetting({ openTabsInCwd: v }))
      )
    )
    panel.appendChild(
      this.field(
        'Boot sequence on launch',
        this.checkbox(s.bootSequence, (v) => this.tabs.updateSetting({ bootSequence: v }))
      )
    )
    panel.appendChild(
      this.field(
        'Sound effects',
        this.checkbox(s.soundEnabled, (v) =>
          this.tabs.applySound(v, this.tabs.getSettings().soundVolume)
        )
      )
    )
    const volWrap = document.createElement('div')
    volWrap.className = 'settings-inline'
    const vol = document.createElement('input')
    vol.type = 'range'
    vol.min = '0'
    vol.max = '100'
    vol.value = String(Math.round(s.soundVolume * 100))
    const volVal = document.createElement('span')
    volVal.className = 'settings-val'
    volVal.textContent = vol.value
    vol.addEventListener('input', () => {
      volVal.textContent = vol.value
      this.tabs.applySound(this.tabs.getSettings().soundEnabled, Number(vol.value) / 100)
    })
    volWrap.append(vol, volVal)
    panel.appendChild(this.field('Volume', volWrap))

    panel.appendChild(
      this.field(
        'PLEASE STAND BY idle screen',
        this.checkbox(s.idleScreen, (v) => {
          this.tabs.updateSetting({ idleScreen: v })
          configureIdle(v, this.tabs.getSettings().idleMinutes)
        })
      )
    )
    const idleMin = document.createElement('input')
    idleMin.type = 'number'
    idleMin.min = '1'
    idleMin.max = '120'
    idleMin.value = String(s.idleMinutes)
    idleMin.className = 'settings-text settings-num'
    idleMin.addEventListener('change', () => {
      const v = Math.max(1, Math.min(120, Number(idleMin.value) || 10))
      this.tabs.updateSetting({ idleMinutes: v })
      configureIdle(this.tabs.getSettings().idleScreen, v)
    })
    panel.appendChild(this.field('Idle minutes', idleMin))

    // ---- SYSTEM ----
    panel.appendChild(this.section('SYSTEM'))
    panel.appendChild(
      this.field(
        'Global summon hotkey (quake mode)',
        this.checkbox(s.quakeEnabled, (v) => this.tabs.updateSetting({ quakeEnabled: v }))
      )
    )
    const hotkey = document.createElement('input')
    hotkey.type = 'text'
    hotkey.className = 'settings-text'
    hotkey.value = s.quakeHotkey
    hotkey.addEventListener('change', () =>
      this.tabs.updateSetting({ quakeHotkey: hotkey.value.trim() })
    )
    panel.appendChild(this.field('Hotkey', hotkey))
    panel.appendChild(
      this.field(
        'Close to tray (keep running)',
        this.checkbox(s.closeToTray, (v) => this.tabs.updateSetting({ closeToTray: v }))
      )
    )
    panel.appendChild(
      this.field(
        'Start with Windows',
        this.checkbox(s.autoStart, (v) => this.tabs.updateSetting({ autoStart: v }))
      )
    )

    // ---- PROFILES ----
    panel.appendChild(this.section('PROFILES'))
    const defSelect = this.select(
      this.tabs.getProfiles().map((p) => ({ value: p.id, label: p.name })),
      this.tabs.getDefaultProfileId(),
      () => this.saveProfiles(profileRows, defSelect)
    )
    panel.appendChild(this.field('Default shell', defSelect))

    const profileRows = document.createElement('div')
    profileRows.className = 'profile-rows'
    for (const p of this.tabs.getProfiles().filter((p) => p.custom)) {
      profileRows.appendChild(this.profileRow(p, profileRows, defSelect))
    }
    panel.appendChild(profileRows)
    panel.appendChild(
      this.button('+ ADD CUSTOM PROFILE', () => {
        profileRows.appendChild(
          this.profileRow(
            { id: `custom-${Date.now()}`, name: '', shell: '', args: [], custom: true },
            profileRows,
            defSelect
          )
        )
      })
    )

    // ---- WORKSPACES ----
    panel.appendChild(this.section('WORKSPACES'))
    const wsRow = document.createElement('div')
    wsRow.className = 'settings-inline ws-save'
    const wsName = document.createElement('input')
    wsName.type = 'text'
    wsName.placeholder = 'workspace name'
    wsName.className = 'settings-text'
    const wsSave = this.button('SAVE CURRENT TABS', () => {
      const name = wsName.value.trim()
      if (!name) return
      this.workspaces = [
        ...this.workspaces.filter((w) => w.name !== name),
        { name, tabs: this.tabs.snapshot() }
      ]
      window.config.saveWorkspaces(this.workspaces)
      this.show() // re-render list
    })
    wsSave.classList.add('settings-button-inline')
    wsRow.append(wsName, wsSave)
    panel.appendChild(wsRow)

    for (const ws of this.workspaces) {
      const row = document.createElement('div')
      row.className = 'settings-field ws-row'
      const label = document.createElement('label')
      label.textContent = `${ws.name} (${ws.tabs.length} tabs)`
      const btns = document.createElement('div')
      btns.className = 'settings-inline'
      const load = this.button('LOAD', () => {
        this.hide()
        void this.tabs.loadWorkspace(ws)
      })
      load.classList.add('settings-button-inline')
      const del = this.button('✕', () => {
        this.workspaces = this.workspaces.filter((w) => w.name !== ws.name)
        window.config.saveWorkspaces(this.workspaces)
        this.show()
      })
      del.classList.add('settings-button-inline', 'settings-button-danger')
      btns.append(load, del)
      row.append(label, btns)
      panel.appendChild(row)
    }

    // ---- EXTRAS ----
    panel.appendChild(this.section('EXTRAS'))
    panel.appendChild(
      this.button('REPLAY BOOT SEQUENCE', () => {
        this.hide()
        runBootSequence()
      })
    )
    panel.appendChild(
      this.button('ROBCO HACKING MINIGAME  (Ctrl+Shift+H)', () => {
        this.hide()
        launchHack()
      })
    )
    panel.appendChild(this.button('OPEN ERROR LOG', () => window.win.openLog()))
    panel.appendChild(this.button('EXPORT SETTINGS', () => void this.exportSettings()))

    const importInput = document.createElement('input')
    importInput.type = 'file'
    importInput.accept = '.json'
    importInput.style.display = 'none'
    importInput.addEventListener('change', () => void this.importSettings(importInput))
    panel.appendChild(importInput)
    panel.appendChild(this.button('IMPORT SETTINGS', () => importInput.click()))

    this.overlay.appendChild(panel)
  }

  // ---- Custom theme editor --------------------------------------------------------

  private persistThemes(): void {
    window.config.saveCustomThemes(this.customThemes)
    registerCustomThemes(this.customThemes)
  }

  private colorInput(value: string, onChange: (v: string) => void): HTMLInputElement {
    const i = document.createElement('input')
    i.type = 'color'
    i.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#45ff8a'
    i.addEventListener('input', () => onChange(i.value))
    return i
  }

  private openThemeEditor(panel: HTMLElement, ct: CustomTheme, isNew: boolean): void {
    panel.querySelector('.theme-editor')?.remove()
    const ed = document.createElement('div')
    ed.className = 'theme-editor'

    const title = document.createElement('div')
    title.className = 'settings-section'
    title.textContent = isNew ? 'NEW THEME' : `EDIT: ${ct.name.toUpperCase()}`
    ed.appendChild(title)

    const name = document.createElement('input')
    name.type = 'text'
    name.className = 'settings-text'
    name.value = ct.name
    name.addEventListener('input', () => (ct.name = name.value))
    ed.appendChild(this.field('Name', name))

    const colorField = (label: string, get: () => string, set: (v: string) => void): void => {
      ed.appendChild(this.field(label, this.colorInput(get(), set)))
    }
    colorField('Background', () => ct.bg, (v) => (ct.bg = v))
    colorField('Text', () => ct.fg, (v) => (ct.fg = v))
    colorField('UI accent', () => ct.dim, (v) => (ct.dim = v))
    colorField('Glow', () => ct.glowColor, (v) => (ct.glowColor = v))
    colorField('Cursor', () => ct.cursor, (v) => (ct.cursor = v))

    const ansiLabel = document.createElement('div')
    ansiLabel.className = 'settings-section'
    ansiLabel.textContent = 'ANSI COLORS'
    ed.appendChild(ansiLabel)

    const grid = document.createElement('div')
    grid.className = 'ansi-grid'
    ANSI_LABELS.forEach((key, i) => {
      const cell = document.createElement('div')
      cell.className = 'ansi-cell'
      cell.title = key
      cell.appendChild(this.colorInput(ct.ansi[i] ?? ct.fg, (v) => (ct.ansi[i] = v)))
      grid.appendChild(cell)
    })
    ed.appendChild(grid)

    const row = document.createElement('div')
    row.className = 'settings-inline'
    const save = this.button('SAVE & APPLY', () => {
      if (!ct.name.trim()) ct.name = 'Custom Theme'
      this.customThemes = [...this.customThemes.filter((t) => t.id !== ct.id), ct]
      this.persistThemes()
      this.tabs.applyTheme(ct.id)
      this.show()
    })
    save.classList.add('settings-button-inline')
    const cancel = this.button('CANCEL', () => ed.remove())
    cancel.classList.add('settings-button-inline')
    row.append(save, cancel)
    ed.appendChild(row)

    // Insert at the end of the DISPLAY section (just before the TEXT header).
    const sections = panel.querySelectorAll('.settings-section')
    panel.insertBefore(ed, sections[1] ?? null)
  }

  // ---- Profiles editor ----------------------------------------------------------

  private profileRow(
    p: Profile,
    container: HTMLElement,
    defSelect: HTMLSelectElement
  ): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'profile-row'
    row.dataset.id = p.id

    const mkInput = (cls: string, value: string, placeholder: string): HTMLInputElement => {
      const i = document.createElement('input')
      i.type = 'text'
      i.className = `settings-text ${cls}`
      i.value = value
      i.placeholder = placeholder
      i.addEventListener('change', () => this.saveProfiles(container, defSelect))
      return i
    }

    row.appendChild(mkInput('p-name', p.name, 'name'))
    row.appendChild(mkInput('p-shell', p.shell, 'C:\\path\\to\\shell.exe'))
    row.appendChild(mkInput('p-args', p.args.join(' '), 'args'))

    const color = document.createElement('input')
    color.type = 'color'
    color.className = 'p-color'
    color.title = 'Tab accent color'
    color.value = p.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#45ff8a'
    color.addEventListener('change', () => this.saveProfiles(container, defSelect))
    row.appendChild(color)

    const del = this.button('✕', () => {
      row.remove()
      this.saveProfiles(container, defSelect)
    })
    del.classList.add('settings-button-inline', 'settings-button-danger')
    row.appendChild(del)
    return row
  }

  private saveProfiles(container: HTMLElement, defSelect: HTMLSelectElement): void {
    const custom: Profile[] = [...container.querySelectorAll<HTMLDivElement>('.profile-row')]
      .map((row) => ({
        id: row.dataset.id!,
        name: row.querySelector<HTMLInputElement>('.p-name')!.value.trim() || 'Custom',
        shell: row.querySelector<HTMLInputElement>('.p-shell')!.value.trim(),
        args: row
          .querySelector<HTMLInputElement>('.p-args')!
          .value.split(' ')
          .filter(Boolean),
        color: row.querySelector<HTMLInputElement>('.p-color')?.value,
        custom: true as const
      }))
      .filter((p) => p.shell)

    window.config.saveProfiles(custom, defSelect.value)
    const detected = this.tabs.getProfiles().filter((p) => !p.custom)
    this.tabs.setProfiles([...detected, ...custom], defSelect.value)
  }

  // ---- Fonts ----------------------------------------------------------------------

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

    const value = `"${family}", monospace`
    addFontOption(value, `${family} (custom)`)
    this.customFonts.push({ family, dataUrl })
    window.config.saveCustomFonts(this.customFonts)

    this.rebuildFontOptions(value)
    this.tabs.applyFont(value, this.tabs.getSettings().fontSize)
    input.value = ''
  }

  // ---- Import / export ---------------------------------------------------------------

  private async exportSettings(): Promise<void> {
    const cfg = await window.config.load()
    const data = {
      settings: cfg.settings,
      customFonts: cfg.customFonts,
      customThemes: cfg.customThemes,
      customProfiles: cfg.customProfiles,
      defaultProfileId: cfg.defaultProfileId,
      workspaces: cfg.workspaces
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fallout-terminal-settings.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  private async importSettings(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (parsed.settings) window.config.saveSettings(parsed.settings)
      if (parsed.customFonts) window.config.saveCustomFonts(parsed.customFonts)
      if (parsed.customThemes) window.config.saveCustomThemes(parsed.customThemes)
      if (parsed.customProfiles) {
        window.config.saveProfiles(
          parsed.customProfiles,
          parsed.defaultProfileId ?? this.tabs.getDefaultProfileId()
        )
      }
      if (parsed.workspaces) {
        this.workspaces = parsed.workspaces
        window.config.saveWorkspaces(this.workspaces)
      }
      // Reload so every subsystem picks the imported values up cleanly.
      window.term.killAll()
      location.reload()
    } catch {
      /* invalid file: ignore */
    }
    input.value = ''
  }
}
