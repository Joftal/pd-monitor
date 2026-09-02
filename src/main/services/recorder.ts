import { app, BrowserWindow } from 'electron'
import { spawn, ChildProcessByStdio } from 'child_process'
import { Readable, Writable } from 'stream'
import * as fs from 'fs'
import * as path from 'path'
import { EV, RecTask } from '../../shared/types'
import { api } from './pandalive'
import { store } from './store'
import { tsName, diskFreeGb, UA, sleep, defaultRecordRoot } from '../util'
import { sendToast } from './notify'

// ============ 录制引擎 ============
// - ffmpeg -c copy 分段录制; 直接使用长效 IVS 变体地址(master 一次性: 源缓存复用)
// - 意外退出过"直播探针": 真下播=done; 仍在播=error(按策略不自动换源, 提示手动)
// - 停滞检测(60s 零字节) + 磁盘监控(30s) + 停止: stdin 写 'q' 优雅退出; 可选 remux
// ==================================

const STALL_MS = 60 * 1000 // 字节数 60s 无增长视为源失效

function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = require('ffmpeg-static') as string
  if (!p) throw new Error('ffmpeg 未安装')
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

/** 严格清理路径用名: 非法字符直接去除(不下划线替代), 收拢空白, 去除首尾点空格(NTFS 约束) */
export function strictName(s: string): string {
  return (
    String(s || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.\s]+$/g, '')
      .trim() || '未命名'
  )
}

/** 录制文件名: 主播名(主播ID)_直播标题(可选,截40)_时间戳; 非法字符直接剔除 */
function buildBaseName(nick: string, userId: string, title: string): string {
  const n = strictName(nick)
  const t = title ? strictName(title.slice(0, 40)).replace(/ /g, '_') : ''
  return t ? `${n}(${userId})_${t}_${tsName()}` : `${n}(${userId})_${tsName()}`
}

export interface StartRecOptions {
  userId: string
  nick: string
  title: string
  password?: string
  auto?: boolean
}

class Task implements RecTask {
  id: string
  userId: string
  nick: string
  title: string
  startedAt: number
  endedAt: number | null = null
  status: RecTask['status'] = 'recording'
  dirPath: string
  currentFile = ''
  files: string[] = []
  bytes = 0
  error = ''
  auto: boolean

  password: string
  private proc: ChildProcessByStdio<Writable, null, Readable> | null = null
  private segIndex = 0
  private baseName = ''
  private statTimer: NodeJS.Timeout | null = null
  private stallTimer: NodeJS.Timeout | null = null
  private stopping = false
  private lastBytes = 0
  private lastBytesAt = 0

  constructor(opt: StartRecOptions, dirPath: string) {
    this.id = `${opt.userId}_${Date.now()}`
    this.userId = opt.userId
    this.nick = opt.nick
    this.title = opt.title
    this.password = opt.password || ''
    this.auto = !!opt.auto
    this.startedAt = Date.now()
    this.dirPath = dirPath
    this.baseName = buildBaseName(opt.nick, opt.userId, opt.title)
  }

  private refreshBaseName(): void {
    // 录制开始前(拿到最新标题后)统一命名: 主播名(主播ID)_直播标题_时间戳
    this.baseName = buildBaseName(this.nick, this.userId, this.title)
  }

  get outputPattern(): string {
    return path.join(this.dirPath, `${this.baseName}_%04d.ts`)
  }

  private push(): void {
    recorder.emitUpdate()
  }

  async run(): Promise<void> {
    fs.mkdirSync(this.dirPath, { recursive: true })
    const play = await api.getPlayCached(this.userId, this.password)
    if (!play.ok || !play.m3u8) {
      const err = new Error(play.error || '获取直播流失败')
      ;(err as Error & { needPassword?: boolean }).needPassword = play.needPassword
      throw err
    }
    if (play.title) this.title = play.title
    this.refreshBaseName() // 拿到最终标题后再定文件名(首次可能任选项带标题)
    if (this.lastBytesAt === 0) this.lastBytesAt = Date.now() // 停滞计时起点: 从未写入也能被检出
    // master URL 仅 10 分钟有效: 录制改用具象变体地址(最高档/原画)
    this.spawnFfmpeg(play.variants?.[0]?.url || play.m3u8)
    this.statTimer = setInterval(() => this.statFiles(), 2000)
    this.stallTimer = setInterval(() => this.checkStall(), 10000)
    this.push()
  }

