// ============================================================================
// 验证脚本: P1 批次(录制产物原子性 / 空历史 / 入参边界 / 机密降级可见 / HLS 代理访问面)
//
// 方法: electron/child_process(伪 ffmpeg)/store/notify/thumbs/logger 替换为可计数替身;
//       recorder.ts / hlsProxy.ts / secrets.ts / shared/types.ts 用真实源码(sucrase 现编译).
//       伪 ffmpeg 会"失败也留下半截产物", 专门用来验我方代码有没有把坏文件收拾干净.
// 场景:
//   A1  remux 失败: 半截 .part 被清掉, 既不落 .mp4 也不入库(修复前坏包进库且喂给后续合并)
//   A2  remux 成功: .part 改名就位成 .mp4, deleteTs 只删已确认转换成功的那份
//   B1  分段合并: 昵称带单引号 → concat list 用 ffmpeg 词法 \' 转义(不是 shell 的 '\'')
//   B2  合并失败: 不出整文件、不留 .part/.concat.txt, 分段一个不删(数据丢失链封堵)
//   C1  拉源阶段停止: 零分段不写历史, 也不 spawn ffmpeg(修复前留一条永远打不开的空条目)
//   D1  对账清骨架: 空条目/目录已删/文件删空 → 移除; 目录里还有别人的媒体 → 保留
//   E1  mergeTask 幂等: 0 字节整文件重做 / 过期整文件重做 / 健康整文件直接返回且不重 spawn
//   E2  mergeTask 不把成品喂给自己(concat 输入表里绝无整文件) / 单段拒合并
//   F1  房间入参一把尺: isRoomId 与 parseRoomInput 同口径拒绝路径穿越/超长/控制字符
//   G1  HLS 代理三道闸: 缺令牌/令牌错 → 403, 未签发 origin → 403, 非法 url → 400
//   G2  代理正常链路: 清单重写带令牌 + 预载段过滤 + 上游请求头注入 + 跨实例令牌互不通用
//   G3  签发 origin 表有上限并按活跃度淘汰(长跑不涨面)
//   H1  机密降级: 无系统密钥 → plain 封装 + degraded=true + 日志留痕; 恢复后重写转 enc
// ============================================================================
import { createRequire } from 'module'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EventEmitter } from 'events'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { transform } = require('sucrase')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let PASS = 0
let FAIL = 0
const fails = []
function assert(cond, name, detail = '') {
  if (cond) {
    PASS++
    console.log(`  [PASS] ${name}`)
  } else {
    FAIL++
    fails.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (fn, ms = 3000) => {
  for (let i = 0; i < Math.ceil(ms / 20); i++) {
    if (fn()) return true
    await settle(20)
  }
  return fn()
}

// ---------- 临时世界 ----------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-p1-'))
const REC = path.join(TMP, 'rec')
fs.mkdirSync(REC, { recursive: true })

const world = {
  // 取流替身
  play: { ok: true, m3u8: 'http://127.0.0.1:1/playlist.m3u8', variants: [{ url: 'http://127.0.0.1:1/720.m3u8' }], dlHeaders: {}, title: '', thumbUrl: '' },
  playDelayMs: 0,
  playCalls: [],
  invalidated: [],
  // 伪 ffmpeg
  ffCalls: [],
  concatLists: [],
  segments: 2,
  segBytes: 700,
  remuxFail: false,
  concatFail: false,
  // 数据层替身
  settings: {},
  anchors: [],
  history: [],
  addHistoryCalls: 0,
  thumbQ: [],
  thumbRm: [],
  toasts: [],
  logInfo: [],
  logWarn: [],
  // 机密替身
  secretDir: '',
  encAvailable: true,
  encThrow: false,
  // 代理替身
  upstream: [],
  upstreamBody: {},
  upstreamStatus: {},
  hdrFor: () => ({ Cookie: 'sess=1', Origin: 'https://play.sooplive.com' })
}

// ---------- 伪 ffmpeg(spawn) ----------
class FakeChild extends EventEmitter {
  constructor(args) {
    super()
    this.args = args
    this.out = args[args.length - 1]
    this.stderr = new EventEmitter()
    this.stdout = new EventEmitter()
    // 直播录制的 ffmpeg 是"常驻"进程: 只有 stdin 收到 q / 被 kill 才退出
    this.stdin = {
      write: () => true,
      end: () => {
        if (!this.ended) {
          this.ended = true
          setTimeout(() => this.emit('exit', 0), 3)
        }
      }
    }
  }
  kill() {
    if (!this.ended) {
      this.ended = true
      setTimeout(() => this.emit('exit', 1), 3)
    }
  }
}

// 输出侧是否显式声明了 mp4 封装器(-f 必须出现在 -i 之后, 前面的 -f concat 是输入侧)
function declaresMp4(args) {
  if (!args) return false
  const a = args.slice(args.indexOf('-i') + 1)
  const i = a.indexOf('-f')
  return i >= 0 && a[i + 1] === 'mp4'
}

function fakeSpawn(bin, args) {
  const kind = args.includes('concat') ? 'concat' : args.includes('segment') ? 'seg' : 'remux'
  const child = new FakeChild(args)
  world.ffCalls.push({ kind, args, out: child.out })
  if (kind === 'seg') {
    for (let i = 1; i <= world.segments; i++) fs.writeFileSync(child.out.replace('%04d', String(i).padStart(4, '0')), Buffer.alloc(world.segBytes, 0x54))
    return child
  }
  // 真 ffmpeg 按输出扩展名推断封装器。原子产物叫 <x>.mp4.part, 不点名 -f 就直接
  // "Unable to choose an output format" 非零退出、一个字节都不写 —— 伪 ffmpeg 必须同样挑名字,
  // 否则"整条 remux 全灭"也能测出 PASS(这条是实机录了一段真直播才抓到的)
  const afterIn = args.slice(args.indexOf('-i') + 1)
  const fi = afterIn.indexOf('-f')
  if (fi < 0 && !/\.(mp4|ts|mkv)$/i.test(child.out)) {
    setImmediate(() => child.emit('exit', 1))
    return child
  }
  setImmediate(() => {
    const fail = kind === 'concat' ? world.concatFail : world.remuxFail
    if (kind === 'concat') {
      const listFile = args[args.indexOf('-i') + 1]
      try {
        world.concatLists.push(fs.readFileSync(listFile, 'utf-8'))
      } catch {
        world.concatLists.push('')
      }
    }
    // 对抗性: 真 ffmpeg 失败也常留下半截文件, 我方必须自己收走
    try {
      fs.writeFileSync(child.out, Buffer.alloc(fail ? 9 : world.segBytes, fail ? 0x48 : 0x4d))
    } catch {
      /* ignore */
    }
    child.emit('exit', fail ? 1 : 0)
  })
  return child
}

// ---------- 模块替身 ----------
const baseStore = {
  getSettings: () => world.settings,
  listAnchors: () => world.anchors,
  addHistory: (t) => {
    world.addHistoryCalls++
    world.history.push({ id: t.id, platform: t.platform, userId: t.userId, nick: t.nick, dirPath: t.dirPath, files: [...t.files], bytes: t.bytes, endedAt: t.endedAt })
  },
  listHistory: () => world.history,
  updateHistory: (id, patch) => {
    const it = world.history.find((h) => h.id === id)
    if (it) Object.assign(it, patch)
  },
  removeHistory: (id) => {
    world.history = world.history.filter((h) => h.id !== id)
  }
}

const fakeUpstreamFetch = async (url, init = {}) => {
  world.upstream.push({ url, headers: init.headers || {} })
  const status = world.upstreamStatus[url] ?? 200
  const body = world.upstreamBody[url] ?? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2-preloading.ts\n#EXT-X-ENDLIST\n'
  return new Response(body, { status, headers: { 'content-type': 'application/vnd.apple.mpegurl' } })
}

const mocks = {
  electron: {
    app: { isPackaged: false, getAppPath: () => ROOT, getPath: () => TMP, setPath() {}, on() {}, whenReady: () => Promise.resolve() },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { trashItem: async () => {}, openPath: async () => ({ error: '' }), showItemInFolder() {}, openExternal: async () => {} },
    ipcMain: { handle() {} },
    safeStorage: {
      isEncryptionAvailable: () => world.encAvailable,
      encryptString: (s) => {
        if (world.encThrow) throw new Error('DPAPI 调用失败(sim)')
        return Buffer.from(`enc(${s})`, 'utf-8')
      },
      decryptString: (buf) => {
        const t = buf.toString('utf-8')
        if (!t.startsWith('enc(')) throw new Error('密文格式非法')
        return t.slice(4, -1)
      }
    },
    session: { defaultSession: { fetch: fakeUpstreamFetch }, fromPartition: () => ({ fetch: fakeUpstreamFetch }) },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) }
  },
  child_process: { spawn: fakeSpawn },
  'ffmpeg-static': path.join(TMP, 'fake-ffmpeg.exe'),
  '../util': {}, // 下面用真实 util 覆盖 dataDir
  './pandalive': { api: { fetchPlaylistDurationSec: async () => 0 } },
  './source': {
    sourceFor: () => ({
      getPlayCached: async (userId, password) => {
        world.playCalls.push({ userId, password })
        if (world.playDelayMs) await settle(world.playDelayMs)
        return world.play
      },
      fetchPlay: async (userId) => {
        world.playCalls.push({ userId, probe: true })
        return world.play
      },
      invalidatePlay: (userId) => world.invalidated.push(userId)
    })
  },
  './store': { store: baseStore },
  './thumbs': { thumbs: { enqueue: (id) => world.thumbQ.push(id), remove: (id) => world.thumbRm.push(id) } },
  './notify': { sendToast: (t, c) => world.toasts.push({ t, c }) },
  './logger': {
    logger: {
      info: (tag, msg) => world.logInfo.push(String(msg)),
      warn: (tag, msg) => world.logWarn.push(String(msg)),
      error: (tag, msg) => world.logWarn.push(String(msg)),
      debug() {},
      flush() {}
    }
  },
  '../i18n': { mt: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k), setMainLocale() {} }
}

