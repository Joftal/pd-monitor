import * as fs from 'fs'
import * as path from 'path'
import { dataDir } from '../util'
import { Anchor, RecHistoryItem, Settings, DEFAULT_SETTINGS } from '../../shared/types'
import { logger } from './logger'

interface DbShape {
  anchors: Anchor[]
  settings: Settings
  history: RecHistoryItem[]
}

const FILE = () => path.join(dataDir(), 'db.json')

/** 读库带重试: Windows 下应用被强杀后立刻重启, db.json 句柄可能尚未释放(EBUSY/EPERM),
 *  此时若静默回退默认态 + 轮询 flush 会把真数据覆写丢 —— 重试 + dbRecovering 写守卫双保险 */
let dbRecovering = false

function load(retryMs = 0): DbShape {
  try {
    const raw = fs.readFileSync(FILE(), 'utf-8')
    const j = JSON.parse(raw)
    dbRecovering = false
    return {
      anchors: Array.isArray(j.anchors) ? j.anchors : [],
      settings: { ...DEFAULT_SETTINGS, ...(j.settings || {}) },
      history: Array.isArray(j.history) ? j.history : []
    }
  } catch (e) {
    if (retryMs > 0 && fs.existsSync(FILE())) {
      const until = Date.now() + retryMs
      while (Date.now() < until) { /* 自旋短等(启动早期, 仅百毫秒级) */ }
      return load(0) // 只重试一次
    }
    // 真没有库(全新安装) → 默认态; 文件存在但读不出 → 恢复态标记(禁写覆真库)
    dbRecovering = fs.existsSync(FILE())
    return { anchors: [], settings: { ...DEFAULT_SETTINGS }, history: [] }
  }
}

let db: DbShape = load(150)
let saveTimer: NodeJS.Timeout | null = null

function persist(immediate = false): void {
  const write = () => {
    if (dbRecovering) {
      // 恢复态禁止覆写; 先尝试重读成功再写
      const re = load(150)
      if (dbRecovering) {
        logger.warn('store', 'db.json 读取仍失败, 跳过本次落盘(避免覆写)')
        return
      }
      db = re
      logger.warn('store', 'db.json 已恢复正常; 恢复窗口内的个别改动可能未落盘')
    }
    try {
      const tmp = FILE() + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf-8')
      fs.renameSync(tmp, FILE())
    } catch (e) {
      console.error('db persist failed', e)
    }
  }
  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    write()
    return
  }
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      write()
    } catch (e) {
      console.error('db persist failed', e)
    }
  }, 400)
}

export const store = {
  // ----- anchors -----
  listAnchors(): Anchor[] {
    return db.anchors
  },
  addAnchor(a: Anchor): void {
    if (!db.anchors.find((x) => x.userId === a.userId)) {
      db.anchors.push(a)
      persist()
    }
  },
  removeAnchor(userId: string): void {
    db.anchors = db.anchors.filter((x) => x.userId !== userId)
    persist()
  },
  updateAnchor(userId: string, patch: Partial<Anchor>): void {
    const a = db.anchors.find((x) => x.userId === userId)
    if (a) {
      Object.assign(a, patch)
      persist()
    }
  },
  // ----- settings -----
  getSettings(): Settings {
    return db.settings
  },
  setSettings(patch: Partial<Settings>): Settings {
    if (typeof patch.proxyUrl === 'string') patch = { ...patch, proxyUrl: patch.proxyUrl.trim() }
    db.settings = { ...db.settings, ...patch }
    persist(true)
    return db.settings
  },
  // ----- history -----
  addHistory(item: RecHistoryItem): void {
    db.history.unshift(item)
    if (db.history.length > 500) db.history.length = 500
    persist()
  },
  listHistory(): RecHistoryItem[] {
    return db.history
  },
  updateHistory(id: string, patch: Partial<RecHistoryItem>): void {
    const h = db.history.find((x) => x.id === id)
    if (h) {
      Object.assign(h, patch)
      persist()
    }
  },
  clearHistory(): void {
    db.history = []
    persist(true)
  },
  removeHistory(id: string): void {
    const n = db.history.length
    db.history = db.history.filter((x) => x.id !== id)
    if (db.history.length < n) persist(true)
  },
  flush(): void {
    persist(true)
  }
}
