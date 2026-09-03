import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// 全平台统一伪装 Windows Chrome UA: 服务端不校验 OS, 统一指纹反而是反风控资产(刻意不换行)
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function dataRoot(): string {
  // Windows 便携哲学: 数据放程序所在目录(便携版经 PORTABLE_EXECUTABLE_DIR 指回原始目录)
  // macOS 的 .app 是只读包(可能 translocation 到隔离区)、Linux AppImage 是只读 squashfs:
  // 打包版在 mac/linux 必须落系统用户数据目录; 开发态三平台都用项目根
  if (app.isPackaged) {
    if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
    return app.getPath('userData')
  }
  return app.getAppPath()
}

export function dataDir(): string {
  const dir = path.join(dataRoot(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  migrateLegacyData(dir)
  return dir
}

/** 默认录制根目录: 程序所在目录/recording(未配置 savePath 时使用) */
export function defaultRecordRoot(): string {
  return path.join(dataRoot(), 'recording')
}

// 旧版本数据在 %APPDATA%/pandalive-monitor/plm-data, 首次运行自动迁移过来
let migrated = false
function migrateLegacyData(target: string): void {
  // 旧版本仅存在于 Windows, 其他平台无需迁移
  if (process.platform !== 'win32') return
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

/** 目录级录制产物对账: 按基名前缀收集现存 mp4/ts(排序) + 总字节; 目录不可读返回空 */
export function scanTaskMedia(dirPath: string, base: string): { files: string[]; bytes: number } {
  try {
    const files = fs
      .readdirSync(dirPath)
      .filter((n) => n.startsWith(base) && /\.(mp4|ts)$/i.test(n))
      .sort()
      .map((n) => path.join(dirPath, n))
    const bytes = files.reduce((s, f) => {
      try {
        return s + fs.statSync(f).size
      } catch {
        return s
      }
    }, 0)
    return { files, bytes }
  } catch {
    return { files: [], bytes: 0 }
  }
}

export function tsName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let diskProbeWarned = false
export function diskFreeGb(dir: string): number {
  try {
    const root = path.parse(path.resolve(dir)).root
    // 简单跨平台: 用 statfs(node 18.15+)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const st = fs.statfsSync ? fs.statfsSync(root) : null
    if (st) return (st.bavail * st.bsize) / 1024 ** 3
  } catch (e) {
    if (!diskProbeWarned) {
      diskProbeWarned = true
      // 磁盘保护静默失效必须留痕(延迟 require 避免 util->logger->util 环)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { logger } = require('./logger')
        logger.warn('app', `磁盘探测失败, 磁盘阈值保护将不生效: ${String((e as Error).message || e)}`)
      } catch {
        /* ignore */
      }
    }
  }
  return Number.MAX_SAFE_INTEGER
}
