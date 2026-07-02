import './idle.css'

// "PLEASE STAND BY" idle screen: fades in after a period with no user input
// and no terminal output; any key or click dismisses it.

let enabled = false
let minutes = 10
let last = Date.now()
let overlay: HTMLDivElement | null = null

export function noteActivity(): void {
  last = Date.now()
  if (overlay) dismiss()
}

export function configureIdle(on: boolean, mins: number): void {
  enabled = on
  minutes = Math.max(1, mins || 10)
  last = Date.now()
  if (!on && overlay) dismiss()
}

function dismiss(): void {
  overlay?.remove()
  overlay = null
  last = Date.now()
}

function show(): void {
  if (overlay) return
  overlay = document.createElement('div')
  overlay.id = 'idle-overlay'

  const plate = document.createElement('div')
  plate.className = 'idle-plate'
  const ring = document.createElement('div')
  ring.className = 'idle-ring'
  const text = document.createElement('div')
  text.className = 'idle-text'
  text.textContent = 'PLEASE\nSTAND BY'
  ring.appendChild(text)
  plate.appendChild(ring)
  overlay.appendChild(plate)

  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    window.removeEventListener('keydown', onKey, true)
    dismiss()
  }
  window.addEventListener('keydown', onKey, true)
  overlay.addEventListener('mousedown', dismiss)

  document.body.appendChild(overlay)
}

// Global activity sources (throttled mousemove).
let lastMove = 0
window.addEventListener('keydown', () => noteActivity(), true)
window.addEventListener('mousedown', () => noteActivity(), true)
window.addEventListener(
  'mousemove',
  () => {
    const now = Date.now()
    if (now - lastMove > 1000) {
      lastMove = now
      noteActivity()
    }
  },
  true
)

window.setInterval(() => {
  if (enabled && !overlay && Date.now() - last > minutes * 60_000) show()
}, 15_000)
