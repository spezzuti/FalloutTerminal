import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { homedir } from 'os'
import type { SpawnOptions, SpawnResult } from '../shared/types'

interface PtySession {
  proc: pty.IPty
  windowId: number
  /** Bytes sent to the renderer but not yet acknowledged as rendered. */
  unacked: number
  paused: boolean
}

const sessions = new Map<string, PtySession>()

// Flow control: pause the shell when the renderer falls too far behind
// (e.g. an accidental `cat` of a huge file), resume when it catches up.
const FLOW_HIGH = 300_000
const FLOW_LOW = 60_000

/** Pick a sensible default shell for the platform. */
function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: [] }
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] }
}

export function registerPtyHandlers(ipcMain: IpcMain): void {
  // Create a new shell session.
  ipcMain.handle('pty:spawn', (event: IpcMainInvokeEvent, opts: SpawnOptions): SpawnResult => {
    const def = defaultShell()
    const file = opts.shell || def.file
    const args = opts.args ?? def.args

    let proc: pty.IPty
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        cwd: opts.cwd || homedir(),
        env: { ...process.env, ...(opts.env || {}) } as Record<string, string>
      })
    } catch (e) {
      // Shell missing or failed to start; report instead of crashing the call.
      return { error: e instanceof Error ? e.message : String(e) }
    }

    const windowId = BrowserWindow.fromWebContents(event.sender)?.id ?? -1
    const session: PtySession = { proc, windowId, unacked: 0, paused: false }
    sessions.set(opts.id, session)

    // Stream shell output back to the renderer, tagged with the session id.
    proc.onData((data) => {
      const win = BrowserWindow.fromId(windowId)
      if (win && !win.isDestroyed()) {
        session.unacked += data.length
        if (!session.paused && session.unacked > FLOW_HIGH) {
          try {
            proc.pause()
            session.paused = true
          } catch {
            /* process may have exited */
          }
        }
        win.webContents.send('pty:data', opts.id, data)
      }
    })

    proc.onExit(({ exitCode }) => {
      const win = BrowserWindow.fromId(windowId)
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty:exit', opts.id, exitCode)
      }
      sessions.delete(opts.id)
    })

    return { pid: proc.pid, shell: file }
  })

  // Keystrokes / pasted text from the renderer into the shell.
  ipcMain.on('pty:input', (_e: IpcMainEvent, id: string, data: string) => {
    sessions.get(id)?.proc.write(data)
  })

  // Renderer acknowledges rendered output; resume a paused shell when caught up.
  ipcMain.on('pty:ack', (_e: IpcMainEvent, id: string, length: number) => {
    const s = sessions.get(id)
    if (!s) return
    s.unacked = Math.max(0, s.unacked - length)
    if (s.paused && s.unacked < FLOW_LOW) {
      try {
        s.proc.resume()
        s.paused = false
      } catch {
        /* process may have exited */
      }
    }
  })

  // Kill every session (used before a renderer reload to avoid orphans).
  ipcMain.on('pty:kill-all', () => {
    disposeAllPtys()
  })

  // Terminal was resized in the UI; tell the shell.
  ipcMain.on('pty:resize', (_e: IpcMainEvent, id: string, cols: number, rows: number) => {
    const s = sessions.get(id)
    if (s && cols > 0 && rows > 0) {
      try {
        s.proc.resize(cols, rows)
      } catch {
        /* resize can throw if the process just exited; safe to ignore */
      }
    }
  })

  // Explicitly kill a session (e.g. tab closed).
  ipcMain.on('pty:kill', (_e: IpcMainEvent, id: string) => {
    const s = sessions.get(id)
    if (s) {
      try {
        s.proc.kill()
      } catch {
        /* already gone */
      }
      sessions.delete(id)
    }
  })
}

export function disposeAllPtys(): void {
  for (const { proc } of sessions.values()) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }
  sessions.clear()
}