// ---------- TS 即时编译加载 ----------
const moduleCache = new Map()
function loadTs(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const file = path.join(ROOT, rel)
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code
  const m = { exports: {} }
  moduleCache.set(rel, m)
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id]
    if (id === '../../shared/types') return loadTs('src/shared/types.ts')
    return require(id)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(m.exports, localRequire, m, file, path.dirname(file))
  return m.exports
}

const realUtil = loadTs('src/main/util.ts')
mocks['../util'] = { ...realUtil, dataDir: () => world.secretDir }
const types = loadTs('src/shared/types.ts')
const { recorder, strictName } = loadTs('src/main/services/recorder.ts')

// ---------- 场景辅助 ----------
const listTask = (uid, platform = 'pandalive') => recorder.list().find((t) => t.userId === uid && t.platform === platform)
const hist = () => world.history
const media = (dir) => fs.readdirSync(dir).filter((n) => /\.(mp4|ts)$/i.test(n)).sort()
// 与主进程同一条"分段形态"判据: `<基名>_0001.ts` 是分段, `<基名>.mp4` 是合并成品
const SEG_RE = /_(\d{4}|vod)\.(mp4|ts)$/i
const segsIn = (dir) => media(dir).filter((n) => SEG_RE.test(n))
const wholeIn = (dir) => media(dir).filter((n) => !SEG_RE.test(n))
const anyOf = (dir, suffix) => fs.readdirSync(dir).some((n) => n.endsWith(suffix))
const defaults = (over = {}) => ({ ...types.DEFAULT_SETTINGS, savePath: REC, diskLimitGb: 0, autoMp4: true, deleteTs: false, mergeMp4: false, mergeDeleteSegments: false, proxyUrl: '', ...over })

