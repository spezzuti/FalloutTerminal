// Multi-line paste protection: pasting text that contains newlines executes
// commands immediately in a shell, so confirm before sending it.

let guardEnabled = true

export function setPasteGuardEnabled(on: boolean): void {
  guardEnabled = on
}

function needsGuard(text: string): boolean {
  return guardEnabled && /[\r\n]/.test(text)
}

function confirmPaste(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const lines = text.split(/\r\n|\r|\n/)
    const overlay = document.createElement('div')
    overlay.id = 'paste-overlay'

    const panel = document.createElement('div')
    panel.id = 'paste-panel'

    const title = document.createElement('div')
    title.className = 'paste-title'
    title.textContent = `WARNING: PASTING ${lines.length} LINES`
    panel.appendChild(title)

    const note = document.createElement('div')
    note.className = 'paste-note'
    note.textContent = 'Multi-line text runs commands immediately.'
    panel.appendChild(note)

    const preview = document.createElement('pre')
    preview.className = 'paste-preview'
    preview.textContent =
      lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… ${lines.length - 6} more` : '')
    panel.appendChild(preview)

    const row = document.createElement('div')
    row.className = 'paste-buttons'
    const done = (ok: boolean): void => {
      overlay.remove()
      window.removeEventListener('keydown', onKey, true)
      resolve(ok)
    }
    const mkBtn = (label: string, ok: boolean): HTMLButtonElement => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', () => done(ok))
      return b
    }
    row.append(mkBtn('PASTE', true), mkBtn('CANCEL', false))
    panel.appendChild(row)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        done(true)
      }
    }
    window.addEventListener('keydown', onKey, true)

    overlay.appendChild(panel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false)
    })
    document.body.appendChild(overlay)
  })
}

/** Paste via `doPaste`, confirming first when the text contains newlines. */
export async function guardedPaste(text: string, doPaste: (t: string) => void): Promise<void> {
  if (!text) return
  if (!needsGuard(text)) {
    doPaste(text)
    return
  }
  if (await confirmPaste(text)) doPaste(text)
}
