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
  /** 回放(VOD)下载任务(旧历史记录无此字段) */
  vod?: boolean
  /** VOD: 清单总时长(秒, 拉取失败为 0 → 前端表现为不定进度) */
  vodTotalSec?: number
  /** VOD: 已下载的媒体时长(秒, 来自 ffmpeg -progress out_time) */
  vodDoneSec?: number
  /** 直播间封面(取自拉源响应; 录制卡片展示用, 旧历史记录无此字段) */
  thumbUrl?: string
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
  /** 开播即预取直播源(后台节流泵), 点进房间零等待 */
  prefetchStream: boolean
  /** 录制收尾时自动把分段 MP4 合并为单个文件 */
  mergeMp4: boolean
  /** 合并成功后删除原分段 MP4(仅 mergeMp4 开时生效; 合并失败永远保留原分段) */
  mergeDeleteSegments: boolean
  /** 界面主题: light(默认) | dark */
  theme: 'light' | 'dark'
  /** 界面语言 */
  locale: 'zh-CN' | 'en-US'
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
  diskLimitGb: 1,
  prefetchStream: true,
  mergeMp4: false,
  mergeDeleteSegments: true,
  theme: 'light',
  locale: 'zh-CN'
}

export interface AccountState {
  loggedIn: boolean
  cookieValid: boolean
  /** 真实会话登录态(经 login_info 校验, 防止被验证码静默拦截的假登录) */
  realLogin: boolean
  /** 账号是否已通过 pandalive 成人认证 */
  isAdult: boolean
  userIdx: number | null
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
  /** 回放(liveType=rec)播放结果: 前端可据此切换"观看/下载回放"语义 */
  vod?: boolean
  /** 变体分档(带宽降序, 第一个是最高档; 用于替代短寿 master 地址) */
  variants?: { url: string; bandwidth: number; resolution: string }[]
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
  type: 'live' | 'fanLive' | 'offline' | 'rec' | 'error' | 'info'
  title: string
  body: string
}

/** 关于页静态信息 */
export interface AppInfo {
  version: string
  author: string
  repo: string
  releasesPage: string
}

/** 检查结果(ok=false 时 latest/url 可能为空) */
export interface UpdateCheckResult {
  ok: boolean
  current: string
  latest?: string
  hasUpdate?: boolean
  url?: string
  error?: string
}

/** 九宫格缩略图就绪推送 */
export interface RecThumbReady {
  id: string
  url: string
}

/** 删除录制任务结果 */
export interface RecDeleteResult {
  ok: boolean
  error?: string
  deletedFiles: number
  freedBytes: number
  missingFiles: number
}

/** 删除单个分段结果 */
export interface RecDeleteFileResult {
  ok: boolean
  error?: string
  remaining: number
  /** 删除后文件全空: 任务条目与缩略图已一并移除 */
  emptied?: boolean
}

// ---------- window.api 桥接口契约(单一事实源: preload 实现它, env.d.ts 引用它) ----------
export interface ApiBridge {
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
  recDiskFree(): Promise<number>
  recMerge(taskId: string): Promise<{ ok: boolean; files?: string[]; error?: string }>
  recThumb(taskId: string): Promise<{ ok: boolean; url: string }>
  recDelete(taskId: string): Promise<RecDeleteResult>
  recDeleteFile(taskId: string, absPath: string): Promise<RecDeleteFileResult>
  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>
  settingsSelectDir(): Promise<string>
  watcherStatus(): Promise<WatcherStatus>
  winControl(action: 'min' | 'max' | 'close'): Promise<void>
  openExternal(url: string): Promise<void>
  appDataDir(): Promise<string>
  openLogs(): Promise<string>
  appInfo(): Promise<AppInfo>
  checkUpdate(): Promise<UpdateCheckResult>
  localFileUrl(absPath: string): string
  onAnchors(cb: (list: Anchor[]) => void): () => void
  onRecordings(cb: (list: RecTask[]) => void): () => void
  onWatcher(cb: (s: WatcherStatus) => void): () => void
  onAccount(cb: (s: AccountState) => void): () => void
  onToast(cb: (t: Toast) => void): () => void
  onDiscovery(cb: (list: DiscoveryItem[]) => void): () => void
  onRecThumb(cb: (p: RecThumbReady) => void): () => void
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
  recDiskFree: 'rec:disk-free',
  recMerge: 'rec:merge',
  recThumb: 'rec:thumb',
  recDelete: 'rec:delete',
  recDeleteFile: 'rec:delete-file',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSelectDir: 'settings:select-dir',
  watcherStatus: 'watcher:status',
  winControl: 'win:control',
  openExternal: 'shell:open-external',
  appDataDir: 'app:data-dir',
  appOpenLogs: 'app:open-logs',
  appInfo: 'app:info',
  appCheckUpdate: 'app:check-update'
} as const

// ---------- IPC event 通道（主进程 -> 渲染进程） ----------
export const EV = {
  anchors: 'ev:anchors',
  recordings: 'ev:recordings',
  recThumb: 'ev:rec-thumb',
  watcher: 'ev:watcher',
  account: 'ev:account',
  toast: 'ev:toast',
  discovery: 'ev:discovery'
} as const