async function reset(over = {}) {
  await recorder.stopAll()
  world.play = { ok: true, m3u8: 'http://127.0.0.1:1/playlist.m3u8', variants: [{ url: 'http://127.0.0.1:1/720.m3u8' }], dlHeaders: {}, title: '', thumbUrl: '' }
  world.playDelayMs = 0
  world.playCalls.length = 0
  world.invalidated.length = 0
  world.ffCalls.length = 0
  world.concatLists.length = 0
  world.segments = 2
  world.segBytes = 700
  world.remuxFail = false
  world.concatFail = false
  world.history = []
  world.addHistoryCalls = 0
  world.thumbQ.length = 0
  world.thumbRm.length = 0
  world.toasts.length = 0
  world.logInfo.length = 0
  world.logWarn.length = 0
  world.anchors = []
  world.secretDir = fs.mkdtempSync(path.join(TMP, 'secret-'))
  world.encAvailable = true
  world.encThrow = false
  world.upstream.length = 0
  world.upstreamBody = {}
  world.upstreamStatus = {}
  world.settings = defaults(over)
}

/** 走完"开始录制 → 停止"一次, 返回该任务的历史条目(未入库则为 null)。
 *  flags 在 reset 之后执行(reset 会复位伪 ffmpeg 的失败开关, 先设后被冲掉就等于没设) */
async function recordOnce(uid, nick, over = {}, flags = () => {}) {
  await reset(over)
  flags()
  await recorder.start({ platform: 'pandalive', userId: uid, nick, title: '', auto: false })
  const dir = listTask(uid).dirPath
  await recorder.stop('pandalive', uid)
  await waitUntil(() => recorder.list().length === 0)
  return { dir, item: hist().find((h) => h.userId === uid) || null }
}

