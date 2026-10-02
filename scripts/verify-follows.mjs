// ============================================================================
// 验证脚本: 两平台「站内关注」列表与导入(SOOP myapi/favorite + Panda /v1/live/bookmark + roundSoop 列表模式 + 会话 Cookie 转持久)
//
// 方法: electron(session/cookies)与 store/notify/recorder/logger 换成可计数替身, pandalive.ts 只替掉网络出口;
//       soop.ts / watcher.ts / ipc.ts / pandalive.ts / shared/types.ts 用真实源码(sucrase 现编译, 单例共用)。
//       列表响应体用 2026-09-29 实测抓到的真实形状(SOOP 718 关注 / Panda 158 关注, 含分组嵌套、脏字段、缺场次)。
// 场景:
//   A1  fetchFavorites 请求面: Origin=www(play 域被服务端 CORS 拒 403), Referer 停在 www 源根(跨源整路径被 Chromium 取消)
//   A2  真实形状解析: 一维 data / 分组嵌套 data / last_broad_start 分钟精度补齐 / 截图协议补全
//   A3  降级即 null(绝不解析成"全都下播"): 515 未登录 / 非 JSON / 缺 data / 全条脏数据
//   A4  单条不可寻址的 user_id 只丢那一条, 其余照常
//   A5  "is_live=true 却没给 broad_no" 判为状态未知(live=null), 交调用方回落探针
//   B1  roundSoop 列表模式: 命中行零探针落状态(nick/标题/截图/人数/开播时刻/标签) + 开播通知一次
//   B2  列表覆盖不到的房才发探针; 整表拿不到时全部回落探针(旧行为)
//   B3  下播要连续两轮才翻转: 单轮"列表说离线"只记 streak, 不动状态也不发通知; 翻离线时只清这一场的属性(密码房/回放), 房间属性留(SOOP 侧由 offPatch 直调证形状, Panda 侧的 19+/粉丝团同一规定)
//   B4  在播房不重复发开播通知; 离线房昵称照常跟进
//   B5  失明计数只看"全部关注都读不到": 列表覆盖到的房不计失败, 兜底房全灭不累计成平台失明
//   B6  SOOP 不带房间级 19+(is_adult 一律不读, 行里写着 true 也不落卡、并把旧残留清掉); 密码房旗仍是三态: 键缺席沿用上一轮, 明确 false 才翻转
//   C1  storeCookies 落罐必带 expirationDate(不带期限=会话 Cookie, 重启即登出)
//   C2  persistSessionCookies 只转 sooplive.com 的无期限条目, 已带期限与外域一律不动
//   C3  网页登录成功链路确实接上了转持久(authWin probe)
//   D1  「导入 SOOP 关注」: 只增不改 + 列表内重复去重 + 离线房同样入墙 + 自录恒关 + 未登录报错不落库
//   D3  反向差值(决策 D3): 站内缺房只标注「站内已取关」, 一条不删; 同名跨平台不串; 回榜即清标注
//   D2  preload / ApiBridge / 已关注页入口 / 双语文案四处接线齐全
//   E1  fetchBookmarks 请求面: POST /v1/live/bookmark + offset/limit + 会话 Cookie + www 源根
//   E2  分页按 page.total 收满即停(不多发页)
//   E3  降级即 null: result=false / HTML 验证页 / HTTP 403 风控 / 缺 list
//   E4  media 只在开播时下发: 在播行取全字段, 离线行 live=null
//   E5  单条不可寻址只丢那一条, 整表皆脏报"改版"而不是"0 个关注"
//   E6  「导入 Panda 关注」与 SOOP 导入共用同一条落库码路
//   E7  两平台导入的 preload / ApiBridge / 两枚按钮 / 双语文案接线齐全
//   E8  북마크 取满 200 上限时跳过反向差值(列表不完整 ≠ 站内已取关)
//   F1  ㊒④ 列表播种的场次号让取流跳过整页 HTML(拉源成功那一档 0 页; 标题/昵称仍由主信息给)
//   F2  页面实读的号同样进缓存: 第二次取流不再读页; 号过期(>90s)才回落到读整页
//   F4  复用的号没成功 → 只回读一页定性, 代价有上界(离线定性 / 同号原样回报 / 换场用新号重走一次)
//   F5  播放页微缓存: TTL 内复用 + 并发合流, fresh=true 必穿透(探针那一发要的是新读数)
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

// ---------- 替身世界 ----------
const world = {
  /** myapi/favorite 的应答(状态码 + 文本), 由场景逐次改写 */
  favStatus: 200,
  favBody: '',
  /** 播放页探针应答: live=有场次号 / offline=页面明确 null / broken=两者都没有(风控页或改版) */
  pageMode: 'live',
  pageFail: false,
  /** 播放页里的 nBroadNo(㊒④: 换场/号失效的场景自己改这一个数) */
  pageBno: null,
  /** player_live_api.php 应答里 CHANNEL 段的覆盖项(未设=在播且各档齐, 让整链走到成功) */
  apiChannel: null,
  /** broad_stream_assign.html 应答: 非空=给地址, null=不给(调度失败) */
  assign: 'https://livecast.sooplive.com/12345678-common-hd-1000.ts?limit=0&sid=x',
  /** api.pandalive.co.kr/v1/live/bookmark 的逐页应答数组(按 offset/200 取); bmStatus 覆盖 HTTP 码 */
  bmPages: [],
  bmStatus: 200,
  /** 观测点 */
  fetches: [],
  cookieWrites: [],
  jar: [],
  toasts: [],
  recStarts: [],
  invalidate: [],
  logInfo: [],
  logWarn: [],
  anchors: [],
  /** ipcMain.handle 注册到的处理器 */
  ipc: {}
}

// Chromium 的域匹配近似: 域 Cookie(.sooplive.com)对任意子域可见, 主机 Cookie 只对本主机可见
function cookieVisibleTo(c, url) {
  try {
    const host = new URL(url).hostname
    const d = (c.domain || '').replace(/^\./, '')
    return host === d || host.endsWith('.' + d)
  } catch {
    return false
  }
}

