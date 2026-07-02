import type { TermApi, WinApi, ClipApi, ConfigApi, NativeApi } from './index'

declare global {
  interface Window {
    term: TermApi
    win: WinApi
    clip: ClipApi
    config: ConfigApi
    native: NativeApi
  }
}

export {}
