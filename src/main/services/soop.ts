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
import { roomKey } from '../../shared/types'
import { UA } from '../util'
import { logger } from './logger'
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
const RESULT_OK = 1
const RESULT_LOGIN = -6
const RESULT_EMPTY = 0
const RESULT_BLOCK = -2
/** Cookie 分散在四个子域(实测登录链路回吐), 取单域必漏 */
const COOKIE_HOSTS = ['https://play.sooplive.com', 'https://login.sooplive.com', 'https://live.sooplive.com', 'https://afevent2.sooplive.com']
/** 实测站点自己的 Cookie 全挂在这个域下, 四子域共用; 手工导入的 Cookie 也按它落罐 */
const COOKIE_DOMAIN = '.sooplive.com'
/** 账密托管键(secrets.dat, safeStorage 加密): 密码只在主进程解出, 不进 db.json/不回显渲染层 */
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

  /** 本地 HLS 代理单实例: 所有房间/清晰度共用一个回环端口, 靠 ?url= 参数分流 */
  private async hls(): Promise<HlsProxy> {
    if (this.proxy) {
      await this.proxy.listen()
      return this.proxy
    }
    const p = new HlsProxy({
      sessionPartition: SOOP_SESSION_PARTITION,
      headers: async () => ({ ...this.baseHeaders(), ...(await this.cookieHeader()) }),
      // SOOP 没有源保活泵: 上游清单判死是唯一的死源探测口, 不收尸就会留死源骗「已缓存」徽标
      onDeadUpstream: (target, status) => this.onUpstreamDead(target, status)
    })
    await p.listen()
    this.proxy = p
    return p
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
   *  (实测 Chromium 会忽略手工 Cookie 头而优先用罐内同域 Cookie, 所以登录态必须落罐) */
  async storeCookies(cookieStr: string): Promise<number> {
    const jar = parseCookieString(cookieStr)
    const ses = session.fromPartition(SOOP_SESSION_PARTITION)
    for (const [name, value] of Object.entries(jar)) {
      await ses.cookies.set({ url: SOOP_ORIGIN, name, value, domain: COOKIE_DOMAIN, path: '/', secure: true, sameSite: 'no_restriction' })
    }
    this.invalidateCookieCache()
    this.loginCache.clear()
    this.clearPlayCache() // 新会话生效: 旧会话签发的源一律作废
    return Object.keys(jar).length
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

  private async req(url: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }, timeoutMs = 15_000): Promise<{ status: number; text: string; finalUrl: string }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const ses = session.fromPartition(SOOP_SESSION_PARTITION)
      const res = await ses.fetch(url, { ...init, signal: ctrl.signal } as RequestInit)
      return { status: res.status, text: await res.text(), finalUrl: res.url || url }
    } catch (e) {
      // Chromium 网络栈报错(ERR_FAILED 类)时按 pandalive 同规约走 Node 兜底, 保持代理设置一致
      if (!(e instanceof Error) || !/ERR_|abort|Timeout|timeout/i.test(e.message)) throw e
      const res = await nodeHttpRequest(init.method || 'GET', url, init.headers || {}, init.body, nodeProxyUrl())
      return { status: res.status, text: res.text, finalUrl: url }
    } finally {
      clearTimeout(timer)
    }
  }

  // ---------- 第 1 步: 播放页元信息 ----------
  /** quiet: 轮询路径每轮每人一发, 日志由 watcher 自己按状态翻转落摘要, 这里再 info 会把日志刷爆 */
  async fetchPageMeta(channel: string, quiet = false): Promise<PageMeta> {
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
    if (!quiet) logger.info('soop', `页面元信息 @${channel}: pathBno=${pathState.broadNo || '-'} pageBno=${page.broadNo || '-'} found=${page.found} offline=${meta.explicitOffline} → bno=${meta.broadNo || '-'} living=${meta.living}`)
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

  async fetchPlay(channel: string, password = ''): Promise<PlayResult> {
    const meta = await this.fetchPageMeta(channel)
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
    if (info.result === RESULT_LOGIN) return { ok: false, needLogin: true, error: mt('soop.needLogin') }
    if (info.needPwd && !password) return { ok: false, needPassword: true, error: mt('soop.pwRequired') }
    if (info.result !== RESULT_OK) return { ok: false, error: mt('soop.playResult', { why: explainResult(info.result) }) }
    if (!info.broadNo || !info.rmd) return { ok: false, error: mt('soop.incomplete') }

    const proxy = await this.hls().catch(() => null)
    const presets = this.sortPresets(info.presets).filter((p) => p.name && p.name.toLowerCase() !== 'auto')
    const variants: VariantInfo[] = []
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
        variants.push({
          url: proxy ? proxy.playlistUrl(up.href) : up.href,
          bandwidth: p.bps * 1000,
          resolution: p.height ? `${p.height}p` : p.name,
          label: p.label || p.name
        })
      } catch (e) {
        logger.warn('soop', `清晰度取流失败 @${channel} quality=${p.name}: ${String((e as Error).message || e)}`)
      }
    }
    if (!variants.length) return { ok: false, error: mt('soop.noStream') }

    logger.info('soop', `拉源成功 @${channel}: 档位=${variants.length} bno=${info.broadNo} cdn=${info.cdn}`)
    // 开播时刻: 播放页整页没有任何时间串, 列表接口才有 broad_start —— 这里用 CHANNEL.BTIME(已播秒数)反推,
    // 零额外请求(这一发本来就要打)。取不到就留空, 不写臆造值
    const startTime = info.btime > 0 ? kstClock(Date.now() - info.btime * 1000) : ''
    return {
      ok: true,
      m3u8: variants[0].url,
      variants,
      // 分段与清单都由本地代理带头, ffmpeg 侧不再需要注入 SOOP 头
      dlHeaders: {},
      title: info.roomName || meta.roomName,
      nick: info.hostName || meta.hostName,
      startTime,
      // GRADE 的分级语义未实测(要 19+ 房样本才敢映射), 不臆断为成人房
      media: { title: info.roomName || meta.roomName, userNick: info.hostName || meta.hostName, liveType: 'live', isPw: info.needPwd, isAdult: false, startTime }
    }
  }

  // ---------- 拉源缓存: 与 pandalive 同策(不设 TTL, 仅显式作废) ----------
  async getPlayCached(channel: string, password = '', forceFresh = false): Promise<PlayResult> {
    const key = password ? `${channel}#pw` : channel
    if (!forceFresh) {
      const c = this.playCache.get(channel)
      if (c && c.ok) return c
      const flying = this.playInflight.get(key)
      if (flying) return flying
    }
    const p = (async () => {
      try {
        const r = await this.fetchPlay(channel, password)
        if (r.ok) {
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

  invalidatePlay(channel: string): void {
    this.playCache.delete(channel)
    this.deadStreak.delete(channel)
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
    this.playCache.clear()
    broadcastSrcCache()
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
