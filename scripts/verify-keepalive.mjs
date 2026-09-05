// ============================================================================
// 验证脚本: 源保活泵 与 全部拉取通道的交互正确性(do not depend on Electron)
//
// 方法: electron/store/notify 等依赖替换为可计数 mock; 真实加载 pandalive.ts(sucrase 现编译);
//       keepaliveTick 以私有方法直调驱动(等效 15s 定时器, 测试不等待).
// 场景:
//   S1  基线: 缓存源后 tick 只发 CDN 心跳(全档齐养), 零 pandalive API 请求
//   S2  下播跳过: anchor 离线 → tick 对该源零请求
//   S3  网络层失败不计死: 全网络异常 × 3 tick → 缓存原样, 零重铸(防断网团灭)
//   S4  主档 404 单次不误杀: strike=1 不清缓存
//   S5  主档连续 404: 收尸 + 在播+预取 → 重铸一发, 心跳恢复
//   S6  满员重铸失败: 收尸后保持熄灭, 后续 tick 不再重复打 API
//   S7  副档 404 仅观测: 不收尸不重铸
//   S8  vod 回放包: tick 跳过(静态分片无活性概念)
//   S9  开关关闭: keepaliveStream=false → tick 零请求
//   S10 未关注的缓存源(临时进房): 照常养(回访场景)
//   S11 重铸并发去重: 保活重铸与手动拉源同 userId → fetchPlay 实发一次
//   S12 tick 自重叠: 并发两 tick, 第二个立即返回(心跳不翻倍)
// ============================================================================
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { transform } = require('sucrase')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let PASS = 0
let FAIL = 0
const fails = []
function assert(cond, name) {
  if (cond) {
    PASS++
    console.log(`  [PASS] ${name}`)
  } else {
    FAIL++
    fails.push(name)
    console.log(`  [FAIL] ${name}`)
  }
}
const tick = () => api.keepaliveTick()
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

// ---------- 伪造世界 ----------
const world = {
  anchors: [], // {userId, isLive}
  playCalls: [], // /v1/live/play 实发记录
  cdnCalls: [], // CDN 请求记录 [{url, via}]
  variantMode: 'ok', // ok | dead404 | all404 | network | secondary404
  playOk: true, // 拉源是否成功(满员=false)
  playLatencyMs: 0
}

const MASTER_TEXT =
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nv1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\nv720.m3u8\n'

const fakeRes = (status, obj) => ({
  status,
  text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
  headers: { getSetCookie: () => [] }
})

const fakeFetch = async (url, init = {}) => {
  const u = new URL(url)
  if (u.hostname === 'api.pandalive.co.kr' && u.pathname === '/v1/live/play') {
    const userId = new URLSearchParams(init.body || '').get('userId')
    world.playCalls.push(userId)
    if (world.playLatencyMs) await settle(world.playLatencyMs)
    if (world.play403) return fakeRes(403, 'risk') // rawFetch → RiskError
    if (!world.playOk) return fakeRes(200, { result: false, message: '房间已满员' })
    return fakeRes(200, {
      result: true,
      PlayList: { hls: [{ url: `https://x.live-video.net/${userId}/master.m3u8` }] },
      media: { title: 't', userNick: 'n', liveType: userId === 'recroom' ? 'rec' : 'live', thumbUrl: '', userImg: '' }
    })
  }
  if (u.hostname.endsWith('live-video.net')) {
    world.cdnCalls.push(u.pathname)
    if (u.pathname.endsWith('/master.m3u8')) return fakeRes(200, MASTER_TEXT) // fetchVariants 拉源时一次性
    // 分档心跳行为
    if (world.variantMode === 'network') throw new Error('ECONNRESET(sim)') // 无 httpStatus: 网络层
    if (world.variantMode === 'all404') return fakeRes(404, 'nf')
    if (world.variantMode === 'dead404' && u.pathname.endsWith('/v1080.m3u8')) return fakeRes(404, 'nf')
    if (world.variantMode === 'secondary404' && u.pathname.endsWith('/v720.m3u8')) return fakeRes(404, 'nf')
    return fakeRes(200, '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\ns1.ts\n')
  }
  throw new Error('fakeFetch 未分派: ' + url)
}

