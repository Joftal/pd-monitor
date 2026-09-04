// ============================================================================
// 验证脚本: 大厅轮询刷新是否会清掉直播源缓存(do not depend on Electron)
//
// 方法: electron/store/notify/recorder 等依赖替换为可计数 mock;
//       src/main/services/pandalive.ts 与 watcher.ts 用真实源码(sucrase 现编译).
// 场景:
//   T1  主命题: A 已关注+列表可见+持续在播 — 轮询后缓存必须仍命中(问题应不复现)
//   T2  主命题: A 未关注 — 同上
//   T3  主命题: A 已关注但列表不可见(missing→urgent 复查), 持续在播 — 同上
//   T4  对照组: 列表内翻转(离线→在播) — onLiveStart 必须触发(作废+通知+预取+自录)
//   T5  回归: 列表不可见主播经 rotate 复查发现开播 — onLiveStart 必须触发(原被吞 bug)
//   T6  回归: per-anchor 模式下任意开播 — onLiveStart 必须触发(原被吞 bug)
// ============================================================================
import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { transform } = require('sucrase')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------- 伪造世界(请求计数 + 可控的平台状态) ----------
const liveItem = (over = {}) => ({
  userId: 'aaa', userIdx: 1, userNick: '主播', title: '测试直播',
  isAdult: false, isPw: false, type: 'free', liveType: 'live',
  user: 100, likeCnt: 10, fanCnt: 5, bookmarkCnt: 0, playCnt: 0,
  startTime: '2026-09-04 10:00:00', isLive: true, thumbUrl: '', userImg: '', ...over
})

const world = {
  inList: {},     // userId -> bool: 全站列表里是否可见
  bjMedia: {},    // userId -> liveItem|null: member/bj 返回的 media
  bj403: {},      // userId -> bool: member/bj 返回 403(触发 RiskError 熔断链)
  bjThrow: {},    // userId -> bool: member/bj 抛普通网络错误(不触发节点兜底, 直抛)
  latency: { liveMs: 0, bjMs: {} }, // 请求人为延迟(T10 让路/T11 取关时序窗口)
  playCalls: [],   // /v1/live/play 真实发起记录(判定"是否重新拉源"的唯一依据)
  liveCalls: [],   // /v1/live 分页请求记录(T16 复用性断言)
  bjCalls: [],     // /v1/member/bj 调用记录 [{userId, at}](轮扫覆盖/时刻断言)
  toasts: [],      // sendToast 记录
  recStarts: [],   // recorder.start 记录
  recStops: [],    // recorder.stop 记录
  recStartThrow: false, // true 时 recorder.start 抛错(T21 自录失败不伤链路)
  stopDelayMs: 0,  // recorder.stop 人为延迟(T22 R5 时序窗口)
}

const fakeRes = (status, obj) => ({
  status,
  text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
  headers: { getSetCookie: () => [] }
})

