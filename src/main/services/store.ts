import * as fs from 'fs'
import * as path from 'path'
import { dataDir } from '../util'
import { Anchor, RecHistoryItem, Settings, DEFAULT_SETTINGS } from '../../shared/types'

interface DbShape {
  anchors: Anchor[]
  settings: Settings
  history: RecHistoryItem[]
}

const FILE = () => path.join(dataDir(), 'db.json')

function load(): DbShape {
  try {
    const raw = fs.readFileSync(FILE(), 'utf-8')
    const j = JSON.parse(raw)
    return {
      anchors: Array.isArray(j.anchors) ? j.anchors : [],
      settings: { ...DEFAULT_SETTINGS, ...(j.settings || {}) },
      history: Array.isArray(j.history) ? j.history : []
    }
  } catch {
    return { anchors: [], settings: { ...DEFAULT_SETTINGS }, history: [] }
  }
}

let db: DbShape = load()
let saveTimer: NodeJS.Timeout | null = null

function persist(immediate = false): void {
  const write = () => {
    const tmp = FILE() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf-8')
    fs.renameSync(tmp, FILE())
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
  clearHistory(): void {
    db.history = []
    persist(true)
  },
  flush(): void {
    persist(true)
  }
}
