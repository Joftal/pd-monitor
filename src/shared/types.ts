// ============ 主进程与渲染进程共享的数据契约 / IPC 通道名 ============

// ---------- 平台与房间主键 ----------
export type Platform = 'pandalive' | 'soop'

/** 裸 ID / 历史库数据的默认归属平台 */
export const DEFAULT_PLATFORM: Platform = 'pandalive'

export function isPlatform(v: unknown): v is Platform {
  return v === 'pandalive' || v === 'soop'
}

/** 房间主键: 同一 ID 在不同平台是两个房间, 一切去重/查找/Map 键都用它而非裸 userId。
 *  只做进程内标识: 目录名用裸 userId + 平台层级, 因为 ':' 在 Windows 文件名非法、
 *  而 strictName 会静默去掉它, 跨平台同 ID 就撞进同一目录。 */
export function roomKey(platform: Platform, userId: string): string {
  return `${platform}:${userId}`
}

/** 房间地址唯一出口(卡片跳转 / 在浏览器打开 / TG 推送都从这里取, 勿再各写各的域名) */
export function roomUrl(platform: Platform, userId: string): string {
  return platform === 'soop'
    ? `https://play.sooplive.com/${userId}`
    : `https://www.pandalive.co.kr/play/${userId}`
}

/** 用户输入(裸 ID 或任意房间链接)→ 主键。平台按域名判定, 裸 ID 归 fallback。
 *  SOOP 的 `/频道/场次号` 形态只取频道名: 场次号每次监控从页面重解析, 不进主键。
 *  无法识别返回 null, 由调用方决定是报错还是回退。 */
