import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function dataRoot(): string {
  // 数据放在程序所在目录(便携化): 打包版=exe 所在目录; 开发版=项目根目录
  // 注意: 便携版运行时会解压到临时目录, app.getPath('exe') 指向临时目录!
  // electron-builder 为便携版提供 PORTABLE_EXECUTABLE_DIR 指向原始 exe 所在文件夹
  if (app.isPackaged) return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
  return app.getAppPath()
}

export function dataDir(): string {
  const dir = path.join(dataRoot(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  migrateLegacyData(dir)
  return dir
}

// 旧版本数据在 %APPDATA%/pandalive-monitor/plm-data, 首次运行自动迁移过来
let migrated = false
function migrateLegacyData(target: string): void {
  if (migrated) return
  migrated = true
  try {
    const roaming = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
    const legacy = path.join(roaming, 'pandalive-monitor', 'plm-data')
    if (!fs.existsSync(legacy) || legacy === target) return
    for (const f of ['db.json', 'vault.dat']) {
      const src = path.join(legacy, f)
      const dst = path.join(target, f)
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst)
        console.log(`[migrate] 已迁移旧数据: ${f}`)
      }
    }
  } catch (e) {
    console.warn('旧数据迁移失败(忽略)', e)
  }
}

export function sanitizeName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|&#.。,，~!·\s]+/g, '_')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/^_|_$/g, '')
      .slice(0, 60) || '未命名'
  )
}

export function tsName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function diskFreeGb(dir: string): number {
  try {
    const root = path.parse(path.resolve(dir)).root
    // 简单跨平台: 用 statfs(node 18.15+)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const st = fs.statfsSync ? fs.statfsSync(root) : null
    if (st) return (st.bavail * st.bsize) / 1024 ** 3
  } catch {
    /* ignore */
  }
  return Number.MAX_SAFE_INTEGER
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(0, Math.round(n / 1024)) + ' KB'
}
