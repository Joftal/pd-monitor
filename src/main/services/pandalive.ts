import { net, session } from 'electron'
import * as http from 'http'
import * as https from 'https'
import * as tls from 'tls'
import * as net2 from 'net'
import { UA, sleep } from '../util'
import { vault, CookieJar } from './vault'

// ============ pandalive API 客户端 ============
// - 全局限速队列(串行 + 最小间隔 + 抖动), 防 IP 风控
// - 请求走 Electron net(Chromium 网络栈), 代理经 session.setProxy 生效
// - Cookie 由 vault(DPAPI 加密) 持久化
// - 风控特征识别 -> RiskError, 供 watcher 熔断
// ==================================================

const API = 'https://api.pandalive.co.kr'
export const SESSION_PARTITION = 'persist:pl'

export class RiskError extends Error {
  constructor(
    message: string,
    public readonly status = 0
  ) {
    super(message)
    this.name = 'RiskError'
  }
}

export interface LiveItem {
  userId: string
  userIdx: number
  userNick: string
  title: string
  isAdult: boolean
  isPw: boolean
  type: string
  liveType: string
  user: number
  likeCnt: number
  fanCnt: number
  bookmarkCnt: number
  playCnt: number
  startTime: string
  isLive: boolean
  thumbUrl: string
  userImg: string
}

export interface PlayResult {
  ok: boolean
  needPassword?: boolean
  error?: string
  m3u8?: string
  /** 解析 master 得到的变体分档(带宽降序, 第一个为最高档) */
  variants?: VariantInfo[]
  hlsBackups?: string[]
  title?: string
  nick?: string
  thumbUrl?: string
  userImg?: string
  media?: Record<string, unknown>
}

export interface VariantInfo {
  url: string
  bandwidth: number
  resolution: string
}

interface QueueJob<T> {
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

let nodeProxyUrl = ''

export function applyProxy(proxyUrl: string): void {
  const ses = session.fromPartition(SESSION_PARTITION)
  const url = (proxyUrl || '').trim()
  nodeProxyUrl = url
  if (url) {
    void ses.setProxy({ proxyRules: url })
  } else {
    void ses.setProxy({ mode: 'direct' })
  }
}

// ---- Node 原生请求(兜底通道): 支持 http 代理 CONNECT 隧道 ----
interface NodeResp {
  status: number
  text: string
  setCookies: string[]
}

function doHttpsRequest(
  method: 'GET' | 'POST',
  u: URL,
  headers: Record<string, string>,
  body: string | undefined,
  sock?: net2.Socket | tls.TLSSocket
): Promise<NodeResp> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method,
        host: u.hostname,
        path: u.pathname + u.search,
        headers,
        agent: false,
        timeout: 20000,
        ...(sock ? { createConnection: () => sock } : {})
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf-8'),
            setCookies: res.headers['set-cookie'] || []
          })
        )
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function nodeHttpRequest(
  method: 'GET' | 'POST',
  urlStr: string,
  headers: Record<string, string>,
  body: string | undefined,
  proxyStr: string
): Promise<NodeResp> {
  const u = new URL(urlStr)
  if (!proxyStr) return doHttpsRequest(method, u, headers, body)

  // 经 HTTP 代理建立 CONNECT 隧道
  const p = proxyStr.includes('://') ? new URL(proxyStr) : new URL('http://' + proxyStr)
  const proxyAuth = p.username
    ? 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64')
    : ''
  const tlsSock = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const conn = http.request({
      host: p.hostname,
      port: Number(p.port) || 80,
      method: 'CONNECT',
      path: `${u.hostname}:443`,
      timeout: 15000,
      ...(proxyAuth ? { headers: { 'Proxy-Authorization': proxyAuth } } : {})
    })
    conn.on('timeout', () => conn.destroy(new Error('代理连接超时')))
    conn.on('connect', (res, sock) => {
      if (res.statusCode !== 200) {
        sock.destroy()
        reject(new Error(`代理 CONNECT 失败: HTTP ${res.statusCode}`))
        return
      }
      const s = tls.connect({ socket: sock, servername: u.hostname })
      s.on('secureConnect', () => resolve(s))
      s.on('error', reject)
    })
    conn.on('error', reject)
    conn.end()
  })
  return doHttpsRequest(method, u, headers, body, tlsSock)
}