const fakeSession = {
  fetch: async (url, init = {}) => {
    world.fetches.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? String(init.body) : '' })
    if (String(url).includes('myapi.sooplive.com/api/favorite')) {
      return { status: world.favStatus, url, text: async () => world.favBody }
    }
    // Panda 站内关注(북마크): POST body 里的 offset 决定第几页(分页不发第三页由场景自己断言)
    if (String(url).includes('api.pandalive.co.kr/v1/live/bookmark')) {
      const offset = Number(/(?:^|&)offset=(\d+)/.exec(String(init.body || ''))?.[1] || 0)
      const page = world.bmPages[offset / 200]
      const text = page === undefined ? '{"result":false,"message":"no page seeded"}' : typeof page === 'string' ? page : JSON.stringify(page)
      return { status: world.bmStatus, url, text: async () => text, headers: { getSetCookie: () => [] } }
    }
    // 播放页探针: soop.ts 的 fetchPageMeta 走同一 req 通道
    if (world.pageFail) throw new Error('ERR_FAILED(sim)')
    // ㊒④ 取流整链的两步(第 2 步主信息 + 第 3 步凭证)与第 4 步调度: 让 F 段能跑到"拉源成功"这一档
    if (String(url).includes('player_live_api.php')) {
      const type = /(?:^|&)type=([^&]*)/.exec(String(init.body || ''))?.[1] || ''
      const ch = type === 'aid' ? { RESULT: 1, AID: 'aid-x' } : { RESULT: 1, BNO: '12345678', RMD: 'https://livecast.sooplive.com', CDN: 'gs_cdn', BJNICK: '甲', TITLE: '在播标题', BTIME: 60, VIEWPRESET: [{ label: 'HD', name: 'hd', label_resolution: 720, bps: 3000 }] }
      const text = JSON.stringify({ CHANNEL: { ...ch, ...(world.apiChannel || {}) } })
      return { status: 200, url, finalUrl: url, text: async () => text }
    }
    if (String(url).includes('broad_stream_assign')) {
      const text = world.assign ? JSON.stringify({ view_url: world.assign }) : '{}'
      return { status: 200, url, finalUrl: url, text: async () => text }
    }
    const body =
      world.pageMode === 'live'
        ? `<script>window.nBroadNo=${world.pageBno ?? 12345678};window.szBjNick='探针昵称';window.szBroadTitle='探针标题';window.szBroadThumPath='//liveimg.sooplive.com/h/12345678.jpg';</script>`
        : world.pageMode === 'offline'
          ? `<script>window.nBroadNo=null;window.szBjNick='探针昵称';</script>`
          : `<html>check your connection</html>`
    return { status: 200, url, finalUrl: url, text: async () => body }
  },
  cookies: {
    set: async (c) => {
      world.cookieWrites.push(c)
      if (!c.url && !c.domain) throw new Error('Cookie set 需要 url 或 domain')
      const domain = c.domain || new URL(c.url).hostname
      world.jar = world.jar.filter((x) => !(x.name === c.name && x.domain === domain && (x.path || '/') === (c.path || '/')))
      world.jar.push({ name: c.name, value: c.value, domain, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'no_restriction', expirationDate: c.expirationDate })
    },
    get: async (filter = {}) => {
      if (filter.url) return world.jar.filter((c) => cookieVisibleTo(c, filter.url))
      if (filter.domain) return world.jar.filter((c) => (c.domain || '') === filter.domain)
      return [...world.jar]
    }
  }
}

const baseStore = {
  // ㊍ 节奏三格已进 monitor: 顶层那几格现在是未注册键(引擎读不到), 预取关不掉就会在同步关注时多发拉源请求
  getSettings: () => {
    const s = { ...types.DEFAULT_SETTINGS }
    s.monitor = {
      pandalive: { ...s.monitor.pandalive, prefetchStream: false, requestGapMs: 0, pollIntervalSec: 120 },
      soop: { ...s.monitor.soop, prefetchStream: false, requestGapMs: 0, pollIntervalSec: 120 }
    }
    return s
  },
  listAnchors: () => world.anchors,
  addAnchor: (a) => {
    if (!world.anchors.find((x) => x.platform === a.platform && x.userId === a.userId)) world.anchors.push(a)
  },
  updateAnchor: (platform, userId, patch) => {
    const a = world.anchors.find((x) => x.platform === platform && x.userId === userId)
    if (a) Object.assign(a, patch)
  },
  flush() {}
}

class RiskError extends Error {}
class BjNotFoundError extends Error {}

// E 段用: pandalive.ts 的真实单例(解析/分页/降级全走真源码), 在模块加载完成后接上
let realPandaApi = null

const mocks = {
  electron: {
    app: { isPackaged: false, getAppPath: () => ROOT, getPath: () => ROOT, setPath() {}, on() {}, whenReady: () => Promise.resolve(), quit() {}, name: 'test' },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: {
      handle: (ch, fn) => {
        world.ipc[ch] = fn
      },
      on() {},
      removeHandler() {}
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) },
    shell: { openExternal: async () => {}, showItemInFolder() {}, trashItem: async () => {}, openPath: async () => ({ error: '' }) },
    net: { request: () => ({ on() {}, end() {}, write() {} }) },
    session: { fromPartition: () => fakeSession, defaultSession: fakeSession }
  },
  'src/main/services/pandalive.ts': {
    api: {
      setGap() {},
      hasSession: () => false,
      cookieValid: false,
      fetchLivePage: async () => ({ list: [], loginInfo: null }),
      // Panda 关注列表走真源码解析(realPandaApi), 替身只做转发, 让 IPC 处理器与客户端在同一条链上
      fetchBookmarks: async () => realPandaApi.fetchBookmarks(),
      fetchBj: async () => {
        throw new Error('本脚本不验单房添加')
      }
    },
    RiskError,
    BjNotFoundError,
    nodeHttpRequest: async (method, url, headers, body) => {
      world.fetches.push({ url, headers: headers || {}, node: true })
      if (String(url).includes('myapi.sooplive.com/api/favorite')) {
        return { status: world.favStatus, text: world.favBody, headers: {} }
      }
      return { status: 599, text: '', headers: {} }
    },
    proxyUrl: () => '',
    applyProxy() {},
    cachedSourceIdsAll: () => [],
    registerProxyPartition() {},
    registerSrcCacheProvider() {},
    broadcastSrcCache() {},
    SESSION_PARTITION: 'persist:pl'
  },
  'src/main/services/source.ts': {
    sourceFor: () => ({
      invalidatePlay: (uid) => world.invalidate.push(uid),
      getPlayCached: async () => ({ ok: true }),
      fetchPlay: async () => ({ ok: true })
    }),
    applyPlayMeta() {}
  },
  'src/main/services/store.ts': { store: baseStore },
  'src/main/services/authWin.ts': { openLoginWindow: async () => ({ ok: false, message: '' }) },
  'src/main/services/vault.ts': { vault: { get: () => null, set() {}, remove() {}, load: () => null, save() {}, clear() {} }, CookieJar: class {} },
  'src/main/services/telegram.ts': { tgSendMessage: async () => ({ ok: true }) },
  'src/main/services/thumbs.ts': { thumbs: { enqueue() {}, remove() {}, stopChildren() {} } },
  'src/main/services/recorder.ts': {
    recorder: {
      start: async (t) => {
        world.recStarts.push(t)
      },
      stop: async () => {},
      stopAll: async () => {},
      list: () => []
    }
  },
  'src/main/services/notify.ts': { sendToast: (t, c) => world.toasts.push({ t, c }) },
  'src/main/services/logger.ts': {
    logger: {
      info: (tag, msg) => world.logInfo.push(String(msg)),
      warn: (tag, msg) => world.logWarn.push(String(msg)),
      error: (tag, msg) => world.logWarn.push(String(msg)),
      debug() {},
      flush() {}
    }
  },
  'src/main/services/secrets.ts': {
    secrets: {
      map: new Map(),
      get(k) {
        return this.map.get(k) || ''
      },
      set(k, v) {
        this.map.set(k, v)
      }
    }
  },
  // ㊒④ F 段要让取流链跑到"拉源成功"才有东西可断言: 代理在这里只做地址换算, 不起真端口
  'src/main/services/hlsProxy.ts': {
    HlsProxy: class {
      async listen() {}
      playlistUrl(upstream) {
        return 'http://127.0.0.1:0/x?url=' + encodeURIComponent(upstream)
      }
      close() {}
    }
  },
  'src/main/util.ts': {
    UA: 'TEST-UA',
    dataDir: () => ROOT,
    defaultRecordRoot: () => ROOT,
    diskFreeGb: () => 999,
    redirectElectronDataDir() {},
    scanTaskMedia: () => [],
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1)))
  },
  'src/main/i18n.ts': { mt: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k), setMainLocale() {} }
}

