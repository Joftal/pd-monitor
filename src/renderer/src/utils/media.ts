import type { RecHistoryItem } from '@shared/types'

// ============ 录制产物判定与格式化(视频库/影院浮层/录制页共用) ============

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(0, Math.round(n / 1024)) + ' KB'
}

/** 录制时长: start→end(空则到当前), h:mm:ss / mm:ss */
export function fmtDur(start: number, end: number | null): string {
  const sec = Math.max(0, Math.floor(((end ?? Date.now()) - start) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
