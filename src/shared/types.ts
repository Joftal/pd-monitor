// ============ 主进程与渲染进程共享的数据契约 / IPC 通道名 ============

export interface AnchorTag {
  isAdult: boolean
  isPw: boolean
  type: string // free | fan ...
  liveType: string // live | rec
}

export interface Anchor {
  userId: string
  userIdx: number | null
  nick: string
  userImg: string
  isLive: boolean
  title: string
  tags: AnchorTag | null
  startTime: string
  viewerCount: number
  likes: number
  fans: number
  thumbUrl: string
  autoRecord: boolean
  addedAt: number
  lastSeenAt: number
}

export type RecStatus = 'recording' | 'remuxing' | 'done' | 'stopped' | 'error'

export interface RecTask {
  id: string
  userId: string
  nick: string
  title: string
  startedAt: number
  endedAt: number | null
  status: RecStatus
  dirPath: string
  currentFile: string
  files: string[]
  bytes: number
  error: string
  auto: boolean
}

export type RecHistoryItem = RecTask

export interface Settings {
  savePath: string
  splitSeconds: number
  autoMp4: boolean
  deleteTs: boolean
  pollIntervalSec: number
  requestGapMs: number
  proxyUrl: string
  watchMode: 'list' | 'per-anchor'
  notifySystem: boolean
  notifySound: boolean
  autoRecordDefault: boolean
  closeToTray: boolean
  diskLimitGb: number
}

export const DEFAULT_SETTINGS: Settings = {
  savePath: '',
  splitSeconds: 900,
  autoMp4: true,
  deleteTs: false,
  pollIntervalSec: 30,
  requestGapMs: 1200,
  proxyUrl: '',
  watchMode: 'list',
  notifySystem: true,
  notifySound: true,
  autoRecordDefault: false,
  closeToTray: true,
  diskLimitGb: 1
}

export interface AccountState {
  loggedIn: boolean
  cookieValid: boolean
  /** 真实会话登录态(经 login_info 校验, 防止被验证码静默拦截的假登录) */
  realLogin: boolean
  /** 账号是否已通过 pandalive 成人认证 */
  isAdult: boolean
  nick: string
  userIdx: number | null
  loginAt: number | null
  encrypted: boolean
}

export interface WatcherStatus {
  running: boolean
  mode: 'list' | 'per-anchor'
  lastRoundAt: number | null
  roundMs: number
  liveCount: number
  monitored: number
  liveFound: number
  circuitOpen: boolean
  message: string
}

export interface PlayInfo {
  ok: boolean
  needPassword?: boolean
  error?: string
  m3u8?: string
  title?: string
  nick?: string
  thumbUrl?: string
  userImg?: string
  tags?: AnchorTag
  startTime?: string
  hlsBackups?: string[]
}

/** 大厅: 全平台在播直播间条目 */
export interface DiscoveryItem {
  userId: string
  userIdx: number | null
  nick: string
  title: string
  isAdult: boolean
  isPw: boolean
  type: string
  liveType: string
  viewers: number
  likes: number
  fans: number
  bookmarks: number
  plays: number
  startTime: string
  thumbUrl: string
  userImg: string
}

export interface Toast {
  type: 'live' | 'offline' | 'rec' | 'error' | 'info'
  title: string
  body: string
}

// ---------- IPC invoke 通道 ----------
export const CH = {
  authState: 'auth:state',
  authLoginPassword: 'auth:login-password',
  authOpenWindow: 'auth:open-window',
  authImportCookies: 'auth:import-cookies',
  authLogout: 'auth:logout',
  anchorsList: 'anchors:list',
  anchorsAdd: 'anchors:add',
  anchorsRemove: 'anchors:remove',
  anchorsSetAuto: 'anchors:set-auto',
  anchorsRefresh: 'anchors:refresh',
  livePlay: 'live:play',
  discoveryList: 'discovery:list',
  recList: 'rec:list',
  recHistory: 'rec:history',
  recStart: 'rec:start',
  recStop: 'rec:stop',
  recOpenFolder: 'rec:open-folder',
  recClearHistory: 'rec:clear-history',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSelectDir: 'settings:select-dir',
  watcherStatus: 'watcher:status',
  watcherStart: 'watcher:start',
  watcherStop: 'watcher:stop',
  winControl: 'win:control',
  openExternal: 'shell:open-external',
  appDataDir: 'app:data-dir'
} as const

// ---------- IPC event 通道（主进程 -> 渲染进程） ----------
export const EV = {
  anchors: 'ev:anchors',
  recordings: 'ev:recordings',
  watcher: 'ev:watcher',
  account: 'ev:account',
  toast: 'ev:toast',
  discovery: 'ev:discovery'
} as const
