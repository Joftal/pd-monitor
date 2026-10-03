import { session } from 'electron'
import { createHash } from 'crypto'
import {
  PlayResult,
  VariantInfo,
  nodeHttpRequest,
  proxyUrl as nodeProxyUrl,
  registerProxyPartition,
  registerSrcCacheProvider,
  broadcastSrcCache
} from './pandalive'
import { isRoomId, roomKey, soopAvatarUrl } from '../../shared/types'
import { UA } from '../util'
import { logger } from './logger'
import { hostOf, laneRun } from './netGate'
import { store } from './store'
import { mt } from '../i18n'
import { secrets } from './secrets'
import { HlsProxy } from './hlsProxy'

// ============ SOOP(ex-AfreecaTV) 取流引擎 ============
// 五步链(2026-09 实测抓包, 与播放页脚本对位):
//   1. GET  https://play.sooplive.com/<频道>            → 页面 window.nBroadNo 拿场次号
//   2. POST https://live.sooplive.com/afreeca/player_live_api.php (type=live) → RMD/CDN/VIEWPRESET
//   3. 同端点 type=aid + quality                          → 该清晰度的播放凭证 AID
//   4. GET  <RMD>/broad_stream_assign.html                → view_url(分档 m3u8 基址)
//   5. view_url + ?aid=                                   → 清单, 再交本地 HLS 代理
// 匿名可看公开房间(实测四步全 200); 19+/限区/密码房需要登录态或房密码。
// 账号侧另有两个端点(2026-09 实测):
//   GET  https://afevent2.sooplive.com/api/get_private_info.php → 未登录回 {"CHANNEL":{"IS_LOGIN":-1,"LOGIN_ID":""}}
//   POST https://login.sooplive.com/app/LoginAction.php         → 失败回 {"RESULT":0}, 成功回 {"RESULT":1}+会话 Cookie
// =======================================================

export const SOOP_SESSION_PARTITION = 'persist:soop'

const SOOP_ORIGIN = 'https://play.sooplive.com'
const CHANNEL_API = 'https://live.sooplive.com/afreeca/player_live_api.php'
const AUTH_CHECK_API = 'https://afevent2.sooplive.com/api/get_private_info.php'
const LOGIN_API = 'https://login.sooplive.com/app/LoginAction.php'
/** 关注列表接口: 一发拿到"我关注的全部主播 + 各自在播状态"。服务端校 Origin(实测 play 域回 403), 必须报 www */
const FAVORITES_API = 'https://myapi.sooplive.com/api/favorite'
const WEB_ORIGIN = 'https://www.sooplive.com'
const RESULT_OK = 1
const RESULT_LOGIN = -6
const RESULT_EMPTY = 0
const RESULT_BLOCK = -2
/** Cookie 分散在多个子域(实测登录链路回吐), 取单域必漏; www/myapi 是网页登录态与关注接口的落点 */
const COOKIE_HOSTS = [
  'https://play.sooplive.com',
  'https://login.sooplive.com',
  'https://live.sooplive.com',
  'https://afevent2.sooplive.com',
  'https://www.sooplive.com',
  'https://myapi.sooplive.com'
]
/** 实测站点自己的 Cookie 全挂在这个域下, 四子域共用; 手工导入的 Cookie 也按它落罐 */
const COOKIE_DOMAIN = '.sooplive.com'
/** 登录态在罐内的保质期(30 天): 只决定"本地还带着 Cookie 多久", 服务端随时可作废, 届时按未登录处理 */
const COOKIE_TTL_SEC = 30 * 24 * 3600/** 账密托管键(secrets.dat, safeStorage 加密): 密码只在主进程解出, 不进 db.json/不回显渲染层 */
const CRED_USER = 'soop.user'
const CRED_PASS = 'soop.pass'
/** 登录态校验结果缓存: 顶栏头像/账号页/预检都会反复取态, 2 分钟内复用一次官方校验 */
const LOGIN_TTL = 120_000
const LOGIN_CACHE_MAX = 128
/** 自动重登冷却: 一轮多房间/多档位的 -6 只打一发登录接口, 免得把风控面放大 */
const RELOGIN_COOLDOWN = 60_000

const RE_PAGE_BROAD_NO = /window\.nBroadNo\s*=\s*(\d+|null);/

function roomPageUrl(channel: string): string {
  return `${SOOP_ORIGIN}/${encodeURIComponent(channel)}`
}

/** 调度接口的 return_type 命名与 CHANNEL.CDN 不完全一致(实测 gs_cdn/lg_cdn 需加 _pc_web 后缀) */
function mapCDNType(cdn: string): string {
  if (cdn.includes('gs_cdn')) return 'gs_cdn_pc_web'
  if (cdn.includes('lg_cdn')) return 'lg_cdn_pc_web'
  return cdn
}

function buildBroadKey(broadNo: string, quality: string): string {
  return `${broadNo}-common-${quality}-hls`
}

/** 播放页路径形态: /频道 或 /频道/场次号; 下播时官方会把地址重定向成 /频道/null */
function parsePathState(rawUrl: string): { channel: string; broadNo: string; explicitOffline: boolean } {
  let path = rawUrl
  try {
    path = new URL(rawUrl).pathname
  } catch {
    path = rawUrl.replace(/^https?:\/\/[^/]+/i, '')
  }
  const parts = path.split('/').filter(Boolean)
  const channel = parts[0] || ''
  const second = (parts[1] || '').toLowerCase()
  if (second === 'null') return { channel, broadNo: '', explicitOffline: true }
  return { channel, broadNo: /^\d+$/.test(second) ? second : '', explicitOffline: false }
}

/** 页面 nBroadNo 三态: 数字=在播 / null=明确下播 / 字段缺失=未知(才允许回退路径场次号) */
function parsePageBroadNo(body: string): { broadNo: string; found: boolean } {
  const m = RE_PAGE_BROAD_NO.exec(body)
  if (!m) return { broadNo: '', found: false }
  if (m[1].toLowerCase() === 'null') return { broadNo: '', found: true }
  return { broadNo: m[1], found: true }
}

function resolvePageBroadNo(
  pathBroadNo: string,
  pageBroadNo: string,
  pageBroadNoFound: boolean,
  pathExplicitlyOffline: boolean
): { broadNo: string; living: boolean; explicitOffline: boolean } {
  if (pageBroadNoFound && pageBroadNo) return { broadNo: pageBroadNo, living: true, explicitOffline: false }
  if (pageBroadNoFound) return { broadNo: '', living: false, explicitOffline: true }
  if (pathExplicitlyOffline) return { broadNo: '', living: false, explicitOffline: true }
  if (pathBroadNo) return { broadNo: pathBroadNo, living: true, explicitOffline: false }
  return { broadNo: '', living: false, explicitOffline: false }
}

