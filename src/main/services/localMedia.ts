import { protocol } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { store } from './store'
import { defaultRecordRoot } from '../util'
import { logger } from './logger'

// ============ 本地媒体协议(plocal://) ============
// 供渲染层 <video> 应用内回看本地录制产物:
//   - dev(http://localhost) 下 file:// 加载受限, 统一走自定义协议
//   - URL: plocal://file/<base64url(绝对路径)>
//   - 白名单: 仅 .mp4, 且必须位于当前录制根 / 默认录制根 / 历史任务目录之下
//   - Range 手动实现: net.fetch(file://) 对 Range 的透传在不同版本不稳定,
//     直接 fs 切片回 206, 保证大文件拖动进度条可用
// ==============================================

const SCHEME = 'plocal'

/** 必须在 app ready 前调用: 声明流媒体特权 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true } }
  ])
}

/** 允许访问的根: 当前录制根 ∪ 默认录制根 ∪ 历史出现过的任务目录(兼容换过保存路径)
 *  拖动进度条会产生连续 Range 请求, 根列表短缓存 3s 避免每请求全量重建 */
let rootsCache: { at: number; roots: string[] } | null = null
function allowedRoots(): string[] {
  if (rootsCache && Date.now() - rootsCache.at < 3000) return rootsCache.roots
  const roots = new Set<string>()
  const cfg = store.getSettings()
  roots.add(path.resolve(cfg.savePath || defaultRecordRoot()))
  roots.add(path.resolve(defaultRecordRoot()))
  for (const h of store.listHistory()) {
    if (h.dirPath) roots.add(path.resolve(h.dirPath))
  }
  rootsCache = { at: Date.now(), roots: [...roots] }
  return rootsCache.roots
}

function isAllowed(abs: string): boolean {
  if (!abs.toLowerCase().endsWith('.mp4')) return false
  if (!path.isAbsolute(abs)) return false
  const resolved = path.resolve(abs)
  return allowedRoots().some((root) => {
    const rel = path.relative(root, resolved)
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

function streamResponse(stream: Readable, init: { status: number; headers: Record<string, string> }): Response {
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: init.status,
    headers: init.headers
  })
}

/** 手动 Range: bytes=start-end / bytes=start- / bytes=-suffix; 非法区间 416 */
function fileResponse(abs: string, rangeHeader: string | null): Response {
  const size = fs.statSync(abs).size
  const baseHeaders = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes'
  }
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (m && (m[1] || m[2])) {
      let start = m[1] === '' ? NaN : parseInt(m[1], 10)
      let end = m[2] === '' ? NaN : parseInt(m[2], 10)
      if (Number.isNaN(start)) {
        // 后缀区间: 最后 end 个字节
        if (end <= 0) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        start = Math.max(0, size - end)
        end = size - 1
      } else if (Number.isNaN(end) || end >= size) {
        end = size - 1
      }
      if (start <= end && start < size) {
        return streamResponse(fs.createReadStream(abs, { start, end }), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1)
          }
        })
      }
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
  }
  return streamResponse(fs.createReadStream(abs), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) }
  })
}

/** app ready 后调用: 安装协议处理器 */
export function installMediaHandler(): void {
  protocol.handle(SCHEME, async (req) => {
    try {
      const u = new URL(req.url)
      const b64 = u.pathname.replace(/^\//, '')
      const abs = Buffer.from(b64, 'base64url').toString('utf-8')
      if (!isAllowed(abs)) {
        logger.warn('media', `拒绝访问(白名单外或非 mp4): ${abs.slice(0, 200)}`)
        return new Response('forbidden', { status: 403 })
      }
      if (!fs.existsSync(abs)) return new Response('not found', { status: 404 })
      return fileResponse(abs, req.headers.get('range'))
    } catch (e) {
      return new Response(String((e as Error).message || e), { status: 500 })
    }
  })
}
