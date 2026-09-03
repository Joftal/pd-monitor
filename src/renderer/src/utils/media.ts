import type { RecHistoryItem } from '@shared/types'

// ============ 录制产物判定与格式化(视频库/影院浮层/录制页共用) ============

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(0, Math.round(n / 1024)) + ' KB'
}

/** 秒 → h:mm:ss / mm:ss */
export function fmtDurHMS(sec: number): string {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 录制时长: start→end(空则到当前), h:mm:ss / mm:ss */
export function fmtDur(start: number, end: number | null): string {
  return fmtDurHMS(Math.floor(((end ?? Date.now()) - start) / 1000))
}

/** 文件基名(去目录) */
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/** 错误串清洗: 去掉前缀 "xxx Error: " */
export function errText(e: unknown): string {
  return String((e as Error)?.message || e).replace(/^.*Error: /, '')
}

/** 大数字缩写: 中文 ≥1万→万, 英文 ≥1000→k(isZh 由调用方 locale 决定; 千/万不得混用) */
export function fmtNum(n: number, isZh: boolean): string {
  if (isZh) return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n)
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n)
}

/** 开播时长: pandalive startTime("YYYY-MM-DD HH:mm:ss") → 时长文案(card.h/card.m) */
export function fmtLiveDuration(startTime: string | undefined, t: (key: string, p?: Record<string, unknown>) => string): string {
  if (!startTime) return ''
  const ts = new Date(startTime.replace(' ', 'T')).getTime()
  const dsec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (!Number.isFinite(dsec)) return ''
  const h = Math.floor(dsec / 3600)
  const m = Math.floor((dsec % 3600) / 60)
  return t(h > 0 ? 'card.h' : 'card.m', { h, m })
}

/** 已合并单文件: 仅一个 MP4 且非回放, 文件名无 _NNNN/_vod 分段后缀 */
export function isMergedTask(h: RecHistoryItem): boolean {
  const mp4s = (h.files || []).filter((f) => f.toLowerCase().endsWith('.mp4'))
  if (h.vod || mp4s.length !== 1 || (h.files || []).length !== 1) return false
  const name = mp4s[0].split(/[\\/]/).pop() || ''
  return !/_(\d{4}|vod)\.mp4$/i.test(name)
}

/** 可手动合并: 分段(MP4≥2 或 TS≥2) 且不存在已合并整文件 */
export function mergeableTask(h: RecHistoryItem): boolean {
  const mp4s = (h.files || []).filter((f) => f.toLowerCase().endsWith('.mp4'))
  const tss = (h.files || []).filter((f) => f.toLowerCase().endsWith('.ts'))
  const segs = mp4s.length >= 2 ? mp4s : tss
  if (segs.length < 2) return false
  const base = (segs[0].split(/[\\/]/).pop() || '').replace(/_(\d{4}|vod)\.(mp4|ts)$/i, '')
  return !mp4s.some((f) => (f.split(/[\\/]/).pop() || '').toLowerCase() === `${base}.mp4`.toLowerCase())
}
