import './palette.css'
import { THEMES, FONTS } from './theme'
import { CRT_LEVELS, runBootSequence } from './crt'
import { launchHack } from './hack'
import { standBy } from './idle'
import type { TabManager } from './tabs'
import type { CrtLevel } from '../../shared/types'

interface Action {
  label: string
  run: () => void
}

interface PaletteCtx {
  tabs: TabManager
  openSettings: () => void
}

/** Ctrl+Shift+P command palette: every action, fuzzy-filterable. */
export function initPalette(ctx: PaletteCtx): void {
  document.addEventListener('app:palette', () => void open(ctx))
}

async function buildActions(ctx: PaletteCtx): Promise<Action[]> {
  const { tabs } = ctx
  const actions: Action[] = []

  for (const p of tabs.getProfiles()) {
    actions.push({ label: `New tab: ${p.name}`, run: () => void tabs.newTab(p.id) })
  }
  actions.push(
    {
      label: 'Duplicate tab',
      run: () => {
        const s = tabs.active()
        if (s) void tabs.newTab(s.profile.id, s.cwd)
      }
    },
    { label: 'Close pane / tab', run: () => tabs.closeFocusedPane() },
    { label: 'Rename tab', run: () => tabs.renameActiveTab() },
    { label: 'Next tab', run: () => tabs.cycleTab(1) },
    { label: 'Previous tab', run: () => tabs.cycleTab(-1) },
    { label: 'Split right', run: () => void tabs.splitActive('row') },
    { label: 'Split down', run: () => void tabs.splitActive('column') }
  )

  for (const t of THEMES) {
    actions.push({ label: `Theme: ${t.name}`, run: () => tabs.applyTheme(t.id) })
  }
  actions.push(
    { label: 'Color mode: Authentic mono', run: () => tabs.applyColorMode('mono') },
    { label: 'Color mode: Hybrid ANSI', run: () => tabs.applyColorMode('hybrid') }
  )
  for (const lvl of CRT_LEVELS) {
    actions.push({
      label: `CRT effects: ${lvl.toUpperCase()}`,
      run: () => tabs.applyCrt(lvl as CrtLevel)
    })
  }
  for (const f of FONTS) {
    actions.push({
      label: `Font: ${f.name}`,
      run: () => tabs.applyFont(f.family, tabs.getSettings().fontSize)
    })
  }
  actions.push({
    label: 'Font size: reset',
    run: () => tabs.applyFont(tabs.getSettings().fontFamily, 16)
  })

  const cfg = await window.config.load()
  for (const ws of cfg.workspaces) {
    actions.push({
      label: `Load workspace: ${ws.name}`,
      run: () => void tabs.loadWorkspace(ws)
    })
  }

  actions.push(
    {
      label: `Sound: ${tabs.getSettings().soundEnabled ? 'off' : 'on'}`,
      run: () =>
        tabs.applySound(!tabs.getSettings().soundEnabled, tabs.getSettings().soundVolume)
    },
    { label: 'Replay boot sequence', run: () => runBootSequence() },
    { label: 'RobCo hacking minigame', run: () => launchHack() },
    { label: 'PLEASE STAND BY', run: () => standBy() },
    { label: 'Open settings', run: ctx.openSettings },
    { label: 'Open error log', run: () => window.win.openLog() }
  )

  return actions
}

async function open(ctx: PaletteCtx): Promise<void> {
  if (document.getElementById('palette-overlay')) return
  const actions = await buildActions(ctx)

  const overlay = document.createElement('div')
  overlay.id = 'palette-overlay'
  const box = document.createElement('div')
  box.id = 'palette'
  const input = document.createElement('input')
  input.id = 'palette-input'
  input.placeholder = 'TYPE A COMMAND...'
  input.spellcheck = false
  const list = document.createElement('div')
  list.id = 'palette-list'
  box.append(input, list)
  overlay.appendChild(box)

  let filtered: Action[] = actions
  let selected = 0

  const close = (): void => {
    overlay.remove()
    ctx.tabs.active()?.term.focus()
  }

  const render = (): void => {
    list.replaceChildren()
    filtered.slice(0, 12).forEach((a, i) => {
      const row = document.createElement('div')
      row.className = 'palette-item' + (i === selected ? ' selected' : '')
      row.textContent = a.label
      row.addEventListener('click', () => {
        close()
        a.run()
      })
      row.addEventListener('mousemove', () => {
        if (selected !== i) {
          selected = i
          render()
        }
      })
      list.appendChild(row)
    })
  }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    filtered = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions
    selected = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selected = Math.min(selected + 1, Math.min(filtered.length, 12) - 1)
      render()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selected = Math.max(selected - 1, 0)
      render()
    } else if (e.key === 'Enter') {
      const a = filtered[selected]
      close()
      a?.run()
    } else if (e.key === 'Escape') {
      close()
    }
  })
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })

  document.body.appendChild(overlay)
  render()
  input.focus()
}