// ---------- TS 即时编译加载 ----------
// 替身按"仓库内模块路径"命中(../util 与 ./util 都归一到 src/main/util.ts),
// 未替身的源码间互引照常加载真实文件 —— watcher/soop/ipc 必须共用同一个 soopApi/watcher 单例
const moduleCache = new Map()
function loadTs(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const file = path.join(ROOT, rel)
  const js = transform(fs.readFileSync(file, 'utf8'), { transforms: ['typescript', 'imports'], filePath: file }).code
  const m = { exports: {} }
  moduleCache.set(rel, m)
  const from = path.posix.dirname(rel.replace(/\\/g, '/'))
  const localRequire = (id) => {
    if (!id.startsWith('.')) return Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id)
    const target = path.posix.normalize(`${from}/${id}`).replace(/^\.\//, '')
    const withTs = target.endsWith('.ts') ? target : `${target}.ts`
    if (Object.prototype.hasOwnProperty.call(mocks, withTs)) return mocks[withTs]
    if (fs.existsSync(path.join(ROOT, withTs))) return loadTs(withTs)
    return require(id)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', js)(m.exports, localRequire, m, file, path.dirname(file))
  return m.exports
}

const types = loadTs('src/shared/types.ts')
const { soopApi } = loadTs('src/main/services/soop.ts')
const { watcher } = loadTs('src/main/services/watcher.ts')
const { CH } = types
// Panda 关注列表要验真实客户端(请求面/分页/降级/字段解析), 限速设到地板值以免脚本变慢
realPandaApi = loadTs('src/main/services/pandalive.ts').api
realPandaApi.setGap(300)

// ---------- 真实抓包样本(2026-09-29, 字段名与形状原样保留, 值做脱敏) ----------
const LIVE_ROW = {
  favorite_no: 1,
  user_id: 'aaa111',
  user_nick: '主播甲',
  is_live: true,
  is_pin: false,
  total_cnt: 2,
  last_broad_start: '2026-09-28 20:11',
  broad_info: [
    {
      broad_no: '12345678',
      broad_title: '在播标题',
      broad_start: '2026-09-29 22:01',
      broad_img: '//liveimg.sooplive.com/h/12345678.jpg',
      url: 'play.sooplive.com/aaa111/12345678',
      is_adult: true, // 平台写着 true —— 解析层也不读它(见 B6), 留着这一格正是为了证明"读了也不取"
      is_password: false,
      pc_view_cnt: 30,
      mobile_view_cnt: 45,
      total_view_cnt: 75
    }
  ]
}
const OFF_ROW = { favorite_no: 2, user_id: 'bbb222', user_nick: '主播乙', is_live: false, last_broad_start: '2026-09-27 10:00:00', broad_info: [] }
const bodyOf = (rows, extra = {}) => JSON.stringify({ data: rows, pool_check: null, total_cnt: rows.length, ...extra })

function reset() {
  world.favStatus = 200
  world.favBody = ''
  world.pageMode = 'live'
  world.pageFail = false
  world.pageBno = null
  world.apiChannel = null
  world.assign = 'https://livecast.sooplive.com/12345678-common-hd-1000.ts?limit=0&sid=x'
  world.bmPages = []
  world.bmStatus = 200
  world.fetches.length = 0
  world.cookieWrites.length = 0
  world.jar.length = 0
  world.toasts.length = 0
  world.recStarts.length = 0
  world.invalidate.length = 0
  world.logInfo.length = 0
  world.logWarn.length = 0
  world.anchors = []
  watcher.soopFailStreak = 0
  watcher.soopOfflineStreak.clear()
  soopApi.invalidateCookieCache()
  // ㊒④ 两处微缓存也是跨场景状态: 不清就会让下一场"读到"上一场的场次号/旧页, 断言变成继承
  soopApi.bnoCache.clear()
  soopApi.pageCache.clear()
  soopApi.pageInflight.clear()
}

const anchor = (over = {}) => ({
  platform: 'soop',
  userId: 'aaa111',
  userIdx: null,
  nick: '',
  userImg: '',
  isLive: false,
  title: '',
  tags: null,
  startTime: '',
  viewerCount: 0,
  likes: 0,
  fans: 0,
  thumbUrl: '',
  autoRecord: false,
  addedAt: 1,
  lastSeenAt: 0,
  ...over
})
const findAnchor = (uid) => world.anchors.find((a) => a.userId === uid)
/** 本轮发过的"播放页探针"次数(按 URL 里的频道名计) */
const pageProbes = () => world.fetches.filter((f) => !String(f.url).includes('myapi')).length
/** ㊒④ 某个频道的整页 HTML 发数: bno 复用与页面微缓存的唯一读数就是"还要不要为拿号读一页" */
const pageHits = (ch) => world.fetches.filter((f) => String(f.url) === `https://play.sooplive.com/${ch}`).length
/** player_live_api.php 的发数(可按 type 分: live=主信息, aid=清晰度凭证) */
const apiHits = (type) => world.fetches.filter((f) => String(f.url).includes('player_live_api.php') && (!type || String(f.body).includes('type=' + type))).length
/** 第 n 发主信息带的场次号(证明复用的就是列表那一个, 不是重新读出来的) */
const apiBno = (i = 0) => {
  const posts = world.fetches.filter((f) => String(f.url).includes('player_live_api.php') && String(f.body).includes('type=live'))
  const m = /(?:^|&)bno=([^&]*)/.exec(String(posts[i]?.body || ''))
  return m ? decodeURIComponent(m[1]) : ''
}

// ============ A: 关注列表客户端 ============
console.log('A1 fetchFavorites 的请求面(Origin 必为 www)')
reset()
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
let rows = await soopApi.fetchFavorites()
const favReq = world.fetches.find((f) => String(f.url).includes('myapi'))
assert(favReq && favReq.url === 'https://myapi.sooplive.com/api/favorite', '命中 myapi/favorite 端点')
assert(favReq.headers.Origin === 'https://www.sooplive.com', 'Origin 报 www(play 域会被服务端 CORS 拒)', `实际=${favReq.headers.Origin}`)
assert(favReq.headers.Referer === 'https://www.sooplive.com/', 'Referer 停在 www 源根(跨源带完整路径会被 Chromium 取消请求)', `实际=${favReq.headers.Referer}`)
assert(rows && rows.length === 2, '两条关注解析成两行')

console.log('A2 真实形状解析')
reset()
world.favBody = bodyOf([[LIVE_ROW], [OFF_ROW]]) // 建了分组时 data 是嵌套数组
rows = await soopApi.fetchFavorites()
assert(rows && rows.length === 2, '分组嵌套 data 摊平后仍是两条')
const live = rows && rows.find((r) => r.userId === 'aaa111')
assert(live && live.isLive && live.live && live.live.broadNo === '12345678', '在播行带场次号')
assert(live.live.startTime === '2026-09-29 22:01:00', '分钟精度开播时刻补齐到秒', `实际=${live.live.startTime}`)
assert(live.live.thumbUrl === 'https://liveimg.sooplive.com/h/12345678.jpg', '截图补 https: 协议')
assert(live.live.viewers === 75, '人数=pc+mobile', `实际=${live.live.viewers}`)
assert(live.live.isAdult === undefined && live.live.isPw === false, '行里写着 is_adult=true 也不进内部行(SOOP 不取房间级 19+), 密码房旗按原值')
const off = rows && rows.find((r) => r.userId === 'bbb222')
assert(off && !off.isLive && off.live === null && off.lastStartTime === '2026-09-27 10:00:00', '离线行不编造场次, 保留上次开播')

console.log('A3 列表不可用一律降级为 null(绝不回"全都下播")')
for (const [name, cfg] of [
  ['515 未登录', () => ((world.favStatus = 515), (world.favBody = '{"code":-10000}'))],
  ['403 Origin 被拒', () => ((world.favStatus = 403), (world.favBody = 'Not allowed in CORS policy.'))],
  ['200 非 JSON(风控页)', () => ((world.favStatus = 200), (world.favBody = '<html>captcha</html>'))],
  ['200 缺 data 数组', () => ((world.favStatus = 200), (world.favBody = '{"result":"ok"}'))],
  ['200 全条缺 user_id', () => ((world.favStatus = 200), (world.favBody = bodyOf([{ is_live: false }, { is_live: true }])))]
]) {
  reset()
  cfg()
  const r = await soopApi.fetchFavorites()
  assert(r === null, `${name} → null`)
}
reset()
world.favStatus = 200
world.favBody = bodyOf([{ user_id: '../../evil', is_live: false }, OFF_ROW])
rows = await soopApi.fetchFavorites()
assert(rows && rows.length === 1 && rows[0].userId === 'bbb222', '路径穿越 ID 只丢那一条, 其余照常')
reset()
world.favStatus = 200
world.favBody = bodyOf([{ user_id: 'a'.repeat(90), is_live: false }, OFF_ROW])
rows = await soopApi.fetchFavorites()
assert(rows && rows.length === 1, '超长 ID 同样被 isRoomId 拦下')

console.log('A5 "说在播却没给场次" = 状态未知, 交调用方回落')
reset()
world.favBody = bodyOf([{ ...LIVE_ROW, broad_info: [] }])
rows = await soopApi.fetchFavorites()
assert(rows && rows[0].isLive === true && rows[0].live === null, 'is_live=true + broad_info 空 → live=null')

// ============ B: roundSoop 列表模式 ============
const runRound = () => watcher.roundSoop(world.anchors.slice(), 0)

console.log('B1 命中列表: 零探针落状态 + 开播通知一次')
reset()
world.anchors = [anchor()]
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
let found = await runRound()
assert(found === 1, '在播数=1')
assert(pageProbes() === 0, '列表命中后一发播放页都不发', `实际=${pageProbes()}`)
const a = findAnchor('aaa111')
assert(a.isLive && a.nick === '主播甲' && a.title === '在播标题', '昵称/标题来自列表')
assert(a.startTime === '2026-09-29 22:01:00', '开播时刻取列表原值(播放页根本没有这个字段)')
assert(a.viewerCount === 75 && a.thumbUrl.startsWith('https://liveimg'), '人数/截图一并落卡')
assert(a.tags && a.tags.isAdult === false && a.tags.liveType === 'live', '标签落卡: 场次属性按原值, 而房间级 19+ 恒不取(行里写着 true 也不落)')
assert(a.userImg === 'https://stimg.sooplive.com/LOGO/aa/aaa111/aaa111.jpg', '空头像由这一轮补齐: SOOP 的列表行没有任何图片字段, 地址就是频道 ID 的函数(零请求)')
assert(world.toasts.filter((t) => t.t.type === 'live').length === 1, '离线→在播发一次开播通知')
assert(world.invalidate.length === 1, '开播即作废旧源')

console.log('B1b 头像补齐只认空槽, 已有的一概不覆写')
reset()
world.anchors = [anchor({ userId: 'bbb222', nick: '乙', userImg: 'https://stimg.sooplive.com/LOGO/bb/bbb222/old.jpg' })]
world.favBody = bodyOf([OFF_ROW])
await runRound()
assert(findAnchor('bbb222').userImg === 'https://stimg.sooplive.com/LOGO/bb/bbb222/old.jpg', '已有头像保持原值(每轮无谓覆写=每轮一次整库落盘)')

console.log('B2 兜底范围: 只探列表覆盖不到的房')
reset()
world.anchors = [anchor(), anchor({ userId: 'off-list', nick: '站外关注' })]
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
await runRound()
assert(world.fetches.filter((f) => !String(f.url).includes('myapi')).length === 1, '仅"不在列表里"的那 1 个房发探针')
assert(world.fetches.some((f) => String(f.url).includes('off-list')), '探针打的是那个房')
reset()
world.anchors = [anchor(), anchor({ userId: 'off-list' })]
world.favStatus = 515
world.favBody = '{"code":-10000}'
found = await runRound()
assert(pageProbes() === 2, '整表拿不到 → 全部回落逐房探针(旧行为)', `实际=${pageProbes()}`)
assert(found === 2, '探针模式照常统计在播')

console.log('B3 下播要连续两轮确认; 房间属性与场次属性分家')
reset()
world.anchors = [anchor({ isLive: true, title: '在播标题', startTime: '2026-09-29 22:01:00', tags: { isAdult: false, isPw: true, type: '', liveType: 'live' } })]
world.favBody = bodyOf([{ ...LIVE_ROW, is_live: false, broad_info: [] }])
await runRound()
assert(findAnchor('aaa111').isLive === true, '第一轮说离线: 状态不动')
assert(world.toasts.filter((t) => t.t.type === 'offline').length === 0, '第一轮不发下播通知')
await runRound()
assert(findAnchor('aaa111').isLive === false, '第二轮才判下播')
assert(world.toasts.filter((t) => t.t.type === 'offline').length === 1, '第二轮发一次下播通知')
const offCard = findAnchor("aaa111")
assert(offCard.title === '' && offCard.viewerCount === 0 && offCard.thumbUrl === '' && offCard.startTime === '', '下播后场次字段清空')
assert(offCard.tags !== null && offCard.tags?.isPw === false && offCard.tags?.liveType === '', 'SOOP 的离线卡: 这一场的属性(密码房/回放)清掉, 而对象不写成 null —— 清的是场次, 不是房间')
// offPatch 两平台共用, "房间属性留、场次属性清"真正为 Panda 服务(自 ㊌ 起 SOOP 不带房间级 19+/粉丝团), 故按 Panda 那一档形状直调一次
const pandaOff = watcher.offPatch({ tags: { isAdult: true, isPw: true, type: 'fan', liveType: 'live' } })
assert(pandaOff.tags?.isAdult === true && pandaOff.tags?.type === 'fan', 'Panda 形状: 房间属性(19+/粉丝团)下播后保留, 它是房间的属性不是这一场的')
assert(pandaOff.tags?.isPw === false && pandaOff.tags?.liveType === '', 'Panda 形状: 场次属性(密码房/回放)随场次结束清掉')

console.log('B4 已在播不重复通知; 离线房昵称跟进; 状态未知的房回落探针')
reset()
world.anchors = [anchor({ isLive: true, nick: '主播甲', startTime: '2026-09-29 22:01:00' }), anchor({ userId: 'bbb222', nick: '' })]
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
await runRound()
assert(world.toasts.length === 0, '持续在播/持续离线都不发通知')
assert(findAnchor('bbb222').nick === '主播乙', '离线房昵称由列表跟进')
reset()
world.anchors = [anchor()]
world.favBody = bodyOf([{ ...LIVE_ROW, is_live: true, broad_info: [] }])
await runRound()
assert(pageProbes() === 1 && findAnchor('aaa111').isLive === true, '"说在播却没给场次" 的那一个回落探针并落在播')
reset()
world.anchors = [anchor({ isLive: true })]
world.favStatus = 515
world.favBody = '{}'
world.pageMode = 'broken'
await runRound()
assert(findAnchor('aaa111').isLive === true && world.toasts.length === 0, '探针既没给场次也没说下播(风控页)时保持上次已知状态, 不发通知')

console.log('B5 失明计数只看"全部关注都读不到"')
reset()
world.anchors = [anchor({ userId: 'off-list' })]
world.favStatus = 515
world.favBody = '{}'
world.pageFail = true
await runRound()
assert(watcher.soopFailStreak === 1, '未登录且探针全灭: 第一轮计 1')
await runRound()
assert(watcher.soopFailStreak === 2, '连续两轮跨阈值')
assert(world.toasts.filter((t) => t.t.type === 'error').length === 1, '跨阈值只出声一次')
reset()
world.anchors = [anchor(), anchor({ userId: 'off-list' })]
world.favBody = bodyOf([LIVE_ROW])
world.pageFail = true
await runRound()
await runRound()
assert(watcher.soopFailStreak === 0, '列表覆盖到一部分关注时, 兜底房全灭不累计成"平台失明"')

console.log('B6 SOOP 全链路不取房间级 19+; 密码房旗仍是三态')
const NO_PW = { ...LIVE_ROW, broad_info: [{ ...LIVE_ROW.broad_info[0], is_password: undefined }] } // JSON 里就是"没这个键"
reset()
world.anchors = [anchor({ isLive: true, tags: { isAdult: true, isPw: false, type: '', liveType: 'live' }, startTime: '2026-09-29 22:01:00' })]
world.favBody = bodyOf([LIVE_ROW]) // 行里 is_adult: true / is_password: false
await runRound()
assert(findAnchor('aaa111').tags.isAdult === false, '列表写着 is_adult=true 也不落卡: 这一路根本不读这一格')
assert(findAnchor('aaa111').tags.isAdult === false && findAnchor('aaa111').tags.isPw === false, '旧轮次残留的 19+ 被这一轮清掉: 卡片、页头与 TG 自此不画 19+')
assert(!('soopBlindAdult' in watcher), '盲读诊断随这一格一起绝迹(它当年就是为了分清"平台没带"与"我们读错键", 现已无对象可诊断)')
reset()
world.anchors = [anchor({ isLive: true, tags: { isAdult: false, isPw: true, type: '', liveType: 'live' }, startTime: '2026-09-29 22:01:00' })]
world.favBody = bodyOf([NO_PW])
await runRound()
assert(findAnchor('aaa111').isLive === true && findAnchor('aaa111').tags.isPw === true, '单轮没带 is_password: 密码房沿用上一轮而不是塌成 false')
reset()
world.anchors = [anchor({ isLive: true, tags: { isAdult: false, isPw: true, type: '', liveType: 'live' }, startTime: '2026-09-29 22:01:00' })]
world.favBody = bodyOf([{ ...LIVE_ROW, broad_info: [{ ...LIVE_ROW.broad_info[0], is_password: false }] }])
await runRound()
assert(findAnchor('aaa111').tags.isPw === false, '平台明确回 false: 当轮就改口(三态不是"只进不退")')

// ============ C: 登录态持久化 ============
console.log('C1 storeCookies 必带期限')
reset()
const n = await soopApi.storeCookies('UserTicket=abc; AuthTicket=def; PREFIX=grp')
assert(n === 3, '三枚 Cookie 落罐')
assert(world.cookieWrites.every((c) => Number.isFinite(c.expirationDate) && c.expirationDate > Date.now() / 1000), '每枚都带 expirationDate(会话 Cookie 重启即丢)', JSON.stringify(world.cookieWrites[0]))

console.log('C2/C3 persistSessionCookies 的取舍')
reset()
await soopApi.storeCookies('UserTicket=abc')
world.cookieWrites.length = 0
world.jar.push(
  { name: 'SessOnly', value: 'v', domain: '.sooplive.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: undefined },
  { name: 'HostSess', value: 'v', domain: 'www.sooplive.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: undefined },
  { name: 'Already', value: 'v', domain: '.sooplive.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 9999 },
  { name: 'Foreign', value: 'v', domain: '.other-site.com', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: undefined }
)
const converted = await soopApi.persistSessionCookies()
assert(converted === 2, '只转无期限的 sooplive.com 条目(全域 + 主机各一枚)', `实际=${converted}`)
assert(!world.cookieWrites.some((c) => c.name === 'UserTicket'), 'storeCookies 已带期限的凭证不重写')
assert(!world.cookieWrites.some((c) => c.name === 'Already'), '已带期限的不重写')
assert(!world.cookieWrites.some((c) => c.name === 'Foreign'), '外域 Cookie 不碰')
const written = world.cookieWrites.find((c) => c.name === 'SessOnly')
assert(written && Number.isFinite(written.expirationDate) && written.domain === '.sooplive.com', '转持久写回同一域/同名')
assert(world.jar.find((c) => c.name === 'SessOnly' && c.expirationDate), '罐内该条已带期限')

console.log('C3 网页登录链路把转持久接上了')
const authWinSrc = fs.readFileSync(path.join(ROOT, 'src/main/services/authWin.ts'), 'utf-8')
assert(/persistSessionCookies\s*\(\s*\)/.test(authWinSrc), 'authWin 的 SOOP probe 登录成功后调用 persistSessionCookies')

// ============ D: 导入 IPC ============
console.log('D1 anchorsImportSoop 的落库语义')
const { registerIpc } = loadTs('src/main/ipc.ts')
registerIpc()
const importHandler = world.ipc[CH.anchorsImportSoop]
assert(typeof importHandler === 'function', 'IPC 通道已注册')
reset()
world.favBody = bodyOf([LIVE_ROW, OFF_ROW, { ...OFF_ROW, user_id: 'ccc333' }, { ...OFF_ROW, user_id: 'ccc333' }])
world.anchors = [anchor({ userId: 'bbb222', nick: '已在库' })]
const res = await importHandler()
assert(res.total === 4 && res.added === 2, `只增不改: 已在库的 bbb222 跳过, 列表内重复的 ccc333 只算一次, added=${res.added}`)
assert(world.anchors.filter((x) => x.userId === 'ccc333').length === 1, '列表内重复项在库内只有一条')
assert(findAnchor('bbb222').nick === '已在库' && findAnchor('bbb222').isLive === false, '已在库的记录不被列表值覆盖(只增不改)')
const na = findAnchor('aaa111')
assert(na && na.isLive && na.nick === '主播甲' && na.title === '在播标题', '在播行按列表原值建卡')
assert(na.viewerCount === 75 && na.startTime === '2026-09-29 22:01:00' && na.tags.isAdult === false && na.tags.liveType === 'live', '人数/开播时刻一次到位; 导入的出生行也不带房间级 19+(SOOP 全链路不取)')
assert(na.userImg === 'https://stimg.sooplive.com/LOGO/aa/aaa111/aaa111.jpg' && findAnchor('ccc333').userImg === 'https://stimg.sooplive.com/LOGO/cc/ccc333/ccc333.jpg', '导入的卡在落库那刻就带头像(在播与离线一样, 不必等一轮轮询)')
assert(na.autoRecord === false, '批量导入不开自录(几十路并发录制=磁盘与风控灾难)')
assert(world.anchors.filter((x) => x.platform === 'soop').length === 3, '离线房同样入墙(全量导入)')
reset()
world.favStatus = 515
world.favBody = '{"code":-10000}'
world.anchors = []
let thrown = null
try {
  await importHandler()
} catch (e) {
  thrown = e
}
assert(thrown && /importFail/.test(thrown.message), '未登录时报错, 不静默"导入 0 条"', thrown && thrown.message)
assert(world.anchors.length === 0, '失败路径一条都不落库')

console.log('D3 反向差值: 只标注「站内已取关」, 一条都不删(决策 D3)')
reset()
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
world.anchors = [
  anchor({ userId: 'bbb222', nick: '仍在站内' }),
  anchor({ userId: 'gone1', nick: '站内取关', siteGone: false }),
  anchor({ userId: 'fresh', nick: '从未同步' }),
  anchor({ platform: 'pandalive', userId: 'aaa111', nick: '对面平台同名房' })
]
const rGone = await importHandler()
const soopOf = (uid) => world.anchors.find((a) => a.platform === 'soop' && a.userId === uid)
assert(rGone.siteGone === 2, `站内没有的本地关注被标注, siteGone=${rGone.siteGone}`)
assert(findAnchor('gone1').siteGone === true && findAnchor('fresh').siteGone === true, '取关标注落在缺房的记录上')
assert(world.anchors.length === 5, '墙上少一个房间都没有发生(只标注不删墙)', `实际=${world.anchors.length}`)
assert(soopOf('bbb222').siteGone !== true, '站内列表里还在的不打标')
assert(soopOf('aaa111').siteGone !== true, '本次由列表新建的在播房不带标注')
assert(
  world.anchors.find((a) => a.platform === 'pandalive' && a.userId === 'aaa111').siteGone === undefined,
  '对面平台的同名房间不受本轮差值影响(主键是平台+ID, 不是裸 ID)'
)
world.favBody = bodyOf([LIVE_ROW, OFF_ROW, { ...OFF_ROW, user_id: 'gone1' }])
const rBack = await importHandler()
assert(rBack.siteGone === 0 && findAnchor('gone1').siteGone === false, '重新被站内列表带回 → 标注清掉, 增量计数归零')
assert(findAnchor('fresh').siteGone === true, '上一轮已标注的这轮不重复计数')

console.log('D2 桥接与界面接线')
assert(/anchorsImportSoop/.test(fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf-8')), 'preload 暴露 anchorsImportSoop')
assert(/anchorsImportSoop\(\): Promise<FollowImportResult>/.test(fs.readFileSync(path.join(ROOT, 'src/shared/types.ts'), 'utf-8')), 'ApiBridge 声明 anchorsImportSoop')
// 一期把「已关注」并进了工作区直播页: 导入入口现在是当前平台的那一颗「同步站内关注」
const wsSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/src/views/WorkspaceView.vue'), 'utf-8')
assert(/api\.anchorsImportSoop\(\)/.test(wsSrc) && /api\.anchorsImportPanda\(\)/.test(wsSrc), '直播页按平台接上了两边导入')
assert(/loggedIn/.test(wsSrc) && /anchorsImportSoop\(\) : await api\.anchorsImportPanda/.test(wsSrc), '未登录时不给导入入口(避免"导入 0 条"的假成功)')
for (const loc of ['zh-CN', 'en-US']) {
  const src = fs.readFileSync(path.join(ROOT, `src/renderer/src/i18n/locales/${loc}.ts`), 'utf-8')
  assert(/syncFollows:/.test(src) && /imported:/.test(src) && /importConfirm/.test(src), `${loc} 有导入文案`)
}

// ============ E: Panda 站内关注(북마크)列表 ============
// 真实抓包样本(2026-09-29 www.pandalive.co.kr/pick/bookmark: 158 关注, 其中 13 条带 media)
const BM_LIVE = {
  channelTitle: '19ㅂ) 자연쮸',
  userNick: 'ෆ점핑ෆ',
  userIdx: 25780534,
  userId: 'mayonz',
  thumbUrl: 'https://cdn.pandalive.co.kr/upload/live/25780534.jpg',
  thumbUrlOrigin: 'https://cdn.pandalive.co.kr/upload/live/25780534_o.jpg',
  dateTime: '2025-12-12 23:12:29',
  userImg: 'https://cdn.pandalive.co.kr/upload/user/25780534.jpg',
  isBookmark: true,
  media: {
    code: '25780534_202609290972d8dece3aaa52',
    title: '19ㅂ) 자연쮸',
    titleJa: '天然おっぱい',
    userId: 'mayonz',
    userIdx: 25780534,
    userNick: 'ෆ점핑ෆ',
    category: 'ind',
    isAdult: true,
    isPw: false,
    type: 'free',
    user: 28,
    userLimit: 1000,
    startTime: '2026-09-29 18:52:55',
    endTime: '0000-00-00 00:00:00',
    isLive: true,
    onAirType: 'live',
    liveType: 'live',
    playCnt: 1234,
    likeCnt: 88,
    fanCnt: 9,
    bookmarkCnt: 158,
    thumbUrl: 'https://cdn.pandalive.co.kr/upload/live/25780534.jpg',
    userImg: 'https://cdn.pandalive.co.kr/upload/user/25780534.jpg'
  }
}
const BM_OFF = {
  channelTitle: '.',
  userNick: 'tt258',
  userIdx: 1007,
  userId: 'icubi69',
  thumbUrl: 'https://cdn.pandalive.co.kr/upload/noimg/user/noimg_F1.jpg',
  dateTime: '2024-12-08 15:34:26',
  userImg: '',
  isBookmark: true
}
const bmPage = (list, total = list.length) => ({ list, page: { offset: 0, limit: 200, total, page: 1, lastPage: 1 }, result: true, message: null, userIp: '1.2.3.4' })

console.log('E1 Panda 关注列表的请求面(POST /v1/live/bookmark + 会话 Cookie)')
reset()
realPandaApi.jar = { sessKey: 'test-sess', siteLang: 'ko' }
world.bmPages = [bmPage([BM_LIVE, BM_OFF])]
const bmRows = await realPandaApi.fetchBookmarks()
const bmReq = world.fetches.find((f) => String(f.url).includes('v1/live/bookmark'))
assert(bmReq && bmReq.url === 'https://api.pandalive.co.kr/v1/live/bookmark', '命中 /v1/live/bookmark 端点')
assert(bmReq.method === 'POST', '方法是 POST(与官网前端一致)')
assert(/(?:^|&)offset=0(?:&|$)/.test(bmReq.body) && /(?:^|&)limit=200(?:&|$)/.test(bmReq.body), '首页带 offset=0&limit=200(官方上限一发收满)', bmReq.body)
assert(bmReq.headers.Origin === 'https://www.pandalive.co.kr' && bmReq.headers.Referer === 'https://www.pandalive.co.kr/', 'Origin/Referer 停在 www 源根(跨源整路径会被 Chromium 取消)')
assert(bmReq.headers.Cookie === 'sessKey=test-sess; siteLang=ko', '有会话罐就带 Cookie(未登录时服务端回 result=false)', bmReq.headers.Cookie)
assert(Array.isArray(bmRows) && bmRows.length === 2, '两条关注解析成两行')
// ㊑ 这一发是轮询的新真值源: 请求面必须与关注数无关(实测 158 关注 = 1 发 / 90KB / page.lastPage=1),
// 短页(list<limit)即判到底 —— 再发一页就是拿轮询去撞风控
assert(world.fetches.filter((f) => String(f.url).includes('bookmark')).length === 1, '短页即停: 一轮只发一发(轮询的风控面下限)')

console.log('E2 分页保险: 上限被抬高时按 page.total 收满即停')
reset()
world.bmPages = [
  bmPage(Array.from({ length: 200 }, (_, i) => ({ ...BM_OFF, userId: `u${i}` })), 260),
  bmPage(Array.from({ length: 60 }, (_, i) => ({ ...BM_OFF, userId: `v${i}` })), 260)
]
const rows2 = await realPandaApi.fetchBookmarks()
assert(rows2 && rows2.length === 260, '两页合起来 260 条')
assert(world.fetches.filter((f) => String(f.url).includes('bookmark')).length === 2, '收满 total 就停, 不发第三页')

console.log('E3 降级即 null(绝不解析成"一个关注都没有")')
reset()
world.bmPages = [{ list: [], page: { total: 0 }, result: false, message: 'need login' }]
assert((await realPandaApi.fetchBookmarks()) === null, 'result=false(未登录) → null')
reset()
world.bmPages = ['<html>captcha</html>']
assert((await realPandaApi.fetchBookmarks()) === null, '返回 HTML 验证页(风控) → null 且不抛')
reset()
world.bmPages = [bmPage([BM_LIVE])]
world.bmStatus = 403
assert((await realPandaApi.fetchBookmarks()) === null, 'HTTP 403 疑似风控 → null 且不抛(RiskError 不外溢)')
reset()
world.bmPages = [{ page: { total: 1 }, result: true }]
assert((await realPandaApi.fetchBookmarks()) === null, '缺 list 数组(改版) → null')

console.log('E4 在播/离线的字段解析(media 只在开播时下发)')
reset()
world.bmPages = [bmPage([BM_LIVE, BM_OFF])]
const r4 = await realPandaApi.fetchBookmarks()
const bLive = r4.find((x) => x.userId === 'mayonz')
const bOff = r4.find((x) => x.userId === 'icubi69')
assert(bLive.isLive && bLive.live, '在播行: 带 media 才判在线')
assert(bLive.live.title === '19ㅂ) 자연쮸' && bLive.live.startTime === '2026-09-29 18:52:55' && bLive.live.viewers === 28, '标题/开播时刻/当前人数取自 media')
assert(bLive.live.isAdult === true && bLive.live.isPw === false && bLive.live.type === 'free' && bLive.live.liveType === 'live', '19+/密码/房间类型/直播-回放取自 media')
assert(bLive.live.likes === 88 && bLive.live.fans === 9, '点赞/粉丝数取自 media(与全站列表同字段名)')
assert(bLive.live.thumbUrl.includes('/upload/live/') && bLive.live.userImg.includes('/upload/user/'), '截图与头像取自 media')
assert(bLive.userIdx === 25780534 && bLive.nick === 'ෆ점핑ෆ', 'userIdx/昵称随行给出')
assert(bOff.isLive === false && bOff.live === null && bOff.nick === 'tt258', '离线行: 没给 media 就是不在线, 昵称照样拿得到')

console.log('E5 单条脏数据只丢那一条, 整表皆脏报改版')
reset()
world.bmPages = [bmPage([{ ...BM_OFF, userId: 'bad id/x' }, { ...BM_OFF, userId: 'okuser1' }])]
const r5 = await realPandaApi.fetchBookmarks()
assert(r5 && r5.length === 1 && r5[0].userId === 'okuser1', '不可寻址的 userId 只丢那一条')
reset()
world.bmPages = [bmPage([{ userId: 'bad id' }, { userNick: '无 id' }])]
assert((await realPandaApi.fetchBookmarks()) === null, '整表都不可解析 = 字段改版, 报 null 而不是"导入 0 条"')

console.log('E6 anchorsImportPanda 的落库语义(与 SOOP 导入同一条码路)')
const pandaHandler = world.ipc[CH.anchorsImportPanda]
assert(typeof pandaHandler === 'function', 'IPC 通道已注册')
reset()
world.bmPages = [bmPage([BM_LIVE, BM_OFF, { ...BM_OFF, userId: 'dup1' }, { ...BM_OFF, userId: 'dup1' }])]
world.anchors = [anchor({ platform: 'pandalive', userId: 'icubi69', nick: '已在库' })]
const r6 = await pandaHandler()
assert(r6.total === 4 && r6.added === 2, `只增不改: 已在库的跳过, 列表内重复只算一次, added=${r6.added}`)
assert(world.anchors.filter((x) => x.userId === 'dup1').length === 1, '列表内重复项在库内只有一条')
const pa = world.anchors.find((x) => x.userId === 'mayonz')
assert(pa.platform === 'pandalive' && pa.isLive && pa.nick === 'ෆ점핑ෆ' && pa.title === '19ㅂ) 자연쮸', '在播行按列表原值建卡')
assert(pa.viewerCount === 28 && pa.startTime === '2026-09-29 18:52:55' && pa.tags.isAdult === true && pa.tags.type === 'free' && pa.tags.liveType === 'live', '人数/开播时刻/标签一次到位(比 SOOP 多出 type/liveType)')
assert(pa.userIdx === 25780534 && pa.userImg.includes('/upload/user/'), 'Panda 行自带的 userIdx/头像一并落卡')
assert(pa.autoRecord === false, '批量导入不开自录')
assert(world.anchors.filter((x) => x.platform === 'pandalive').length === 3, '离线房同样入墙(全量导入)')
assert(findAnchor('icubi69').nick === '已在库' && findAnchor('icubi69').isLive === false, '已在库的记录不被列表值覆盖(只增不改)')
reset()
world.bmPages = [{ list: [], page: { total: 0 }, result: false, message: 'need login' }]
let thrown6 = null
try {
  await pandaHandler()
} catch (e) {
  thrown6 = e
}
assert(thrown6 && /panda\.importFail/.test(thrown6.message), '未登录时报错, 不静默"导入 0 条"', thrown6 && thrown6.message)
assert(world.anchors.length === 0, '失败路径一条都不落库')

console.log('E8 列表取满官方 200 上限 = 可能不完整, 这一趟不做反向差值')
reset()
world.bmPages = [bmPage(Array.from({ length: 200 }, (_, i) => ({ ...BM_OFF, userId: `w${i}` })))]
world.anchors = [anchor({ platform: 'pandalive', userId: 'offwall', nick: '也许只是没翻到' })]
const rTrunc = await pandaHandler()
assert(rTrunc.total === 200 && rTrunc.siteGone === 0, `截断风险下增量计数归零, siteGone=${rTrunc.siteGone}`)
assert(world.anchors.find((a) => a.userId === 'offwall').siteGone === undefined, '不把"列表被上限截断"报成"站内已取关"')

console.log('E7 双平台导入的接线齐全')
const preloadSrc2 = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf-8')
const typesSrc2 = fs.readFileSync(path.join(ROOT, 'src/shared/types.ts'), 'utf-8')
assert(/anchorsImportPanda/.test(preloadSrc2), 'preload 暴露 anchorsImportPanda')
assert(/anchorsImportPanda\(\): Promise<FollowImportResult>/.test(typesSrc2), 'ApiBridge 声明 anchorsImportPanda')
assert(!/SoopImportResult/.test(typesSrc2), '导入回执类型已去 SOOP 化(两平台共用 FollowImportResult)')
assert(/api\.anchorsImportPanda\(\)/.test(wsSrc) && /api\.anchorsImportSoop\(\)/.test(wsSrc), '直播页两平台各有导入调用')
// 一期把两枚按钮合并成一枚「同步站内关注」: 平台由当前工作区决定, 而不是让用户自己挑按钮
assert(/isSoop\.value \? await api\.anchorsImportSoop\(\) : await api\.anchorsImportPanda\(\)/.test(wsSrc), '导入按当前工作区平台绑定')
for (const loc of ['zh-CN', 'en-US']) {
  const src = fs.readFileSync(path.join(ROOT, `src/renderer/src/i18n/locales/${loc}.ts`), 'utf-8')
  assert(
    /importConfirmPanda/.test(src) && /importConfirmSoop/.test(src) && !/importBtnPanda/.test(src),
    `${loc} 有双平台导入确认文案(旧的按平台两枚按钮文案已清理)`
  )
}

// ============ F: ㊒④ SOOP 取流的场次号复用 + 播放页微缓存 ============
// 实测基线(2026-10-02): 24 个在播关注的 broad_no 列表那一发已经全给了, 旧链路却仍为"拿一个号"
// 在每次点开/录制/预取前 GET 一整页播放页 HTML。F 段用真 soop.ts 数整页发数。
console.log('F1 列表播种场次号: 取流成功那一档整页 HTML 一发不发')
reset()
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
{
  const fRows = await soopApi.fetchFavorites()
  assert(fRows.length === 2 && soopApi.bnoCache.get('aaa111')?.bno === '12345678', '在播行的 broad_no 存进场次号缓存')
  assert(!soopApi.bnoCache.has('bbb222'), '离线行没有号可复用')
  world.fetches.length = 0
  const fPlay = await soopApi.fetchPlay('aaa111')
  assert(fPlay.ok === true, '整链跑通(拉源成功)', fPlay.error)
  assert(pageHits('aaa111') === 0, 'F1a 复用列表场次号: 一页 HTML 都不发', `页=${pageHits('aaa111')}`)
  assert(apiBno(0) === '12345678', '第 2 步带的就是列表那一个号', `bno=${apiBno(0)}`)
  assert(world.logInfo.some((m) => m.includes('拉源成功')) && !world.logInfo.some((m) => m.includes('页面元信息 @aaa111')), '日志形状与实机取证同一条: 有拉源成功, 没有页面元信息')
  assert(fPlay.title === '在播标题' && fPlay.nick === '甲', '标题/昵称仍由主信息给(为省一页而合成的空 meta 不得把读数写空)', `${fPlay.nick}/${fPlay.title}`)
}

console.log('F1b 列表改口说离线: 上一场的号当场作废(留着只会让下一次取流白撞)')
reset()
world.favBody = bodyOf([LIVE_ROW])
await soopApi.fetchFavorites()
assert(soopApi.bnoCache.has('aaa111'), '先有一颗号')
world.favBody = bodyOf([{ ...LIVE_ROW, is_live: false, broad_info: [] }])
await soopApi.fetchFavorites()
assert(!soopApi.bnoCache.has('aaa111'), '离线行清掉该房的号(号是这一场的钥匙, 不是这个房的门牌)')

console.log('F2 页面实读到的号同样进缓存: 第二次取流不再读页')
reset()
{
  const fCold = await soopApi.fetchPlay('ccc333')
  assert(fCold.ok === true && pageHits('ccc333') === 1, '冷房第一次: 一页 + 整链', `页=${pageHits('ccc333')}`)
  world.fetches.length = 0
  // 只让页面微缓存过期(10 秒), 场次号缓存(90 秒)仍新鲜: 这一发省掉整页必须靠的是号缓存, 而不是同一份旧页
  const pageHit = soopApi.pageCache.get('ccc333')
  if (pageHit) pageHit.at = Date.now() - 11_000
  const fWarm = await soopApi.fetchPlay('ccc333')
  assert(fWarm.ok === true && pageHits('ccc333') === 0, '第二次直接进第 2 步(号就是刚读到的那个)', `页=${pageHits('ccc333')}`)
  assert(apiBno(0) === '12345678', '第二次带的仍是页面那个号', `bno=${apiBno(0)}`)
}

console.log('F3 场次号过期(>90 秒)= 当没读到过, 回落到读整页那条既有链路')
reset()
{
  soopApi.bnoCache.set('ddd444', { bno: '99999', at: Date.now() - 91_000 })
  const fStale = await soopApi.fetchPlay('ddd444')
  assert(pageHits('ddd444') === 1, '过期号不带上: 回读整页拿当前号', `页=${pageHits('ddd444')}`)
  assert(apiBno(0) === '12345678' && fStale.ok === true, '带上的是页面此刻的真号, 链路仍走通(过期只是回落, 不是失败)', `bno=${apiBno(0)}`)
}

console.log('F4 复用的号没成功: 只回读一页定性, 代价有上界')
reset()
world.favBody = bodyOf([LIVE_ROW])
await soopApi.fetchFavorites()
world.apiChannel = { RESULT: -3 }
world.pageMode = 'offline'
world.fetches.length = 0
{
  const fGone = await soopApi.fetchPlay('aaa111')
  assert(fGone.ok === false && String(fGone.error).startsWith('soop.offline'), '页面说这一场已断 → 报"已下播", 不是笼统接口失败', fGone.error)
  assert(pageHits('aaa111') === 1 && apiHits('live') === 1, '上界: 1 页 + 1 发主信息(旧号不试第二次)', `页=${pageHits('aaa111')} api=${apiHits('live')}`)
}
reset()
world.favBody = bodyOf([LIVE_ROW])
await soopApi.fetchFavorites()
world.apiChannel = { RESULT: -3 }
world.fetches.length = 0
{
  const fSame = await soopApi.fetchPlay('aaa111')
  assert(fSame.ok === false && String(fSame.error).startsWith('soop.playResult'), '页面对得上同一个号 → 失败与号无关, 原样回报那句', fSame.error)
  assert(pageHits('aaa111') === 1 && apiHits('live') === 1, '不重打整链(同号再试一次只会再撞同一条错误)', `api=${apiHits('live')}`)
}
reset()
world.favBody = bodyOf([LIVE_ROW])
await soopApi.fetchFavorites()
world.apiChannel = { RESULT: -3 }
world.pageBno = 87654321
world.fetches.length = 0
{
  await soopApi.fetchPlay('aaa111')
  assert(apiBno(0) === '12345678' && apiBno(1) === '87654321', '页面给了新号 = 换场, 用新号重走', `${apiBno(0)}→${apiBno(1)}`)
  assert(apiHits('live') === 2 && pageHits('aaa111') === 1, '重走只有一次(不多打整链)', `api=${apiHits('live')} 页=${pageHits('aaa111')}`)
}

console.log('F5 播放页微缓存: 连击型调用复用, 要新读数的自己绕过')
reset()
{
  await soopApi.fetchPageMeta('eee555')
  const fMeta2 = await soopApi.fetchPageMeta('eee555')
  assert(pageHits('eee555') === 1 && fMeta2.broadNo === '12345678', 'TTL 内的第二次复用同一份页(录制启动前先取真名 → 紧接着拉整链)', `页=${pageHits('eee555')}`)
  await soopApi.fetchPageMeta('eee555', false, true)
  assert(pageHits('eee555') === 2, 'fresh=true 必须穿透 —— 探针是来要新读数的, 最短一档 5 秒比 TTL 还小')
  soopApi.pageCache.set('fff666', { at: Date.now() - 11_000, meta: { channel: 'fff666', broadNo: '1', living: true, explicitOffline: false, hostName: '', roomName: '', thumbUrl: '' } })
  await soopApi.fetchPageMeta('fff666')
  assert(pageHits('fff666') === 1, '过期即当没读到过(回既有链路, 不把旧页供成永久)')
}
reset()
{
  const [fA, fB] = await Promise.all([soopApi.fetchPageMeta('hhh888'), soopApi.fetchPageMeta('hhh888')])
  assert(pageHits('hhh888') === 1 && fA.broadNo === fB.broadNo, '并发两问合一次请求(整页是唯一昂贵的一步)', `页=${pageHits('hhh888')}`)
}

// ---------- 汇总 ----------
console.log(`\n通过 ${PASS} / 失败 ${FAIL}`)
if (FAIL) {
  console.log('失败项:\n - ' + fails.join('\n - '))
  process.exit(1)
}