// ============================================================================
console.log('\n--- A1 remux 失败不得留下可入库的半截 MP4 ---')
{
  const { dir, item } = await recordOnce('a1', 'Anchor One', { autoMp4: true, deleteTs: true }, () => {
    world.remuxFail = true
  })
  assert(media(dir).length === 2 && media(dir).every((n) => n.endsWith('.ts')) && segsIn(dir).length === 2, 'A1-1 目录里只剩 2 段 TS 分段', media(dir).join(','))
  assert(!anyOf(dir, '.mp4'), 'A1-2 没有半截 .mp4 落盘')
  assert(!anyOf(dir, '.part'), 'A1-3 失败产物 .part 被清走')
  assert(!!item && item.files.length === 2, 'A1-4 入库文件表 = 2 段 TS(坏包不进库)', item && JSON.stringify(item.files))
  assert(item.bytes === 1400, 'A1-5 字节数只算现存分段', String(item && item.bytes))
}

console.log('\n--- A2 remux 成功: .part 改名就位, deleteTs 只删已转换的那份 ---')
{
  const { dir, item } = await recordOnce('a2', 'Anchor Two', { autoMp4: true, deleteTs: true })
  assert(media(dir).length === 2 && media(dir).every((n) => n.endsWith('.mp4')), 'A2-1 产出 2 个 MP4 且 TS 已删', media(dir).join(','))
  assert(!anyOf(dir, '.part'), 'A2-2 不留 .part 中间产物')
  assert(!!item && item.files.every((f) => f.endsWith('.mp4')), 'A2-3 库里指向 MP4')
  const remuxCall = world.ffCalls.find((c) => c.kind === 'remux')
  assert(remuxCall && remuxCall.out.endsWith('.mp4.part'), 'A2-4 ffmpeg 目标就是 .part(不是终名直写)', remuxCall && remuxCall.out)
  assert(declaresMp4(remuxCall?.args), 'A2-6 .part 输出必须点名 -f mp4: 真 ffmpeg 按扩展名推断封装器, 猜不出就非零退出且不写一个字节(整条转码静默全灭)', remuxCall && remuxCall.args.join(' '))
  assert(world.thumbQ.length === 1, 'A2-5 有产物才排缩略图')
}

console.log('\n--- B1 分段合并: 昵称带单引号的 concat 转义 ---')
{
  const { dir, item } = await recordOnce('b1', "O'Neil", { autoMp4: true, deleteTs: true, mergeMp4: true, mergeDeleteSegments: false })
  const list = world.concatLists[0] || ''
  assert(list.includes("O\\'Neil"), "B1-1 concat list 用 ffmpeg 词法转义单引号", list.split('\n')[0])
  assert(!list.includes("'\\''"), 'B1-2 不再使用 shell 的引号转义惯用法')
  const mergeCall = world.ffCalls.find((c) => c.kind === 'concat')
  assert(mergeCall && mergeCall.out.endsWith('.mp4.part'), 'B1-3 合并产物先落 .part', mergeCall && mergeCall.out)
  assert(declaresMp4(mergeCall?.args), 'B1-3b 合并侧同样要点名输出封装器: 输入侧的 -f concat 管不到 .part 输出', mergeCall && mergeCall.args.join(' '))
  assert(wholeIn(dir).length === 1 && wholeIn(dir)[0].endsWith('.mp4'), 'B1-4 合并整文件就位(非分段形态的那一个)', media(dir).join(','))
  assert(segsIn(dir).length === 2, 'B1-5 未开删除时分段全留', media(dir).join(','))
  assert(!!item && item.files.length === 3, 'B1-6 库里同时索引整文件与分段', item && JSON.stringify(item.files.map((f) => path.basename(f))))
}

console.log('\n--- B2 合并失败: 不留半成品, 分段一个都不能少 ---')
{
  const { dir } = await recordOnce(
    'b2',
    "O'Neil",
    { autoMp4: true, deleteTs: true, mergeMp4: true, mergeDeleteSegments: true },
    () => {
      world.concatFail = true
    }
  )
  assert(wholeIn(dir).length === 0, 'B2-1 失败的合并不产出整文件', media(dir).join(','))
  assert(!anyOf(dir, '.part') && !anyOf(dir, '.concat.txt'), 'B2-2 .part/.concat.txt 都被清理', fs.readdirSync(dir).join(','))
  assert(segsIn(dir).length === 2, 'B2-3 分段未被"合并后删除分段"误删(数据丢失链封堵)', media(dir).join(','))
  assert(world.logWarn.some((l) => l.includes('分段合并失败')), 'B2-4 失败有日志留痕')
}

