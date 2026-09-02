import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { CH, EV } from '../shared/types'
import type {
  AccountState, Anchor, DiscoveryItem, PlayInfo, RecHistoryItem, RecTask, Settings, Toast, WatcherStatus
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const apiBridge = {
  // 账号
  authState: (): Promise<AccountState> => ipcRenderer.invoke(CH.authState),
  authLoginPassword: (id: string, pw: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(CH.authLoginPassword, id, pw),
  authOpenWindow: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(CH.authOpenWindow),
  authImportCookies: (cookieStr: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(CH.authImportCookies, cookieStr),
  authLogout: (): Promise<boolean> => ipcRenderer.invoke(CH.authLogout),

  // 主播
  anchorsList: (): Promise<Anchor[]> => ipcRenderer.invoke(CH.anchorsList),
  anchorsAdd: (input: string): Promise<Anchor> => ipcRenderer.invoke(CH.anchorsAdd, input),
  anchorsRemove: (userId: string): Promise<boolean> => ipcRenderer.invoke(CH.anchorsRemove, userId),
  anchorsSetAuto: (userId: string, auto: boolean): Promise<boolean> =>
    ipcRenderer.invoke(CH.anchorsSetAuto, userId, auto),
  anchorsRefresh: (): Promise<boolean> => ipcRenderer.invoke(CH.anchorsRefresh),

  // 播放
  livePlay: (userId: string, password?: string, fresh?: boolean): Promise<PlayInfo> =>
    ipcRenderer.invoke(CH.livePlay, userId, password, fresh),

  // 大厅
  discoveryList: (): Promise<DiscoveryItem[]> => ipcRenderer.invoke(CH.discoveryList),

  // 录制
  recList: (): Promise<RecTask[]> => ipcRenderer.invoke(CH.recList),
  recHistory: (): Promise<RecHistoryItem[]> => ipcRenderer.invoke(CH.recHistory),
  recStart: (userId: string, password?: string): Promise<RecTask | { ok: false; needPassword?: boolean; error?: string }> =>
    ipcRenderer.invoke(CH.recStart, userId, password),
  recStop: (userId: string): Promise<void> => ipcRenderer.invoke(CH.recStop, userId),
  recOpenFolder: (dir: string): Promise<boolean> => ipcRenderer.invoke(CH.recOpenFolder, dir),
  recClearHistory: (): Promise<boolean> => ipcRenderer.invoke(CH.recClearHistory),

  // 设置
  settingsGet: (): Promise<Settings> => ipcRenderer.invoke(CH.settingsGet),
  settingsSet: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(CH.settingsSet, patch),
  settingsSelectDir: (): Promise<string> => ipcRenderer.invoke(CH.settingsSelectDir),

  // 轮询
  watcherStatus: (): Promise<WatcherStatus> => ipcRenderer.invoke(CH.watcherStatus),
  watcherStart: (): Promise<void> => ipcRenderer.invoke(CH.watcherStart),
  watcherStop: (): Promise<void> => ipcRenderer.invoke(CH.watcherStop),

  // 窗口
  winControl: (action: 'min' | 'max' | 'close'): Promise<void> => ipcRenderer.invoke(CH.winControl, action),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(CH.openExternal, url),
  appDataDir: (): Promise<string> => ipcRenderer.invoke(CH.appDataDir),

  // 事件订阅
  onAnchors: (cb: (list: Anchor[]) => void) => on<Anchor[]>(EV.anchors, cb),
  onRecordings: (cb: (list: RecTask[]) => void) => on<RecTask[]>(EV.recordings, cb),
  onWatcher: (cb: (s: WatcherStatus) => void) => on<WatcherStatus>(EV.watcher, cb),
  onAccount: (cb: (s: AccountState) => void) => on<AccountState>(EV.account, cb),
  onToast: (cb: (t: Toast) => void) => on<Toast>(EV.toast, cb),
  onDiscovery: (cb: (list: DiscoveryItem[]) => void) => on<DiscoveryItem[]>(EV.discovery, cb)
}

export type ApiBridge = typeof apiBridge

contextBridge.exposeInMainWorld('api', apiBridge)