export function parseRoomInput(raw: string, fallback: Platform = DEFAULT_PLATFORM): { platform: Platform; userId: string } | null {
  const s = (raw || '').trim()
  if (!s) return null
  const platform: Platform = /sooplive\.com\//i.test(s)
    ? 'soop'
    : /pandalive\.co\.kr\//i.test(s)
      ? 'pandalive'
      : fallback
  const isUrl = /^https?:\/\//i.test(s)
  const path = isUrl ? s.replace(/^https?:\/\/[^/]+/i, '') : s
  const segs = path.split(/[/?#]+/).filter(Boolean)
  // pandalive 链接带 /play 路由段, SOOP 播放页第一段就是频道名(个别分享链接写作 /channel/频道名)
  const route = platform === 'pandalive' ? 'play' : 'channel'
  const cand = segs[0] === route ? segs[1] : segs[0]
  if (!cand) return null
  // 纯数字只会是 SOOP 的场次号(或误粘的数字), 不可能是任一平台的登录名
  if (isUrl && /^\d+$/.test(cand)) return null
  const userId = cand.replace(/[^\w-]/g, '')
  return userId ? { platform, userId } : null
}

export interface AnchorTag {
  isAdult: boolean
  isPw: boolean
  type: string // free | fan ...
  liveType: string // live | rec
}

export interface Anchor {
  /** 归属平台; 与 userId 共同构成主键 */
  platform: Platform
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
  /** 归属平台; 与 userId 共同定位房间(录制产物目录仍按 nick(userId) 命名, 平台分叉在下一层) */
  platform: Platform
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
  /** 进行中的管线阶段(对 status 的细化; 历史条目无此字段):
   *  fetch 拉源 → recording 录制/下载 → stopping 收尾 → remux 转码 → merge 合并 */
  stage?: 'fetch' | 'recording' | 'stopping' | 'remux' | 'merge'
  /** 阶段内件数进度(转码/合并: 第 cur/total 件; 为 0 表示未知) */
  stageCur?: number
  stageTotal?: number
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
  /** 源保活: 对已缓存源做轻量心跳维持 IVS 会话活性(退出观看后满员房间仍能凭旧源继续看), 死源及时作废重铸 */
  keepaliveStream: boolean
  /** 录制收尾时自动把分段 MP4 合并为单个文件 */
  mergeMp4: boolean
  /** 合并成功后删除原分段 MP4(仅 mergeMp4 开时生效; 合并失败永远保留原分段) */
  mergeDeleteSegments: boolean
  /** 录制因源失效(停滞/中断)失败时自动重拉新源续录 —— 显式开启才生效(跨签名过期/跨天挂机场景); 每主播连续最多 3 次 */
  autoRetryRecord: boolean
  /** Telegram 推送: 开播(含粉丝房) */
  tgLive: boolean
  /** Telegram 推送: 下播 */
  tgOffline: boolean
  /** Telegram 推送: 录制启动/完成 */
  tgRecord: boolean
  /** Telegram 推送: 错误(录制出错/熔断等) */
  tgError: boolean
  /** Telegram chatId(@BotFather 建 bot 后用 getUpdates 或 /getChatId 获取) */
  tgChatId: string
  /** Telegram 专用代理(如 http://127.0.0.1:7890); 留空则跟随全局代理 */
  tgProxy: string
  /** bot token 是否已配置(真值存 secrets 保险箱, 此处仅投影供 UI 展示) */
  tgTokenSet: boolean
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
  keepaliveStream: true,
  mergeMp4: false,
  mergeDeleteSegments: true,
  autoRetryRecord: false,
  tgLive: true,
  tgOffline: false,
  tgRecord: true,
  tgError: true,
  tgChatId: '',
  tgProxy: '',
  tgTokenSet: false,
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
  /** 官方校验请求本身失败(网络/风控): 与"服务端明确未登录"语义不同, 前端不得报成未登录 */
  netFail: boolean
  encrypted: boolean
}

/** SOOP 账号态: 与 PandaLive 完全独立的两套登录态, 字段按 SOOP 接口能给的信息来
 *  (潘达以数字 idx 标识账号, SOOP 只有 LOGIN_ID/LOGIN_NICK; 且 SOOP 支持账密自动重登) */
export interface SoopAccountState {
  /** 会话罐里是否已有 .sooplive.com Cookie(匿名站点 Cookie 也算, 故只用于"有没有种过") */
  hasCookies: boolean
  /** 官方 get_private_info.php 判定已登录(LOGIN_ID 非空) —— 取 19+/限区房间的依据 */
  realLogin: boolean
  /** 请求层失败(网络/风控), 与"服务端明确未登录"语义不同 */
  netFail: boolean
  loginId: string
  nick: string
  /** 已托管的账密自动重登账号(仅用户名; 密码不出主进程) */
  credentialUser: string
}

export interface AccountStates {
  pandalive: AccountState
  soop: SoopAccountState
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
  /** SOOP 专有: 该房间要登录态(19+/限区/匿名降级), 前端据此给"去登录"入口而不是当成未开播 */
  needLogin?: boolean
  error?: string
  m3u8?: string
  /** 回放(liveType=rec)播放结果: 前端可据此切换"观看/下载回放"语义 */
  vod?: boolean
  /** 变体分档(带宽降序, 第一个是最高档; 用于替代短寿 master 地址) */
  variants?: { url: string; bandwidth: number; resolution: string; label?: string }[]
  title?: string
  nick?: string
  thumbUrl?: string
  userImg?: string
  tags?: AnchorTag
  startTime?: string
  /** 备用线路 master(hls.js 自动选档); 只含与主线互异的真备用 —— 平台返回同链时为空, 线路栏自动隐藏 */
  hlsBackups?: string[]
  /** 本源包在主进程缓存中的生成时刻(ms 时间戳; 切换清晰度/线路不刷新, 手动刷新/重拉才更新) */
  fetchedAt?: number
}

/** 源保活单源运行状态(播放页"播放源卡"展示) */
export interface KeepaliveStatus {
  /** 设置开关是否启用 */
  enabled: boolean
  /** 该房间当前是否持有有效源(缓存命中) */
  cached: boolean
  /** 最近一次心跳时刻(ms; 0=从未心跳) */
  lastAt: number
  /** 最近一次心跳是否正常(主档可用) */
  lastOk: boolean
  /** 该源包养着的分档数 */
  variants: number
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
  type: 'live' | 'fanLive' | 'roomChange' | 'offline' | 'rec' | 'error' | 'info' | 'session'
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
  /** 两套登录态一次给全: 顶栏双头像与账号页共用同一份事实源 */
  authState(): Promise<AccountStates>
  authOpenWindow(platform: Platform): Promise<{ ok: boolean; message: string }>
  authImportCookies(cookieStr: string, platform: Platform): Promise<{ ok: boolean; message: string }>
  authLogout(platform: Platform): Promise<boolean>
  /** SOOP 账密自动重登: 存下凭据并立刻登录一次; 账号传空串=解除托管, 密码不回显也不回传 */
  authSaveSoopCredentials(username: string, password: string): Promise<{ ok: boolean; message: string }>
  anchorsList(): Promise<Anchor[]>
  /** platform 省略时由输入形态推断(带域名按域名, 裸 ID 归默认平台) */
  anchorsAdd(input: string, platform?: Platform): Promise<Anchor>
  anchorsRemove(platform: Platform, userId: string): Promise<boolean>
  anchorsSetAuto(platform: Platform, userId: string, auto: boolean): Promise<boolean>
  anchorsRefresh(): Promise<boolean>
  livePlay(platform: Platform, userId: string, password?: string, fresh?: boolean): Promise<PlayInfo>
  /** 返回 roomKey 集(非裸 userId) */
  liveSrcCache(): Promise<string[]>
  keepaliveStatus(platform: Platform, userId: string): Promise<KeepaliveStatus>
  discoveryList(): Promise<DiscoveryItem[]>
  recList(): Promise<RecTask[]>
  recHistory(): Promise<RecHistoryItem[]>
  recStart(platform: Platform, userId: string, password?: string): Promise<RecTask | { ok: false; needPassword?: boolean; error?: string }>
  recStop(platform: Platform, userId: string): Promise<void>
  recOpenFolder(dir: string): Promise<boolean>
  recDiskFree(): Promise<number>
  recMerge(taskId: string): Promise<{ ok: boolean; files?: string[]; error?: string }>
  recThumb(taskId: string): Promise<{ ok: boolean; url: string }>
  recDelete(taskId: string): Promise<RecDeleteResult>
  recDeleteFile(taskId: string, absPath: string): Promise<RecDeleteFileResult>
  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>
  settingsSelectDir(): Promise<string>
  /** 保存 Telegram bot token 到加密保险箱(不回显); 空串=清除; 返回刷新后的设置投影 */
  telegramSetToken(token: string): Promise<Settings>
  /** 发送测试消息: token 传空串则用保险箱已存值 */
  telegramTest(token: string, chatId: string): Promise<{ ok: boolean; message: string }>
  watcherStatus(): Promise<WatcherStatus>
  winControl(action: 'min' | 'max' | 'close'): Promise<void>
  openExternal(url: string): Promise<void>
  appDataDir(): Promise<string>
  openLogs(): Promise<string>
  appInfo(): Promise<AppInfo>
  checkUpdate(): Promise<UpdateCheckResult>
  /** 渲染层诊断日志入主日志文件(限流防刷屏; 勿传含 token/代理凭证的原文) */
  rendererLog(level: 'info' | 'warn', msg: string): void
  localFileUrl(absPath: string): string
  onAnchors(cb: (list: Anchor[]) => void): () => void
  onRecordings(cb: (list: RecTask[]) => void): () => void
  onWatcher(cb: (s: WatcherStatus) => void): () => void
  onAccount(cb: (s: AccountStates) => void): () => void
  onToast(cb: (t: Toast) => void): () => void
  onDiscovery(cb: (list: DiscoveryItem[]) => void): () => void
  onRecThumb(cb: (p: RecThumbReady) => void): () => void
  /** 有效直播源缓存快照(已获取源的房间 roomKey 集; 卡片「秒开」徽标依据) */
  onSrcCache(cb: (keys: string[]) => void): () => void
}

// ---------- IPC invoke 通道 ----------
export const CH = {
  authState: 'auth:state',
  authOpenWindow: 'auth:open-window',
  authImportCookies: 'auth:import-cookies',
  authLogout: 'auth:logout',
  authSaveSoopCredentials: 'auth:save-soop-credentials',
  anchorsList: 'anchors:list',
  anchorsAdd: 'anchors:add',
  anchorsRemove: 'anchors:remove',
  anchorsSetAuto: 'anchors:set-auto',
  anchorsRefresh: 'anchors:refresh',
  livePlay: 'live:play',
  liveSrcCache: 'live:src-cache',
  liveKeepaliveStatus: 'live:keepalive-status',
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
  telegramSetToken: 'telegram:set-token',
  telegramTest: 'telegram:test',
  watcherStatus: 'watcher:status',
  winControl: 'win:control',
  openExternal: 'shell:open-external',
  appDataDir: 'app:data-dir',
  appOpenLogs: 'app:open-logs',
  appInfo: 'app:info',
  appCheckUpdate: 'app:check-update',
  appLog: 'app:log'
} as const

// ---------- IPC event 通道（主进程 -> 渲染进程） ----------
export const EV = {
  anchors: 'ev:anchors',
  recordings: 'ev:recordings',
  recThumb: 'ev:rec-thumb',
  watcher: 'ev:watcher',
  account: 'ev:account',
  toast: 'ev:toast',
  discovery: 'ev:discovery',
  srcCache: 'ev:src-cache'
} as const
