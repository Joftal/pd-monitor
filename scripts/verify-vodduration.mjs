// ============================================================================
// 验证脚本: 回放下载的全长分母 —— pandalive.fetchPlaylistDurationSec 与它的两个消费端
//
// 背景: vodTotalSec 是回放进度条唯一的分母(recorder.ts 拉源后写入 → 渲染层 vodPct 换算)。
//       它算错 = 进度条说谎; 它算不出(0)时若被当成"0%", 比不画进度条更骗人。
//       本脚本此前不存在, 因为 verify-p1.mjs 把整个 ./pandalive 替成了
//       { api: { fetchPlaylistDurationSec: async () => 0 } } —— 替身绿, 真函数从未被跑过。
// 方法: 只 sucrase 现编译 src/main/services/pandalive.ts(真实源码, 含真实 EXTINF 解析),
//       electron 的 session.fetch 换成可注入文本的替身; 主机名一律 .invalid,
//       未分派的 URL 直接抛 → 任何漏网请求不可能悄悄打到真网络。
// 场景:
//   V1 真实媒体清单求和: 小数段 + 尾逗号 + 干扰行(MAP/PROGRAM-DATE-TIME/TARGETDURATION)不计入
//   V2 行尾 CRLF 与前后空白: 同一份清单跨平台换行不改分和
//   V3 只给 variant 行的 master 清单 → 0(分母未知, 不是"0 秒的片子")
//   V4 脏 EXTINF 行只丢那一行: 缺数字 / 字母 / 负数(preload 段写法) 一律不进和
//   V5 非清单应答(风控 HTML / 空串)→ 0
//   V6 HTTP 403 → 0, 且全程只发一次请求(状态码错误绝不走 Node 通道重发)
//   V7 长清单的浮点累加误差落进整秒不被读出(进度百分比的分母容差)
//   V8 接线: 真实函数被 recorder 调用并写进 vodTotalSec; 分母 0 时渲染层退文字而非 0%
// ============================================================================
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { transform } = require('sucrase')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (name, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

// ---------- 替身网络: 只认 .invalid, 其余一律抛(绝不真发) ----------
const world = { body: '', status: 200, calls: [] }
const fakeRes = (status, text) => ({
  status,
  text: async () => text,
  headers: { getSetCookie: () => [] }
})
const fakeFetch = async (url) => {
  const u = new URL(url)
  if (!u.hostname.endsWith('.invalid')) throw new Error('fakeFetch 未分派(不允许真网络): ' + url)
  world.calls.push(url)
  return fakeRes(world.status, world.body)
}

const mocks = {
  electron: {
    BrowserWindow: { getAllWindows: () => [] },
    session: { fromPartition: () => ({ fetch: fakeFetch, setProxy: async () => {}, setUserAgent() {} }) },
    net: { fetch: fakeFetch }
  },
  '../util': { UA: 'verify-script', sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  './vault': { vault: { encrypted: false, load: () => null, save() {}, clear() {} } },
  './logger': { logger: { info() {}, warn() {} } },
  '../i18n': { mt: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k), setMainLocale() {} },
  './store': { store: { getSettings: () => ({ proxyUrl: '' }), listAnchors: () => [] } }
}

const moduleCache = new Map()
function loadTs(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const file = path.join(ROOT, rel)
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code
  const m = { exports: {} }
  moduleCache.set(rel, m)
  const localRequire = (id) => {
    if (id in mocks) return mocks[id]
    if (id === '../../shared/types') return loadTs('src/shared/types.ts')
    return require(id)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(m.exports, localRequire, m, file, path.dirname(file))
  return m.exports
}

const { api } = loadTs('src/main/services/pandalive.ts')
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const ask = async (body, status = 200) => {
  world.body = body
  world.status = status
  const before = world.calls.length
  const v = await api.fetchPlaylistDurationSec('https://vod-cdn.invalid/master.m3u8')
  return { v, sent: world.calls.length - before }
}

// ============================================================================
console.log('\n■ V1 真实媒体清单: 小数段求和, 干扰行不进和')
{
  const r = await ask(
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXTINF:9.676,',
      'seg-0.ts',
      '#EXT-X-KEY:METHOD=AES-128,URI="k.bin"',
      '#EXTINF:9.676,',
      'seg-1.ts',
      '#EXT-X-PROGRAM-DATE-TIME:2026-09-29T12:00:00.000Z',
      '#EXTINF:8.141,',
      'seg-2.ts',
      '#EXT-X-ENDLIST'
    ].join('\n')
  )
  check('V1-1 三段小数按 27.493 求和', Math.abs(r.v - 27.493) < 1e-9, String(r.v))
  check('V1-2 真的走了一次 fetchText(替身被调用)', r.sent === 1, `发请求 ${r.sent} 次`)
}

console.log('\n■ V2 CRLF 与前后空白不改分和(Windows 抓下来的清单与 Linux 同一结果)')
{
  const unix = '#EXTM3U\n#EXTINF:6.0,\na.ts\n#EXTINF:4.5,\nb.ts\n#EXT-X-ENDLIST\n'
  const crlf = unix.replace(/\n/g, '\r\n')
  const padded = '#EXTM3U\n   #EXTINF:6.0,\r\na.ts\n#EXTINF:4.5,\nb.ts\n#EXT-X-ENDLIST\n'
  const a = await ask(unix)
  const b = await ask(crlf)
  const c = await ask(padded)
  check('V2-1 LF 求和 10.5', Math.abs(a.v - 10.5) < 1e-9, String(a.v))
  check('V2-2 CRLF 与 LF 同分', b.v === a.v, String(b.v))
  check('V2-3 行首缩进行尾空白照计', Math.abs(c.v - 10.5) < 1e-9, String(c.v))
}

console.log('\n■ V3 master 清单(只有 variant 行) → 0 = 全长未知, 而不是"0 秒的片子"')
{
  const r = await ask('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080p.m3u8\n')
  check('V3-1 master 返回 0', r.v === 0, String(r.v))
}

console.log('\n■ V4 脏 EXTINF 行只丢那一行, 绝不把 NaN/负数带进和')
{
  const r = await ask(
    [
      '#EXTM3U',
      '#EXTINF:,x.ts', // 空时长
      '#EXTINF:abc,', // 非数字
      '#EXTINF:-0.001,', // 预载段的负时长写法
      '#EXTINF:1.2.3,', // 双小数点: 正则的 [\d.]+ 会收下, Number() 得 NaN(护栏就为这条)
      '#EXTINF:',
      'good.ts',
      '#EXTINF:12.0,',
      'good2.ts'
    ].join('\n')
  )
  check('V4-1 五条脏行全弃, 只计 12', r.v === 12, String(r.v))
  check('V4-2 结果不是 NaN(NaN 会击穿整条进度估算)', !Number.isNaN(r.v), String(r.v))
}

console.log('\n■ V5 非清单应答(风控 HTML / 空串)→ 0')
{
  const html = await ask('<!DOCTYPE html><html><body>Access Denied</body></html>')
  const empty = await ask('')
  check('V5-1 HTML 页返回 0', html.v === 0, String(html.v))
  check('V5-2 空响应体返回 0', empty.v === 0, String(empty.v))
}

console.log('\n■ V6 HTTP 403 → 0, 且状态码错误不触发 Node 通道重发')
{
  const r = await ask('#EXTM3U\n#EXTINF:6.0,\na.ts\n', 403)
  check('V6-1 403 退化为 0(不定进度)', r.v === 0, String(r.v))
  check('V6-2 全程只发 1 次请求(同一请求打两遍会放大风控面)', r.sent === 1, `发请求 ${r.sent} 次`)
}

console.log('\n■ V7 长清单浮点累加: 误差必须落在整秒读数之内')
{
  const segs = Array.from({ length: 3600 }, (_, i) => `#EXTINF:2.997,\ns${i}.ts`).join('\n')
  const r = await ask('#EXTM3U\n' + segs + '\n#EXT-X-ENDLIST\n')
  check('V7-1 3600 段 2.997s ≈ 10789.2s(误差 < 0.01)', Math.abs(r.v - 3600 * 2.997) < 1e-2, String(r.v))
  check('V7-2 换算成分钟不抖(整秒容差内)', Math.round(r.v / 60) === 180, String(Math.round(r.v / 60)))
}

console.log('\n■ V8 接线: 真实函数被录制管线调用, 分母为 0 时界面退文字而不是画 0% 空条')
{
  const rec = src('src/main/services/recorder.ts')
  const view = src('src/renderer/src/views/RecordingsView.vue')
  const impl = src('src/main/services/pandalive.ts')
  check('V8-0 被测函数是真实现(源码里确有 EXTINF 求和)', /#EXTINF:\(\[\\d\.\]\+\)/.test(impl))
  check('V8-1 recorder 拉源后写入 vodTotalSec', /this\.vodTotalSec = await api\.fetchPlaylistDurationSec\(src\)/.test(rec))
  check('V8-2 vodDoneSec 与 vodTotalSec 同源于 -progress 管道', /out_time_ms/.test(rec) && /vodDoneSec = Number/.test(rec))
  check('V8-3 分母为 0 时 vodPct 返回 null(退回文字呈现)', /if \(!task\.vodTotalSec\) return null/.test(view))
  check('V8-4 段头 caption 不把回放当直播(recorder 两条 spawn 分支的既有事实)', /some\(\(task\) => !task\.vod\)/.test(view))
}

console.log('\n' + '─'.repeat(72))
check('V0 反空转下限: 本脚本真的发过 ≥10 次清单请求(每个场景各一次)', world.calls.length >= 10, `累计 ${world.calls.length} 次`)
console.log('\n' + '─'.repeat(72))
console.log(`结果: ${failures === 0 ? '全部按预期' : failures + ' 条与预期不符'}`)
console.log('解读: V1~V5 PASS ⇒ 分母只在"真的数得出"时给出, 数得出时精确到毫秒;')
console.log('      V6 PASS ⇒ 拉不到的清单不会顺手打第二遍(风控面不放大);')
console.log('      V7 PASS ⇒ 三小时回放的累加误差不会改变用户看到的分钟数;')
console.log('      V8 PASS ⇒ 主进程算出的分母确实进到了进度条, 且 0 分母显示为不定进度而非 0%.')
process.exit(failures === 0 ? 0 : 1)