// ---------- store mock ----------
const db = { anchors: [], settings: null, history: [] }
const store = {
  listAnchors: () => db.anchors,
  updateAnchor: (userId, patch) => {
    const a = db.anchors.find((x) => x.userId === userId)
    if (a) Object.assign(a, patch)
  },
  addAnchor: (a) => db.anchors.push(a),
  removeAnchor: (userId) => {
    db.anchors = db.anchors.filter((x) => x.userId !== userId)
  },
  getSettings: () => db.settings,
  setSettings: (p) => {
    db.settings = { ...db.settings, ...p }
    return db.settings
  },
  flush() {},
  listHistory: () => db.history,
  addHistory() {}
}
db.settings = {
  savePath: '', splitSeconds: 900, autoMp4: true, deleteTs: false,
  pollIntervalSec: 30, requestGapMs: 300, proxyUrl: '', watchMode: 'list',
  notifySystem: false, notifySound: false, autoRecordDefault: false,
  closeToTray: false, diskLimitGb: 1, prefetchStream: true, keepaliveStream: true,
  mergeMp4: false, mergeDeleteSegments: true, autoRetryRecord: false,
  theme: 'light', locale: 'zh-CN'
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
  '../i18n': { mt: (k) => k, setMainLocale() {} },
  './store': { store }
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
    if (id in mocks) return mocks[id]
    if (id === './pandalive') return loadTs('src/main/services/pandalive.ts')
    if (id === '../../shared/types') return loadTs('src/shared/types.ts')
    return require(id)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(m.exports, localRequire, m, file, path.dirname(file))
  return m.exports
}

const { api } = loadTs('src/main/services/pandalive.ts')

// ---------- 场景 ----------
function resetWorld() {
  db.anchors.length = 0
  world.playCalls.length = 0
  world.cdnCalls.length = 0
  world.variantMode = 'ok'
  world.playOk = true
  world.playLatencyMs = 0
  world.play403 = false
  api.clearPlayCache()
  api.remintCooldownUntil = 0 // 重铸风控冷却跨场景复位(S14)
}

const variantCount = (userId) => world.cdnCalls.filter((p) => p.includes(`/${userId}/`) && !p.endsWith('/master.m3u8')).length
const markCdn = () => world.cdnCalls.length
const markPlay = () => world.playCalls.length

console.log('\n===== S1-S12 源保活泵交互验证 =====\n')

// S1 基线 + S7 全档齐养
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
const apiCallsAtCache = markPlay()
await tick()
assert(variantCount('a') === 2, 'S1-1 每 tick 全档齐养: 2 个分档各 1 次心跳')
assert(markPlay() === apiCallsAtCache, 'S1-2 保活 tick 零 pandalive API 请求(fetchPlay/fetchBj)')
assert(api.cachedSourceIds().includes('a'), 'S1-3 缓存保持有效')

// S2 下播跳过
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
db.anchors[0].isLive = false // 下播
const c0 = markCdn()
await tick()
assert(world.cdnCalls.length === c0, 'S2 已下播主播的缓存源: tick 零心跳(死亡属预期, 不耗请求)')

// S3 网络层失败 ×3 不团灭
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
world.variantMode = 'network'
await tick()
await tick()
await tick()
assert(api.cachedSourceIds().includes('a'), 'S3-1 网络层异常 × 3 tick: 缓存不动, 无误收尸')
assert(world.playCalls.filter((u) => u === 'a').length === 1, 'S3-2 网络层异常: 零重铸 API 调用')

// S4 主档 404 单次不误杀
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
world.variantMode = 'dead404'
await tick()
assert(api.cachedSourceIds().includes('a'), 'S4 主档 404 × 1: strike=1, 缓存保留(单次不误杀)')

// S5 连续两次真死: 收尸 + 重铸一发
await tick() // 第二次 dead404
// 重铸经串行链(含 ~1.2s 抖动间隙)延后执行: 轮询等待实发(上限 3s)
for (let i = 0; i < 30 && world.playCalls.filter((u) => u === 'a').length < 2; i++) await settle(100)
assert(world.playCalls.filter((u) => u === 'a').length === 2, 'S5-1 连续 2 次真死: 收尸后重铸 fetchPlay 一发')
assert(api.cachedSourceIds().includes('a'), 'S5-2 重铸成功(房未满): 缓存复活, 心跳可恢复')
world.variantMode = 'ok'
await tick()
assert(variantCount('a') >= 2, 'S5-3 重铸后心跳继续齐养(新源已接管)')

// S6 满员: 重铸失败, 保持熄灭且不再骚扰 API
resetWorld()
db.anchors.push({ userId: 'full', isLive: true })
await api.getPlayCached('full')
world.variantMode = 'dead404'
await tick()
world.playOk = false // 房间满员
await tick()
for (let i = 0; i < 30 && world.playCalls.filter((u) => u === 'full').length < 2; i++) await settle(100) // 重铸链轮询待尽
const playsAfterFull = world.playCalls.filter((u) => u === 'full').length
assert(playsAfterFull === 2 && !api.cachedSourceIds().includes('full'), 'S6-1 满员: 收尸+重铸一发失败后保持熄灭')
const playsMark = world.playCalls.filter((u) => u === 'full').length
await tick()
await tick()
assert(world.playCalls.filter((u) => u === 'full').length === playsMark, 'S6-2 熄灭的源: 后续 tick 零心跳零重试(不再骚扰 API)')

// S7 副档 404 仅观测
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
world.variantMode = 'secondary404'
await tick()
await tick()
assert(api.cachedSourceIds().includes('a'), 'S7-1 副档 404 × 2: 不收尸(主档活着即不判死)')
assert(world.playCalls.filter((u) => u === 'a').length === 1, 'S7-2 副档 404: 零重铸')

