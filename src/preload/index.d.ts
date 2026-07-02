import type { TermApi, WinApi, ClipApi, ConfigApi } from './index'

declare global {
  interface Window {
    term: TermApi
    win: WinApi
    clip: ClipApi
    config: ConfigApi
  }
}

export {}