  private spawnFfmpeg(m3u8: string): void {
    const cfg = store.getSettings()
    const args = [
      '-y',
      '-loglevel', 'error',
      '-hide_banner',
      '-user_agent', UA,
      '-headers', 'Origin: https://www.pandalive.co.kr\r\nReferer: https://www.pandalive.co.kr/\r\n',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '15',
      '-rw_timeout', '50000000',
    ]
    if (cfg.proxyUrl) args.push('-http_proxy', cfg.proxyUrl)
    args.push(
      '-i', m3u8,
      '-map', '0',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(Math.max(60, cfg.splitSeconds || 900)),
      '-segment_format', 'mpegts',
      '-segment_start_number', String(this.segIndex || 1),
      '-reset_timestamps', '1',
      this.outputPattern
    )
    const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
    this.proc = ff
    let errBuf = ''
    ff.stderr.on('data', (d: Buffer) => {
      errBuf = (errBuf + d.toString()).slice(-4000)
    })
    ff.on('exit', (code) => {
      const expected = this.stopping
      this.proc = null
      this.statFiles()
      if (expected) return
      if (this.status !== 'recording') return
      const reason =
        code === 0
          ? '流连接结束'
          : errBuf.split('\n').filter(Boolean).slice(-3).join(' | ') || `ffmpeg 退出码 ${code}`
      void this.handleUnexpectedExit(reason)
    })
  }

  /** 意外退出统一语义: 拉一次现行流判下播/中断 —— 真下播按完成收尾, 还在播才记错误(不自动换源) */
  private async handleUnexpectedExit(reason: string): Promise<void> {
    let stillLive = false
    try {
      const play = await api.fetchPlay(this.userId, this.password)
      stillLive = !!(play.ok && play.m3u8)
    } catch {
      stillLive = false // 拉不出也按下播论
    }
    if (stillLive) {
      this.error = `录制中断(${reason}), 主播仍在播, 请手动重新开始录制`
      await this.finalize('error')
    } else {
      await this.finalize('done') // 正常下播: 完成态收尾
    }
  }

  /** 停滞检测(60s 字节无增长=源失效) + 磁盘监控(跨天录制保护) */
  private diskCheckCnt = 0
  private checkStall(): void {
    if (this.status !== 'recording' || this.stopping || !this.proc) return
    if (this.bytes !== this.lastBytes) {
      this.lastBytes = this.bytes
      this.lastBytesAt = Date.now()
    } else if (this.lastBytesAt && Date.now() - this.lastBytesAt > STALL_MS) {
      this.error = '源停滞无数据(可能已失效), 请手动重新开始录制'
      void this.finalize('error')
      return
    }
    // 每 ~30s 检查一次磁盘, 避免跨天录制把磁盘写满
    if (++this.diskCheckCnt >= 3) {
      this.diskCheckCnt = 0
      const limit = store.getSettings().diskLimitGb
      if (diskFreeGb(this.dirPath) < limit) {
        this.error = `磁盘剩余空间不足 ${limit}GB, 已停止录制`
        void this.finalize('error')
      }
    }
  }