// S8 vod 回放包跳过
resetWorld()
db.anchors.push({ userId: 'recroom', isLive: true })
await api.getPlayCached('recroom') // liveType=rec → vod 包
const c1 = markCdn()
await tick()
assert(world.cdnCalls.length === c1, 'S8 vod 回放包: tick 零心跳(静态分片无活性)')

// S9 开关关闭零请求
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
store.setSettings({ keepaliveStream: false })
const c2 = markCdn()
await tick()
assert(world.cdnCalls.length === c2, 'S9 keepaliveStream=false: tick 零请求(开关即时生效)')
store.setSettings({ keepaliveStream: true })

// S10 未关注的缓存源照常养
resetWorld()
await api.getPlayCached('guest') // 临时进房, 不在关注列表
await tick()
assert(variantCount('guest') === 2, 'S10 未关注缓存源(回访场景): 照常齐养')

// S11 重铸与手动拉源并发去重
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
world.variantMode = 'dead404'
world.playLatencyMs = 120
await tick() // strike=1
await tick() // strike=2: 收尸+重铸经串行链延迟
for (let i = 0; i < 30 && world.playCalls.filter((u) => u === 'a').length < 2; i++) await settle(100) // 待重铸实发(在飞, 120ms 延迟)
const manualP = api.getPlayCached('a') // 用户同时手动进房 → 应命中在途复用而非再发一发
await settle(200)
await manualP
assert(world.playCalls.filter((u) => u === 'a').length === 2, 'S11 重铸×手动并发: playInflight 去重合并, fetchPlay 实发 2 次(基线1+合并1)而非 3')

// S12 tick 自重叠防护
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
world.variantMode = 'ok'
const c3 = markCdn()
const p1 = tick()
const p2 = tick() // 应立即空返回
await Promise.all([p1, p2])
assert(variantCount('a') === 2 + 0, 'S12 并发 tick: keepaliveBusy 守卫, 心跳不翻倍')

// S13 状态投影(播放页"播放源卡"数据源)
resetWorld()
db.anchors.push({ userId: 'a', isLive: true })
await api.getPlayCached('a')
let st = api.keepaliveStatus('a')
assert(st.cached === true && st.lastAt === 0, 'S13-1 首心跳前投影: cached=true, lastAt=0(未心跳)')
await tick()
st = api.keepaliveStatus('a')
assert(st.lastAt > 0 && st.lastOk && st.variants === 2 && st.enabled === true, 'S13-2 心跳后投影: 时刻/档位/开关齐备')
const at1 = st.lastAt
db.anchors[0].isLive = false
await tick()
assert(api.keepaliveStatus('a').lastAt === at1, 'S13-3 下播 tick 跳过: 心跳时刻不前进')
store.setSettings({ keepaliveStream: false })
assert(api.keepaliveStatus('a').enabled === false, 'S13-4 enabled 实时反映设置开关')
store.setSettings({ keepaliveStream: true })
api.invalidatePlay('a')
st = api.keepaliveStatus('a')
assert(st.cached === false && st.lastAt === 0, 'S13-5 作废后状态清档(不残留尸态)')

// S14 重铸风控自闭环: 重铸撞 403 → 全链冷却 5 分钟, 后续收尸重铸直接丢弃(零请求)
resetWorld()
db.anchors.push({ userId: 'd1', isLive: true }, { userId: 'd2', isLive: true })
await api.getPlayCached('d1')
await api.getPlayCached('d2')
world.variantMode = 'dead404'
world.play403 = true
world.playLatencyMs = 150 // 重铸 d1 慢行: 保证 d2 在冷却立下之前已入队 —— 专治"时序运气"(结构检查必考)
await tick() // 双双 strike=1
await tick() // 双双收尸 → d1 重铸撞 403 → 冷却; d2 入队即丢弃(链步内二次检查)
for (let i = 0; i < 30 && world.playCalls.filter((u) => u === 'd1').length < 2; i++) await settle(100)
await settle(300) // 留 d2 若有漏按的时间(不应有)
assert(api.keepaliveStatus('d1').cached === false, 'S14-1 重铸撞风控后保持熄灭')
assert(world.playCalls.filter((u) => u === 'd1').length === 2, 'S14-2 d1 重铸整好一发(撞风控那发)')
assert(world.playCalls.filter((u) => u === 'd2').length === 1, 'S14-3 冷却期后续重铸被丢弃: d2 零额外 API 请求')

console.log(`\n==== 结果: ${PASS} 通过 / ${FAIL} 失败 ====`)
if (FAIL) {
  console.log('失败项:\n - ' + fails.join('\n - '))
  process.exit(1)
}
console.log(`解读: S1/S7 心跳只走 CDN 零 API 占用; S3 网络异常零收尸零重铸(断网不团灭);
      S4/S5 单次不误杀, 连续真死才收尸且重铸仅一发; S6 满员保持熄灭不骚扰;
      S2/S8 下播与回放不耗请求; S10 回访源同养; S11 并发合并; S12 自重叠防护.`)
