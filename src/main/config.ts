import { app } from 'electron'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  mkdirSync,
  copyFileSync,
  renameSync
} from 'fs'
import { join, dirname } from 'path'
import type { Profile, AppConfig } from '../shared/types'

export type {
  Profile,
  SavedTab,
  Workspace,
  AppSettings,
  AppConfig,
  CustomFont,
  CustomTheme
} from '../shared/types'

function fileExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

// ---- Error logging ----------------------------------------------------------
// Main-process failures are otherwise invisible; keep a small rotating log.
// Lives here (rather than in index.ts) so config load/save can log write and
// corruption-recovery failures without an index.ts <-> config.ts import cycle.

export function logPath(): string {
  return join(app.getPath('userData'), 'error.log')
}

export function logError(tag: string, err: unknown): void {
  try {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    try {
      if (statSync(logPath()).size > 512 * 1024) writeFileSync(logPath(), '')
    } catch {
      /* no log yet */
    }
    appendFileSync(logPath(), `[${new Date().toISOString()}] ${tag}: ${detail}\n`)
  } catch {
    /* never let logging crash the app */
  }
}

/**
 * Write `data` to `path` atomically: write to a sibling `.tmp` file, then
 * rename it over the target. A crash/power-loss mid-write leaves either the
 * old file or the new one intact, never a truncated/corrupt one.
 */
export function atomicWriteFileSync(path: string, data: string): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, data, 'utf-8')
  renameSync(tmpPath, path)
}

// Shell integration: make the prompt emit OSC 9;9 (current directory) so the
// terminal can open new tabs in the same folder and restore tabs to theirs.
// The PowerShell hook reproduces the default "PS path>" prompt exactly.
const PS_INTEGRATION =
  "function prompt { $e=[char]27; Write-Host -NoNewline ($e+']9;9;'+$PWD.Path+$e+'\\'); 'PS '+$PWD.Path+'> ' }"
const CMD_INTEGRATION = 'prompt $E]9;9;$P$E\\$P$G'

