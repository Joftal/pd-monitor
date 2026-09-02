/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

import type {
  AccountState, Anchor, DiscoveryItem, PlayInfo, RecHistoryItem, RecTask, Settings, Toast, WatcherStatus
} from '@shared/types'

declare global {
  interface Window {
    api: {
      authState(): Promise<AccountState>
      authLoginPassword(id: string, pw: string): Promise<{ ok: boolean; message: string }>
      authOpenWindow(): Promise<{ ok: boolean; message: string }>
      authImportCookies(cookieStr: string): Promise<{ ok: boolean; message: string }>
      authLogout(): Promise<boolean>
      anchorsList(): Promise<Anchor[]>
      anchorsAdd(input: string): Promise<Anchor>
      anchorsRemove(userId: string): Promise<boolean>
      anchorsSetAuto(userId: string, auto: boolean): Promise<boolean>
      anchorsRefresh(): Promise<boolean>
      livePlay(userId: string, password?: string, fresh?: boolean): Promise<PlayInfo>
      discoveryList(): Promise<DiscoveryItem[]>
      recList(): Promise<RecTask[]>
      recHistory(): Promise<RecHistoryItem[]>
      recStart(userId: string, password?: string): Promise<RecTask | { ok: false; needPassword?: boolean; error?: string }>
      recStop(userId: string): Promise<void>
      recOpenFolder(dir: string): Promise<boolean>
      recClearHistory(): Promise<boolean>
      recDiskFree(): Promise<number>
      settingsGet(): Promise<Settings>
      settingsSet(patch: Partial<Settings>): Promise<Settings>
      settingsSelectDir(): Promise<string>
      watcherStatus(): Promise<WatcherStatus>
      watcherStart(): Promise<void>
      watcherStop(): Promise<void>
      winControl(action: 'min' | 'max' | 'close'): Promise<void>
      openExternal(url: string): Promise<void>
      appDataDir(): Promise<string>
      onAnchors(cb: (list: Anchor[]) => void): () => void
      onRecordings(cb: (list: RecTask[]) => void): () => void
      onWatcher(cb: (s: WatcherStatus) => void): () => void
      onAccount(cb: (s: AccountState) => void): () => void
      onToast(cb: (t: Toast) => void): () => void
      onDiscovery(cb: (list: DiscoveryItem[]) => void): () => void
    }
  }
}

export {}
