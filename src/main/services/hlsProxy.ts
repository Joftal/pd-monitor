import { session } from 'electron'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { logger } from './logger'

// ============ 本地 HLS 过滤代理 ============
// SOOP 的播放清单有两处坑, 直接喂给 ffmpeg / hls.js 都会出事:
//   1. 清单里的分段是相对地址且需要带 Origin/Referer/Cookie —— 渲染层拿不到、ffmpeg 传头也嫌脏;
//   2. 尾部可能挂 name 含 preloading 的预载分段, 内容尚未写完, 取到就是半截 TS(实测偶发, 不代表常态)。
// 因此所有 SOOP 流统一走 127.0.0.1 的一层本地代理: 播放清单在本地重写并把分段收进 /media,
// 上游请求头由本模块注入。用户看到的"播放源"是代理地址, 复制到外部播放器会失效(设计上已说明)。
// ==========================================

/** 伴随标签: 过滤预载分段时要连同它们一起丢弃, 否则留下"有 EXTINF 无 URI"的非法清单 */
const URI_TAG_PREFIXES = [
  '#EXTINF',
  '#EXT-X-BYTERANGE',
  '#EXT-X-STREAM-INF',
  '#EXT-X-PROGRAM-DATE-TIME',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-CUE-OUT',
  '#EXT-X-CUE-IN',
  '#EXT-X-DATERANGE'
]

function isUriTag(line: string): boolean {
  return URI_TAG_PREFIXES.some((p) => line.startsWith(p))
}

function looksLikePlaylist(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('.m3u8') || lower.endsWith('.m3u')
}

/** 重写 m3u8: 分段与 EXT-X-MAP 的 URI 收进本地 /media, 顺带剔除预载分段 */
export function rewritePlaylist(content: string, baseUrl: string, mediaUrlOf: (abs: string) => string, filterPreloading: boolean): string {
  const out: string[] = []
  let pending: string[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const rewritten = rewriteTagUri(line, baseUrl, mediaUrlOf)
      if (isUriTag(line)) pending = [...pending, rewritten]
      else {
        out.push(...pending, rewritten)
        pending = []
      }
      continue
    }
    const abs = new URL(line, baseUrl).href
    if (filterPreloading && abs.includes('preloading')) {
      pending = [] // 预载段连同其 EXTINF 等伴随标签一起丢
      continue
    }
    out.push(...pending, mediaUrlOf(abs))
    pending = []
  }
  out.push(...pending)
  return out.join('\n') + '\n'
}

/** 只重写标签里第一个 URI="..."(EXT-X-MAP 等), 其余原样保留 */
function rewriteTagUri(line: string, baseUrl: string, mediaUrlOf: (abs: string) => string): string {
  const start = line.indexOf('URI="')
  if (start < 0) return line
  const valueStart = start + 5
  const end = line.indexOf('"', valueStart)
  if (end < 0) return line
  const raw = line.slice(valueStart, end)
  try {
    return line.slice(0, valueStart) + mediaUrlOf(new URL(raw, baseUrl).href) + line.slice(end)
  } catch {
    return line
  }
}

export interface HlsProxyOptions {
  /** 每次上游请求现取请求头(登录态会变, 不能在建代理时冻结) */
  headers: (target: string) => Promise<Record<string, string>> | Record<string, string>
  /** 拉上游用哪个 session(继承其代理设置); 传空则走默认 session */
  sessionPartition?: string
  /** 上游清单判死(403/404 = 场次凭证已作废): 调用方据此收掉对应源缓存。
   *  5xx/超时不回调 —— 那是上游抖动, 收尸会把好源误杀 */
  onDeadUpstream?: (target: string, status: number) => void
}

export class HlsProxy {
  private server = createServer((req, res) => void this.handle(req, res))
  private port = 0
  /** 本代理签发过的上游 origin。代理会替请求附上 SOOP 登录 Cookie, 目标地址绝不能由请求方任意指定:
   *  只放行自家签发过的地址(playlistUrl + 清单重写时逐条登记), 本机其它进程/网页便无法把它当开放代理用 */
  private readonly allowedOrigins = new Set<string>()

