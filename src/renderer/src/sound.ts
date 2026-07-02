// CRT sound design, fully synthesized with Web Audio (no audio assets).
// - a low mains hum while the app runs
// - a soft mechanical click per keystroke
// - a power-on sweep for the boot sequence
// - a collapsing blip for the power-off animation

let ctx: AudioContext | null = null
let master: GainNode | null = null
let humGain: GainNode | null = null
let enabled = false
let volume = 0.4
let lastClick = 0

function ensureContext(): void {
  if (ctx) return
  ctx = new AudioContext()
  master = ctx.createGain()
  master.gain.value = volume
  master.connect(ctx.destination)
}

/** Browsers may suspend audio until a user gesture; resume lazily. */
function resumeIfNeeded(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume()
}

function startHum(): void {
  if (!ctx || !master || humGain) return
  humGain = ctx.createGain()
  humGain.gain.value = 0.012
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 120
  const osc2 = ctx.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.value = 59.7
  const g2 = ctx.createGain()
  g2.gain.value = 0.5
  osc.connect(humGain)
  osc2.connect(g2)
  g2.connect(humGain)
  humGain.connect(master)
  osc.start()
  osc2.start()
}

function stopHum(): void {
  humGain?.disconnect()
  humGain = null
}

export function configureSound(on: boolean, vol: number): void {
  enabled = on
  volume = Math.min(1, Math.max(0, vol))
  if (on) {
    ensureContext()
    master!.gain.value = volume
    resumeIfNeeded()
    startHum()
  } else {
    stopHum()
  }
}

/** Short filtered-noise click; throttled so key repeat doesn't machine-gun. */
export function keyClick(): void {
  if (!enabled || !ctx || !master) return
  const now = performance.now()
  if (now - lastClick < 28) return
  lastClick = now
  resumeIfNeeded()

  const buf = ctx.createBuffer(1, 400, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 70)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1900
  bp.Q.value = 1.1
  const g = ctx.createGain()
  g.gain.value = 0.22
  src.connect(bp)
  bp.connect(g)
  g.connect(master)
  src.start()
}

/** Rising power-on sweep for the boot sequence. */
export function bootSound(): void {
  if (!enabled || !ctx || !master) return
  resumeIfNeeded()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(90, t)
  osc.frequency.exponentialRampToValueAtTime(750, t + 0.8)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.15)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  osc.connect(g)
  g.connect(master)
  osc.start(t)
  osc.stop(t + 1)
}

/** Falling blip matching the CRT power-off collapse. */
export function powerOffSound(): void {
  if (!enabled || !ctx || !master) return
  resumeIfNeeded()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(420, t)
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.32)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.09, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38)
  osc.connect(g)
  g.connect(master)
  osc.start(t)
  osc.stop(t + 0.4)
}