  private killProc(): Promise<void> {
    return new Promise((resolve) => {
      const p = this.proc
      if (!p) return resolve()
      const timer = setTimeout(() => {
        try {
          p.kill('SIGKILL')
        } catch { /* ignore */ }
        resolve()
      }, 8000)
      p.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        p.stdin.write('q')
        p.stdin.end()
      } catch {
        try {
          p.kill()
        } catch { /* ignore */ }
      }
    })
  }

  private statFiles(): void {
    try {
      const list = fs
        .readdirSync(this.dirPath)
        .filter((f) => f.startsWith(this.baseName) && (f.endsWith('.ts') || f.endsWith('.mp4')))
        .sort()
      this.files = list.map((f) => path.join(this.dirPath, f))
      this.bytes = this.files.reduce((sum, f) => {
        try {
          return sum + fs.statSync(f).size
        } catch {
          return sum
        }
      }, 0)
      const writing = list.filter((f) => f.endsWith('.ts')).pop()
      this.currentFile = writing ? path.join(this.dirPath, writing) : this.files[this.files.length - 1] || ''
    } catch {
      /* ignore */
    }
    this.push()
  }

  /** 用户主动停止 */
  async stop(): Promise<void> {
    if (this.status !== 'recording') return
    this.stopping = true
    await this.killProc()
    await this.finalize('stopped')
  }

  /** 收尾: remux / 入库 / 通知 */
  private async finalize(status: RecTask['status']): Promise<void> {
    if (this.statTimer) clearInterval(this.statTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.statTimer = null
    this.stallTimer = null
    await this.killProc()
    this.statFiles()

    const cfg = store.getSettings()
    if (status !== 'error' && cfg.autoMp4 && this.files.some((f) => f.endsWith('.ts'))) {
      this.status = 'remuxing'
      this.push()
      for (const f of [...this.files]) {
        if (!f.endsWith('.ts')) continue
        const ok = await this.remux(f)
        if (ok && cfg.deleteTs) {
          try {
            fs.unlinkSync(f)
          } catch { /* ignore */ }
        }
      }
      this.statFiles()
    }

    this.status = status
    this.endedAt = Date.now()
    if (status === 'error') {
      // 录制出错(源死/中断): 立即作废该主播的源缓存, 避免下次重录复用尸源
      api.invalidatePlay(this.userId)
    }
    store.addHistory(Recorder.publicTask(this))
    recorder.removeTask(this.userId)
    this.push()

    if (status === 'done') sendToast({ type: 'rec', title: `${this.nick} 录制完成`, body: `${this.files.length} 个分段` })
    if (status === 'error') sendToast({ type: 'error', title: `${this.nick} 录制出错`, body: this.error.slice(0, 120) })
  }

  private async remux(tsFile: string): Promise<boolean> {
    const mp4 = tsFile.replace(/\.ts$/, '.mp4')
    return new Promise((resolve) => {
      const ff = spawn(ffmpegPath(), ['-y', '-i', tsFile, '-c', 'copy', '-movflags', '+faststart', mp4], {
        stdio: ['ignore', 'ignore', 'ignore']
      })
      ff.on('exit', (code) => resolve(code === 0))
      ff.on('error', () => resolve(false))
    })
  }
}

class Recorder {
  private tasks = new Map<string, Task>()

  static publicTask(t: Task): RecTask {
    // 剥离私有实现字段(进程句柄/房间密码), 只暴露公开数据
    const { id, userId, nick, title, startedAt, endedAt, status, dirPath, currentFile, files, bytes, error, auto } = t
    return { id, userId, nick, title, startedAt, endedAt, status, dirPath, currentFile, files: [...files], bytes, error, auto }
  }

  emitUpdate(): void {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.recordings, [...this.tasks.values()].map((t) => Recorder.publicTask(t)))
  }

  list(): RecTask[] {
    return [...this.tasks.values()].map((t) => Recorder.publicTask(t))
  }

  isRecording(userId: string): boolean {
    const t = this.tasks.get(userId)
    return !!t && t.status === 'recording'
  }

  async start(opt: StartRecOptions): Promise<RecTask> {
    const exist = this.tasks.get(opt.userId)
    if (exist && (exist.status === 'recording' || exist.status === 'remuxing')) {
      return Recorder.publicTask(exist)
    }
    const cfg = store.getSettings()
    const root = cfg.savePath || defaultRecordRoot()
    const dir = path.join(root, `${strictName(opt.nick)}(${opt.userId})`)
    if (diskFreeGb(dir) < cfg.diskLimitGb) {
      const err = new Error(`磁盘剩余空间不足 ${cfg.diskLimitGb}GB, 无法开始录制`)
      sendToast({ type: 'error', title: '录制失败', body: String(err.message) })
      throw err
    }
    const task = new Task(opt, dir)
    // 先占位再初始化, 防双击/并发产生两个 ffmpeg
    this.tasks.set(opt.userId, task)
    try {
      await task.run()
    } catch (e) {
      this.tasks.delete(opt.userId)
      if ((e as Error & { needPassword?: boolean }).needPassword) {
        const err = e as Error & { needPassword?: boolean }
        err.message = '密码房: 需要密码才能录制'
        throw err
      }
      sendToast({ type: 'error', title: `${opt.nick} 录制启动失败`, body: String((e as Error).message || e) })
      throw e
    }
    sendToast({ type: 'rec', title: `开始录制 ${opt.nick}`, body: opt.title || '' })
    this.emitUpdate()
    return Recorder.publicTask(task)
  }

  async stop(userId: string): Promise<void> {
    const t = this.tasks.get(userId)
    if (t) await t.stop()
  }

  async stopAll(): Promise<void> {
    for (const t of [...this.tasks.values()]) {
      await t.stop()
      await sleep(300)
    }
  }

  removeTask(userId: string): void {
    this.tasks.delete(userId)
  }

  openFolder(userId: string): string | null {
    const t = this.tasks.get(userId)
    return t ? t.dirPath : null
  }
}

export const recorder = new Recorder()