  constructor(private readonly opts: HlsProxyOptions) {
    // ffmpeg/hls.js 会复用长连接取分段: 服务端一旦主动掐掉空闲 keep-alive, 下一发请求就是连接重置。
    // 只设请求侧超时, 不给连接设超时。
    this.server.keepAliveTimeout = 0
    this.server.requestTimeout = 0
    this.server.headersTimeout = 0
  }

  /** 绑定随机空闲端口; 失败即抛, 调用方据此回落上游直连 */
  listen(): Promise<void> {
    if (this.port) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      // 只绑回环: 代理会替请求附上登录 Cookie, 不能暴露到局域网
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        logger.info('hls', `SOOP HLS 代理已启动: 127.0.0.1:${this.port}`)
        resolve()
      })
    })
  }

  /** 播放清单入口: 上游 m3u8 经本地重写后回给播放器/ffmpeg */
  playlistUrl(upstream: string): string {
    this.allowTarget(upstream)
    return `http://127.0.0.1:${this.port}/playlist.m3u8?url=${encodeURIComponent(upstream)}`
  }

  private allowTarget(raw: string): void {
    try {
      this.allowedOrigins.add(new URL(raw).origin)
    } catch {
      /* 非法地址: 不登记, handle() 里也一律拒 */
    }
  }

  /** 分段/EXT-X-MAP 的本地地址: 顺带放行其 origin —— 清单里指向哪个 CDN, 下一次 /media 才取得到 */
  private mediaUrlOf = (abs: string): string => {
    this.allowTarget(abs)
    return `http://127.0.0.1:${this.port}/media?url=${encodeURIComponent(abs)}`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1')
      if (u.pathname !== '/playlist.m3u8' && u.pathname !== '/media') {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
        res.end('not found')
        return
      }
      const raw = u.searchParams.get('url') || ''
      if (!/^https?:\/\//i.test(raw)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' })
        res.end('bad url')
        return
      }
      // 目标必须是本代理签发过的 origin, 否则等于开着带凭证的任意转发口
      let origin = ''
      try {
        origin = new URL(raw).origin
      } catch {
        origin = ''
      }
      if (!this.allowedOrigins.has(origin)) {
        res.writeHead(403, { 'Access-Control-Allow-Origin': '*' })
        res.end('target not allowed')
        return
      }
      if (u.pathname === '/playlist.m3u8' || looksLikePlaylist(raw)) {
        await this.servePlaylist(raw, res)
        return
      }
      await this.serveRaw(raw, res)
    } catch (e) {
      logger.warn('hls', `HLS 代理处理失败: ${String((e as Error).message || e)}`)
      if (!res.headersSent) res.writeHead(502, { 'Access-Control-Allow-Origin': '*' })
      res.end('proxy error')
    }
  }

  private async fetchUpstream(target: string, timeoutMs: number): Promise<Response> {
    const headers = await this.opts.headers(target)
    const ses = this.opts.sessionPartition ? session.fromPartition(this.opts.sessionPartition) : session.defaultSession
    // 走 session.fetch 与主进程其它请求同享代理设置; net.fetch 自身无超时, 用 AbortController 兜住
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    return ses
      .fetch(target, { headers, signal: ctrl.signal })
      .finally(() => clearTimeout(timer))
  }

  private async servePlaylist(target: string, res: ServerResponse): Promise<void> {
    const up = await this.fetchUpstream(target, 15_000)
    if (up.status !== 200) {
      if (up.status === 403 || up.status === 404) this.opts.onDeadUpstream?.(target, up.status)
      res.writeHead(up.status || 502, { 'Access-Control-Allow-Origin': '*' })
      res.end(`upstream ${up.status}`)
      return
    }
    const text = await up.text()
    const body = rewritePlaylist(text, target, this.mediaUrlOf, true)
    res.writeHead(200, {
      'Content-Type': up.headers.get('content-type') || 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    })
    res.end(body)
  }

  private async serveRaw(target: string, res: ServerResponse): Promise<void> {
    const up = await this.fetchUpstream(target, 30_000)
    const buf = Buffer.from(await up.arrayBuffer())
    res.writeHead(up.status === 0 ? 502 : up.status, {
      'Content-Type': up.headers.get('content-type') || 'video/mp2t',
      'Content-Length': String(buf.length),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    })
    res.end(buf)
  }
}