/** 页面脚本里的 window.xxx = '...' / "..." 字符串变量 */
function parseWindowString(body: string, name: string): string {
  const re = new RegExp(`window\\.${name}\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`)
  const m = re.exec(body)
  const raw = m ? m[1] ?? m[2] ?? '' : ''
  if (!raw) return ''
  try {
    return JSON.parse('"' + raw.replace(/"/g, '\\"') + '"')
  } catch {
    return raw
  }
}

/** 播放页截图(window.szBroadThumPath, 同时是 og:image): 实测形如 //liveimg.sooplive.com/m/<场次号>?随机,
 *  无 Cookie 无 Referer 也直接 200; 下播时官方换成 blind_background.svg 占位, 那种不如不显示 */
function parsePageThumb(body: string): string {
  const raw = parseWindowString(body, 'szBroadThumPath')
  if (!raw || raw.includes('blind_background')) return ''
  return raw.startsWith('//') ? 'https:' + raw : raw
}

/** 关注列表里"此刻在播"的那一场 */
export interface SoopFavoriteLive {
  broadNo: string
  title: string
  /** KST 钟面串, 已补齐到秒与平台同格式 */
  startTime: string
  thumbUrl: string
  viewers: number
  /** 密码房标记: 平台这一行说了才算数 —— 键缺席/非布尔一律留 undefined(= 不知道),
   *  塌成 false 就等于替上一轮的真值下结论(watcher 的列表回写按这一格合并) */
  isPw?: boolean
}

export interface SoopFavoriteRow {
  userId: string
  nick: string
  /** 关注行自己不带任何图片字段(实测 718 行的键集里没有一个 img/url), 头像是按频道 ID 派生出来的 */
  userImg: string
  isLive: boolean
  /** 上次开播的钟面串(离线项也有, 可显示"多久没播") */
  lastStartTime: string
  /** isLive=true 但这里为 null: 列表说有场次却没给, 状态判不了, 调用方须对该房回落到播放页探针 */
  live: SoopFavoriteLive | null
}

/** 接口给的是分钟精度钟面串("2026-09-29 22:01"), 平台内统一为秒级; 形状不对返回空串(不可用) */
function favClock(v: unknown): string {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s + ':00'
  return ''
}

function favThumb(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s.includes('blind_background')) return ''
  return s.startsWith('//') ? 'https:' + s : s
}

/** 当前观众数: broad_info 里的 total_view_cnt 就是 pc+mobile 之和(实测与页面口径一致), 分端值缺失才退到它 */
function favViewers(b: Record<string, unknown>): number {
  const pc = Number(b.pc_view_cnt)
  const mo = Number(b.mobile_view_cnt)
  if (Number.isFinite(pc) || Number.isFinite(mo)) return (Number.isFinite(pc) ? pc : 0) + (Number.isFinite(mo) ? mo : 0)
  const t = Number(b.total_view_cnt)
  return Number.isFinite(t) ? t : 0
}

/** 单条关注 → 内部行; 返回 null 表示这条不可用(缺 user_id / id 不可寻址) */
function parseFavoriteRow(raw: unknown): SoopFavoriteRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const userId = String(r.user_id ?? '')
  if (!isRoomId(userId)) return null
  const row: SoopFavoriteRow = {
    userId,
    nick: String(r.user_nick ?? ''),
    // 关注列表那一行没有头像字段(实测 718 行的键集里一个 image/url 都没有), 只能按频道 ID 派生
    userImg: soopAvatarUrl(userId),
    isLive: r.is_live === true,
    lastStartTime: favClock(r.last_broad_start),
    live: null
  }
  if (!row.isLive) return row
  const b = Array.isArray(r.broad_info) ? r.broad_info[0] : undefined
  if (!b || typeof b !== 'object') return row
  const live = b as Record<string, unknown>
  const broadNo = String(live.broad_no ?? '')
  if (!broadNo) return row
  row.live = {
    broadNo,
    title: String(live.broad_title ?? ''),
    startTime: favClock(live.broad_start),
    thumbUrl: favThumb(live.broad_img),
    viewers: favViewers(live),
    // is_adult 一律不读(2026-10-01 用户定: SOOP 的房间级 19+ 标记不重要, 可以不展示):
    // 平台自己会在同一场直播里改口(真机 7 轮同一 broad_start 读到 true→false×3→true), 而这一旗的消费面只有展示。
    // 能不能取到 19+ 的源与它无关 —— 靠的是 SOOP 登录态(代理上游走 persist:soop)和账号的成人认证(verifyLogin 回包的 isAdult)。
    // 密码房这一旗留着: 它决定要不要弹密码框、录制带不带密码, 是功能不是装饰。
    isPw: typeof live.is_password === 'boolean' ? live.is_password : undefined
  }
  return row
}

/** 平台通用的 startTime 是 KST 钟面串("YYYY-MM-DD HH:MM:SS"), 渲染层与 watcher 都按 UTC+9 解析 ——
 *  SOOP 侧由 BTIME 反推时必须落成同一格式, 否则两套时长算法会各算各的 */
