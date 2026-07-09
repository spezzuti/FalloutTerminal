import './hack.css'
import { keyClick } from './sound'

// The RobCo terminal hacking minigame, faithful to the Fallout rules:
// pick the password from words embedded in a memory dump; wrong guesses show
// a likeness count (matching letters in matching positions); clicking matched
// bracket pairs removes a dud or resets attempts; 4 attempts before lockout.

const WORD_POOL = [
  'HUNTERS', 'FACTION', 'SILENCE', 'CAPTIVE', 'WARFARE', 'FORTUNE', 'PRIVATE',
  'MUTANTS', 'SCIENCE', 'SOCIETY', 'VILLAGE', 'JOURNEY', 'WELFARE', 'FIGHTER',
  'HISTORY', 'DEFENSE', 'LIBERTY', 'QUALITY', 'MACHINE', 'NUCLEAR', 'OUTPOST',
  'PATRIOT', 'RANGERS', 'SALVAGE', 'SHELTER', 'STATION', 'SURVIVE', 'TRADERS',
  'VICTORY', 'CRUSADE', 'BEACONS', 'CENTURY', 'COUNCIL', 'CULTURE', 'EMBASSY',
  'FREEDOM', 'GENERAL', 'HOSTILE', 'HOSTAGE', 'JUSTICE', 'LEADERS', 'MASTERY',
  'NETWORK', 'OFFENSE', 'PIONEER', 'RECRUIT'
]

const JUNK = '!@#$%^&*()_-+=\\|;:\'",<>./?'
const BRACKETS: Array<[string, string]> = [
  ['<', '>'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}']
]

const ROWS = 34 // 2 panes x 17 rows
const ROW_LEN = 12
const WORD_COUNT = 12
const WORD_LEN = 7

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function likeness(a: string, b: string): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++
  return n
}

// Stakes: win streak shown in the title bar; losing locks the GAME for 60s.
const KEY_STREAK = 'hackStreak'
const KEY_LOCK = 'hackLockUntil'

export function updateStreakBadge(): void {
  const el = document.getElementById('hack-streak')
  if (!el) return
  const n = Number(localStorage.getItem(KEY_STREAK) || 0)
  el.textContent = n > 0 ? `☢×${n}` : ''
  el.title = n > 0 ? `Hacking win streak: ${n}` : ''
}

function recordWin(): void {
  localStorage.setItem(KEY_STREAK, String(Number(localStorage.getItem(KEY_STREAK) || 0) + 1))
  updateStreakBadge()
}

function recordLoss(): void {
  localStorage.setItem(KEY_STREAK, '0')
  localStorage.setItem(KEY_LOCK, String(Date.now() + 60_000))
  updateStreakBadge()
}

export function launchHack(): void {
  if (document.getElementById('hack')) return
  const lockUntil = Number(localStorage.getItem(KEY_LOCK) || 0)
  if (Date.now() < lockUntil) {
    const secs = Math.ceil((lockUntil - Date.now()) / 1000)
    const toast = document.createElement('div')
    toast.className = 'hack-toast'
    toast.textContent = `TERMINAL LOCKED — RETRY IN ${secs}s`
    document.body.appendChild(toast)
    window.setTimeout(() => toast.remove(), 2200)
    return
  }
  new HackGame()
}

class HackGame {
  private readonly root: HTMLDivElement
  private readonly logEl: HTMLDivElement
  private readonly attemptsEl: HTMLDivElement
  private attempts = 4
  private readonly password: string
  private readonly words: string[]
  private duds: string[] = []
  private locked = false
  private closed = false

  constructor() {
    this.words = shuffled(WORD_POOL).slice(0, WORD_COUNT)
    this.password = this.words[Math.floor(Math.random() * this.words.length)]
    this.duds = this.words.filter((w) => w !== this.password)

    this.root = document.createElement('div')
    this.root.id = 'hack'

    const header = document.createElement('div')
    header.className = 'hack-header'
    header.textContent =
      'ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL\nENTER PASSWORD NOW'
    this.root.appendChild(header)

    this.attemptsEl = document.createElement('div')
    this.attemptsEl.className = 'hack-attempts'
    this.root.appendChild(this.attemptsEl)
    this.renderAttempts()

    const body = document.createElement('div')
    body.className = 'hack-body'

    // Memory-dump rows with embedded words and bracket pairs.
    const wordRows = shuffled(Array.from({ length: ROWS }, (_v, i) => i)).slice(0, WORD_COUNT)
    const rowMap = new Map<number, string>()
    wordRows.forEach((r, i) => rowMap.set(r, this.words[i]))

    const panes: HTMLDivElement[] = [document.createElement('div'), document.createElement('div')]
    panes.forEach((p) => (p.className = 'hack-pane'))

    let addr = 0xf964 + Math.floor(Math.random() * 0x400)
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement('div')
      row.className = 'hack-row'

      const addrEl = document.createElement('span')
      addrEl.className = 'hack-addr'
      addrEl.textContent = `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`
      addr += ROW_LEN
      row.appendChild(addrEl)

      const content = document.createElement('span')
      content.className = 'hack-line'
      const word = rowMap.get(r)
      if (word) {
        const off = Math.floor(Math.random() * (ROW_LEN - WORD_LEN + 1))
        content.appendChild(this.junkSpan(off))
        const w = document.createElement('span')
        w.className = 'hack-word'
        w.textContent = word
        w.addEventListener('click', () => this.guess(word, w))
        content.appendChild(w)
        content.appendChild(this.junkSpan(ROW_LEN - off - WORD_LEN))
      } else if (Math.random() < 0.18) {
        // A clickable matched bracket pair hidden in the junk.
        const [open, close] = BRACKETS[Math.floor(Math.random() * BRACKETS.length)]
        const inner = 1 + Math.floor(Math.random() * 4)
        const pre = Math.floor(Math.random() * (ROW_LEN - inner - 2))
        content.appendChild(this.junkSpan(pre))
        const b = document.createElement('span')
        b.className = 'hack-bracket'
        b.textContent = open + this.junkText(inner) + close
        b.addEventListener('click', () => this.useBracket(b))
        content.appendChild(b)
        content.appendChild(this.junkSpan(ROW_LEN - pre - inner - 2))
      } else {
        content.appendChild(this.junkSpan(ROW_LEN))
      }
      row.appendChild(content)
      panes[r < ROWS / 2 ? 0 : 1].appendChild(row)
    }