const fakeFetch = async (url, init = {}) => {
  const u = new URL(url)
  if (u.hostname === 'api.pandalive.co.kr' && u.pathname === '/v1/live') {
    world.liveCalls.push(u.searchParams.get('offset') || '0')
    if (world.latency.liveMs) await new Promise((r) => setTimeout(r, world.latency.liveMs))
    const list = Object.keys(world.inList).filter((id) => world.inList[id]).map((id) => liveItem({ userId: id, userNick: `nick_${id}` }))
    return fakeRes(200, { result: true, list, loginInfo: { userInfo: { isLogin: true } } })
  }
  if (u.hostname === 'api.pandalive.co.kr' && u.pathname === '/v1/member/bj') {
    const userId = new URLSearchParams(init.body || '').get('userId')
    world.bjCalls.push({ userId, at: Date.now() })
    if (world.bj403[userId]) return fakeRes(403, { result: false, message: 'blocked' }) // rawFetch → RiskError
    if (world.bjThrow[userId]) throw new Error('boom') // 不含 ERR_FAILED: rawFetch 直抛, 不兜 Node 通道
    const d = world.latency.bjMs[userId] || 0
    if (d) await new Promise((r) => setTimeout(r, d))
    return fakeRes(200, { result: true, bjInfo: { id: userId, nick: `nick_${userId}`, img: '' }, media: world.bjMedia[userId] ?? null })
  }
  if (u.hostname === 'api.pandalive.co.kr' && u.pathname === '/v1/live/play') {
    const body = new URLSearchParams(init.body || '')
    world.playCalls.push({ userId: body.get('userId'), password: body.get('password') || '' })
    return fakeRes(200, {
      result: true,
      PlayList: { hls: [{ url: `https://cdn.live-video.net/${body.get('userId')}/master.m3u8` }] },
      media: { title: 't', userNick: 'n', liveType: 'live', thumbUrl: '', userImg: '' }
    })
  }
  if (u.hostname.endsWith('live-video.net')) {
    return fakeRes(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080p.m3u8\n')
  }
  throw new Error('fakeFetch 未分派: ' + url)
}

// ---------- store mock(关键: listAnchors 返回原数组引用, 复刻 store.ts 语义) ----------
const db = { anchors: [], settings: null, history: [] }
const store = {
  listAnchors: () => db.anchors,
  updateAnchor: (userId, patch) => { const a = db.anchors.find((x) => x.userId === userId); if (a) Object.assign(a, patch) },
  addAnchor: (a) => { db.anchors.push(a) },
  removeAnchor: (userId) => { db.anchors = db.anchors.filter((x) => x.userId !== userId) },
  getSettings: () => db.settings,
  setSettings: (p) => { db.settings = { ...db.settings, ...p }; return db.settings },
  flush() {}, listHistory: () => db.history, addHistory() {}
}
const DEFAULT_SETTINGS = {
  savePath: '', splitSeconds: 900, autoMp4: true, deleteTs: false,
  pollIntervalSec: 3600, // 防止 round finally 的 schedule 在测试窗口内自跑
  requestGapMs: 300, proxyUrl: '', watchMode: 'list',
  notifySystem: false, notifySound: false, autoRecordDefault: false,
  closeToTray: false, diskLimitGb: 1, prefetchStream: true,
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
  './store': { store },
  './notify': { sendToast: (t) => world.toasts.push(t) },
  './recorder': {
    recorder: {
      start: async (opt) => {
        if (world.recStartThrow) throw new Error('disk full(sim)')
        world.recStarts.push(opt)
        return { id: 'x' }
      },
      stop: async (userId) => {
        world.recStops.push(userId)
        if (world.stopDelayMs) await new Promise((r) => setTimeout(r, world.stopDelayMs))
      },
      list: () => [],
      hasTask: () => false
    }
  }
}

// ---------- TS 即时编译加载(同一文件单例缓存 → pandalive/watcher 拿到同一 api) ----------
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
const { watcher } = loadTs('src/main/services/watcher.ts')

// ---------- 测试基建 ----------
let failures = 0
const check = (name, cond, detail = '') => {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}
const playCount = (uid) => world.playCalls.filter((c) => c.userId === uid).length
const mkAnchor = (userId, over = {}) => ({
  userId, userIdx: 1, nick: `nick_${userId}`, userImg: '', isLive: false, title: '', tags: null,
  startTime: '', viewerCount: 0, likes: 0, fans: 0, thumbUrl: '', autoRecord: false,
  addedAt: Date.now(), lastSeenAt: 0, ...over
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (fn, ms = 1500) => { for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await sleep(50) } return fn() }

async function reset() {
  // 先断开间隙泵后续轮扫 + 等上一场在飞请求落完, 再清计数 —— 否则残留 bj/play 调用污染下一场断言
  watcher.idleQueue = []
  await waitUntil(() => !watcher.idlePumping && !watcher.roundInFlight, 3000)
  // 熔断/冷却状态一并复位(跨场景隔离; pump/round 的熔断语义由 T9/T13 负责触发与观察)
  watcher.errorStreak = 0
  watcher.cooldownUntil = 0
  watcher.status.circuitOpen = false
  watcher.status.message = ''
  db.anchors = []
  db.settings = { ...DEFAULT_SETTINGS }
  world.inList = {}; world.bjMedia = {}; world.bj403 = {}; world.bjThrow = {}; world.latency = { liveMs: 0, bjMs: {} }
  world.playCalls.length = 0; world.liveCalls.length = 0; world.bjCalls.length = 0; world.toasts.length = 0; world.recStarts.length = 0
  world.recStops.length = 0; world.recStartThrow = false; world.stopDelayMs = 0
  api.clearPlayCache()
  watcher.running = true // 绕过 start() 的 schedule; round 由脚本手动驱动
}
const round = () => watcher.round() // 直接驱动 Watcher 内部轮次(TS private 于 JS 运行时不存在)

// ============================================================================
console.log('\n■ T1 主命题: A 已关注+列表可见+持续在播, 大厅轮询刷新后源缓存必须仍命中')
await reset()
db.anchors = [mkAnchor('aaa', { isLive: true })]
world.inList = { aaa: true }
{
  const r1 = await api.getPlayCached('aaa')
  check('T1-0 首次进房拉源', r1.ok && playCount('aaa') === 1)
  await round()
  check('T1-1 轮询一轮未发源请求', playCount('aaa') === 1)
  const r2 = await api.getPlayCached('aaa')
  check('T1-2 重新进房缓存命中(0 新请求)', playCount('aaa') === 1 && r2.m3u8 === r1.m3u8)
  check('T1-3 fetchedAt 未变(同一缓存对象)', r2.fetchedAt === r1.fetchedAt)
  await round(); await round()
  const r3 = await api.getPlayCached('aaa')
  check('T1-4 多轮后依旧命中', playCount('aaa') === 1 && r3.fetchedAt === r1.fetchedAt)
}

console.log('\n■ T2 主命题: A 未关注, 轮询与缓存互不相干')
await reset()
world.inList = { aaa: true }
{
  await api.getPlayCached('aaa')
  await round()
  const r2 = await api.getPlayCached('aaa')
  check('T2-1 未关注主播轮询后缓存仍命中', playCount('aaa') === 1 && r2.ok)
}

console.log('\n■ T3 主命题: A 已关注但列表不可见(missing→urgent 复查), 持续在播缓存仍命中')
await reset()
db.anchors = [mkAnchor('aaa', { isLive: true })]
world.inList = {} // A 不在全站列表(19+/隐藏/排名 500 外)
world.bjMedia = { aaa: liveItem({ userId: 'aaa' }) } // 但 bj 复查确认在播
{
  await api.getPlayCached('aaa')
  await round()
  const r2 = await api.getPlayCached('aaa')
  check('T3-1 urgent 复查后缓存未作废', playCount('aaa') === 1 && r2.ok)
}

console.log('\n■ T4 对照组: 列表内翻转(离线→在播) — 缓作废/通知/预取/自录 应全部发生')
await reset()
db.anchors = [mkAnchor('ddd', { isLive: false, autoRecord: true })]
world.inList = { ddd: true }
{
  await api.getPlayCached('ddd') // 旧缓存
  const before = playCount('ddd')
  await round()                  // ddd 在列表(在播) 且 db.isLive=false → wasLive=false → onLiveStart
  await waitUntil(() => playCount('ddd') > before)
  check('T4-1 开播 toast 已发', world.toasts.some((t) => t.type === 'live'))
  check('T4-2 旧源作废后预取拉新源', playCount('ddd') === 2)
  check('T4-3 自动录制已启动', world.recStarts.some((r) => r.userId === 'ddd'))
  const r2 = await api.getPlayCached('ddd')
  check('T4-4 再进房用新源', playCount('ddd') === 2 && r2.ok)
}

console.log('\n■ T5 回归: 列表不可见主播经 rotate 复查发现开播 — onLiveStart 必须触发(修复验证)')
await reset()
db.anchors = [mkAnchor('bbb', { isLive: false, autoRecord: true })]
world.inList = {} // bbb 列表不可见
world.bjMedia = { bbb: liveItem({ userId: 'bbb' }) } // rotate 复查发现在播
{
  await api.getPlayCached('bbb') // 旧缓存(开播后应作废)
  await round()                  // missing rest 队列仅 bbb → rotate 必复查 → applyBj
  await waitUntil(() => playCount('bbb') === 2)
  check('T5-1 开播 toast 已发', world.toasts.some((t) => t.type === 'live'))
  check('T5-2 自动录制已启动', world.recStarts.some((r) => r.userId === 'bbb'))
  check('T5-3 旧源作废+预取新源', playCount('bbb') === 2, `play 请求数=${playCount('bbb')}`)
  check('T5-4 isLive 状态已更新', db.anchors[0].isLive === true)
}

console.log('\n■ T6 回归: per-anchor 模式下开播 — onLiveStart 必须触发(修复验证)')
await reset()
db.settings.watchMode = 'per-anchor'
db.anchors = [mkAnchor('ccc', { isLive: false, autoRecord: true })]
world.bjMedia = { ccc: liveItem({ userId: 'ccc' }) }
{
  await round() // roundByBj → 全部走 applyBj
  check('T6-1 per-anchor 开播 toast 已发', world.toasts.some((t) => t.type === 'live'))
  check('T6-2 per-anchor 开播自动录制已启动', world.recStarts.some((r) => r.userId === 'ccc'))
}

// ============================================================================
watcher.running = false
console.log('\n' + '─'.repeat(72))
console.log(`结果: ${failures === 0 ? '全部按预期' : failures + ' 条与预期不符'}`)
console.log('\n■ T7 场景: 主播开播时不在前 500(列表不可见) — 间隙泵扫到后 通知+数据+后续每轮跟进')
await reset()
// 4 个离线关注(a1..c4), 全都不在列表; 只有 ccc 实际已开播
db.anchors = ['a1', 'b2', 'ccc', 'd4'].map((id) => mkAnchor(id, { isLive: false, autoRecord: id === 'ccc' }))
world.inList = {}
world.bjMedia = { ccc: liveItem({ userId: 'ccc', userNick: 'C酱', title: '500名外的开播', user: 321, fanCnt: 77, thumbUrl: 'https://img/x.jpg' }) }
{
  await round() // 主轮询仅拉列表; rest 4 人交间隙泵, 开播发现是异步的 → 等泵扫到再断言
  check('T7-0 间隙泵已扫到 ccc 开播', await waitUntil(() => db.anchors.find((a) => a.userId === 'ccc').isLive, 6000))
  check('T7-1 开播 toast 已发(rotate 通道)', world.toasts.some((t) => t.type === 'live'))
  check('T7-2 自动录制已启动', world.recStarts.some((r) => r.userId === 'ccc'))
  await waitUntil(() => playCount('ccc') >= 1)
  check('T7-3 开播预取已跑', playCount('ccc') >= 1)
  const c = db.anchors.find((a) => a.userId === 'ccc')
  check('T7-4 开播数据完整(nick/title/观众/粉丝/封面/标签/开播时间)',
    c.isLive && c.nick === 'C酱' && c.title === '500名外的开播' && c.viewerCount === 321 &&
    c.fans === 77 && c.thumbUrl === 'https://img/x.jpg' && !!c.tags && c.startTime === '2026-09-04 10:00:00')
  check('T7-5 同批扫到的未开播主播保持离线', !db.anchors.find((a) => a.userId === 'a1').isLive && !db.anchors.find((a) => a.userId === 'b2').isLive)

  // 被发现后进入 urgent 通道: 下一轮起每轮复查, 数据实时跟进
  world.bjMedia.ccc = liveItem({ userId: 'ccc', userNick: 'C酱', title: '换了标题', user: 999 })
  await round()
  const c2 = db.anchors.find((a) => a.userId === 'ccc')
  check('T7-6 下一轮 urgent 复查数据跟进(标题/观众数)', c2.title === '换了标题' && c2.viewerCount === 999)
}

console.log('\n■ T8 场景: 轮询间隔 300s + 8 个离线关注(第 7 个开播) — 间隙兜底泵发现延迟与间隔脱钩')
await reset()
db.settings.pollIntervalSec = 300 // 长间隔: 旧 rotate 方案下最坏 ⌈8/3⌉×300s = 900s 才发现
db.settings.requestGapMs = 300    // 限速下限(setGap min 300): 泵节奏 ≈300ms/请求
const ids = Array.from({ length: 8 }, (_, i) => `t${i + 1}`)
db.anchors = ids.map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
world.bjMedia = { t7: liveItem({ userId: 't7', userNick: 'T7酱' }) } // 第 7 个开播
{
  const t0 = Date.now()
  await round() // 主轮询仅拉列表; rest 8 人整体交间隙泵
  const found = await waitUntil(() => db.anchors.find((a) => a.userId === 't7').isLive, 6000)
  check('T8-1 间隙内发现开播(不等下一个 300s 间隔)', found)
  const cost = Date.now() - t0
  check('T8-2 发现耗时 ≈ N×gap 量级(远小于一个间隔)', cost < 10000, `实际 ${(cost / 1000).toFixed(1)}s`)
  await waitUntil(() => new Set(world.bjCalls.map((c) => c.userId)).size >= 8, 6000)
  const seen = new Set(world.bjCalls.map((c) => c.userId))
  check('T8-3 本轮 8 个离线关注全部被轮扫一遍', ids.every((id) => seen.has(id)), `${seen.size}/8`)
  check('T8-4 每人至多一次(快照消费制, 无重复)', world.bjCalls.length === seen.size, `${world.bjCalls.length} 次/${seen.size} 人`)
  check('T8-5 开播 toast 已发(applyBj 链路)', world.toasts.some((t) => t.type === 'live'))
}

console.log('\n■ T9 熔断交互: 间隙泵请求 403(RiskError) → 立即熔断+停扫, 不误伤后续')
await reset()
db.anchors = ['f1', 'f2', 'f3'].map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
world.bj403 = { f2: true }
{
  await round()
  await waitUntil(() => watcher.status.circuitOpen, 5000)
  await waitUntil(() => !watcher.idlePumping, 3000)
  const idsCalled = world.bjCalls.map((c) => c.userId)
  check('T9-1 RiskError 立即熔断', watcher.status.circuitOpen === true)
  check('T9-2 熔断 toast 已发', world.toasts.some((t) => t.type === 'error'))
  check('T9-3 403 之后泵停扫(f3 未被请求)', idsCalled.join(',') === 'f1,f2', idsCalled.join(','))
}

console.log('\n■ T15 熔断闭环(承接 T9): 冷却压制 → 过期恢复 → 间隙泵重启补扫')
{
  await round() // 冷却中: 走 cooling 分支, 不拉列表不发任何请求
  check('T15-1 冷却分支压制(circuitOpen 保持, message=cooling)',
    watcher.status.circuitOpen === true && watcher.status.message === 'watcher.cooling')
  const bjN0 = world.bjCalls.length
  check('T15-2 冷却中无任何复查请求', world.bjCalls.length === bjN0)
  watcher.cooldownUntil = Date.now() - 1000 // 伪造冷却过期
  world.bj403 = {}                           // 撤掉风控源
  await round()                              // 恢复轮: 成功 → 熔断复位 + idleQueue 新快照
  check('T15-3 恢复后熔断复位(errorStreak 清零)', watcher.status.circuitOpen === false && watcher.errorStreak === 0)
  const got = await waitUntil(() => world.bjCalls.some((c) => c.userId === 'f3'), 6000)
  check('T15-4 上轮断档的 f3 已被间隙泵补扫', got)
}

console.log('\n■ T10 让路: round 进行中间隙泵不得消费(roundInFlight 检查)')
await reset()
db.anchors = ['g1', 'g2'].map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
{
  await round() // round1 结束 → 泵启动扫 g1(bj 慢 2.5s)
  world.latency.bjMs = { g1: 2500 }
  await sleep(900)                    // 泵的 bj(g1) 正在飞
  world.latency.liveMs = 4500         // round2 主体持续 ~4.5s, 覆盖 bj(g1) 落地窗口
  const p2 = round()                  // round2 开始: roundInFlight=true
  // bj(g1) 落地后泵应 break; round2 结束后 pumpIdle 才把 g2 发出
  const got = await waitUntil(() => world.bjCalls.some((c) => c.userId === 'g2'), 20000)
  await p2
  const g2At = world.bjCalls.find((c) => c.userId === 'g2')?.at || 0
  check('T10-1 g2 最终被扫到', got)
  check('T10-2 g2 的请求发出时刻 ≥ round2 结束时刻(让路生效)', g2At >= watcher.status.lastRoundAt,
    `g2.at=${g2At} round2End=${watcher.status.lastRoundAt}`)
}

console.log('\n■ T11 取关守卫: 快照内主播被取关 → 不再发请求 / 开播事件不落')
await reset()
db.anchors = ['x1', 'x2'].map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
world.latency.bjMs = { x1: 400 } // 给取关留时序窗口
{
  await round()              // 泵 shift x1(飞 400ms)
  store.removeAnchor('x2')   // 快照生成后取关 x2
  await waitUntil(() => !watcher.idlePumping, 4000)
  const idsCalled = world.bjCalls.map((c) => c.userId)
  check('T11-1 已取关的 x2 不再发请求', idsCalled.join(',') === 'x1', idsCalled.join(','))
}
// 取关主播恰在飞行窗口开播: 事件不得落(幽灵 toast/自录双保险)
await reset()
db.anchors = [mkAnchor('x3', { isLive: false, autoRecord: true }), mkAnchor('x4', { isLive: false })]
world.inList = {}
world.bjMedia = { x3: liveItem({ userId: 'x3', userNick: 'X3酱' }) }
world.latency.bjMs = { x3: 400 }
{
  await round()              // 泵 shift x3(飞 400ms)
  store.removeAnchor('x3')   // 飞行窗口内取关
  await waitUntil(() => !watcher.idlePumping, 4000)
  check('T11-2 取关主播开播 toast 被守卫拦下', !world.toasts.some((t) => t.type === 'live'))
  check('T11-3 取关主播自动录制未启动', !world.recStarts.some((r) => r.userId === 'x3'))
  check('T11-4 未取关的 x4 照常轮扫', world.bjCalls.some((c) => c.userId === 'x4'))
}
// R4 同源: 预取泵——开播翻转把 z2 排进 prewarm 队列后, 节流窗口内取关 → 队列残留不得再拉源
await reset()
db.anchors = [mkAnchor('z1', { isLive: false }), mkAnchor('z2', { isLive: false })]
world.inList = { z1: true, z2: true } // 双主播同轮开播 → prewarmQueue=[z1,z2]
{
  await round() // 两个 onLiveStart: 预取泵启动, shift z1 拉源后进入 ~1.2s 节流 sleep
  store.removeAnchor('z2') // 节流窗口内取关 z2(尚未被 shift)
  await waitUntil(() => !watcher.prewarmPumping && !watcher.idlePumping, 6000)
  const pulled = new Set(world.playCalls.map((c) => c.userId))
  check('T11-5 z1(在监控)预取已完成', pulled.has('z1'))
  check('T11-6 z2(节流窗口内取关)未再拉源', !pulled.has('z2'), [...pulled].join(','))
}

console.log('\n■ T12 模式切换: list→per-anchor 后 idleQueue 清空, 泵无职责')
await reset()
db.anchors = ['m1', 'm2'].map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
world.latency.bjMs = { m2: 1200 } // 切换时 m2 应在飞
{
  await round()                    // 泵扫 m1 → shift m2(飞 1.2s)
  await sleep(300)
  db.settings = { ...db.settings, watchMode: 'per-anchor' }
  await round()                    // roundByBj 全量扫 m1,m2; 分支应清 idleQueue
  check('T12-1 per-anchor 分支清空 idleQueue', watcher.idleQueue.length === 0)
  const n0 = world.bjCalls.length
  await sleep(1600)                // 若泵未清, 残留会继续发请求
  check('T12-2 切换后间隙泵无新请求', world.bjCalls.length === n0, `${n0} → ${world.bjCalls.length}`)
}

console.log('\n■ T13 普通错误: 出错即停(不熔断), 下轮新快照恢复')
await reset()
db.anchors = ['e1', 'e2', 'e3'].map((id) => mkAnchor(id, { isLive: false }))
world.inList = {}
world.bjThrow = { e1: true }
{
  await round()
  await waitUntil(() => !watcher.idlePumping, 4000)
  const idsCalled = world.bjCalls.map((c) => c.userId)
  check('T13-1 出错即停(e2/e3 未扫)', idsCalled.join(',') === 'e1', idsCalled.join(','))
  check('T13-2 记 1 次失败但不熔断', watcher.errorStreak === 1 && watcher.status.circuitOpen === false)
  world.bjThrow = {}
  await round() // 新一轮: 新快照整批重排
  await waitUntil(() => new Set(world.bjCalls.map((c) => c.userId)).size >= 3, 6000)
  const seen = new Set(world.bjCalls.map((c) => c.userId))
  check('T13-3 下轮全员补扫恢复', ['e1', 'e2', 'e3'].every((id) => seen.has(id)), [...seen].join(','))
}

console.log('\n■ T14 urgent 回归: 列表外在播主播仍轮内每轮全查(不入间隙泵)')
await reset()
db.anchors = [mkAnchor('u1', { isLive: true }), mkAnchor('v1', { isLive: false })]
world.inList = {}
world.bjMedia = { u1: liveItem({ userId: 'u1', userNick: 'U1酱' }) } // u1 在播但列表不可见
{
  await round() // u1 走 urgent(轮内); v1 交泵(间隙)
  await waitUntil(() => world.bjCalls.some((c) => c.userId === 'v1'), 4000)
  await round() // 第二轮: u1 仍 urgent
  await waitUntil(() => world.bjCalls.filter((c) => c.userId === 'v1').length >= 2, 6000)
  const u1Calls = world.bjCalls.filter((c) => c.userId === 'u1').length
  check('T14-1 u1(在播) 每轮 urgent 恰好 1 次(泵未重复扫)', u1Calls === 2, `2 轮共 ${u1Calls} 次`)
  check('T14-2 v1(离线) 每轮间隙泵 1 次', world.bjCalls.filter((c) => c.userId === 'v1').length === 2)
}

console.log('\n■ T16 复用性: 大厅与关注主播共享一份列表请求 — 列表可见关注零增量, 仅不可见者单独查')
await reset()
// p1..p3: 关注且列表可见(在播); q1: 关注+离线+列表不可见(rest); q2: 关注+在播+列表不可见(urgent)
db.anchors = [
  ...['p1', 'p2', 'p3'].map((id) => mkAnchor(id, { isLive: false })),
  mkAnchor('q1', { isLive: false }),
  mkAnchor('q2', { isLive: true })
]
world.inList = { p1: true, p2: true, p3: true }
world.bjMedia = { q2: liveItem({ userId: 'q2', userNick: 'Q2酱' }) }
{
  await round()
  await waitUntil(() => world.bjCalls.some((c) => c.userId === 'q1'), 5000)
  const bjOf = (id) => world.bjCalls.filter((c) => c.userId === id).length
  check('T16-1 列表请求本轮仅 1 页(首页即到底)', world.liveCalls.length === 1, `${world.liveCalls.length} 次`)
  check('T16-2 大厅数据源来自同一份列表(discovery=3 条在播)', watcher.getDiscovery().length === 3)
  check('T16-3 列表可见的 p1/p2/p3 零增量 bj 请求', bjOf('p1') + bjOf('p2') + bjOf('p3') === 0, `p合计=${bjOf('p1') + bjOf('p2') + bjOf('p3')}`)
  check('T16-4 p1..p3 数据已从列表 patch(全部翻转为在播)', ['p1', 'p2', 'p3'].every((id) => db.anchors.find((a) => a.userId === id).isLive))
  check('T16-5 q2(urgent) 轮内恰好 1 次 bj', bjOf('q2') === 1, `${bjOf('q2')} 次`)
  check('T16-6 q1(rest) 仅间隙泵 1 次 bj, 无重复通道', bjOf('q1') === 1, `${bjOf('q1')} 次`)
  const total = world.liveCalls.length + world.bjCalls.length
  check('T16-7 全轮总请求 = 1(列表) + 1(urgent) + 1(rest泵) = 3', total === 3, `实测 ${total}`)
}

console.log('\n■ T17 粉丝房开播: fanLive 专用通知 + 自动录制照常')
await reset()
db.anchors = [mkAnchor('fan1', { isLive: false, autoRecord: true })]
// fakeFetch 的列表项由 inList 生成(恒 type=free) → 走 rest 泵 bj 通道注入 type=fan;
// onLiveStart 的 fanLive 判定读 tags.type, 任何通道同源
world.inList = {}
world.bjMedia = { fan1: liveItem({ userId: 'fan1', type: 'fan', title: '粉丝专场' }) }
{
  await round() // missing → rest 快照 → 间隙泵
  await waitUntil(() => world.toasts.length > 0, 5000)
  check('T17-1 粉丝房开播 toast 为 fanLive 类型', world.toasts.some((t) => t.type === 'fanLive'))
  check('T17-2 不再重复发普通 live toast', !world.toasts.some((t) => t.type === 'live'))
  check('T17-3 粉丝房自动录制照常启动', world.recStarts.some((r) => r.userId === 'fan1'))
}

console.log('\n■ T18 下播通知链路: 在播→复查判下播 → offline toast 单发; 再查仍离线不重复发')
await reset()
db.anchors = [mkAnchor('u9', { isLive: true, autoRecord: false })]
world.inList = {} // 列表不可见 → urgent 通道
world.bjMedia = { u9: liveItem({ userId: 'u9' }) }
{
  await round() // urgent 复查: 仍在播(数据跟进, 无事件)
  check('T18-0 持续在播无事件', world.toasts.length === 0)
  world.bjMedia.u9 = null // 下播
  await round() // urgent 复查 media=null → applyBj 下播分支
  check('T18-1 判下播后 isLive=false', db.anchors[0].isLive === false)
  check('T18-2 offline toast 发出(恰好一次)', world.toasts.filter((t) => t.type === 'offline').length === 1)
  await round() // 下一轮: u9 进 rest → 间隙泵复查仍 media=null → 不得重复通知
  await waitUntil(() => world.bjCalls.filter((c) => c.userId === 'u9').length >= 3, 6000)
  check('T18-3 重复判离线不重复发 toast', world.toasts.filter((t) => t.type === 'offline').length === 1)
}

console.log('\n■ T19 下播守卫: urgent 复查飞行窗口取关 → onLiveEnd 不落')
await reset()
db.anchors = [mkAnchor('u8', { isLive: true }), mkAnchor('u7', { isLive: false })]
world.inList = {}
world.bjMedia = {} // u8 media=null(下播), 但 bj 响应慢 400ms
world.latency.bjMs = { u8: 400 }
{
  const p = round()          // urgent 循环 await fetchBj(u8)(飞 400ms)
  await sleep(120)           // 确认请求在飞
  store.removeAnchor('u8')   // 飞行窗口取关
  await p
  await waitUntil(() => !watcher.idlePumping, 3000)
  check('T19-1 取关后下播 toast 被守卫拦下', !world.toasts.some((t) => t.type === 'offline'))
  check('T19-2 未取关的 u7 仍被 rest 泵复查', world.bjCalls.some((c) => c.userId === 'u7'))
}

console.log('\n■ T20 双通道竞态: 泵在飞时发现开播 + 主循环同轮发现 → 通知/自录仅单发')
await reset()
db.anchors = [mkAnchor('d5', { isLive: false, autoRecord: true })]
world.inList = {}
world.bjMedia = { d5: liveItem({ userId: 'd5', userNick: 'D5酱' }) }
world.latency.bjMs = { d5: 700 } // 泵的 bj 慢 700ms
{
  await round() // round1: rest=[d5], 泵 shift d5, fetchBj 飞 700ms(media 在播)
  world.inList = { d5: true } // 同时 d5 出现在全站列表
  const p = round()           // round2 立即开始: 主循环命中 d5 → onLiveStart(第一发)
  await p
  await waitUntil(() => !watcher.idlePumping, 4000) // 泵的 bj(d5) 后落地: wasLive 已为 true → 跳过
  check('T20-1 开播 toast 恰好一次', world.toasts.filter((t) => t.type === 'live').length === 1,
    `${world.toasts.filter((t) => t.type === 'live').length} 次`)
  check('T20-2 自动录制恰好一次', world.recStarts.filter((r) => r.userId === 'd5').length === 1)
}

console.log('\n■ T21 自录失败不伤链路: recorder.start 抛错 → toast 照发/计数不涨/他人照常')
await reset()
db.anchors = [mkAnchor('bad1', { isLive: false, autoRecord: true }), mkAnchor('ok2', { isLive: false, autoRecord: true })]
world.inList = { bad1: true, ok2: true } // 双主播同轮开播
world.recStartThrow = true // 所有 start 都抛
{
  await round()
  check('T21-1 自录失败但开播 toast 照发', world.toasts.filter((t) => t.type === 'live').length === 2)
  check('T21-2 watcher 失败计数不涨(recorder 静默兜底)', watcher.errorStreak === 0)
  check('T21-3 熔断未误开', watcher.status.circuitOpen === false)
  world.recStartThrow = false
  await round() // 正常轮, 无翻转无事件
  check('T21-4 后续轮询正常无异常', watcher.errorStreak === 0 && watcher.status.circuitOpen === false)
}

console.log('\n■ T22 录制开关矩阵: autoRecord=false 不起录; R5 取关时序(先取关后停录)窗口无孤儿录制')
await reset()
db.anchors = [mkAnchor('norec', { isLive: false, autoRecord: false })]
world.inList = { norec: true }
{
  await round()
  check('T22-1 autoRecord=false: 通知有/起录无', world.toasts.some((t) => t.type === 'live') && world.recStarts.length === 0)
}
// R5: 模拟修复后的 ipc 顺序——先 removeAnchor 再慢 stop; stop 窗口内开播翻转不得新建录制
await reset()
db.anchors = [mkAnchor('w9', { isLive: false, autoRecord: true })]
world.inList = { w9: true } // w9 开播中(列表可见)
world.stopDelayMs = 600
{
  store.removeAnchor('w9') // 第一步: 取关落库(ipc 修复后顺序)
  const stopP = (async () => {
    world.recStops.push('w9') // 第二步: 慢 stop 进行中
    await sleep(world.stopDelayMs)
  })()
  await round() // stop 窗口内的轮询: w9 已不在监控 → 主循环不遍历, 即便翻转也无自录
  await stopP
  check('T22-2 R5时序: stop 窗口内无孤儿录制', !world.recStarts.some((r) => r.userId === 'w9'))
  check('T22-3 R5时序: stop 已对该主播执行', world.recStops.includes('w9'))
  check('T22-4 R5时序: 开播在列表里仍不发通知(守卫)', !world.toasts.some((t) => t.type === 'live'))
}

console.log('解读: T1/T2/T3 PASS ⇒ 「大厅轮询刷新会清源缓存」不成立(真实源码+可计数请求实证);')
console.log('      T4 PASS ⇒ 列表内开播翻转的作废链路正常工作(对照);')
console.log('      T17 PASS ⇒ 粉丝房 fanLive 专用通知+自录正常; T18 PASS ⇒ 下播 toast 单发, 重复判离线不重复;')
console.log('      T19/T20 PASS ⇒ 下播守卫/双通道竞态: 取关不播下播通知, 双通道同发现仍单发; T21/T22 PASS ⇒ 自录失败不伤链路, 开关矩阵闭合.')
console.log('      T5/T6 PASS ⇒ applyBj 快照修复生效: 列表外/单独模式开播的 通知+预取+自录+源作废 全链路恢复;')
console.log('      T7 PASS ⇒ 开播时 500 名外: 兜底通道能完整拿到 通知/自录/预取/开播数据, 发现后 urgent 每轮跟进;')
console.log('      T8 PASS ⇒ 方案A间隙泵: 发现延迟 ≈ N×gap(秒~分钟级), 与轮询间隔(30s/300s)完全脱钩;')
console.log('      T9/T13 PASS ⇒ 泵失败语义: RiskError 立即熔断停扫, 普通错误即停不熔断, 下轮新快照恢复;')
console.log('      T15 PASS ⇒ 熔断闭环: 冷却零请求压制 → 过期恢复熔断复位 → 断档者补扫;')
console.log('      T10 PASS ⇒ 让路语义: round 进行中泵不消费(roundInFlight), 轮后才继续;')
console.log('      T11 PASS ⇒ 取关守卫: 快照内取关者不发请求, 飞行窗口开播事件不落(无幽灵 toast/自录), 预取队列残留同挡;')
console.log('      T12 PASS ⇒ 模式切换: per-anchor 分支清 idleQueue, 泵无重复职责;')
console.log('      T14 PASS ⇒ urgent 回归: 列表外在播主播仍轮内每轮全查, 不被泵重复;')
console.log('      T16 PASS ⇒ 大厅/关注一份请求两用: 列表可见关注零增量, 全轮请求数恒等于 页数+urgent+rest.')
process.exit(failures === 0 ? 0 : 1)
