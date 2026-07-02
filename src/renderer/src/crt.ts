import './crt.css'
import type { CrtLevel } from '../../shared/types'

const LEVEL_CLASSES = ['crt-off', 'crt-low', 'crt-medium', 'crt-high']
export const CRT_LEVELS: CrtLevel[] = ['off', 'low', 'medium', 'high']

/** Create the (non-interactive) CRT overlay layers inside the terminal area. */
export function initCrtOverlays(container: HTMLElement): void {
  for (const cls of ['crt-scanlines', 'crt-bloom', 'crt-vignette', 'crt-flicker', 'crt-burn']) {
    const el = document.createElement('div')
    el.className = `crt-overlay ${cls}`
    container.appendChild(el)
  }
}

export function setCrtLevel(level: CrtLevel): void {
  const app = document.getElementById('app')
  if (!app) return
  LEVEL_CLASSES.forEach((c) => app.classList.remove(c))
  app.classList.add(`crt-${level}`)
}

// Big ROBCO banner (figlet "Standard"). String.raw keeps backslashes literal.
// Each letter is a fixed 7-column glyph so columns line up cleanly.
const ROBCO_ART = String.raw`
 ____    ___   ____    ____   ___
|  _ \  / _ \ | __ )  / ___| / _ \
| |_) || | | ||  _ \ | |    | | | |
|  _ < | |_| || |_) || |___ | |_| |
|_| \_\ \___/ |____/  \____| \___/
`

/** Play the RobCo-style power-on boot animation, then reveal the terminal. */
export function runBootSequence(): void {
  const lines = [
    'ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL',
    'ESTABLISHING UPLINK ............ OK',
    'INITIALIZING BOOT LOADER v3.11',
    'LOADING PIP-OS (R) ....',
    'CHECKING MEMORY .... 64K RAM SYSTEM',
    '38911 BYTES FREE',
    '',
    'WELCOME OVERSEER'
  ]

  const boot = document.createElement('div')
  boot.id = 'boot'

  // The ASCII banner appears first, glowing.
  const art = document.createElement('div')
  art.className = 'boot-art'
  art.textContent = ROBCO_ART
  boot.appendChild(art)

  // Then the status lines type in, one at a time, slowly.
  const artRevealSec = 1.1
  const lineStep = 0.32
  lines.forEach((text, i) => {
    const line = document.createElement('div')
    line.className = 'boot-line'
    line.textContent = text || ' '
    line.style.animationDelay = `${artRevealSec + i * lineStep}s`
    boot.appendChild(line)
  })

  const hint = document.createElement('div')
  hint.className = 'boot-hint'
  hint.textContent = 'PRESS ANY KEY TO SKIP'
  boot.appendChild(hint)

  document.body.appendChild(boot)

  let finished = false
  const timers: number[] = []
  const finish = (): void => {
    if (finished) return
    finished = true
    timers.forEach((t) => window.clearTimeout(t))
    window.removeEventListener('keydown', onKey, true)
    boot.classList.add('done')
    window.setTimeout(() => boot.remove(), 700)
  }
  // Skip on any key or click; swallow the key so it doesn't reach the shell.
  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    finish()
  }
  window.addEventListener('keydown', onKey, true)
  boot.addEventListener('click', finish)

  const linesDoneMs = (artRevealSec + lines.length * lineStep + 0.7) * 1000
  timers.push(window.setTimeout(finish, linesDoneMs))
}
