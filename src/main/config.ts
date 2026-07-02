import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Profile, AppConfig } from '../shared/types'

export type {
  Profile,
  SavedTab,
  Workspace,
  AppSettings,
  AppConfig,
  CustomFont
} from '../shared/types'

function fileExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

/** Detect shells present on this machine and build default profiles. */
function detectProfiles(): Profile[] {
  const profiles: Profile[] = []
  const sysRoot = process.env.SystemRoot || 'C:\\Windows'

  // Windows PowerShell (always present on Windows)
  profiles.push({
    id: 'powershell',
    name: 'PowerShell',
    shell: join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: []
  })

  // PowerShell 7+ (pwsh), if installed
  const pwshCandidates = [
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(process.env['ProgramW6432'] || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  ]
  const pwsh = pwshCandidates.find(fileExists)
  if (pwsh) {
    profiles.push({ id: 'pwsh', name: 'PowerShell 7', shell: pwsh, args: [] })
  }

  // Command Prompt (always present)
  profiles.push({
    id: 'cmd',
    name: 'Command Prompt',
    shell: join(sysRoot, 'System32', 'cmd.exe'),
    args: []
  })

  // Git Bash, if installed
  const gitBashCandidates = [
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramW6432'] || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  ]
  const gitBash = gitBashCandidates.find(fileExists)
  if (gitBash) {
    profiles.push({ id: 'git-bash', name: 'Git Bash', shell: gitBash, args: ['--login', '-i'] })
  }

  // WSL, if present
  const wsl = join(sysRoot, 'System32', 'wsl.exe')
  if (fileExists(wsl)) {
    profiles.push({ id: 'wsl', name: 'WSL', shell: wsl, args: [] })
  }

  return profiles
}

function defaultConfig(): AppConfig {
  const profiles = detectProfiles()
  return {
    version: 1,
    profiles,
    defaultProfileId: profiles[0]?.id ?? 'powershell',
    session: { tabs: [] },
    workspaces: [],
    settings: {
      themeId: 'pipboy',
      fontFamily: '"Monofonto", monospace',
      fontSize: 16,
      restoreSession: true,
      crtLevel: 'medium',
      bootSequence: true
    },
    customFonts: []
  }
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

let cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cache) return cache
  const path = configPath()
  if (fileExists(path)) {
    try {
      // Strip a UTF-8 BOM if present (some editors/tools add one), which would
      // otherwise make JSON.parse throw and wipe the user's config.
      let raw = readFileSync(path, 'utf-8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      // Merge with defaults so new fields are filled in on upgrade, and always
      // refresh detected profiles so newly installed shells appear.
      const base = defaultConfig()
      cache = {
        ...base,
        ...parsed,
        profiles: base.profiles,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        session: parsed.session || base.session,
        workspaces: parsed.workspaces || base.workspaces,
        customFonts: parsed.customFonts || base.customFonts
      }
      return cache
    } catch {
      /* corrupt file: fall through to defaults */
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
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    /* best-effort persistence */
  }
}

export function getProfile(id: string): Profile | undefined {
  return loadConfig().profiles.find((p) => p.id === id)
}