console.log('\n--- C1 拉源阶段停止: 零分段不写历史 ---')
{
  await reset()
  world.playDelayMs = 120
  const started = recorder.start({ platform: 'pandalive', userId: 'c1', nick: 'Slow Fetch', title: '', auto: false })
  await settle(20) // 此刻仍在 fetch 第一棒
  await recorder.stop('pandalive', 'c1')
  await started
  await settle(160) // 让在飞的取流回包落完(不得再 spawn)
  assert(world.history.length === 0 && world.addHistoryCalls === 0, 'C1-1 磁盘零文件 → 库里零条目')
  assert(world.ffCalls.length === 0, 'C1-2 停止后迟到的取流不回启 ffmpeg')
  assert(world.logInfo.some((l) => l.includes('零分段结束')), 'C1-3 零分段结束有日志说明')
  assert(recorder.list().length === 0, 'C1-4 无僵尸任务')
  assert(world.thumbQ.length === 0, 'C1-5 空条目不排缩略图')
}

console.log('\n--- D1 对账: 空骨架条目清掉, 别人的文件不许认领 ---')
{
  await reset()
  const mkDir = (n) => {
    const d = path.join(TMP, 'rec', 'd', n)
    fs.mkdirSync(d, { recursive: true })
    return d
  }
  const empty = mkDir('empty')
  const other = mkDir('other')
  fs.writeFileSync(path.join(other, '别人的会话_0001.ts'), 'x')
  const wiped = mkDir('wiped')
  const gone = path.join(TMP, 'rec', 'd', 'gone')
  world.history = [
    { id: 'd-empty', platform: 'pandalive', userId: 'd1', nick: '空条目', dirPath: empty, files: [], bytes: 0 },
    { id: 'd-other', platform: 'pandalive', userId: 'd2', nick: '他人媒体', dirPath: other, files: [], bytes: 0 },
    { id: 'd-wiped', platform: 'pandalive', userId: 'd3', nick: '文件删空', dirPath: wiped, files: [path.join(wiped, 'x_0001.ts')], bytes: 5 },
    { id: 'd-gone', platform: 'pandalive', userId: 'd4', nick: '目录已删', dirPath: gone, files: [], bytes: 0 }
  ]
  const r = recorder.reconcileHistory()
  assert(r.dropped === 3, 'D1-1 三条骨架/删空条目被移除', JSON.stringify(r))
  assert(hist().length === 1 && hist()[0].id === 'd-other', 'D1-2 目录内还有其它媒体时保守保留', JSON.stringify(hist()))
  assert(world.thumbRm.length === 3, 'D1-3 移除条目同步清缩略图')

  // D2 合并成品的索引稳定性: files 表里整文件排序在分段前, 对账不得因此认不出分段
  await reset()
  const dm = path.join(TMP, 'rec', 'd', 'merged')
  fs.mkdirSync(dm, { recursive: true })
  const names = ["合并者(m1)_20260101_120000.mp4", '合并者(m1)_20260101_120000_0001.mp4', '合并者(m1)_20260101_120000_0002.mp4']
  for (const n of names) fs.writeFileSync(path.join(dm, n), 'z'.repeat(100))
  const mf = names.map((n) => path.join(dm, n))
  world.history = [{ id: 'd-merged', platform: 'pandalive', userId: 'm1', nick: '合并者', dirPath: dm, files: mf, bytes: 300 }]
  const r2 = recorder.reconcileHistory()
  assert(r2.changed === 0 && r2.dropped === 0, 'D2-1 成品+分段的索引对账幂等(不改写、不移除)', JSON.stringify(r2))
  assert(hist()[0].files.length === 3, 'D2-2 在盘分段不会被基名误判而从库里抹掉', JSON.stringify(hist()[0].files.map((f) => path.basename(f))))
}

