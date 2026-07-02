import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { homedir } from 'os'
import type { SpawnOptions, SpawnResult } from '../shared/types'

interface PtySession {
  proc: pty.IPty
  windowId: number
}

const sessions = new Map<string, PtySession>()

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
    sessions.set(opts.id, { proc, windowId })

    // Stream shell output back to the renderer, tagged with the session id.
    proc.onData((data) => {
      const win = BrowserWindow.fromId(windowId)
      if (win && !win.isDestroyed()) {
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
