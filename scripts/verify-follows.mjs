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
//   G1  ㊓① 作废纪元: invalidatePlay 之后在飞的那条链不复活缓存(带密那一格同摘), 换号清表同规则
//   G4  ㊓② seedPlay: 续录复用中断探针那一发 = 下一次取流零请求; 坏源不种, 种子清判死计数
//   K1  ㊕ 关注列表的在飞合流: 同一瞬时的两问共享一发整表, 落定后再问照发(不设 TTL)
//   K2  ㊕ SOOP 源缓存的年龄收手: 回访客 10 分钟 / 下播 30 分钟出队, 在播长场次不掐, 全程零网络
//   K3  ㊕ 兜底重发出声: 会话层失败 → Node 那一发不再静默, 但 60 秒只报一次(带累计次数)
//   H1~H5 ㊔ 取源链的档位扇出: 后台只买最高档(1+1 发)、残缺包不外交、满档由进房那一次买、手动拉源不省发
//   H6~H7 ㊙(R29-4) 差档复用: 满档 caller 只买没买过的那几档(已买的从复用账递出), 作废/换场/菜单错位三格各自摘账
//   I1~I4 ㊔ 接口风控信号记账: 整页 HTML 与 515 不算风控, 403/429/5xx/接口回 HTML 各武装一次且只按时点解除
//   J1~J3 ㊔ 静默期只收手后台泵: 探针整批收手而列表一发照发, 失明判据不被绕过, 用户进房取流不受牵连
//   L1~L2 ㊗(C7) livePlay 手动刷新的 8 秒下限: 只闸强制位不闸档级, 失败/非强制/别房/对面平台都不立闸
//   M1~M3 ㊘ 轮28 三笔: 添加那一发的真值当场用掉 · 复查吃十秒微缓存 · SOOP 门槛回执 15 分钟不再重打整链
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
  /** 关注列表那一发的应答延迟(㊕ K1: 在飞合流要有窗口让两问撞进同一次请求) */
  favDelayMs: 0,
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
  /** ㊘(R28-1) api.pandalive.co.kr/v1/member/bj 的应答体(null=服务端不给这一格 → 走 Node 兜底那条路) */
  bjBody: null,
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
  /** ㊗ L 段: 取流处理器的调用现场(强制位/档级/成没成) + 替身的令牌序号与失败次数 */
  playCalls: [],
  playSeq: 0,
  playFails: 0,
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
      if (world.favDelayMs) await new Promise((r) => setTimeout(r, world.favDelayMs))
      return { status: world.favStatus, url, text: async () => world.favBody }
    }
    // Panda 站内关注(북마크): POST body 里的 offset 决定第几页(分页不发第三页由场景自己断言)
    if (String(url).includes('api.pandalive.co.kr/v1/live/bookmark')) {
      const offset = Number(/(?:^|&)offset=(\d+)/.exec(String(init.body || ''))?.[1] || 0)
      const page = world.bmPages[offset / 200]
      const text = page === undefined ? '{"result":false,"message":"no page seeded"}' : typeof page === 'string' ? page : JSON.stringify(page)
      return { status: world.bmStatus, url, text: async () => text, headers: { getSetCookie: () => [] } }
    }
    // ㊘(R28-1) 逐房 member/bj: 手工添加那一发与降级复查都走这里, 应答体由场景自己摆
    if (String(url).includes('api.pandalive.co.kr/v1/member/bj')) {
      const text = JSON.stringify(world.bjBody ?? { result: false, message: 'no bj seeded' })
      return { status: 200, url, text: async () => text, headers: { getSetCookie: () => [] } }
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
      // ㊘(R28-3) 替身必须同契约: 间隙泵/轮次现在都读这一面钟, 缺格会让 pumpIdle 一碰就 TypeError
      // (本套一律回"没在冷却", 需要演冷却的场景自己改这一格 —— 与 ㊓ 那一课同一个形状)
      riskCooling: () => false,
      // ㊙(R29-1) 这本账分成两格之后, 轮次扇出与间隙泵读的是"整表那一发被拒"那一格: 缺格同样是一碰就 TypeError
      oracleRiskCooling: () => false,
      // Panda 关注列表走真源码解析(realPandaApi), 替身只做转发, 让 IPC 处理器与客户端在同一条链上
      fetchBookmarks: async () => realPandaApi.fetchBookmarks(),
      // ㊘(R28-1) 手工添加那一条链也要能跑真客户端: 加房的 IPC 处理器与逐房那一发必须在同一条链上,
      // 否则"同一房 1.2 秒内两发 member/bj"这一种形状在本套里根本测不出来(替身吞掉参数照样绿 —— ㊖ 那一课)
      fetchBj: async (userId) => realPandaApi.fetchBj(userId)
    },
    RiskError,
    BjNotFoundError,
    nodeHttpRequest: async (method, url, headers, body) => {
      world.fetches.push({ url, headers: headers || {}, node: true })
      if (String(url).includes('myapi.sooplive.com/api/favorite')) {
        if (world.favDelayMs) await new Promise((r) => setTimeout(r, world.favDelayMs))
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
      // ㊗ L 段要看得见处理器"传下来了什么": 强制位与档级是这个文件的唯一真值处, 替身若把参数丢了,
      // 断言就退化成"确实调用过" —— 那是恒真。每次调用记一条, 返回值给一份带自增令牌的包(两次的 m3u8 必然不同)
      getPlayCached: async (uid, pwd, force, fullV) => {
        const fail = world.playFails > 0
        if (fail) world.playFails--
        else world.playSeq++
        world.playCalls.push({ uid, force: !!force, fullVariants: !!fullV, fail })
        return fail
          ? { ok: false, error: 'playFail(sim)', needLogin: true }
          : { ok: true, m3u8: `https://mock/x${world.playSeq}.m3u8`, variants: [{ url: `https://mock/x${world.playSeq}.m3u8`, bandwidth: 0 }], fetchedAt: Date.now() }
      },
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
  world.favDelayMs = 0
  world.pageMode = 'live'
  world.pageFail = false
  world.pageBno = null
  world.apiChannel = null
  world.assign = 'https://livecast.sooplive.com/12345678-common-hd-1000.ts?limit=0&sid=x'
  world.bmPages = []
  world.bmStatus = 200
  world.bjBody = null // ㊘(R28-1) member/bj 那一格的应答同样一场一份
  world.fetches.length = 0
  world.cookieWrites.length = 0
  world.jar.length = 0
  world.toasts.length = 0
  world.recStarts.length = 0
  world.invalidate.length = 0
  world.logInfo.length = 0
  world.logWarn.length = 0
  world.anchors = []
  world.playCalls.length = 0
  world.playSeq = 0
  world.playFails = 0
  watcher.soopFailStreak = 0
  watcher.soopOfflineStreak.clear()
  soopApi.invalidateCookieCache()
  // ㊘(R28-5) 托管账密那两格也是跨场景状态: 留着上一场那双账号, 下一场"没托管所以记门槛账"那一格就测不出来
  mocks['src/main/services/secrets.ts'].secrets.map.clear()
  // ㊕ 兜底重发的出声窗口也是跨场景状态: 不清会让下一场的"第一句"永远出不来
  soopApi.fallbackCnt = 0
  soopApi.fallbackLogUntil = 0
  // ㊒④ 两处微缓存也是跨场景状态: 不清就会让下一场"读到"上一场的场次号/旧页, 断言变成继承
  soopApi.bnoCache.clear()
  soopApi.pageCache.clear()
  soopApi.pageInflight.clear()
  // ㊓① 源缓存/在飞链/判死计数同样是跨场景状态(清缓存即纪元整体前移, 顺带挡住上一场的在飞链)
  soopApi.clearPlayCache()
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
// lastSeenAt=0 是"证明不了陈旧"那一支(旧库/没写过): 两轮防抖照旧 —— 陈旧基线第一轮翻的那一支见 B3b
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

console.log('B3b ㊛(轮31) 陈旧基线(冷启动/长停)第一轮就翻状态, 但不发那场"下播"')
reset()
// 现场形状: 应用停摆几小时后醒来, 卡上还挂着上一场的 isLive=true, 而 lastSeenAt 是两个轮距之前(阈值 2×120s)
world.anchors = [anchor({ isLive: true, nick: '主播甲', title: '在播标题', startTime: '2026-09-29 22:01:00', lastSeenAt: Date.now() - 30 * 60_000 })]
world.favBody = bodyOf([{ ...LIVE_ROW, is_live: false, broad_info: [] }])
await runRound()
assert(findAnchor('aaa111').isLive === false, 'B3b1 陈旧基线遇到第一轮离线读数即翻状态(旧写法要再等一个轮距才落地, 而平台那句读数本来就报的是离线)')
assert(world.toasts.filter((t) => t.t.type === 'offline').length === 0, 'B3b2 不发下播通知: 那场散于应用停摆期间, 我们根本没在场, 报"刚刚下播"是把旧账当现值')
assert(watcher.soopOfflineStreak.size === 0, 'B3b3 那张"待第二轮确认"的账当场清账(留着会让预取泵白挡一间)')
assert(pageProbes() === 0, 'B3b4 判这一件事用的还是那一发整表: 零增量请求')
reset()
// 新基线(刚刚才被读过)同一句读数仍走两轮 —— 豁免只给"证明得了陈旧"的那一支
world.anchors = [anchor({ isLive: true, title: '在播标题', startTime: '2026-09-29 22:01:00', lastSeenAt: Date.now() })]
world.favBody = bodyOf([{ ...LIVE_ROW, is_live: false, broad_info: [] }])
await runRound()
assert(findAnchor('aaa111').isLive === true && watcher.soopOfflineStreak.size === 1, 'B3b5 新基线照旧两轮防抖(瞬回离线的抖动仍拦得住, 时效一点没让)')
await runRound()
assert(findAnchor('aaa111').isLive === false && world.toasts.filter((t) => t.t.type === 'offline').length === 1, 'B3b6 第二轮才翻, 且那一次通知照发(它真是我们看着散的那场)')

console.log('B3c ㊛(轮31) 逐房探针那一发撞上旧账: 同样第一轮翻状态、不发那场下播')
reset()
world.anchors = [anchor({ userId: 'off-list', isLive: true, lastSeenAt: Date.now() - 30 * 60_000 })]
world.favStatus = 515
world.favBody = '{"code":-10000}' // 整表不接待 ⇒ 这一间走逐房播放页探针(另一条读数面)
world.pageMode = 'offline'
await runRound()
assert(findAnchor('off-list').isLive === false, 'B3c1 探针报"明确未播" + 陈旧基线 = 第一轮就翻(与列表那一条同判据, 不看读数从哪条链来)')
assert(world.toasts.filter((t) => t.t.type === 'offline').length === 0, 'B3c2 同样不发下播通知')
assert(pageProbes() === 1, 'B3c3 用的还是那一发探针: 零增量请求', `实发=${pageProbes()}`)

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

// ============ G: ㊓①② SOOP 的作废纪元与源种子(与 Panda 同策, 这里走真 soop.ts) ============
// 审计形状(R4): invalidatePlay/clearPlayCache 只删了 playCache, 而一条先于它发出的链回来照旧 set ——
// 用户那边就是"下播的房还能秒开 / 换号后仍在用旧账号签发的源"。G 段把这三个口都数出来。
console.log('G1 在飞的取流链遇到 invalidatePlay: 结果照还给调用方, 但不落缓存')
reset()
{
  const gP = soopApi.getPlayCached('ggg1', '', true) // 链已出发(请求在飞)
  assert(soopApi.playInflight.has('ggg1#top'), 'G1a 出发时在飞表里有它(否则下一句没有对照)')
  soopApi.invalidatePlay('ggg1') // 出发之后才被作废
  assert(!soopApi.playInflight.has('ggg1#top'), 'G1b 作废顺手把在飞那条摘掉: 新 caller 不许合进一条注定作废的链')
  const gR = await gP
  assert(gR.ok === true, 'G1c 调用方仍拿到源(这一发不白跑)')
  assert(!soopApi.cachedSourceIds().includes('soop:ggg1'), 'G1d 但缓存没有被复活(纪元不合)', soopApi.cachedSourceIds().join(','))
  world.fetches.length = 0
  await soopApi.getPlayCached('ggg1')
  assert(apiHits('live') === 1, 'G1e 下一次取流重走整链(缓存里确实是空的)', `api=${apiHits('live')}`)
}

console.log('G2 带密码那一条同样在作废时被摘掉(在飞键有四个形状: 密码槽 × 档位扇出)')
reset()
{
  const gP = soopApi.getPlayCached('hh1', 'pw123', true)
  assert(soopApi.playInflight.has('hh1#pw#top'), 'G2a 在飞键 = 频道 + 密码槽 + 档位扇出(预取那一发默认只解最高档)')
  soopApi.invalidatePlay('hh1')
  assert(
    ['hh1', 'hh1#pw', 'hh1#top', 'hh1#pw#top'].every((k) => !soopApi.playInflight.has(k)),
    'G2b 作废把四种形状一起摘(留一半=复活走了后门)',
    [...soopApi.playInflight.keys()].join(',')
  )
  await gP
  assert(soopApi.playCache.size === 0, 'G2c 结果不落缓存')
}

console.log('G3 换号/登出(clearPlayCache): 所有在飞链一律不许把旧会话签发的源写回来')
reset()
{
  const gA = soopApi.getPlayCached('ii1', '', true)
  const gB = soopApi.getPlayCached('ii2', '', true)
  soopApi.clearPlayCache()
  const [rA, rB] = await Promise.all([gA, gB])
  assert(rA.ok === true && rB.ok === true, 'G3a 两发的结果照还(不吞调用方那一发)')
  assert(soopApi.cachedSourceIds().length === 0, 'G3b 两枚都不落缓存: 整表纪元前移, 不靠逐房补刀', soopApi.cachedSourceIds().join(','))
}

console.log('G4 seedPlay: 续录复用中断探针那一发(省掉第二条完整链), 坏源不种')
reset()
{
  const pack = await soopApi.getPlayCached('jj1', '', true)
  assert(pack.ok === true && soopApi.cachedSourceIds().includes('soop:jj1'), 'G4a 先正常拉一枚进缓存')
  soopApi.deadStreak.set('jj1', 1) // 上一源被数过一次"上游已死"
  soopApi.invalidatePlay('jj1')
  soopApi.seedPlay('jj1', pack)
  world.fetches.length = 0
  const hit = await soopApi.getPlayCached('jj1')
  assert(world.fetches.length === 0 && hit.m3u8 === pack.m3u8 && hit.fetchedAt > 0, 'G4b 种子命中: 下一次取流零请求(整链不再重打), 且带打戳', `req=${world.fetches.length}`)
  soopApi.deadStreak.set('kk1', 1) // 这一房的上游刚被数过一次"已死"
  soopApi.seedPlay('kk1', pack)
  assert(soopApi.cachedSourceIds().includes('soop:kk1') && !soopApi.deadStreak.has('kk1'), 'G4c 种子带打戳并清掉判死计数(新源在手, 旧账作废)')
  soopApi.seedPlay('jj2', { ...pack, ok: false })
  assert(!soopApi.cachedSourceIds().includes('soop:jj2'), 'G4d 坏源不许种(种子只认真拿到手的源)')
}

// ============ H: ㊔ SOOP 取源链的档位扇出(后台只买最高档, 满档由真的进房那一次买) ============
// 实测形状: 每一档 = 1 发 AID + 1 发调度(broad_stream_assign), 主信息那发与档数无关。
// 4 档房在预取泵上就是 1+8 发背靠背, 而"用户会不会切清晰度"是一个都没发生过的假设。
const PRESETS2 = [
  { label: 'HD', name: 'hd', label_resolution: 720, bps: 3000 },
  { label: 'SD', name: 'sd', label_resolution: 480, bps: 1000 }
]
const assignHits = () => world.fetches.filter((f) => String(f.url).includes('broad_stream_assign')).length

console.log('H1 只解最高档的那一发: 1 发主信息 + 1 发 AID + 1 发调度, 菜单标"残缺"')
reset()
world.apiChannel = { VIEWPRESET: PRESETS2 }
{
  const top = await soopApi.getPlayCached('q1')
  assert(top.ok === true && top.variants.length === 1 && top.partial === true, 'H1a 一份菜单只有一档, 且 partial=true(卡片算有源, 菜单等进房补齐)', `档=${top.variants?.length}`)
  assert(apiHits('aid') === 1 && assignHits() === 1, 'H1b AID 与调度各恰好一发(满档才是 2+2)', `aid=${apiHits('aid')} assign=${assignHits()}`)
  assert(world.logInfo.some((m) => /档位=1\(只解最高档\)/.test(m)), 'H1c 日志把这一档说清楚(真机据此认形状)')
  const full0 = top.variants[0]
  assert(full0.resolution === '720p', 'H1d 省发留下的必须是最高档(秒开要的就是它)', `res=${full0.resolution}`)

  console.log('H2 已有最高档(哪怕是残缺那一份)的房: 再要最高档零请求')
  world.fetches.length = 0
  const again = await soopApi.getPlayCached('q1')
  assert(world.fetches.length === 0 && again.m3u8 === top.m3u8, 'H2a 命中同一条包 —— 最高档就在里面, 重打整链是纯浪费', `req=${world.fetches.length}`)

  console.log('H3 用户真的进房(要满档菜单): 残缺包不许交出去, 差的那几档现买 —— ㊙(R29-4) 已买的最高档不再重买')
  world.fetches.length = 0
  world.logInfo.length = 0
  const full = await soopApi.getPlayCached('q1', '', false, true)
  assert(full.variants.length === 2 && full.partial === false, 'H3a 满档请求换回两档菜单且不再标残缺(接上复用账之后"其余档一档没买到"不再是满档, 旧判据会把它写成缺档)', `档=${full.variants.length} partial=${full.partial}`)
  assert(full.variants[0].url === top.variants[0].url, 'H3b 复用那一份是从头接起的: 最高档那格与预取买到的同一发(秒开的那一条地址没被换掉)', `${full.variants[0]?.url} vs ${top.variants[0]?.url}`)
  // 旧写法: 满档 caller 认定"残缺包不能给", 于是整条链重打 —— 连最高档那 1+1 发也原样再买一遍(现场实拍 @ahfotlrp0675)
  assert(apiHits('aid') === 1 && assignHits() === 1, 'H3c 补齐 = 只买差的那一档(每档两发), 已经买到的这一档从复用账里递出来', `aid=${apiHits('aid')} assign=${assignHits()}`)
  assert(world.logInfo.some((m) => /复用已买档=1\(省 2 发\)/.test(m)), 'H3d 省下的发数写进成功日志: 事后数包的人要能一眼看出这一条链少打了 2 发')
  assert(!world.logInfo.some((m) => /只解最高档/.test(m)), 'H3e 满档那一发的日志不带"只解最高档"(两种形状在读数面上仍分得开)')

  console.log('H4 切画质再切回: 满档包之后两种请求都不许再打链')
  world.fetches.length = 0
  const backTop = await soopApi.getPlayCached('q1')
  const backFull = await soopApi.getPlayCached('q1', '', false, true)
  assert(
    world.fetches.length === 0 && backTop.variants.length === 2 && backFull.variants.length === 2,
    'H4a 满档包含最高档 ⇒ 两方都命中(切走再切回不会失效也不会重新取源)',
    `req=${world.fetches.length}`
  )

  console.log('H5 用户手动拉源那一条(fetchPlay)默认满档: 省发只发生在后台那一路')
  world.fetches.length = 0
  const raw = await soopApi.fetchPlay('q2')
  assert(raw.ok === true && raw.variants.length === 2 && raw.partial === false, 'H5 fetchPlay 不省发(播放页手动刷新要的本来就是完整菜单)')

  console.log('H6 ㊙(R29-4) 事件一落地, 旧那一场买过的档就不再是"同一场"的档')
  {
    await soopApi.getPlayCached('q3', '', false, false) // 后台先买最高档, 留一格复用账
    soopApi.invalidatePlay('q3') // 下播/收尸/手动强刷都会走到这里
    world.fetches.length = 0
    const after = await soopApi.getPlayCached('q3', '', false, true)
    assert(after.variants.length === 2 && apiHits('aid') === 2, 'H6a 作废之后满档 caller 重打两档: 那一场的凭证跟着源一起废了, 复用账必须一起摘', `实买=${apiHits('aid')}`)
    world.fetches.length = 0
    await soopApi.getPlayCached('q3', '', false, true)
    assert(world.fetches.length === 0, 'H6b 满档链落地即摘账(一本只增不减的账早晚会骗人): 缓存此时已不缺档, 不该再有"复用"这回事')

    console.log('H6c 换号/登出那一条(clearPlayCache)同样摘账: 上一号买过的档对这一个账号不成立')
    await soopApi.getPlayCached('q6', '', false, false) // 后台先买最高档并记账
    assert(soopApi.partialBuy.has('q6'), 'H6c0 记账这一格先自证: 没记上账的话, 下面那条"重打两档"就永远是绿的(变异取证的教训写在 ㊘⑥)')
    soopApi.clearPlayCache()
    world.fetches.length = 0
    const sw = await soopApi.getPlayCached('q6', '', false, true)
    assert(sw.variants.length === 2 && apiHits('aid') === 2, 'H6c 摘账后满档 caller 重打两档(账号不同 ⇒ 能买的档与 aid 都不同, 旧那一份凭证不该递出来)', `实买=${apiHits('aid')}`)
  }

  console.log('H7 ㊙(R29-4) 换场与换菜单: 两格判据各自把关')
  {
    await soopApi.getPlayCached('q4', '', false, false) // 同一场: 先买最高档并记账(bno=12345678)
    assert(soopApi.partialBuy.get('q4')?.bno === '12345678', 'H7a0 账里躺着的就是"上一场那一份": 下面那两发重买才归得出是号对不上, 而不是根本没账可复用')
    world.apiChannel = { VIEWPRESET: PRESETS2, BNO: '88888888' } // 平台说这是新一场了
    world.fetches.length = 0
    const nb = await soopApi.getPlayCached('q4', '', false, true)
    assert(apiHits('aid') === 2 && nb.variants.length === 2, 'H7a 复用判据是场次而不是时间: 号一变, 上一场买的那几档立刻不成立(整档重买, 不给旧凭证)', `实买=${apiHits('aid')}`)
    world.apiChannel = { VIEWPRESET: PRESETS2 }
    await soopApi.getPlayCached('q5', '', false, false) // 先按"hd 是最高档"那份菜单买一档并记账
    assert(soopApi.partialBuy.get('q5')?.bought.map((b) => b.name).join(',') === 'hd', 'H7b0 记的那一档确实叫 hd(位置 0): 于是下面那两发重买是"位置对不上"造成的, 不是没账')
    world.apiChannel = { VIEWPRESET: [{ label: 'SD', name: 'sd', label_resolution: 1080, bps: 9000 }, { label: 'HD', name: 'hd', label_resolution: 720, bps: 3000 }] }
    world.fetches.length = 0 // 同一场、同一号, 只是菜单改了高低: 买过的那一档从第一格掉到了第二格
    const pf = await soopApi.getPlayCached('q5', '', false, true)
    assert(pf.variants[0].resolution === '1080p', 'H7b1 菜单换了高低(同名不同档)之后, 满档包的第一格必须是新的最高档 —— 从错位那一格接起就是交一份对不上菜单的源', `res=${pf.variants[0]?.resolution}`)
    assert(apiHits('aid') === 2 && pf.variants.length === 2, 'H7b2 只对"前缀对得上"的那一段负责: 名字还在而位置不对 ⇒ 那一档当没买过、照买 —— 宁可多买也不交出错位的菜单', `实买=${apiHits('aid')}`)
  }
}

// ============ I: ㊔ SOOP 接口风控信号记账(只记账不发火) ============
console.log('I1 播放页回 HTML 不是风控信号(探针读的就是整页)')
reset()
world.pageMode = 'broken'
await soopApi.fetchPageMeta('p1')
assert(soopApi.riskCooling() === false, 'I1a 整页 HTML 是这一路的常态, 旧形状会把每一次页读都冷却', `cooling=${soopApi.riskCooling()}`)

console.log('I2 515 = 网关的"没登录"回执, 按登录态处理而不是被 ban')
reset()
world.favStatus = 515
world.favBody = '{"code":-10000}'
{
  const rows = await soopApi.fetchFavorites()
  assert(rows === null, 'I2a 列表不可用照旧降级成 null(绝不把"没拿到"当成"全都下播")')
  assert(soopApi.riskCooling() === false, 'I2b 515 不武装静默期(把它记成风控=把登出当被 ban)')
}

console.log('I3 403 / 429 / 非 515 的 5xx / 接口回 HTML: 四种形状各武装一次, 且全程不抛新异常')
for (const [name, setup] of [
  ['403', () => { world.favStatus = 403; world.favBody = '{"code":-1}' }],
  ['429', () => { world.favStatus = 429; world.favBody = 'too fast' }],
  ['500', () => { world.favStatus = 500; world.favBody = 'boom' }],
  ['接口回HTML', () => { world.favStatus = 200; world.favBody = '<html>captcha</html>' }]
]) {
  reset()
  setup()
  const rows = await soopApi.fetchFavorites()
  assert(rows === null && soopApi.riskCooling() === true, `I3-${name} 记进风控账且降级为 null(调用方契约一字不变)`)
  assert(world.logWarn.some((m) => /疑似风控/.test(m)), `I3-${name}b 出声一次(日志是唯一可见面)`)
}

console.log('I4 静默期只由时间到点解除: 一次幸运的 200 不提前解锁, 换号/登出才立即解锁')
reset()
world.favStatus = 403
await soopApi.fetchFavorites()
world.favStatus = 200
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
await soopApi.fetchFavorites()
assert(soopApi.riskCooling() === true, 'I4a 冷却期内即使这一发真的 200 了也不解锁(解锁条件只有"时间到点")')
soopApi.clearPlayCache()
assert(soopApi.riskCooling() === false, 'I4b 换号/登出清表连带解除静默期(旧账号的账不钉新账号的泵)')

// ============ J: ㊔ 静默期只收手后台泵, 不牵连接用户那一条 ============
console.log('J1 冷却轮: 降级探针整批收手, 关注列表那一发照旧(1 发/轮不是风控忌讳的形状)')
reset()
world.pageMode = 'offline' // 站外那个房本就在官网查无(离线页), 让"沿用上一轮"这一条有对照
world.anchors = [anchor(), anchor({ userId: 'off-list' })]
world.favBody = bodyOf([LIVE_ROW]) // 站外的房只有一个 → 常态就是这一发
await runRound()
const probesBefore = pageProbes()
assert(probesBefore === 1, 'J1a 改造前的基线: 列表覆盖不到的那 1 个房发 1 发探针', `页=${probesBefore}`)
world.favStatus = 403
await soopApi.fetchFavorites() // 撞一次风控
world.fetches.length = 0
world.favStatus = 200
await runRound()
assert(pageProbes() === 0, 'J1b 冷却期内探针整批收手(零整页读)', `页=${pageProbes()}`)
assert(world.fetches.some((f) => String(f.url).includes('myapi')), 'J1c 关注列表那一发照发(停它 = 直接丢开播时效)')
assert(watcher.status.byPlatform.soop.roundFailed === 1, 'J1d 收手的那 1 个房计一次"本轮未读到"(既算失败又算被挡下=同一批房数两遍)', `未读=${watcher.status.byPlatform.soop.roundFailed}`)
{
  const card = findAnchor('off-list')
  assert(card.isLive === false && card.title === '', 'J1f 三态必分: 收手绝不把"没读到"写成"已下播"(这里本就是离线房, 不许被翻新)')
}
reset()
world.anchors = [anchor({ isLive: true })]
world.favStatus = 403
await soopApi.fetchFavorites()
world.favBody = '{"code":-10000}' // 列表也拿不到: 全部房进 probe
await runRound()
assert(watcher.soopFailStreak === 1, 'J2 冷却收手不许把失明判据绕过去(覆盖 0 且有房待读 = 全灭)')

console.log('J3 用户进房那一条不受静默期牵连: 拉源链照打(后台泵收手 ≠ 前台点不动)')
reset()
world.favStatus = 403
await soopApi.fetchFavorites()
{
  const r = await soopApi.getPlayCached('u1', '', true)
  assert(r.ok === true && apiHits('live') === 1, 'J3 冷却期内的手动取流照常成功(riskCooling 不在用户意图路径上)', `ok=${r.ok}`)
}

// ============ K: ㊕ 关注列表的在飞合流 + 源缓存的年龄收手 ============
const favHits = () => world.fetches.filter((f) => String(f.url).includes('myapi')).length

console.log('K1 同一瞬时的两问只发一发整表(轮询与「立即刷新」会撞在一起)')
reset()
world.favBody = bodyOf([LIVE_ROW, OFF_ROW])
world.favDelayMs = 40
{
  const [k1a, k1b] = await Promise.all([soopApi.fetchFavorites(), soopApi.fetchFavorites()])
  world.favDelayMs = 0
  assert(favHits() === 1, 'K1a 在飞合流: 两问共享一发请求(整表 718 条那一发不便宜)', `发=${favHits()}`)
  assert(k1a.length === 2 && k1b === k1a, 'K1b 合并的是同一次读数, 不是各解一遍')
  await soopApi.fetchFavorites()
  assert(favHits() === 2, 'K1c 落定之后再问照发新的一发: 这一发是"谁在播"的真值源, 给它加 TTL 是拿时效换请求数')
}

console.log('K2 源缓存的年龄收手: 回访客过宽限、下播房过时限出队; 在播源不限年龄; 这一趟零网络')
reset()
world.anchors = [anchor({ userId: 'sw1', isLive: true }), anchor({ userId: 'sw2', isLive: true }), anchor({ userId: 'sw5', isLive: true })]
await soopApi.getPlayCached('sw1')
await soopApi.getPlayCached('sw2')
await soopApi.getPlayCached('sw5')
await soopApi.getPlayCached('sw3') // 不在关注表的回访客
await soopApi.getPlayCached('sw4')
assert(soopApi.cachedSourceIds().length === 5, 'K2a 五间房各持一份源(对照起点)', soopApi.cachedSourceIds().join(','))
soopApi.playCache.get('sw1').fetchedAt -= 90 * 60_000 // 在播 90 分钟的长场次
soopApi.playCache.get('sw2').fetchedAt -= 31 * 60_000 // 下播(SOOP 列表那一路已把卡翻离线)
soopApi.playCache.get('sw3').fetchedAt -= 11 * 60_000 // 回访客过 10 分钟宽限
world.anchors.find((a) => a.userId === 'sw2').isLive = false
world.anchors.find((a) => a.userId === 'sw5').isLive = false // 下播才 0 分钟
world.fetches.length = 0
{
  const dropped = soopApi.sweepPlayCache()
  assert(dropped === 2 && !soopApi.playCache.has('sw2') && !soopApi.playCache.has('sw3'), 'K2b 过时限的两枚出队(「已缓存」徽标随之熄灭)', `出队=${dropped}`)
  assert(soopApi.playCache.has('sw1'), 'K2c 在播且仍在关注表的源不许被时限掐: 长场次的秒开不是牺牲品')
  assert(soopApi.playCache.has('sw4') && soopApi.playCache.has('sw5'), 'K2d 没到时限的一律不动(回访客 10 分钟内、下播房 30 分钟内)')
  assert(world.fetches.length === 0, 'K2e 收手这一趟零请求: 它只扫内存, 关掉保活与否都照跑')
  const idsBefore = world.fetches.length
  await soopApi.getPlayCached('sw2', '', false, true) // 出队之后再要 = 重新走整链(旧源不许复活)
  assert(world.fetches.length > idsBefore, 'K2f 出队即纪元前移: 下一次取流必然重新打链(尸源不再外供)', `req=${world.fetches.length - idsBefore}`)
}

console.log('K3 兜底重发必须出声(㊕): 会话层失败 → Node 再打一遍, 这一跳过去是静默的')
reset()
world.pageFail = true
{
  await soopApi.fetchPageMeta('fb1').catch(() => {})
  assert(world.fetches.length === 2, 'K3a 一次页面读在会话层失败后由 Node 重发(请求数翻倍是事实, 过去没痕迹)', `发=${world.fetches.length}`)
  assert(world.logWarn.filter((m) => /Node 兜底重发 ×1/.test(m)).length === 1, 'K3b 重发出声一句: 带次数、原因与目标', world.logWarn.join(' | '))
  world.fetches.length = 0
  world.logWarn.length = 0
  await soopApi.fetchPageMeta('fb2').catch(() => {})
  await soopApi.fetchPageMeta('fb3').catch(() => {})
  assert(world.logWarn.filter((m) => /Node 兜底重发/.test(m)).length === 0, 'K3c 60 秒窗口内不逐条刷屏(DNS 黑洞期那是每请求一次的形态)')
  assert(soopApi.fallbackCnt === 2, 'K3d 窗口内的次数在累计, 等下一句一起报', `cnt=${soopApi.fallbackCnt}`)
}

// ============ L: 播放器那一条取流 IPC 的手动刷新下限(㊗ C7) ============
// 这一节验的是处理器"把强制位传下去了没有": source.ts 在本套里是替身(真取流链由 F/G/H 段直接驱动 soopApi),
// 所以断言落在 playCalls 那本参数账上 —— 验参数而不是验"调用过", 否则替身吞掉参数照样绿(㊖ 那一课的形态)
console.log('L1 强制刷新的 8 秒下限: 刚成功过的那一发之内不再传 force')
{
  const playH = world.ipc[CH.livePlay]
  assert(typeof playH === 'function', 'L1a livePlay 通道已注册')
  reset()
  world.anchors = [anchor({ userId: 'thr001', isLive: true })]
  const first = await playH({}, 'soop', 'thr001', '', true)
  assert(first.ok && world.playCalls.length === 1 && world.playCalls[0].force === true && world.playCalls[0].fullVariants === true, 'L1b 第一发强制刷新照旧要 force + 全档(下限不改变"该打的那一发", 也不牵连档级)', JSON.stringify(world.playCalls))
  const second = await playH({}, 'soop', 'thr001', '', true)
  assert(second.ok && world.playCalls.length === 2 && world.playCalls[1].force === false, 'L1c 8 秒内的第二发降级为"复用手里那份"(force=false → 命中 playCache, 整链一发都不重打; SOOP 单链实测 8~10 发, 连点 N 下过去就是 N 条链同时插队)', JSON.stringify(world.playCalls))
  assert(world.playCalls[1].fullVariants === true, 'L1d 被闸掉的只有强制位: 全档那一参照传, 清晰度菜单不许跟着一起缩水')
  assert(world.logInfo.filter((m) => /取流强制刷新节流/.test(m)).length === 1, 'L1e 降级要出声: 静默复用会让人以为「手动刷新」这个按钮坏了', world.logInfo.join(' | '))
}

console.log('L2 只有真强制取到源才落账: 失败、非强制、别的房都不立闸')
{
  const playH = world.ipc[CH.livePlay]
  const forces = () => world.playCalls.map((c) => c.force).join(',')
  reset()
  world.anchors = [anchor({ userId: 'thr002', isLive: true })]
  world.playFails = 1
  const dead = await playH({}, 'soop', 'thr002', '', true)
  assert(dead.ok === false && dead.needLogin === true, 'L2a 失败原样回报(needLogin 一并透传): 节流不许把失败刷成成功')
  const retry = await playH({}, 'soop', 'thr002', '', true)
  assert(retry.ok && forces() === 'true,true', 'L2b 紧接着的重试照拿 force: 失败从来不落账, "源真死了再点一次"永远有反应', forces())
  // 进房那一发(非强制)同样不落账 —— 否则刚开播就点手动刷新会被自己几秒前的缓存闸成哑的
  reset()
  world.anchors = [anchor({ userId: 'thr003', isLive: true })]
  await playH({}, 'soop', 'thr003', '', false)
  const manual = await playH({}, 'soop', 'thr003', '', true)
  assert(manual.ok && forces() === 'false,true', 'L2c 非强制那一发不立闸: 进房后立刻点手动刷新仍然要 force(它是读数, 不是重复的读数)', forces())
  await playH({}, 'soop', 'thr003', '', true)
  assert(forces() === 'false,true,false', 'L2d 而强制成功之后紧接着的那一发要落闸: 同一秒内两条完整链同时插队是这一节消灭的东西', forces())
  // 账本按 平台+房 记: 同号的两平台、不同号的同一平台互不牵连
  await playH({}, 'pandalive', 'thr003', '', true)
  assert(forces().endsWith(',true') && world.playCalls.at(-1).force === true, 'L2e 对面平台的同号不共享这一格账(roomKey 复合键): 裸 userId 建表会让 SOOP 的节流把 Panda 那一发也闸掉', forces())
  await playH({}, 'soop', 'thr004', '', true)
  assert(world.playCalls.at(-1).force === true, 'L2f 同平台的别的房同理(闸是逐房的, 不是全站一刀)', forces())
}

// ============ M: ㊘ 轮28 的三笔(加房那一发的真值 / 复查那一页 / 门槛回执的账) ============
// 这一节的三条都落在"同一件事被打了两遍"上, 而两遍之间隔着的往往是几秒: 只有让 IPC 处理器与真客户端、
// 真取流链在同一条链上才数得出来(替身把第二遍吞掉, 断言就会绿得毫无意义)。
const bjHits = () => world.fetches.filter((f) => String(f.url).includes('/v1/member/bj')).length
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
/** 等一个异步副作用落地(本套原来全是同步驱动, M 段要数的是"泵在添加链返回之后发出的那一发") */
const until = async (fn, ms = 4000) => {
  for (let i = 0; i < ms / 50; i++) {
    if (fn()) return true
    await sleepMs(50)
  }
  return fn()
}

console.log('M1 ㊘(R28-1) 手工添加 Panda 房: member/bj 买回来的在播真值当场用掉')
{
  const addH = world.ipc[CH.anchorsAdd]
  assert(typeof addH === 'function', 'M1a anchorsAdd 已注册')
  reset()
  world.bjBody = { result: true, bjInfo: { id: 'mayonz', nick: '점핑', img: '' }, media: BM_LIVE.media }
  const idle0 = watcher.idleQueue.length
  const card = await addH({}, 'https://www.pandalive.co.kr/play/mayonz', 'pandalive')
  assert(bjHits() === 1, 'M1b 添加这一条链上 member/bj 恰好一发(旧写法这一发只取昵称/头像, media 整包丢掉 ⇒ 卡片按离线落库, 间隙泵 1.2 秒后为同一件事再发一次)', `实发=${bjHits()}`)
  assert(card.isLive === true && card.title === BM_LIVE.media.title && card.viewerCount === 28 && card.likes === 88 && card.fans === 9 && card.startTime === BM_LIVE.media.startTime,
    'M1c 卡片按第一发买回的真值落库(在播/标题/观众/点赞/粉丝/开播时刻), 不等第二轮', JSON.stringify({ l: card.isLive, t: card.title, v: card.viewerCount }))
  assert(card.tags && card.tags.isAdult === true && card.tags.isPw === false && card.tags.type === 'free' && card.tags.liveType === 'live', 'M1d 房态标签同样落地(19+ 与密码房旗不必等大也不会被写成 false)')
  assert(card.lastSeenAt > 0 && card.lastLiveAt === BM_LIVE.media.startTime, 'M1e 已知道在播的房不留 lastSeenAt=0(离线口径不该套在它身上)')
  assert(watcher.idleQueue.length === idle0, 'M1f 在播房没有进间隙泵: trackIdle 那条守卫拦得住, 拦不住的是旧写法把卡片写成了离线')
  watcher.running = true
  await watcher.pumpIdle() // 真点一次泵: M1b 那一发数要有这一句才不是空断言 —— 旧写法在这一步发出第二发
  assert(bjHits() === 1, 'M1f2 间隙泵跑一趟也仍是 0 第二发(旧写法: 卡片离线落库 → 排进泵 → 1.2 秒后同一 userId 第二次打到 /v1/member/bj)', `实发=${bjHits()}`)
  reset()
  world.bjBody = { result: true, bjInfo: { id: 'off1', nick: '오프', img: '' }, media: null }
  watcher.idleQueue.length = 0
  const off = await addH({}, 'off1', 'pandalive')
  assert(off.isLive === false && off.tags === null, 'M1g media 真没有 = 仍按离线落库(新读法不替平台编造在播)')
  // trackIdle 那句 void pumpIdle() 是立刻开扫的, 所以"补扫那一发"要等它落地才数得到(不在添加链的同步段里)
  const pumped = await until(() => bjHits() >= 2, 5000)
  assert(pumped, 'M1h 真无数据才走 ㊗(C4) 那条补洞: 添加那一发之外, 间隙泵照旧为"它到底在不在播"补发一发 —— 2 发 = 已知答案的那一问没重复, 未知的那一问一发不少', `bj=${bjHits()} 队列=${watcher.idleQueue.length}`)
  assert(watcher.idleQueue.length === 0, 'M1h2 补扫是队列被消费掉(不是添加链自己叠发)', `队列=${watcher.idleQueue.length}`)
  reset()
  watcher.discovery = [{ userId: 'mayonz', nick: '大厅昵称', userIdx: 1, userImg: '', title: '大厅标题', isAdult: false, isPw: false, type: 'free', liveType: 'live', startTime: '', viewers: 1, likes: 0, fans: 0, thumbUrl: '' }]
  const fromDisc = await addH({}, 'mayonz', 'pandalive')
  assert(fromDisc.isLive === true && bjHits() === 0, 'M1i 大厅快照命中仍零 bj: 那条既有省发路径没被新读法顶掉(两条路各归各, 不叠发)')
  assert(fromDisc.nick === '大厅昵称' && fromDisc.title === '大厅标题', 'M1j 大厅优先于 bj 的取值顺序不变(近一分钟的全站读数比一次单房问答更该采信)')
}

console.log('M2 ㊘(R28-2) 取流复查吃微缓存: 十秒内刚读过的那一页不再重买')
{
  reset()
  await soopApi.fetchPageMeta('aaa111', true, true, '探针') // 探针要新读数: 这一页是真买回来的
  assert(pageHits('aaa111') === 1, 'M2a 先让探针付一页(它在微缓存里, 且号也入了账)', `页=${pageHits('aaa111')}`)
  soopApi.bnoCache.set('aaa111', { bno: '12345678', at: Date.now() })
  world.apiChannel = { RESULT: -3 }
  world.fetches.length = 0
  const r = await soopApi.fetchPlay('aaa111')
  assert(r.ok === false && String(r.error).startsWith('soop.playResult'), 'M2b 号对得上而链失败 → 原样回报那一句(与 F4 同判据)', r.error)
  assert(pageHits('aaa111') === 0, 'M2c 复查复用探针那一页: 0 新页(旧写法 fresh=true 把微缓存与在途合并一并绕过, 几秒前刚买过的那一页在这里原样重买)', `页=${pageHits('aaa111')}`)
  assert(apiHits('live') === 1, 'M2d 省掉的是页不是判据: 主信息仍一发', `api=${apiHits('live')}`)
  const hit = soopApi.pageCache.get('aaa111')
  if (hit) hit.at = Date.now() - 11_000
  soopApi.bnoCache.set('aaa111', { bno: '12345678', at: Date.now() })
  world.fetches.length = 0
  await soopApi.fetchPlay('aaa111')
  assert(pageHits('aaa111') === 1, 'M2e 过了十秒窗口照样真读一页: 复查要的"这一页怎么说"不由旧页供成永久(F4 那条既有语义没被顶掉)')
}

console.log('M3 ㊘(R28-5) SOOP 门槛回执账: 只记两类不会自己好的回答')
{
  reset()
  world.apiChannel = { RESULT: -6 } // 会话缺失/过期
  const a = await soopApi.getPlayCached('gate1')
  assert(a.ok === false && a.needLogin === true, 'M3a 第一次问照实回报"要登录"(账不改写答案, 只改写第二次要不要去问)')
  const n0 = world.fetches.length
  const b = await soopApi.getPlayCached('gate1')
  assert(b.needLogin === true && world.fetches.length === n0, 'M3b 15 分钟内不再为同一间重打整链(旧写法只缓存 r.ok ⇒ 被拒那一句从没落进任何账, 每点一次重打 9~10 发)', `新增=${world.fetches.length - n0}`)
  assert(b !== a, 'M3c 短路还给的是副本: 调用方就地改这一个对象不许污染账里那一份(否则"要密码"能被改成"要登录")')
  world.fetches.length = 0
  const c = await soopApi.getPlayCached('gate1', 'pw999')
  assert(world.fetches.length > 0 && c.needLogin === true, 'M3d 带密码那一发不看账: 密码本身就是新信息')
  world.fetches.length = 0
  const d = await soopApi.getPlayCached('gate1', '', true)
  assert(world.fetches.length > 0 && d.needLogin === true, 'M3e 手动强刷绕账: 用户明确要一次新答案时不该拿旧账挡(冷却只归后台的泵消费 —— D74h 同一条纪律)')
  soopApi.invalidatePlay('gate1')
  world.fetches.length = 0
  await soopApi.getPlayCached('gate1')
  assert(world.fetches.length > 0, 'M3f 事件解除: 作废(下播收尸/换号/重开播)之后重新问一次平台, 门槛账只许活到下一个事件')
  // 要密码的那一类: 预取那一路永远没有密码 ⇒ 记账
  reset()
  world.apiChannel = { BPWD: 'Y' }
  const p1 = await soopApi.getPlayCached('gate2')
  assert(p1.ok === false && p1.needPassword === true, 'M3g 密码房 + 没密码 → 报"要密码"')
  const n1 = world.fetches.length
  const p2 = await soopApi.getPlayCached('gate2')
  assert(p2.needPassword === true && world.fetches.length === n1, 'M3h 同一间第二次不再重打整链(这一类的代价实测 9~10 发, 而预取泵永远不给密码 ⇒ 每次预取都白付)', `新增=${world.fetches.length - n1}`)
  // 密码不对的那一类不记账: 下一次可能改对
  reset()
  world.apiChannel = { BPWD: 'Y', RESULT: 0 }
  const w1 = await soopApi.getPlayCached('gate3', 'wrong')
  assert(w1.ok === false && w1.needPassword === true && String(w1.error).startsWith('soop.pwWrong'), 'M3i 交了密码而平台仍不给源 = 密码不对, 报"可重填"那句', w1.error)
  const n2 = world.fetches.length
  const w2 = await soopApi.getPlayCached('gate3', 'wrong')
  assert(world.fetches.length > n2, 'M3j 密码不对不记账: 再问一次是"用户改了密码"这条路的必经一步, 把它锁 15 分钟就是把纠错锁死', `新增=${world.fetches.length - n2}`)
  // 带密码那一发本来就不看账(M3d), 所以"记没记账"只能由没有密码的那条路读出 —— 预取泵正是这一形状
  const n2b = world.fetches.length
  const w3 = await soopApi.getPlayCached('gate3')
  assert(world.fetches.length > n2b, 'M3j2 密码不对后无密码那一问照样打平台: 账本里若混进 pwWrong, 预取泵会拿着"密码不对"去问一间它从没交过密码的房', `新增=${world.fetches.length - n2b}`)
  assert(String(w3.error).startsWith('soop.pwRequired'), 'M3j3 报的是"这房要密码"而不是"密码不对": 这一路没交过密码, 无从知道对不对', w3.error)
  // 托管了账密时"要登录"不是终局: 后台 60 秒就能自愈 ⇒ 不记账
  reset()
  mocks['src/main/services/secrets.ts'].secrets.map.set('soop.user', 'me')
  mocks['src/main/services/secrets.ts'].secrets.map.set('soop.pass', 'pw')
  world.apiChannel = { RESULT: -6 }
  const q1 = await soopApi.getPlayCached('gate4')
  assert(q1.ok === false && q1.needLogin === true, 'M3k 托管账密在场时照样报"要登录"(重登没成功就是没成功, 账不许把失败刷成成功)')
  const n3 = world.fetches.length
  const q2 = await soopApi.getPlayCached('gate4')
  assert(world.fetches.length > n3, 'M3l 有托管账密就不记门槛账: 会话过期这一类能在后台自愈, 记账等于把它锁死在墙上(60 秒重登节流才是它该有的节奏)', `新增=${world.fetches.length - n3}`)
  assert(soopApi.gates.size === 0, 'M3m 这一场账本里一格都没有(四类判定各归各: 只有"要登录且没托管"与"要密码且没密码"进账)', `size=${soopApi.gates.size}`)
}

// ---------- 汇总 ----------
console.log(`\n通过 ${PASS} / 失败 ${FAIL}`)
if (FAIL) {
  console.log('失败项:\n - ' + fails.join('\n - '))
  process.exit(1)
}