/** Detect shells present on this machine and build default profiles. */
function detectProfiles(): Profile[] {
  const profiles: Profile[] = []
  const sysRoot = process.env.SystemRoot || 'C:\\Windows'

  // Windows PowerShell (always present on Windows)
  profiles.push({
    id: 'powershell',
    name: 'PowerShell',
    shell: join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoExit', '-Command', PS_INTEGRATION],
    color: '#3b9eff'
  })

  // PowerShell 7+ (pwsh), if installed
  const pwshCandidates = [
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(process.env['ProgramW6432'] || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  ]
  const pwsh = pwshCandidates.find(fileExists)
  if (pwsh) {
    profiles.push({
      id: 'pwsh',
      name: 'PowerShell 7',
      shell: pwsh,
      args: ['-NoLogo', '-NoExit', '-Command', PS_INTEGRATION],
      color: '#2bd9d9'
    })
  }

  // Command Prompt (always present)
  profiles.push({
    id: 'cmd',
    name: 'Command Prompt',
    shell: join(sysRoot, 'System32', 'cmd.exe'),
    args: ['/k', CMD_INTEGRATION],
    color: '#ffd23b'
  })

  // Git Bash, if installed
  const gitBashCandidates = [
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramW6432'] || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  ]
  const gitBash = gitBashCandidates.find(fileExists)
  if (gitBash) {
    profiles.push({
      id: 'git-bash',
      name: 'Git Bash',
      shell: gitBash,
      args: ['--login', '-i'],
      color: '#ff7a45'
    })
  }

  // WSL, if present
  const wsl = join(sysRoot, 'System32', 'wsl.exe')
  if (fileExists(wsl)) {
    profiles.push({ id: 'wsl', name: 'WSL', shell: wsl, args: [], color: '#c17bff' })
  }

  return profiles
}

function defaultConfig(): AppConfig {
  const profiles = detectProfiles()
  return {
    version: 1,
    profiles,
    defaultProfileId: profiles[0]?.id ?? 'powershell',
    customProfiles: [],
    session: { tabs: [] },
    workspaces: [],
    settings: {
      themeId: 'pipboy',
      colorMode: 'mono',
      fontFamily: '"Monofonto", monospace',
      fontSize: 16,
      cursorStyle: 'block',
      cursorBlink: true,
      restoreSession: true,
      crtLevel: 'medium',
      bootSequence: true,
      copyOnSelect: false,
      pasteGuard: true,
      soundEnabled: true,
      soundVolume: 0.4,
      performanceMode: false,
      quakeEnabled: true,
      quakeHotkey: 'CommandOrControl+Shift+`',
      closeToTray: false,
      autoStart: false,
      idleScreen: true,
      idleMinutes: 10,
      openTabsInCwd: true
    },
    customFonts: [],
    customThemes: []
  }
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

let cache: AppConfig | null = null

/** Parse a config file at `path` and merge it over the defaults. Throws on
 *  missing/corrupt/unparseable files; used for both config.json and .bak. */
function parseConfigFile(path: string): AppConfig {
  // Strip a UTF-8 BOM if present (some editors/tools add one), which would
  // otherwise make JSON.parse throw and wipe the user's config.
  let raw = readFileSync(path, 'utf-8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const parsed = JSON.parse(raw) as Partial<AppConfig>
  // Merge with defaults so new fields are filled in on upgrade, and always
  // refresh detected profiles so newly installed shells appear.
  const base = defaultConfig()
  const customProfiles = (parsed.customProfiles || []).map((p) => ({ ...p, custom: true }))
  const profiles = [...base.profiles, ...customProfiles]
  const defaultProfileId = profiles.some((p) => p.id === parsed.defaultProfileId)
    ? parsed.defaultProfileId!
    : base.defaultProfileId
  return {
    ...base,
    ...parsed,
    profiles,
    customProfiles,
    defaultProfileId,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    session: parsed.session || base.session,
    workspaces: parsed.workspaces || base.workspaces,
    customFonts: parsed.customFonts || base.customFonts,
    customThemes: parsed.customThemes || base.customThemes
  }
}

export function loadConfig(): AppConfig {
  if (cache) return cache
  const path = configPath()
  if (fileExists(path)) {
    try {
      cache = parseConfigFile(path)
      return cache
    } catch (e) {
      logError('config load', e)
      // Primary file is corrupt/unreadable: try the last-known-good backup
      // before ever falling back to defaults, so a crash mid-write doesn't
      // wipe profiles, themes, workspaces, or the saved session.
      const bakPath = `${path}.bak`
      if (fileExists(bakPath)) {
        try {
          cache = parseConfigFile(bakPath)
          logError('config load', new Error(`recovered from ${bakPath} after corrupt config.json`))
          // Move the corrupt primary aside and rewrite it from the recovered
          // backup right away — otherwise the next saveConfig() would copy the
          // corrupt file over this backup before writing.
          try {
            renameSync(path, `${path}.corrupt`)
          } catch {
            /* best-effort */
          }
          saveConfig(cache)
          return cache
        } catch (e2) {
          logError('config backup load', e2)
        }
      }
      // Both primary and backup are unusable: preserve the corrupt file
      // (instead of silently overwriting it) before falling back to defaults.
      try {
        renameSync(path, `${path}.corrupt`)
        logError('config corrupt', new Error(`preserved unreadable config as ${path}.corrupt`))
      } catch (e3) {
        logError('config preserve corrupt', e3)
      }
    }
  }
  cache = defaultConfig()
  saveConfig(cache)
  return cache
}

export function saveConfig(config: AppConfig): void {
  cache = config
  const path = configPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const json = JSON.stringify(config, null, 2)
    // Keep exactly one backup of the last-known-good config before
    // overwriting it, so loadConfig() can recover from a corrupt write.
    if (fileExists(path)) {
      try {
        copyFileSync(path, `${path}.bak`)
      } catch (e) {
        logError('config backup', e)
      }
    }
    atomicWriteFileSync(path, json)
  } catch (e) {
    logError('config save', e)
  }
}

export function getProfile(id: string): Profile | undefined {
  return loadConfig().profiles.find((p) => p.id === id)
}