    body.append(panes[0], panes[1])

    this.logEl = document.createElement('div')
    this.logEl.className = 'hack-log'
    body.appendChild(this.logEl)
    this.root.appendChild(body)

    const hint = document.createElement('div')
    hint.className = 'hack-hint'
    hint.textContent = 'CLICK A WORD TO GUESS · BRACKET PAIRS HELP · ESC TO EXIT'
    this.root.appendChild(hint)

    document.body.appendChild(this.root)
    this.log('TERMLINK ACTIVE')

    window.addEventListener('keydown', this.onKey, true)
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
    }
  }

  private junkText(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += JUNK[Math.floor(Math.random() * JUNK.length)]
    return s
  }

  private junkSpan(n: number): HTMLSpanElement {
    const s = document.createElement('span')
    s.textContent = this.junkText(n)
    return s
  }

  private renderAttempts(): void {
    this.attemptsEl.textContent =
      `${this.attempts} ATTEMPT(S) LEFT: ` + '█ '.repeat(this.attempts).trim()
  }

  private log(msg: string): void {
    const line = document.createElement('div')
    line.textContent = `>${msg}`
    this.logEl.appendChild(line)
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  private guess(word: string, el: HTMLElement): void {
    if (this.locked || el.classList.contains('dud')) return
    keyClick()
    this.log(word)
    if (word === this.password) {
      this.log('EXACT MATCH!')
      this.log('PLEASE WAIT')
      this.log('WHILE SYSTEM')
      this.log('IS ACCESSED.')
      this.win()
      return
    }
    this.log(`ENTRY DENIED`)
    this.log(`${likeness(word, this.password)}/${WORD_LEN} CORRECT.`)
    el.classList.add('dud')
    this.attempts--
    this.renderAttempts()
    if (this.attempts <= 0) this.lockout()
  }

  private useBracket(el: HTMLElement): void {
    if (this.locked || el.classList.contains('used')) return
    keyClick()
    el.classList.add('used')
    const restorable = this.attempts < 4
    if (restorable && Math.random() < 0.3) {
      this.attempts = 4
      this.renderAttempts()
      this.log('ALLOWANCE')
      this.log('REPLENISHED.')
      return
    }
    // Remove a dud from the board.
    const dudWords = this.duds.filter((w) =>
      [...this.root.querySelectorAll<HTMLElement>('.hack-word')].some(
        (e) => e.textContent === w && !e.classList.contains('dud')
      )
    )
    const target = dudWords[Math.floor(Math.random() * dudWords.length)]
    if (target) {
      for (const e of this.root.querySelectorAll<HTMLElement>('.hack-word')) {
        if (e.textContent === target) {
          e.classList.add('dud')
          e.textContent = '.'.repeat(WORD_LEN)
        }
      }
      this.log('DUD REMOVED.')
    }
  }

  private win(): void {
    this.locked = true
    recordWin()
    window.setTimeout(() => {
      if (this.closed) return
      this.root.classList.add('hack-granted')
      const msg = document.createElement('div')
      msg.className = 'hack-banner'
      msg.textContent = 'ACCESS GRANTED — WELCOME, OVERSEER'
      this.root.appendChild(msg)
      window.setTimeout(() => this.close(), 2200)
    }, 700)
  }

  private lockout(): void {
    this.locked = true
    recordLoss()
    this.root.classList.add('hack-locked')
    const msg = document.createElement('div')
    msg.className = 'hack-banner hack-banner-bad'
    msg.textContent = 'TERMINAL LOCKED — PLEASE CONTACT AN ADMINISTRATOR'
    this.root.appendChild(msg)
    window.setTimeout(() => this.close(), 2600)
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    window.removeEventListener('keydown', this.onKey, true)
    this.root.remove()
  }
}