function kstClock(ms: number): string {
  const d = new Date(ms + 9 * 3600_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

interface ViewPreset {
  label: string
  name: string
  height: number
  bps: number
}

interface ChannelInfo {
  result: number
  broadNo: string
  hostName: string
  roomName: string
  rmd: string
  cdn: string
  needPwd: boolean
  /** 已播秒数(CHANNEL.BTIME, 实测在播房为累计秒): 播放页/列表侧都拿不到开播时刻, 只能由它反推 */
  btime: number
  presets: ViewPreset[]
}

interface PageMeta {
  channel: string
  broadNo: string
  /** 页面/路径已明确下播: 与"字段缺失"必须区分, 否则会把下播报成接口异常 */
  explicitOffline: boolean
  living: boolean
  hostName: string
  roomName: string
  /** 在播截图; 下播占位或取不到时为空串 */
  thumbUrl: string
}

function explainResult(result: number): string {
  switch (result) {
    case RESULT_OK:
      return mt('soop.resultOk')
    case RESULT_LOGIN:
      return mt('soop.resultLogin')
    case RESULT_EMPTY:
      return mt('soop.resultEmpty')
    case RESULT_BLOCK:
      return mt('soop.resultBlock')
    default:
      return mt('soop.resultUnknown', { code: result })
  }
}

/** 官方登录态: IS_LOGIN/LOGIN_ID 双字段实测同向, 判据取 LOGIN_ID 非空(参考实现同策) */
export interface SoopLoginInfo {
  isLogin: boolean
  loginId: string
  nick: string
  /** 请求层失败(网络/风控), 与"服务端明确未登录"语义不同, 调用方不得据此判死会话 */
  netFail: boolean
}

/** "k=v; k=v" → 凭证 map(浏览器 document.cookie 与 Set-Cookie 首段同构) */
function parseCookieString(raw: string): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const part of String(raw || '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k && v) jar[k] = v
  }
  return jar
}

/** 日志脱敏: 账号只留首尾各一字符(实测平台 LOGIN_ID 多为半匿名串, 但仍是身份标识) */
export function maskLoginId(id: string): string {
  if (id.length <= 2) return id ? id[0] + '*' : '*'
  return `${id[0]}***${id[id.length - 1]}`
}

class SoopApi {
  private proxy: HlsProxy | null = null
  private playCache = new Map<string, PlayResult>()
  private playInflight = new Map<string, Promise<PlayResult>>()
  private cookieCache: { at: number; header: string } | null = null
  /** 最近一次"这一房在播, 场次号是 X"的读数(关注列表整表白送 broad_no / 播放页实读), 按频道各存一格。
   *  取流第一步原本只为拿这个号码就发一整页 HTML, 列表那一发既然给了就不该再买一次(㊒④)。
   *  与 playCache 互不牵连: 源作废 ≠ 场次号作废 —— 它只随 TTL 与失败回落失效 */
  private bnoCache = new Map<string, { bno: string; at: number }>()
  /** ㊙(R29-4) 已买档位的复用账: 频道 → { 为哪一场次买的, 买到了哪几档 }。
   *  判据是场次而不是时间: aid/签名地址在同一场内本来就是长效的, 与 playCache"只认显式作废"同规约。
   *  满档 caller 过去只能整条链重打(连最高档那 2 发也重买一遍), 这一格把已经买到的那几档递出来, 只补差档 */
  private partialBuy = new Map<string, { bno: string; bought: { name: string; variant: VariantInfo }[] }>()
  /** 只比一轮轮询长一点: 过期就当没读到过, 回到读页那条既有链路(下播判定要的是页/路径这句话, 不是这里) */
  private static BNO_TTL = 90_000
  /** 播放页 HTML 的微缓存: 只给"连击型"调用方复用(录制启动前先取真名 → 紧接着拉整链, 同一页两发)。
   *  轮询探针是来要新读数的, 一律 fresh 绕过这里 —— 最短一档 5s 比 TTL 还小, 缓存会吃掉头一轮 */
  private pageCache = new Map<string, { at: number; meta: PageMeta }>()
  private pageInflight = new Map<string, Promise<PageMeta>>()
  private static PAGE_TTL = 10_000

  /** 本地 HLS 代理单实例: 所有房间/清晰度共用一个回环端口, 靠 ?url= 参数分流 */
  private proxyStarting: Promise<HlsProxy> | null = null
  private async hls(): Promise<HlsProxy> {
    if (this.proxy) {
      await this.proxy.listen()
      return this.proxy
    }
    // 并发首拉(预取泵与用户手动进房同时到)必须合流: 各建各的会留下两个监听实例, 后写的覆盖 this.proxy,
    // 先建的那个端口永久泄漏; 更要命的是 onUpstreamDead 用 this.proxy 重算 playlistUrl ——
    // 缓存里的旧端口地址从此没人认得, 死源收尸整条链路静默失效
    if (!this.proxyStarting) {
      this.proxyStarting = (async () => {
        const p = new HlsProxy({
          sessionPartition: SOOP_SESSION_PARTITION,
          headers: async () => ({ ...this.baseHeaders(), ...(await this.cookieHeader()) }),
          // SOOP 没有源保活泵: 上游清单判死是唯一的死源探测口, 不收尸就会留死源骗「已缓存」徽标
          onDeadUpstream: (target, status) => this.onUpstreamDead(target, status)
        })
        await p.listen()
        this.proxy = p
        return p
      })().finally(() => {
        this.proxyStarting = null
      })
    }
    return this.proxyStarting
  }

  private baseHeaders(referer?: string): Record<string, string> {
    return {
      'User-Agent': UA,
      Origin: SOOP_ORIGIN,
      Referer: referer || `${SOOP_ORIGIN}/`,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  }

  /** SOOP 会话 Cookie(登录窗/导入写进 persist:soop): 四子域合并, 10s 短缓存免得每请求查库 */
  private async cookieString(): Promise<string> {
    if (this.cookieCache && Date.now() - this.cookieCache.at < 10_000) return this.cookieCache.header
    const ses = session.fromPartition(SOOP_SESSION_PARTITION)
    const merged: Record<string, string> = {}
    try {
      for (const u of COOKIE_HOSTS) {
        for (const c of await ses.cookies.get({ url: u })) merged[c.name] = c.value
      }
    } catch (e) {
      logger.warn('soop', `读取 SOOP Cookie 失败: ${String(e)}`)
    }
    const header = Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    this.cookieCache = { at: Date.now(), header }
    return header
  }

  private async cookieHeader(): Promise<Record<string, string>> {
    const s = await this.cookieString()
    return s ? { Cookie: s } : {}
  }

  invalidateCookieCache(): void {
    this.cookieCache = null
  }

  // ---------- 账号: 登录态校验 / Cookie 落罐 / 账密自动重登 ----------
  /** 会话罐里是否有任何 SOOP Cookie(匿名站点 Cookie 也算): 只用来区分"从没登录过"与"登录态已失效" */
  async hasJarCookies(): Promise<boolean> {
    return !!(await this.cookieString())
  }

  /** 官方登录态校验(get_private_info.php): 实测未登录回 {"IS_LOGIN":-1,"LOGIN_ID":""}, 判据取 LOGIN_ID 非空
   *  - cookieOverride: 试验证通道, 走 Node 直发且完全不碰会话罐(导入/重登落罐前必须先验真)
   *  - 结果按 Cookie 指纹缓存 2 分钟并合并在途请求: 顶栏头像/账号页/取流预检都要取同一个态
   *  - netFail(网络/风控/非 JSON)不进缓存, 也不得被调用方当成"未登录" */
  private loginCache = new Map<string, { at: number; info: SoopLoginInfo }>()
  private loginInflight = new Map<string, Promise<SoopLoginInfo>>()
  /** 最后一次真实发出 get_private_info 的时刻(含 netFail 的失败尝试; 试验证通道不计): 账号页「上次校验」用 */
  private loginCheckedAt = 0

  get lastVerifyAt(): number {
    return this.loginCheckedAt
  }

  async verifyLogin(cookieOverride?: string, force = false): Promise<SoopLoginInfo> {
    const cookie = cookieOverride ?? (await this.cookieString())
    if (!cookie) return { isLogin: false, loginId: '', nick: '', netFail: false } // 一点凭证都没有就别打官方接口
    const key = createHash('sha256').update(cookie).digest('hex')
    const hit = this.loginCache.get(key)
    if (!force && hit && Date.now() - hit.at < LOGIN_TTL) return hit.info
    const flying = this.loginInflight.get(key)
    if (flying) return flying
    const p = (async (): Promise<SoopLoginInfo> => {
      let info: SoopLoginInfo
      if (!cookieOverride) this.loginCheckedAt = Date.now()
      try {
        const headers = { ...this.baseHeaders(), Cookie: cookie }
        const res = cookieOverride
          ? await nodeHttpRequest('GET', AUTH_CHECK_API, headers, undefined, nodeProxyUrl())
          : await this.req(AUTH_CHECK_API, { headers })
        if (res.status !== 200) throw new Error(mt('soop.verifyHttp', { status: res.status }))
        const c = (JSON.parse(res.text) as { CHANNEL?: Record<string, unknown> }).CHANNEL || {}
        const loginId = String(c.LOGIN_ID ?? '')
        info = { isLogin: !!loginId, loginId, nick: String(c.LOGIN_NICK ?? ''), netFail: false }
      } catch (e) {
        logger.warn('soop', `登录态校验未通过或请求失败: ${String((e as Error).message || e)}`)
        info = { isLogin: false, loginId: '', nick: '', netFail: true }
      }
      if (!info.netFail) {
        this.loginCache.set(key, { at: Date.now(), info })
        if (this.loginCache.size > LOGIN_CACHE_MAX) {
          for (const [k, v] of this.loginCache) if (Date.now() - v.at >= LOGIN_TTL) this.loginCache.delete(k)
          while (this.loginCache.size > LOGIN_CACHE_MAX) this.loginCache.delete(this.loginCache.keys().next().value as string)
        }
      }
      return info
    })().finally(() => this.loginInflight.delete(key))
    this.loginInflight.set(key, p)
    return p
  }

  /** 校验通过的 Cookie 落进会话罐: 统一按 .sooplive.com 全域写, 四子域才都读得到
   *  (实测 Chromium 会忽略手工 Cookie 头而优先用罐内同域 Cookie, 所以登录态必须落罐)
   *  expirationDate 必给: 不带期限写入即"会话 Cookie", 应用一退就蒸发 */
  async storeCookies(cookieStr: string): Promise<number> {
    const jar = parseCookieString(cookieStr)
    const ses = session.fromPartition(SOOP_SESSION_PARTITION)
    for (const [name, value] of Object.entries(jar)) {
      await ses.cookies.set({ url: SOOP_ORIGIN, name, value, domain: COOKIE_DOMAIN, path: '/', secure: true, sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + COOKIE_TTL_SEC })
    }
    this.invalidateCookieCache()
    this.loginCache.clear()
    this.clearPlayCache() // 新会话生效: 旧会话签发的源一律作废
    return Object.keys(jar).length
  }

  /** 网页登录用的官网只回吐"无 Expires 的会话 Cookie"(实测 UserTicket/AuthTicket 等全无期限),
   *  persist: 分区也救不了 —— Chromium 只持久化带期限的条目, 于是每次重启都从"已登录"跌回未登录。
   *  登录确认当刻把罐内 sooplive.com 的会话 Cookie 补期限重写一遍转成持久条目; 已带期限的原样不动。
   *  返回转换条数。 */
  async persistSessionCookies(): Promise<number> {
    const ses = session.fromPartition(SOOP_SESSION_PARTITION)
    const all = await ses.cookies.get({})
    const until = Math.floor(Date.now() / 1000) + COOKIE_TTL_SEC
    let n = 0
    for (const c of all) {
      const domain = c.domain ?? ''
      if (c.expirationDate || !domain.replace(/^\./, '').endsWith('sooplive.com')) continue
      const host = domain.replace(/^\./, '')
      try {
        await ses.cookies.set({
          url: `https://${host}${c.path ?? '/'}`,
          name: c.name,
          value: c.value,
          domain,
          path: c.path ?? '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: until
        })
        n++
      } catch (e) {
        logger.warn('soop', `Cookie 转持久失败 ${c.name}: ${String((e as Error).message || e)}`)
      }
    }
    if (n) {
      this.invalidateCookieCache()
      logger.info('soop', `会话 Cookie 已转持久(${n} 枚)`)
    }
    return n
  }

  /** 托管账密登录(LoginAction.php): 实测错凭证回 {"RESULT":0}, 成功回 {"RESULT":1} + 四子域 Set-Cookie
   *  先官方复检再落罐 —— 平台偶发回 RESULT:1 却不给可用会话 */
  async loginWithPassword(username: string, password: string): Promise<SoopLoginInfo> {
    const body = new URLSearchParams({
      szWork: 'login',
      szType: 'json',
      szUid: username,
      szPassword: password,
      isSaveId: 'true',
      isSavePw: 'false',
      isLoginRetain: 'Y'
    }).toString()
    const res = await nodeHttpRequest('POST', LOGIN_API, { ...this.baseHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body, nodeProxyUrl())
    if (res.status !== 200) throw new Error(mt('soop.loginHttp', { status: res.status }))
    let code = Number.NaN
    try {
      code = Number((JSON.parse(res.text) as { RESULT?: number }).RESULT)
    } catch {
      throw new Error(mt('soop.loginBadJson'))
    }
    if (code !== RESULT_OK) throw new Error(mt('soop.loginDenied', { code }))
    const jar: Record<string, string> = {}
    for (const line of res.setCookies || []) Object.assign(jar, parseCookieString(String(line).split(';')[0]))
    const cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    if (!cookie) throw new Error(mt('soop.loginNoCookie'))
    const info = await this.verifyLogin(cookie)
    if (!info.isLogin) throw new Error(info.netFail ? mt('soop.loginNetFail') : mt('soop.loginNotVerified'))
    await this.storeCookies(cookie)
    logger.info('soop', `账密登录成功: ${maskLoginId(info.loginId)}(Cookie ${Object.keys(jar).length} 枚)`)
    return info
  }

  credentials(): { username: string; hasPassword: boolean } {
    return { username: secrets.get(CRED_USER), hasPassword: !!secrets.get(CRED_PASS) }
  }

  /** 托管凭据落库: 只在登录已验真之后调用 —— 错凭据落库等于埋哑弹, 下次 -6 才静默失效 */
  saveCredentials(username: string, password: string): void {
    secrets.set(CRED_USER, username)
    secrets.set(CRED_PASS, password)
  }

  clearCredentials(): void {
    secrets.set(CRED_USER, '')
    secrets.set(CRED_PASS, '')
  }

  /** 退出登录: 站点存储连同 Cookie 罐一起清, 并解除账密托管
   *  (托管不解除的话, 下一次 -6 会把用户刚登出的会话又静默登回来) */
  async logout(): Promise<void> {
    this.clearCredentials()
    try {
      await session.fromPartition(SOOP_SESSION_PARTITION).clearStorageData()
    } catch { /* ignore */ }
    this.invalidateCookieCache()
    this.loginCache.clear()
    this.clearPlayCache()
  }

  /** 取流撞上 RESULT=-6(会话缺失/过期)时的自愈: 托管了账密才登, 60s 冷却 + 在途合并
   *  一轮多房间/多档位的 -6 只打一发登录接口 —— 登录接口同样有风控, 不能跟着重试次数放大 */
  private reloginAt = 0
  private reloginInflight: Promise<boolean> | null = null

  /** ㊘(R28-5): 托管了账密 = 会话过期这一类能在后台自愈, 门槛账不许把"要登录"记成终局 */
  private canAutoRelogin(): boolean {
    return Boolean(secrets.get(CRED_USER) && secrets.get(CRED_PASS))
  }

  async tryAutoLogin(): Promise<boolean> {
    const username = secrets.get(CRED_USER)
    const password = secrets.get(CRED_PASS)
    if (!username || !password) return false
    if (this.reloginInflight) return this.reloginInflight
    if (Date.now() - this.reloginAt < RELOGIN_COOLDOWN) return false
    this.reloginAt = Date.now()
    const p = (async () => {
      try {
        await this.loginWithPassword(username, password)
        return true
      } catch (e) {
        logger.warn('soop', `Cookie 过期自动重登失败: ${String((e as Error).message || e)}`)
        return false
      } finally {
        this.reloginInflight = null
      }
    })()
    this.reloginInflight = p
    return p
  }

  /** ㊕: 每一发都过一遍按站车道(见 netGate)。这里不区分"是谁调的", 用户级标记由调用链顶端 asUser() 打,
   *  沿异步链传到这一层 —— 所以预取泵/探针/保活的后台发会互相让开, 而点播放那一发不等。 */
  private async req(url: string, init: { method?: 'GET' | 'POST'; headers: Record<string, string>; body?: string }, timeoutMs = 15_000): Promise<{ status: number; text: string; finalUrl: string }> {
    return laneRun(hostOf(url), store.getSettings().monitor.soop.requestGapMs, () => this.sendReq(url, init, timeoutMs))
  }

  private async sendReq(url: string, init: { method?: 'GET' | 'POST'; headers: Record<string, string>; body?: string }, timeoutMs: number): Promise<{ status: number; text: string; finalUrl: string }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const ses = session.fromPartition(SOOP_SESSION_PARTITION)
      const res = await ses.fetch(url, { ...init, signal: ctrl.signal } as RequestInit)
      const out = { status: res.status, text: await res.text(), finalUrl: res.url || url }
      this.noteRisk(url, out.status, out.text)
      return out
    } catch (e) {
      // Chromium 网络栈报错(ERR_FAILED 类)时按 pandalive 同规约走 Node 兜底, 保持代理设置一致
      if (!(e instanceof Error) || !/ERR_|abort|Timeout|timeout/i.test(e.message)) throw e
      this.noteFallback(e.message, url)
      const res = await nodeHttpRequest(init.method || 'GET', url, init.headers || {}, init.body, nodeProxyUrl())
      const out = { status: res.status, text: res.text, finalUrl: url }
      this.noteRisk(url, out.status, out.text)
      return out
    } finally {
      clearTimeout(timer)
    }
  }

  /** 兜底重发的留痕(㊕): 这条日志说的是"同一个请求打了第二遍"—— 第一遍没落地, 第二遍由 Node 发出。
   *  旧写法一声不吭, 于是请求数凭空翻倍却毫无痕迹, 审计只能从"拉源成功"的计数里倒推。
   *  逐条写会在断网/DNS 黑洞期把日志刷成计数器(那一形态每请求都触发), 所以 60 秒只出声一次,
   *  静默窗口里的次数在下一句里一起报出来 */
  private fallbackCnt = 0
  private fallbackLogUntil = 0
  private noteFallback(reason: string, url: string): void {
    this.fallbackCnt++
    const now = Date.now()
    if (now < this.fallbackLogUntil) return
    this.fallbackLogUntil = now + 60_000
    const n = this.fallbackCnt
    this.fallbackCnt = 0
    logger.warn('soop', `会话请求失败(${reason}) → Node 兜底重发 ×${n}: ${url.replace(/^https?:\/\//, '').slice(0, 48)}`)
  }

  /** 风控信号只记账, 不发火(㊔): 这一站的取流链单房就有 8~10 发、降级探针每轮几十发, 任何一发撞上
   *  403/429/5xx/接口回 HTML 都是"平台在嫌我们快"。旧判据要等"整轮探针全灭"才出声 —— 而列表健康时的
   *  逐房被拦永远凑不出 covered===0, 等于这一半的失败没有保护。
   *  不抛新异常: 现有调用方对非 200 各有各的吃法(列表回落 null、取流按结果码出文案), 在这里改抛法会把
   *  一句文案的差别变成一条录制的成败 —— 由 riskCooling() 让后台的泵自己收手, 用户那一条不受牵连。
   *  515 不算: 那是 SOOP 网关的"没登录"回执, 既有链路按登录态处理; 把它记成风控等于把登出当被 ban */
  private noteRisk(url: string, status: number, text: string): void {
    // 播放页本来就是 HTML(roomPageUrl 的唯一形状 = SOOP_ORIGIN/<频道>); 接口(host 各异、路径带扩展名)回 HTML 才是验证页
    const isPage = url.startsWith(`${SOOP_ORIGIN}/`)
    const httpHit = status === 403 || status === 429 || (status >= 500 && status !== 515)
    const htmlOnApi = !isPage && text.trimStart().startsWith('<')
    if (!httpHit && !htmlOnApi) return
    if (!this.riskCooling()) logger.warn('soop', `疑似风控信号(HTTP ${status}${htmlOnApi && !httpHit ? ', 接口返回 HTML' : ''}), 后台泵收手 ${SoopApi.RISK_COOL_MS / 60_000} 分钟`)
    this.riskUntil = Date.now() + SoopApi.RISK_COOL_MS
  }

  /** 后台泵(预取/降级探针)在风控静默期收手: 冷却只由时间到点解除, 一次幸运 200 不提前解锁 */
  private riskUntil = 0
  private static RISK_COOL_MS = 5 * 60_000
  riskCooling(): boolean {
    return Date.now() < this.riskUntil
  }

  /** 全量关注 + 各自在播状态(实测 718 条 / 374KB / 无分页), 一发替代逐房探针。
   *  返回 null = 列表本轮不可用(未登录 515 / Origin 被拒 / 改版缺 data / 非 JSON / 网络异常):
   *  调用方必须整体降级到 fetchPageMeta, 绝不能把"没拿到"当成"全都下播了"。
   *  单条脏数据只丢那一条并计数进日志。 */
  /** 整表那一发的在途合并(㊕): 轮次、导入点击、立即刷新可能在同一瞬间各要一份 374KB 的同一张表,
   *  旧写法一比一发往上游打。只做合流、不做 TTL 缓存 —— 这一发是"谁在播"的真值源,
   *  给它的结果加时限等于拿"没读到"换时效; 而它每轮只有一发, 不是需要削峰的形状。
   *  null(列表不可用)同样合并: 一轮坏了而导入同时落地时, 不该把同一发坏请求打两遍。 */
  private favInflight: Promise<SoopFavoriteRow[] | null> | null = null

  async fetchFavorites(): Promise<SoopFavoriteRow[] | null> {
    if (this.favInflight) return this.favInflight
    const p = this.readFavorites().finally(() => {
      if (this.favInflight === p) this.favInflight = null
    })
    this.favInflight = p
    return p
  }

  private async readFavorites(): Promise<SoopFavoriteRow[] | null> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Origin: WEB_ORIGIN,
      // Referer 只能到 www 的"源根": 这是跨源请求(myapi ← www 页面), Chromium 按默认
      // strict-origin-when-cross-origin 只允许带 origin 级 Referer, 带完整路径会被网络层直接
      // 取消("Cancelling request ... with invalid referrer"), 白丢一次 ses.fetch 再靠 Node 兜底
      Referer: `${WEB_ORIGIN}/`,
      Accept: 'application/json, text/plain, */*',
      ...(await this.cookieHeader())
    }
    try {
      const res = await this.req(FAVORITES_API, { headers }, 20_000)
      if (res.status !== 200) {
        logger.warn('soop', `关注列表不可用(HTTP ${res.status}), 本轮回到逐房探针`)
        return null
      }
      const j = JSON.parse(res.text) as { data?: unknown }
      if (!Array.isArray(j.data)) {
        logger.warn('soop', '关注列表返回结构变更(缺 data 数组), 本轮回到逐房探针')
        return null
      }
      // 建了分组时 data 是"组内数组的数组"(前端拿完就 flat()), 无分组是一维
      const rawRows: unknown[] = j.data.some((x) => Array.isArray(x)) ? (j.data as unknown[][]).flat() : j.data
      const rows: SoopFavoriteRow[] = []
      let dropped = 0
      for (const x of rawRows) {
        const r = parseFavoriteRow(x)
        if (r) rows.push(r)
        else dropped++
      }
      if (rawRows.length && !rows.length) {
        logger.warn('soop', `关注列表 ${rawRows.length} 条全部解析失败(字段改名?), 本轮回到逐房探针`)
        return null
      }
      if (dropped) logger.warn('soop', `关注列表丢弃 ${dropped}/${rawRows.length} 条非法行`)
      // 整表这一发同时是"谁在播、场次号多少"的免费真值: 记下来给取流链路复用(㊒④),
      // 于是"列表覆盖到的房"取流时不必再为拿 nBroadNo 发一整页 HTML
      for (const r of rows) {
        if (r.live) this.bnoCache.set(r.userId, { bno: r.live.broadNo, at: Date.now() })
        else this.bnoCache.delete(r.userId) // 列表报离线: 上一场的号码不再是这一场的钥匙, 留着只会让取流白撞一次
      }
      return rows
    } catch (e) {
      logger.warn('soop', `关注列表拉取失败: ${String((e as Error).message || e)}`)
      return null
    }
  }

  // ---------- 第 1 步: 播放页元信息 ----------
  /** quiet: 轮询路径每轮每人一发, 日志由 watcher 自己按状态翻转落摘要, 这里再 info 会把日志刷爆
   *  fresh: 跳过 10 秒微缓存与在途合并 —— 探针就是要一个新读数
   *  why: 落日志用的来路名(㊕)。整页 HTML 是这条链上最贵的一发, 而"292 发页面元信息 / 103 个房"
   *       这种数只有知道来路才能判断该不该省 —— 探针、取流第一步、取流复查、加房、录制取名各是一回事 */
  async fetchPageMeta(channel: string, quiet = false, fresh = false, why = '取流'): Promise<PageMeta> {
    if (!fresh) {
      const hit = this.pageCache.get(channel)
      if (hit && Date.now() - hit.at < SoopApi.PAGE_TTL) return hit.meta
      const flying = this.pageInflight.get(channel)
      if (flying) return flying
    }
    const p = this.readPageMeta(channel, quiet, why).finally(() => {
      if (this.pageInflight.get(channel) === p) this.pageInflight.delete(channel)
    })
    if (!fresh) this.pageInflight.set(channel, p)
    return p
  }

  private async readPageMeta(channel: string, quiet: boolean, why: string): Promise<PageMeta> {
    const pageUrl = roomPageUrl(channel)
    const res = await this.req(pageUrl, { headers: { ...this.baseHeaders(pageUrl), ...(await this.cookieHeader()) } })
    if (res.status !== 200) throw new Error(mt('soop.pageHttp', { status: res.status }))
    const pathState = parsePathState(res.finalUrl)
    const page = parsePageBroadNo(res.text)
    const resolved = resolvePageBroadNo(pathState.broadNo, page.broadNo, page.found, pathState.explicitOffline)
    const meta: PageMeta = {
      channel: pathState.channel || channel,
      broadNo: resolved.broadNo,
      explicitOffline: resolved.explicitOffline,
      living: resolved.living,
      hostName: parseWindowString(res.text, 'szBjNick'),
      roomName: parseWindowString(res.text, 'szBroadTitle'),
      thumbUrl: parsePageThumb(res.text)
    }
    // 无论调用方是不是强制重读, 这一份都进微缓存: 缓存只服务"几秒内的连击复用",
    // 而探针这类要新读数的一方从不从缓存里取(上面已绕开)
    this.pageCache.set(channel, { at: Date.now(), meta })
    if (this.pageCache.size > 64) {
      for (const [k, v] of this.pageCache) if (Date.now() - v.at >= SoopApi.PAGE_TTL) this.pageCache.delete(k)
      while (this.pageCache.size > 64) this.pageCache.delete(this.pageCache.keys().next().value as string)
    }
    if (meta.living && meta.broadNo) this.bnoCache.set(channel, { bno: meta.broadNo, at: Date.now() })
    if (!quiet) logger.info('soop', `页面元信息(来源=${why}) @${channel}: pathBno=${pathState.broadNo || '-'} pageBno=${page.broadNo || '-'} found=${page.found} offline=${meta.explicitOffline} → bno=${meta.broadNo || '-'} living=${meta.living}`)
    return meta
  }

  private async postApi(form: Record<string, string>): Promise<ChannelInfo & { aid?: string }> {
    const res = await this.req(CHANNEL_API, {
      method: 'POST',
      headers: { ...this.baseHeaders(), ...(await this.cookieHeader()), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString()
    })
    if (res.status !== 200) throw new Error(mt('soop.apiHttp', { status: res.status }))
    let j: { CHANNEL?: Record<string, unknown> }
    try {
      j = JSON.parse(res.text) as { CHANNEL?: Record<string, unknown> }
    } catch {
      throw new Error(mt('soop.apiBadJson'))
    }
    const c = j.CHANNEL || {}
    const str = (k: string): string => (c[k] == null ? '' : String(c[k]))
    const raw = Array.isArray(c.VIEWPRESET) ? (c.VIEWPRESET as Record<string, unknown>[]) : []
    const presets: ViewPreset[] = raw.map((p) => ({
      label: String(p.label ?? ''),
      name: String(p.name ?? ''),
      height: Number(p.label_resolution ?? 0) || 0,
      bps: Number(p.bps ?? 0) || 0
    }))
    return {
      result: Number(c.RESULT ?? 0) || 0,
      broadNo: str('BNO'),
      hostName: str('BJNICK'),
      roomName: str('TITLE'),
      rmd: str('RMD'),
      cdn: str('CDN'),
      needPwd: str('BPWD').toUpperCase() === 'Y',
      btime: Number(c.BTIME ?? 0) || 0,
      aid: str('AID') || undefined,
      presets
    }
  }

  // ---------- 第 2 步: 房间主信息 ----------
  private async fetchChannelInfo(channel: string, broadNo: string, pwd: string): Promise<ChannelInfo> {
    return this.postApi({
      from_api: '0',
      mode: 'landing',
      player_type: 'html5',
      stream_type: 'common',
      type: 'live',
      bid: channel,
      bno: broadNo,
      pwd
    })
  }

  // ---------- 第 3 步: 清晰度凭证 ----------
  private async fetchAid(channel: string, broadNo: string, quality: string, pwd: string): Promise<{ aid: string; result: number }> {
    const info = await this.postApi({
      from_api: '0',
      mode: 'landing',
      player_type: 'html5',
      stream_type: 'common',
      type: 'aid',
      bid: channel,
      bno: broadNo,
      pwd,
      quality
    })
    return { aid: info.aid || '', result: info.result }
  }

  // ---------- 第 4 步: 调度取 view_url ----------
  private async fetchViewURL(rmd: string, cdn: string, broadNo: string, quality: string): Promise<string> {
    // RMD 可能带路径前缀, 必须按"去尾斜杠 + 拼接"处理(new URL(绝对路径, base) 会把前缀丢掉)
    const u = new URL(`${rmd.replace(/\/+$/, '')}/broad_stream_assign.html`)
    u.searchParams.set('return_type', mapCDNType(cdn))
    u.searchParams.set('broad_key', buildBroadKey(broadNo, quality))
    const res = await this.req(u.href, { headers: { ...this.baseHeaders(), ...(await this.cookieHeader()) } })
    if (res.status !== 200) throw new Error(mt('soop.assignHttp', { status: res.status }))
    let viewUrl = ''
    try {
      viewUrl = String((JSON.parse(res.text) as { view_url?: string }).view_url || '')
    } catch {
      throw new Error(mt('soop.assignBadJson'))
    }
    if (!viewUrl) throw new Error(mt('soop.assignNoUrl', { cdn, quality }))
    return viewUrl
  }

  /** 清晰度倒序: 接口给的是低→高, 默认档必须落在最高画质 */
  private sortPresets(presets: ViewPreset[]): ViewPreset[] {
    return [...presets].sort((a, b) => (b.height - a.height) || (b.bps - a.bps) || b.label.localeCompare(a.label))
  }

  /** 列表或上一发页面给的在场场次号, 过期即当没读到过(回落到读整页那条既有链路) */
  private freshBroadNo(channel: string): string {
    const hit = this.bnoCache.get(channel)
    if (!hit) return ''
    if (Date.now() - hit.at >= SoopApi.BNO_TTL) {
      this.bnoCache.delete(channel)
      return ''
    }
    return hit.bno
  }

  /** ㊘(R28-4): 这一间手上有没有"还活着的场次号" —— 预取泵用它判断要不要先买一整页。
   *  这本账不需要额外的写入点: 列表整表(:718)与任何一次真读到的页面(:770)都已经在写它 */
  hasBroadNo(channel: string): boolean {
    return Boolean(this.freshBroadNo(channel))
  }

  async fetchPlay(channel: string, password = '', fullVariants = true): Promise<PlayResult> {
    // ㊔: fullVariants=false 只解最高档(预取泵用的省发型)。这一路的成本不是"一发":
    // 每个清晰度要 1 发 aid + 1 发 broad_stream_assign(实测档位=4 ⇒ 单房 4 页/整链 8~10 发),
    // 而后台预取的房间用户多半根本不会点进去 —— 按档位扇出等于为一份没人看的菜单付全额。
    // 真进房(ipc livePlay)与录制现拉都走完整档, 于是菜单与备用线路的读数与旧行为一字不差。
    // ㊒④: 关注列表那一发本来就带着 broad_no, 取流第一发的整页 HTML 只为它而发 —— 有号就直接进第 2 步
    const known = this.freshBroadNo(channel)
    if (known) {
      const r = await this.runPlayChain(channel, password, { channel, broadNo: known, explicitOffline: false, living: true, hostName: '', roomName: '', thumbUrl: '' }, fullVariants)
      // 成功最好; "要密码/要登录"与场次号无关, 照原样回报; 其余失败才回读整页, 让页面那句话来定性
      if (r.ok || r.needPassword || r.needLogin) return r
      logger.info('soop', `复用列表场次号未成功(${r.error || '未知'}), 回读播放页核对 @${channel}`)
      this.bnoCache.delete(channel)
      // ㊘(R28-2): 这一发不再是 fresh —— 它问的是"这一页怎么说", 而十秒内刚读过的那一页就是最新读数
      // (探针/上一次链都写在 pageCache 里)。旧写法把微缓存与在途合并一并绕过, 于是探针几秒前买过的那一页
      // 在这里被原样重买; 它要的三个判据(living/号码变没变/那句话)一页 HTML 里都齐, 十秒的窗口换不来新信息
      const m = await this.fetchPageMeta(channel, false, false, '取流复查')
      // 页面说没在播 = 那一场已经断了(原判据由整链头部给出); 号码变了 = 新一场, 用新号重走;
      // 页面说在播且号码没变 = 失败与场次号无关, 原样回报即可, 不重打整链
      if (!m.living || m.broadNo !== known) return this.runPlayChain(channel, password, m, fullVariants)
      return r
    }
    const meta = await this.fetchPageMeta(channel)
    return this.runPlayChain(channel, password, meta, fullVariants)
  }

  private async runPlayChain(channel: string, password: string, meta: PageMeta, fullVariants = true): Promise<PlayResult> {
    if (!meta.living) {
      if (meta.explicitOffline) return { ok: false, error: mt('soop.offline') }
      return { ok: false, error: mt('soop.noBno') }
    }

    let info = await this.fetchChannelInfo(channel, meta.broadNo, password)
    // 实测 -6 有两种成因: 从没登录过 / 会话已过期。后者能在后台自愈 —— 托管了账密就重登一次并当场重试
    if (info.result === RESULT_LOGIN && (await this.tryAutoLogin())) {
      logger.info('soop', `自动重登成功, 当场重试拉流 @${channel}`)
      info = await this.fetchChannelInfo(channel, meta.broadNo, password)
    }
    if (info.result === RESULT_LOGIN) {
      const pack: PlayResult = { ok: false, needLogin: true, error: mt('soop.needLogin') }
      // ㊘(R28-5): 没有托管账密时这一句是"这一房此刻取不到源"的终局回答 —— 记进门槛账,
      // 15 分钟内不再替同一个房间重打整链。托管了账密的不在账内: 上面 tryAutoLogin 只受 60 秒冷却管着,
      // 下一发就可能自愈, 记账等于把登录态锁死在墙上
      if (!this.canAutoRelogin()) this.noteGate(channel, pack)
      return pack
    }
    if (info.needPwd && !password) {
      // 密码房而这一路没有密码(预取泵永远没有密码): 整链的其余 8~9 发都是白付, 记一笔
      const pack: PlayResult = { ok: false, needPassword: true, error: mt('soop.pwRequired') }
      this.noteGate(channel, pack)
      return pack
    }
    // 密码房 + 已交过一发密码 + 平台仍不给播放信息: 只可能是密码不对。必须报成"可重填"的形态,
    // 否则会把它当笼统接口失败 —— 用户看到的是"SOOP 拒绝返回播放信息", 既不知错在哪也无从重试
    if (info.result !== RESULT_OK) {
      if (info.needPwd) return { ok: false, needPassword: true, error: mt('soop.pwWrong') }
      return { ok: false, error: mt('soop.playResult', { why: explainResult(info.result) }) }
    }
    if (!info.broadNo || !info.rmd) return { ok: false, error: mt('soop.incomplete') }

    // 代理起不来就直接判死: 裸上游地址带不走 Cookie/Origin, 播放器与 ffmpeg 必定 403,
    // 而且这个"看着有效"的源会被缓存并点亮「秒开」徽标 —— 静默降级等于把故障藏进缓存里
    const proxy = await this.hls().catch((e) => {
      logger.warn('soop', `本地 HLS 代理启动失败 @${channel}: ${String((e as Error).message || e)}`)
      return null
    })
    if (!proxy) return { ok: false, error: mt('soop.proxyFail') }
    const allPresets = this.sortPresets(info.presets).filter((p) => p.name && p.name.toLowerCase() !== 'auto')
    // ㊔: 省发型只解最高档 —— 清晰度菜单上的其余档位是"没人点就不必买"的(每档 2 发)
    // ㊙(R29-4): 要满档的这一条先接上"同一场已经买过的档"(预取那条省发型链留下的), 只补差档。
    // 现场实拍 @ahfotlrp0675: 14:05:07 预取 bno=297557133 档位=1, 14:07:26 用户进房 ⇒ 旧规则认定那份
    // partial 不能给满档 caller(判得对), 于是整条链重打, 连最高档那 2 发也原样重买了一遍
    const reuse: { name: string; variant: VariantInfo }[] = []
    if (fullVariants && !password) {
      const e = this.partialBuy.get(channel)
      if (e && e.bno === info.broadNo) {
        for (const b of e.bought) {
          // 只对"前缀对得上"的那一段负责: 平台中途换了菜单名字, 对不上的那档就当没买过、照买
          if (allPresets.findIndex((p) => p.name === b.name) !== reuse.length) break
          reuse.push(b)
        }
      }
    }
    const want = fullVariants ? allPresets : allPresets.slice(0, 1)
    const presets = want.filter((p) => !reuse.some((b) => b.name === p.name))
    const variants: VariantInfo[] = reuse.map((b) => b.variant)
    const bought: { name: string; variant: VariantInfo }[] = []
    for (const p of presets) {
      try {
        let { aid, result } = await this.fetchAid(channel, info.broadNo, p.name, password)
        // AID 这一发同样会因会话过期回 -6(实测公开房只在此步要登录态): 后台重登后只重试一次
        if (result === RESULT_LOGIN && (await this.tryAutoLogin())) {
          const retry = await this.fetchAid(channel, info.broadNo, p.name, password)
          aid = retry.aid
          result = retry.result
        }
        if (result !== RESULT_OK || !aid) {
          logger.warn('soop', `AID 申请失败 @${channel} quality=${p.name}: ${explainResult(result)}`)
          continue
        }
        const viewUrl = await this.fetchViewURL(info.rmd, info.cdn, info.broadNo, p.name)
        const up = new URL(viewUrl)
        up.searchParams.set('aid', aid)
        const variant: VariantInfo = {
          url: proxy.playlistUrl(up.href),
          bandwidth: p.bps * 1000,
          resolution: p.height ? `${p.height}p` : p.name,
          label: p.label || p.name
        }
        variants.push(variant)
        bought.push({ name: p.name, variant })
      } catch (e) {
        logger.warn('soop', `清晰度取流失败 @${channel} quality=${p.name}: ${String((e as Error).message || e)}`)
      }
    }
    if (!variants.length) {
      // 密码房的 AID 这一发才真验密码: 密码不对时平台不给任何一档(主信息那步照样回 OK)
      if (info.needPwd && password) return { ok: false, needPassword: true, error: mt('soop.pwWrong') }
      return { ok: false, error: mt('soop.noStream') }
    }

    // ㊙(R29-4) 省发型链买到的档记进复用账(带密码的那一条不记: 预取泵永远没有密码, 而这一格只按频道记账);
    // 满档链一旦落地, 缓存从此不缺档 ⇒ 摘账
    if (!fullVariants && !password && allPresets.length > 1) this.partialBuy.set(channel, { bno: info.broadNo, bought })
    if (fullVariants) this.partialBuy.delete(channel)
    logger.info(
      'soop',
      `拉源成功 @${channel}: 档位=${variants.length}${fullVariants ? '' : '(只解最高档)'}${reuse.length ? ` 复用已买档=${reuse.length}(省 ${reuse.length * 2} 发)` : ''} bno=${info.broadNo} cdn=${info.cdn}`
    )
    // 开播时刻: 播放页整页没有任何时间串, 列表接口才有 broad_start —— 这里用 CHANNEL.BTIME(已播秒数)反推,
    // 零额外请求(这一发本来就要打)。取不到就留空, 不写臆造值
    const startTime = info.btime > 0 ? kstClock(Date.now() - info.btime * 1000) : ''
    return {
      ok: true,
      m3u8: variants[0].url,
      variants,
      // 只解了最高档 ⇒ 这份源包不完整(卡片照算有源, 清晰度菜单等真进房补齐); 平台本来就只给一档时不算残缺
      // ㊙(R29-4): 满档链也要说实话 —— 接上复用账之后"其余档一档没买到"不再会让整包为空, 旧判据会把它写成满档
      partial: allPresets.length > 1 && variants.length < allPresets.length,
      // 分段与清单都由本地代理带头, ffmpeg 侧不再需要注入 SOOP 头
      dlHeaders: {},
      title: info.roomName || meta.roomName,
      nick: info.hostName || meta.hostName,
      startTime,
      // GRADE 的分级语义未实测(要 19+ 房样本才敢映射), 不臆断为成人房 —— 也就不写这一格:
      // 补一个 isAdult: false 是"知道它没有", 而这一路从没看到过这一格; SOOP 自此全链路不带房间级 19+(见 parseFavoriteRow)
      media: { title: info.roomName || meta.roomName, userNick: info.hostName || meta.hostName, liveType: 'live', isPw: info.needPwd, startTime }
    }
  }

  // ---------- 拉源缓存: 与 pandalive 同策(不按取用时间过期, 只认显式作废 + 年龄收手) ----------
  /** 作废纪元(㊒㊓①): 每次显式作废 +1, 在飞的链写入前比对纪元 ——
   *  不比对时"下播/换号作废"会被一条先于它发出的链复活(缓存复活 = 读数复活) */
  private playEpoch = new Map<string, number>()
  private playEpochAll = 0
  private epochOf(channel: string): number {
    return this.playEpochAll + (this.playEpoch.get(channel) || 0)
  }
  private bumpEpoch(channel: string): void {
    this.playEpoch.set(channel, (this.playEpoch.get(channel) || 0) + 1)
  }

  // ---- 门槛回执的账(㊘ R28-5, 抄 Panda ㊔ 那本): 平台明说过不去的那一类, 一段时间内不再替它重打整链 ----
  /** 只收两类不会自己好的回答: "要登录且没托管账密可重登" / "这房要密码而这一路没有密码"。
   *  密码不对(下一次可能改对)与登录态可自愈(60s 冷却后再来)都不记账 —— 与 Panda GATE_CODES 同一取舍。
   *  一次进房的代价在这里是 9~10 发(bnoCache 未命中时还要多一整页), 而旧写法只缓存 r.ok,
   *  于是被拒的那一句从来没有落进任何账: 同一间每点一次就重打一遍整链 */
  private gates = new Map<string, { until: number; pack: PlayResult }>()
  private static GATE_TTL_MS = 15 * 60_000

  private noteGate(channel: string, pack: PlayResult): void {
    this.gates.set(channel, { until: Date.now() + SoopApi.GATE_TTL_MS, pack })
  }

  /** 事件解除: 开播/作废/换号/带密码来/手动强刷都该重新问一次平台 */
  private dropGate(channel: string): void {
    this.gates.delete(channel)
  }

  async getPlayCached(channel: string, password = '', forceFresh = false, fullVariants = false): Promise<PlayResult> {
    // 在途键同时表达密码槽位与扇出档级(㊔): 把"要全档"的 caller 合进一条只解最高档的在途链,
    // 等于塞给它一份残缺的清晰度菜单 —— 宁可各走一条链(最多多 4 发, 且只在预取与进房撞在同一瞬时的窄口上)
    const key = `${channel}${password ? '#pw' : ''}${fullVariants ? '' : '#top'}`
    if (!forceFresh) {
      const c = this.playCache.get(channel)
      // 命中规则(㊔): 只要最高档的那一方, 手里这份是不是满档都够用(满档包含最高档);
      // 要满档菜单的那一方, 一份只解了最高档的包绝不能给它 —— 那就是"清晰度菜单缺档"而不是"秒开"
      if (c && c.ok && (!fullVariants || !c.partial)) return c
      // 门槛账短路(㊘ R28-5): 带密码来的那一次不看账(密码本身就是新信息), 手动强刷同样绕开 ——
      // 与 Panda 的 `&& !password` + forceFresh 双豁免同规约；放在在途合并之前, 免得排着队的房再去撞一条注定被拒的链
      const g = this.gates.get(channel)
      if (g && g.until > Date.now() && !password) return { ...g.pack }
      const flying = this.playInflight.get(key)
      if (flying) return flying
    }
    const e0 = this.epochOf(channel)
    const p = (async () => {
      try {
        const r = await this.fetchPlay(channel, password, fullVariants)
        // 纪元不合 = 这条链出发后被作废过: 结果照还给调用方, 但不落缓存
        if (r.ok && this.epochOf(channel) === e0) {
          r.fetchedAt = Date.now()
          this.playCache.set(channel, r)
          this.deadStreak.delete(channel) // 新源在手: 上一源的判死计数作废
          broadcastSrcCache()
        }
        return r
      } finally {
        this.playInflight.delete(key)
      }
    })()
    this.playInflight.set(key, p)
    return p
  }

  /** 种一枚刚现拉到的有效源(㊓②): 续录复用中断探针那一发, 不再打第二条完整取流链 */
  seedPlay(channel: string, pack: PlayResult): void {
    if (!pack.ok) return
    pack.fetchedAt = Date.now()
    this.playCache.set(channel, pack)
    this.deadStreak.delete(channel)
    broadcastSrcCache()
  }

  invalidatePlay(channel: string): void {
    this.bumpEpoch(channel)
    this.playCache.delete(channel)
    this.dropGate(channel) // ㊘: 事件(重开播/收尸/手动强刷)一发生就该重新问一次平台, 门槛账只许活到下一个事件
    // 在飞的几条(带密/不带密 × 全档/只最高档, ㊔)一并摘掉: 留着等于让新 caller 合进一条注定作废的链, 复活走后门
    for (const pw of ['', '#pw']) for (const fan of ['', '#top']) this.playInflight.delete(`${channel}${pw}${fan}`)
    this.deadStreak.delete(channel)
    this.partialBuy.delete(channel) // ㊙(R29-4): 事件一落地, 旧那一场买过的档就不再是"同一场"的档
    broadcastSrcCache()
  }

  /** 上游清单判死(403/404)→ 找出是哪个房间的源并收尸。
   *  连续两次才收(与 Panda 保活同规约): 单次可能是 CDN 抖动, 误杀好源的代价是白重铸一轮五步链。
   *  缓存条目本来就极少(只在播且被点开的房间), 直接扫比再维护一张 上游→房间 表划算 */
  private deadStreak = new Map<string, number>()
  private onUpstreamDead(target: string, status: number): void {
    const local = this.proxy?.playlistUrl(target)
    if (!local) return
    for (const [channel, pack] of this.playCache) {
      if (!pack.ok) continue
      if (pack.m3u8 !== local && !pack.variants?.some((v) => v.url === local)) continue
      const n = (this.deadStreak.get(channel) || 0) + 1
      if (n < 2) {
        this.deadStreak.set(channel, n)
        logger.warn('soop', `直播源上游异常(${status}), 再犯一次即收尸: @${channel}`)
        return
      }
      logger.warn('soop', `直播源上游已死(${status}), 源收尸: @${channel}`)
      this.invalidatePlay(channel)
      return
    }
  }

  clearPlayCache(): void {
    this.playEpochAll++ // 换号/登出: 所有在飞的链一律不许落缓存
    this.playCache.clear()
    this.playInflight.clear()
    this.deadStreak.clear()
    this.partialBuy.clear() // ㊙(R29-4): 上一号买过的档对这一个账号不成立(账号不同 ⇒ 能买的档与 aid 都不同)
    this.gates.clear() // ㊘: 上一个账号的"要登录/要密码"对这一个账号毫无意义(与 Panda 换号清账同语义)
    this.riskUntil = 0 // 上一号的风控静默不该闷住新账号的泵(与 Panda 熔断随换号撤退同语义)
    broadcastSrcCache()
  }

  /** 源缓存的年龄收手(㊕): SOOP 没有心跳可打, 但同一句话说得通 —— 缓存里那份是带签名的地址,
   *  放着不管就是"徽标亮着而流已死"。时限抄 Panda 那两档(未关注的回访客 10 分钟 / 已下播 30 分钟),
   *  在播且仍在关注表的源不限年龄: 下播翻转与上游判死已经各自会收尸, 时限再掐长场次只会多打一条整链。
   *  这一趟只扫内存, 零网络。 */
  private static CACHE_GUEST_TTL = 10 * 60_000
  private static CACHE_OFFLINE_TTL = 30 * 60_000
  private cacheSweepTimer: NodeJS.Timeout | null = null

  startCacheSweep(): void {
    if (this.cacheSweepTimer) return
    const loop = (): void => {
      this.sweepPlayCache()
      this.cacheSweepTimer = setTimeout(loop, 60_000)
    }
    this.cacheSweepTimer = setTimeout(loop, 60_000)
  }

  /** 按年龄收手: 返回这一趟出队的源数。没有年龄读数的(不是经缓存写入路径来的包)不收 —— 宁漏一次清理也不误杀 */
  sweepPlayCache(): number {
    const anchors = new Map(store.listAnchors().map((a) => [roomKey(a.platform, a.userId), a]))
    let dropped = 0
    for (const [channel, pack] of [...this.playCache.entries()]) {
      if (!pack.fetchedAt) continue
      const age = Date.now() - pack.fetchedAt
      const a = anchors.get(roomKey('soop', channel))
      if (!a) {
        if (age <= SoopApi.CACHE_GUEST_TTL) continue
        logger.info('soop', `源缓存收手: @${channel} 不在关注表且已过宽限, 源出队`)
      } else {
        if (a.isLive || age <= SoopApi.CACHE_OFFLINE_TTL) continue
        logger.info('soop', `源缓存收手: @${channel} 已下播且源挂了 ${Math.round(age / 60_000)} 分钟, 源出队`)
      }
      this.invalidatePlay(channel)
      dropped++
    }
    return dropped
  }

  /** 已获取有效直播源的房间主键集(卡片「已缓存」徽标的事实源, 与 pandalive 汇成一个列表) */
  cachedSourceIds(): string[] {
    return [...this.playCache.entries()].filter(([, v]) => v.ok).map(([k]) => roomKey('soop', k))
  }
}

// 会话分区与缓存列表向 pandalive 侧登记: 代理设置/已缓存徽标广播都要覆盖 SOOP
registerProxyPartition(SOOP_SESSION_PARTITION)
registerSrcCacheProvider(() => soopApi.cachedSourceIds())

export const soopApi = new SoopApi()