class PandaApi {
  /** 拉取任意绝对 URL 文本(带 pandalive Origin/Referer, 经 session/代理/Node 兜底) */
  private async fetchText(url: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Origin: 'https://www.pandalive.co.kr',
      Referer: 'https://www.pandalive.co.kr/'
    }
    if (this.hasSession()) headers['Cookie'] = this.cookieHeader
    const ses = session.fromPartition(SESSION_PARTITION)
    try {
      const sesFetch = (ses as unknown as { fetch?: typeof net.fetch }).fetch
      const res = sesFetch ? await sesFetch.call(ses, url, { headers }) : await net.fetch(url, { headers })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      const res = await nodeHttpRequest('GET', url, headers, undefined, nodeProxyUrl)
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      return res.text
    }
  }

  /** 解析 master m3u8, 取变体分档列表(带宽降序); 取不到时回退为 master 本身 */
  async fetchVariants(masterUrl: string): Promise<VariantInfo[]> {
    try {
      const text = await this.fetchText(masterUrl)
      const lines = text.split('\n')
      const out: VariantInfo[] = []
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (!l.startsWith('#EXT-X-STREAM-INF')) continue
        const bw = Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] || 0)
        const res = /RESOLUTION=(\d+x\d+)/.exec(l)?.[1] || ''
        // 下一行非注释即分档地址
        for (let j = i + 1; j < lines.length; j++) {
          const v = lines[j].trim()
          if (!v) continue
          if (v.startsWith('#')) break
          out.push({ url: new URL(v, masterUrl).href, bandwidth: bw, resolution: res })
          break
        }
      }
      out.sort((a, b) => b.bandwidth - a.bandwidth)
      if (out.length) return out
    } catch (e) {
      console.warn('fetchVariants failed, fallback to master:', String(e))
    }
    return [{ url: masterUrl, bandwidth: 0, resolution: 'master' }]
  }

  private jar: CookieJar = {}
  private queue: QueueJob<unknown>[] = []
  private pumping = false
  gapMs = 1200
  cookieValid = false

  setGap(ms: number): void {
    this.gapMs = Math.max(300, ms)
  }

  // ---------- cookie ----------
  restoreCookies(): void {
    const jar = vault.load()
    if (jar) this.jar = jar
  }

  saveCookies(): void {
    vault.save(this.jar)
  }

  clearCookies(): void {
    this.jar = {}
    vault.clear()
    this.clearPlayCache() // 登出/换号: 旧账号签发的源凭证全部作废
  }

  hasSession(): boolean {
    return Boolean(this.jar['sessKey'])
  }

  private harvestCookies(setCookies: string[]): void {
    let changed = false
    for (const c of setCookies) {
      const pair = c.split(';')[0]
      const i = pair.indexOf('=')
      if (i > 0) {
        this.jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
        changed = true
      }
    }
    if (changed && this.hasSession()) this.saveCookies()
  }

  private cookieHeaderOf(jar: CookieJar): string {
    return Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  get cookieHeader(): string {
    return this.cookieHeaderOf(this.jar)
  }

  private harvest(res: { headers: Headers }): void {
    this.harvestCookies(res.headers.getSetCookie?.() ?? [])
  }

  // ---------- 限速队列 ----------
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: fn, resolve, reject } as QueueJob<unknown>)
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    while (this.queue.length) {
      const job = this.queue.shift()!
      try {
        const v = await job.run()
        job.resolve(v)
      } catch (e) {
        job.reject(e)
      }
      const jitter = this.gapMs * (0.7 + Math.random() * 0.6)
      await sleep(jitter)
    }
    this.pumping = false
  }

  // ---------- 底层请求 ----------
  private async rawFetch(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
    extraHeaders: Record<string, string> = {},
    jarOverride?: CookieJar
  ): Promise<{ status: number; text: string }> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Origin: 'https://www.pandalive.co.kr',
      Referer: 'https://www.pandalive.co.kr/',
      'x-device-info': '{"t":"webPc","v":"1.0","ui":24631221}',
      ...extraHeaders
    }
    const useJar = jarOverride ?? this.jar
    if (useJar['sessKey']) headers['Cookie'] = this.cookieHeaderOf(useJar)
    let body: string | undefined
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(form).toString()
    }
    const ses = session.fromPartition(SESSION_PARTITION)
    // 优先用 session.fetch(走该 session 的代理配置); Chromium 网络栈对个别端点
    // (/v1/member/login 的多 Set-Cookie 响应) 会触发 net::ERR_FAILED, 回退 Node fetch
    let status: number
    let text: string
    try {
      const sesFetch = (ses as unknown as { fetch?: typeof net.fetch }).fetch
      const res = sesFetch
        ? await sesFetch.call(ses, API + path, { method, headers, body })
        : await net.fetch(API + path, { method, headers, body })
      if (!jarOverride) this.harvest(res)
      status = res.status
      text = await res.text()
    } catch (e) {
      if (e instanceof Error && e.message.includes('ERR_FAILED')) {
        // 兜底: Node 原生请求(支持代理 CONNECT 隧道, 与设置页代理一致)
        const res = await nodeHttpRequest(method, API + path, headers, body, nodeProxyUrl)
        if (!jarOverride) this.harvestCookies(res.setCookies)
        status = res.status
        text = res.text
      } else {
        throw e
      }
    }
    if (status === 403 || status === 429) throw new RiskError(`HTTP ${status} (可能被风控)`, status)
    if (status >= 500) throw new RiskError(`HTTP ${status} 服务器错误`, status)
    if (text.trimStart().startsWith('<')) throw new RiskError('返回HTML(疑似风控验证页)', status)
    return { status, text }
  }

  private parseText<T>(text: string): T {
    try {
      return JSON.parse(text) as T
    } catch {
      if (text === '' || text === '""') return {} as T
      throw new RiskError('响应不是JSON(疑似风控)')
    }
  }

  private async json<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    return this.enqueue(async () => {
      const { text } = await this.rawFetch(method, path, form)
      return this.parseText<T>(text)
    })
  }

  /** 绕过限速队列的紧急请求(如录制刷新URL), 仍走风控检测 */
  async jsonPriority<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    const { text } = await this.rawFetch(method, path, form)
    return this.parseText<T>(text)
  }

  // ---------- 业务接口 ----------
  async login(loginId: string, password: string): Promise<{ ok: boolean; message: string }> {
    await this.enqueue(async () => {
      // 登录接口返回空字符串, 成功以 Set-Cookie(sessKey) 为准
      await this.rawFetch('POST', '/v1/member/login', { loginId, password })
      return null
    })
    if (!this.hasSession()) {
      return { ok: false, message: '登录失败: 请检查账号密码(若需验证码, 请改用"网页登录")' }
    }
    this.saveCookies()
    // 官方校验: isLogin 为 false 说明被防自动登录验证码静默拦截 -> 回滚假会话
    const info = await this.checkLoginInfo()
    if (!info.isLogin) {
      this.clearCookies()
      this.cookieValid = false
      return {
        ok: false,
        message: '直登被官方防自动登录拦截(需人机验证), 请改用「网页登录」方式完成验证'
      }
    }
    this.cookieValid = true
    this.accountIsAdult = info.isAdult
    return { ok: true, message: '登录成功' }
  }

  /** 官方登录态校验: 返回 isLogin / isAdult(成人认证) 等; 可提供 jar 进行"试验证"(不落地) */
  accountIsAdult = false
  async checkLoginInfo(jarOverride?: CookieJar): Promise<{ isLogin: boolean; isAdult: boolean; idx: number | null }> {
    try {
      const { text } = await this.rawFetch('POST', '/v1/member/login_info', {}, {}, jarOverride)
      const j = this.parseText<{
        result?: boolean
        loginInfo?: { userInfo?: { isLogin?: boolean; isAdult?: boolean; idx?: number } }
      }>(text)
      const ui = j?.loginInfo?.userInfo || {}
      return { isLogin: !!ui.isLogin, isAdult: !!ui.isAdult, idx: ui.idx ?? null }
    } catch {
      return { isLogin: false, isAdult: false, idx: null }
    }
  }

  async importCookies(jar: CookieJar): Promise<void> {
    this.jar = { ...this.jar, ...jar }
    this.saveCookies()
    this.clearPlayCache() // 新会话生效: 旧会话签发的源清空重来
    const info = await this.checkLoginInfo()
    this.cookieValid = info.isLogin
    this.accountIsAdult = info.isAdult
  }

  /** 拉一页全站直播列表; 响应带 loginInfo 可校验登录态; adultShowAdModeYN=Y 对认证账号开放 19+ 列表 */
  async fetchLivePage(offset: number, limit = 100): Promise<{ list: LiveItem[]; loginInfo: unknown }> {
    const j = await this.json<{ list?: LiveItem[]; loginInfo?: unknown; result?: boolean; message?: string }>(
      'GET',
      `/v1/live?hotyn=Y&adultShowAdModeYN=Y&offset=${offset}&limit=${limit}`
    )
    if ((j as { result?: boolean })?.result === false) {
      throw new RiskError(`live list result=false: ${(j as { message?: string })?.message || ''}`)
    }
    return { list: j.list ?? [], loginInfo: j.loginInfo }
  }

  async fetchBj(
    userId: string
  ): Promise<{ nick: string; userIdx: number | null; userImg: string; media: LiveItem | null }> {
    const j = await this.json<{
      result?: boolean
      bjInfo?: { id?: string; nick?: string; img?: string; profileImage?: string }
      media?: LiveItem & { userImg?: string }
      message?: string
    }>('POST', '/v1/member/bj', { userId, info: 'media' })
    if (j.result === false) throw new RiskError(j.message || 'member/bj 失败')
    const media = j.media ?? null
    return {
      nick: j.bjInfo?.nick || media?.userNick || userId,
      userIdx: media?.userIdx ?? null,
      userImg: media?.userImg || j.bjInfo?.img || j.bjInfo?.profileImage || '',
      media
    }
  }

  // ---- 拉源缓存: 不设时限, 源能用就一直用; 仅显式事件作废(重开播/录制出错/换号/手动强刷) ----
  private playCache = new Map<string, { r: PlayResult; at: number }>()

  invalidatePlay(userId: string): void {
    this.playCache.delete(userId)
  }

  clearPlayCache(): void {
    this.playCache.clear()
  }

  async getPlayCached(userId: string, password = '', forceFresh = false): Promise<PlayResult> {
    if (!forceFresh) {
      const c = this.playCache.get(userId)
      if (c && c.r.ok) return c.r
    }
    const r = await this.fetchPlay(userId, password)
    if (r.ok) this.playCache.set(userId, { r, at: Date.now() })
    return r
  }

  async fetchPlay(userId: string, password = ''): Promise<PlayResult> {
    const j = await this.jsonPriority<{
      result?: boolean
      message?: string
      errorData?: { code?: string }
      PlayList?: { hls?: { url: string }[]; hls2?: { url: string }[]; hls3?: { url: string }[] }
      media?: Record<string, unknown>
    }>('POST', '/v1/live/play', { action: 'watch', userId, password, shareLinkType: '' })

    const code = j?.errorData?.code
    if (code) {
      if (code === 'needAdult') return { ok: false, error: '成人限制房: 需要已成人认证的登录Cookie' }
      if (code === 'needLogin') return { ok: false, error: '需要登录后观看' }
      if (code === 'needFan') return { ok: false, error: '粉丝团专属: 当前账号无权限' }
      if (code === 'needUnlimitItem')
        return { ok: false, error: '该房间已满员: 平台要求购买「满员入场券」道具才能进入(付费门槛)' }
      if (code === 'needCoinPurchase')
        return { ok: false, error: '付费直播间: 账号爱心余额不足, 需在平台充值爱心后观看(付费门槛)' }
      if (/pw|password/i.test(code)) return { ok: false, needPassword: true, error: '密码房: 需要正确密码' }
      return { ok: false, error: `${code}: ${j.message || '无法播放'}` }
    }
    if (j?.result === false) {
      const msg = j.message || ''
      if (/비밀번호|password/i.test(msg)) return { ok: false, needPassword: true, error: '密码房: 需要正确密码' }
      return { ok: false, error: msg || '播放失败' }
    }
    const pl = j?.PlayList
    const hls = pl?.hls?.[0]?.url
    if (!hls) return { ok: false, error: '未获取到直播流(可能已下播或为回放)' }
    const backups: string[] = []
    if (pl?.hls2?.[0]?.url) backups.push(pl.hls2[0].url)
    if (pl?.hls3?.[0]?.url) backups.push(pl.hls3[0].url)
    // master 只活 10 分钟: 解析出长效变体地址供播放/录制直接使用
    const variants = await this.fetchVariants(hls)
    return {
      ok: true,
      m3u8: hls,
      variants,
      hlsBackups: backups,
      title: (j.media?.title as string) || '',
      nick: (j.media?.userNick as string) || '',
      thumbUrl: (j.media?.thumbUrl as string) || '',
      userImg: (j.media?.userImg as string) || '',
      media: j.media
    }
  }
}

export const api = new PandaApi()