console.log('\n--- E1/E2 mergeTask 幂等与自喂防护 ---')
{
  await reset()
  const d = path.join(TMP, 'rec', 'e', 'E(a9)')
  fs.mkdirSync(d, { recursive: true })
  const s1 = path.join(d, 'E(a9)_0001.mp4')
  const s2 = path.join(d, 'E(a9)_0002.mp4')
  const out = path.join(d, 'E(a9).mp4')
  const writeSegs = () => {
    fs.writeFileSync(s1, 'A'.repeat(300))
    fs.writeFileSync(s2, 'B'.repeat(300))
    for (const f of [s1, s2]) fs.utimesSync(f, new Date(), new Date())
  }
  const item = { id: 'e-1', platform: 'pandalive', userId: 'a9', nick: 'E', dirPath: d, files: [s1, s2], bytes: 600 }

  // E1-a: 0 字节整文件 = 上次被腰斩, 必须重做
  writeSegs()
  fs.writeFileSync(out, '')
  world.history = [{ ...item, files: [s1, s2, out] }]
  world.ffCalls.length = 0
  let r = await recorder.mergeTask('e-1')
  assert(r.ok && fs.statSync(out).size > 0, 'E1-a 零字节整文件被重新合并覆盖(不再谎报成功)')
  assert(world.ffCalls.some((c) => c.kind === 'concat'), 'E1-b 确实重跑了一次 concat')
  assert(!fs.existsSync(out + '.part'), 'E1-c 就位后不留 .part')

  // E2: 整文件绝不进自己的输入表
  writeSegs()
  fs.writeFileSync(out, '')
  world.concatLists.length = 0
  world.history = [{ ...item, files: [out, s1, s2] }]
  r = await recorder.mergeTask('e-1')
  const list = world.concatLists[world.concatLists.length - 1] || ''
  const listPaths = list.split('\n').filter(Boolean).map((l) => l.replace(/^file '/, '').replace(/'$/, ''))
  assert(r.ok && !listPaths.some((p) => path.basename(p) === 'E(a9).mp4'), 'E2-a concat 输入表里没有整文件(成品不再套一遍)', list)
  assert(listPaths.length === 2, 'E2-b 两段分段都在输入表且仅此两段', JSON.stringify(listPaths))

  // E1-d: 过期整文件(合并后又续录过) → 重做
  writeSegs()
  fs.writeFileSync(out, 'W'.repeat(500))
  fs.utimesSync(out, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  world.ffCalls.length = 0
  world.history = [{ ...item, files: [s1, s2, out] }]
  r = await recorder.mergeTask('e-1')
  assert(r.ok && world.ffCalls.some((c) => c.kind === 'concat'), 'E1-d 早于分段的整文件判为过期并重做')
  assert(world.logWarn.some((l) => l.includes('既有整文件不可用')), 'E1-e 重做原因有日志')

  // E1-f: 健康整文件 → 直接成功, 零 ffmpeg
  fs.writeFileSync(out, 'W'.repeat(500))
  world.ffCalls.length = 0
  world.history = [{ ...item, files: [s1, s2, out] }]
  r = await recorder.mergeTask('e-1')
  assert(r.ok && world.ffCalls.length === 0, 'E1-f 健康的整文件幂等命中, 不重复合并')

  // E2-c: 只有一段 → 明确拒合并
  fs.rmSync(out, { force: true })
  fs.rmSync(s2, { force: true })
  world.history = [{ ...item, files: [s1] }]
  r = await recorder.mergeTask('e-1')
  assert(!r.ok && r.error === 'rec.mergeFew', 'E2-c 单段拒合并并给出原因', JSON.stringify(r))
}

console.log('\n--- F1 房间入参: isRoomId 与 parseRoomInput 同一把尺 ---')
{
  const { isRoomId, parseRoomInput } = types
  const bad = ['', 'a/b', 'a\\b', '..\\..\\windows', '../../etc/passwd', 'a..b', 'a.', 'a b', 'x'.repeat(81), 'a\u0000b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', '%04d', null, undefined, 42]
  const badKept = bad.filter((v) => isRoomId(v))
  assert(badKept.length === 0, 'F1-1 路径穿越/保留字符/控制字符/超长一律拒', JSON.stringify(badKept))
  const good = ['abcdefgh', 'soop_channel_1', 'a.b-c', 'x'.repeat(80)]
  assert(good.every((v) => isRoomId(v)), 'F1-2 正常登录名/频道名不误杀')
  assert(parseRoomInput('https://www.pandalive.co.kr/play/abc123')?.userId === 'abc123', 'F1-3 Panda 链接解析正常')
  assert(parseRoomInput('https://play.sooplive.com/ch_x')?.userId === 'ch_x', 'F1-4 SOOP 链接解析正常')
  assert(parseRoomInput('x'.repeat(81)) === null, 'F1-5 超长 ID 不入库(与主进程同口径)')
  assert(parseRoomInput('../../etc/passwd', 'pandalive') === null, 'F1-6 穿越形态输入解析不出房间')
  const sn = strictName("a\\/:*?\"<>|%b  c..")
  assert(sn === 'ab c', 'F1-7 落盘名剔除非法字符与尾部点', JSON.stringify(sn))
  assert(strictName('%') === 'app.unnamed', 'F1-8 全非法名退化为未命名(mt 替身返回键名)')
}

console.log('\n--- G1/G2/G3 本地 HLS 代理访问面 ---')
{
  const { HlsProxy } = loadTs('src/main/services/hlsProxy.ts')
  const proxies = []
  const mk = async () => {
    const p = new HlsProxy({ headers: world.hdrFor, sessionPartition: 'persist:soop', onDeadUpstream: () => {} })
    await p.listen()
    proxies.push(p)
    return p
  }
  const get = async (url) => {
    const res = await fetch(url)
    return { status: res.status, text: await res.text() }
  }
  const p = await mk()
  const up = 'https://live.sooplive.com/abc/720.m3u8'
  const signed = p.playlistUrl(up)
  const token = new URL(signed).searchParams.get('t')
  assert(/^[0-9a-f]{32}$/.test(token || ''), 'G1-0 播放清单地址带 32 位令牌', token)

  const noToken = await get(`http://127.0.0.1:${new URL(signed).port}/playlist.m3u8?url=${encodeURIComponent(up)}`)
  assert(noToken.status === 403 && noToken.text === 'bad token', 'G1-1 缺令牌的请求 403(本机其它进程扫端口无用)', JSON.stringify(noToken))
  const wrongToken = await get(`http://127.0.0.1:${new URL(signed).port}/playlist.m3u8?t=deadbeef&url=${encodeURIComponent(up)}`)
  assert(wrongToken.status === 403, 'G1-2 令牌错误 403')
  const notSigned = await get(`http://127.0.0.1:${new URL(signed).port}/playlist.m3u8?t=${token}&url=${encodeURIComponent('https://evil.example.com/x.m3u8')}`)
  assert(notSigned.status === 403 && notSigned.text === 'target not allowed', 'G1-3 未签发 origin 403(不是开放代理)', JSON.stringify(notSigned))
  const badUrl = await get(`http://127.0.0.1:${new URL(signed).port}/media?t=${token}&url=file:///c:/windows/win.ini`)
  assert(badUrl.status === 400, 'G1-4 非 http(s) 目标 400')

  const okRes = await get(signed)
  assert(okRes.status === 200 && okRes.text.includes('#EXTM3U'), 'G2-1 已签发地址正常出清单')
  assert(!okRes.text.includes('preloading'), 'G2-2 预载分段被过滤')
  const mediaLine = okRes.text.split('\n').find((l) => l.includes('/media'))
  assert(mediaLine && mediaLine.includes(`t=${token}`), 'G2-3 重写后的分段地址继承本实例令牌', mediaLine)
  assert(world.upstream.some((u) => u.headers.Cookie === 'sess=1'), 'G2-4 上游请求带注入的 Cookie 头')
  const p2 = await mk()
  const cross = await get(`http://127.0.0.1:${new URL(p2.playlistUrl(up)).port}/playlist.m3u8?t=${token}&url=${encodeURIComponent(up)}`)
  assert(cross.status === 403, 'G2-5 跨实例令牌互不通用(每实例独立随机)')

  // G3: 签发表有上限且按活跃度淘汰
  const p3 = await mk()
  const t3 = new URL(p3.playlistUrl('https://cdn0.example.com/a.m3u8')).searchParams.get('t')
  const port3 = new URL(p3.playlistUrl(up)).port
  for (let i = 0; i < 40; i++) p3.playlistUrl(`https://cdn${i}.example.com/a.m3u8`)
  assert(p3.allowedOrigins.size <= 32, 'G3-1 签发 origin 表不超上限(长跑不涨面)', String(p3.allowedOrigins.size))
  const evicted = await get(`http://127.0.0.1:${port3}/playlist.m3u8?t=${t3}&url=${encodeURIComponent('https://cdn0.example.com/a.m3u8')}`)
  assert(evicted.status === 403, 'G3-2 最久未用的 origin 被淘汰后取不到')
  const kept = await get(`http://127.0.0.1:${port3}/playlist.m3u8?t=${t3}&url=${encodeURIComponent('https://cdn39.example.com/a.m3u8')}`)
  assert(kept.status === 200, 'G3-3 活跃 origin 保留')
  // 重复签发刷新时效: 反复签 cdn0 不该被淘汰
  const p4 = await mk()
  const t4 = new URL(p4.playlistUrl(up)).searchParams.get('t')
  const port4 = new URL(p4.playlistUrl(up)).port
  for (let i = 0; i < 60; i++) p4.playlistUrl(i % 2 ? `https://x${i}.example.com/a.m3u8` : 'https://keep.example.com/a.m3u8')
  const keepRes = await get(`http://127.0.0.1:${port4}/playlist.m3u8?t=${t4}&url=${encodeURIComponent('https://keep.example.com/a.m3u8')}`)
  assert(keepRes.status === 200, 'G4-1 反复签发的活跃 CDN 不被淘汰(否则录制自断)')
  for (const pr of proxies) {
    pr.server.closeAllConnections?.()
    await new Promise((res) => pr.server.close(res))
  }
}

console.log('\n--- H1 无系统密钥时的机密降级必须说实话 ---')
{
  const loadFresh = () => {
    moduleCache.delete('src/main/services/secrets.ts')
    return loadTs('src/main/services/secrets.ts').secrets
  }
  // H1: 密钥可用 → enc: 落盘, degraded=false
  await reset()
  let s = loadFresh()
  s.set('tgToken', '123:ABC')
  const raw = fs.readFileSync(path.join(world.secretDir, 'secrets.dat'), 'utf-8')
  assert(raw.startsWith('enc:'), 'H1-1 密钥可用时以 enc: 封装落盘')
  assert(s.degraded === false, 'H1-2 正常态不谎报降级')
  assert(s.get('tgToken') === '123:ABC', 'H1-3 取回原值')
  // H2: 密钥不可用 → plain: 落盘 + degraded + 日志
  await reset()
  world.encAvailable = false
  s = loadFresh()
  s.set('tgToken', '123:ABC')
  const raw2 = fs.readFileSync(path.join(world.secretDir, 'secrets.dat'), 'utf-8')
  assert(raw2.startsWith('plain:'), 'H2-1 无系统密钥时降级 plain 封装')
  assert(s.degraded === true, 'H2-2 degraded 如实上报(UI 据此提示)')
  assert(world.logWarn.some((l) => l.includes('系统密钥不可用')), 'H2-3 降级有日志留痕(不再静默)')
  assert(Buffer.from(raw2.slice(6), 'base64').toString('utf-8').includes('123:ABC'), 'H2-4 plain 确为可逆编码(风险描述属实)')
  // H3: 磁盘仍是 plain, 系统密钥恢复 → 仍报降级, 直到下次写入才转 enc
  moduleCache.delete('src/main/services/secrets.ts')
  world.encAvailable = true
  s = loadFresh()
  assert(s.degraded === true, 'H3-1 磁盘那份还是明文时不谎称已加密')
  s.set('tgToken', '123:ABC')
  const raw3 = fs.readFileSync(path.join(world.secretDir, 'secrets.dat'), 'utf-8')
  assert(raw3.startsWith('enc:') && s.degraded === false, 'H3-2 下次写入即迁回 enc, 状态同步澄清')
  // H4: 加密路径本身抛错(如 DPAPI 抖动) → 降级但不静默
  await reset()
  world.encThrow = true
  s = loadFresh()
  s.set('tgToken', '123:ABC')
  assert(fs.readFileSync(path.join(world.secretDir, 'secrets.dat'), 'utf-8').startsWith('plain:'), 'H4-1 加密写入异常时回落明文')
  assert(world.logWarn.some((l) => l.includes('加密写入失败')), 'H4-2 异常路径同样留痕')
  assert(s.get('tgToken') === '123:ABC', 'H4-3 功能不因降级中断(值仍可用)')
}

console.log(`\n==== 结果: ${PASS} 通过 / ${FAIL} 失败 ====`)
if (FAIL) {
  console.log('失败项:\n - ' + fails.join('\n - '))
  process.exit(1)
}
console.log(`解读: A1/A2 PASS ⇒ remux 只以 .part 直写, 成功才改名就位; 失败的半截产物既不入库也不留盘;
      B1 PASS ⇒ concat 用 ffmpeg 词法 \\' 转义(旧 shell 惯用法让含 ' 的昵称必炸);
      B2 PASS ⇒ 合并失败不产整文件且分段零误删(原"坏包混进合并池→合并成功→删好段"数据丢失链封堵);
      C1 PASS ⇒ 拉源期停止不再留下永远打不开的空历史; D1 PASS ⇒ 对账能把历史骨架清掉且不认领他人文件;
      E1/E2 PASS ⇒ mergeTask 只认同样"非空 + 不早于任一分段"的整文件, 且成品永不进自己的输入表;
      F1 PASS ⇒ 房间寻址与落盘名只接受可寻址字符(渲染层被注入也无法拼出穿越路径);
      G1~G4 PASS ⇒ 本地代理只服务本实例签发过且带令牌的地址, 签发表有上限;
      H1 PASS ⇒ 无系统密钥的明文降级由 degraded 说出来并落日志, 不再只躺在 console.warn 里.`)
console.log(`临时目录: ${TMP}`)
process.exit(0)
