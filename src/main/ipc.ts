import { app, BrowserWindow, dialog, ipcMain, net, session, shell } from 'electron'
import * as path from 'path'
import {
  CH, EV, AccountState, AccountStates, Anchor, AppInfo, DEFAULT_PLATFORM, isPlatform, parseRoomInput, Platform, PlayInfo, Settings, SoopAccountState, UpdateCheckResult
} from '../shared/types'
import { APP_META, cmpSemver } from '../shared/appmeta'
import { api, SESSION_PARTITION, applyProxy, cachedSourceIdsAll } from './services/pandalive'
import { sourceFor, applyPlayMeta } from './services/source'
import { maskLoginId, soopApi } from './services/soop'
import { store } from './services/store'
import { vault } from './services/vault'
import { watcher } from './services/watcher'
import { recorder } from './services/recorder'
import { openLoginWindow } from './services/authWin'
import { sendToast } from './services/notify'
import { secrets } from './services/secrets'
import { tgSendMessage } from './services/telegram'
import { dataDir, defaultRecordRoot, diskFreeGb, UA } from './util'
import { logger } from './services/logger'
import { thumbs } from './services/thumbs'
import { mt, setMainLocale } from './i18n'

async function pandaAccount(): Promise<AccountState> {
  let realLogin = false
  let isAdult = false
  let userIdx: number | null = null
  let netFail = false
  if (api.hasSession()) {
    const info = await api.checkLoginInfo()
    realLogin = info.isLogin
    isAdult = info.isAdult
    userIdx = info.idx
    netFail = info.netFail
  }
  const state: AccountState = {
    loggedIn: api.hasSession(),
    cookieValid: api.hasSession() && (api.cookieValid || realLogin),
    realLogin,
    isAdult,
    userIdx,
    netFail,
    encrypted: vault.encrypted
  }
  // 登录态核对留痕: 区分「本地没存住(cookie=0)」与「服务端判死(有cookie但未登录)」与「网络/风控误检(netFail)」
  logger.info(
    'auth',
    `潘达登录态核对: cookie=${api.cookieCount}枚 会话=${api.hasSession() ? '有' : '无'} ` +
      `官方校验=${netFail ? '请求失败(网络/风控)' : realLogin ? `已登录${isAdult ? ' +成人认证' : ' 无成人认证'}` : api.hasSession() ? '未登录(cookie已被服务端作废)' : '未登录'}`
  )
  return state
}

/** SOOP 登录态: 会话罐(persist:soop)就是唯一存储, 判据只认 get_private_info 回的 LOGIN_ID
 *  hasJar 为假时不发请求(匿名态压根没 Cookie), netFail 单列 —— 不许把网络故障报成"未登录" */
async function soopAccount(): Promise<SoopAccountState> {
  let hasCookies = await soopApi.hasJarCookies()
  const cred = soopApi.credentials()
  // 托管着账密却没 Cookie(首装/清过会话/被服务端作废): 这里懒触发一次自动重登。
  // 不做的话"账密自动重登"只在拉流撞 -6 时才生效, 顶栏与账号页会一直显示未登录;
  // 不放启动流程是为了不在启动窗口塞外部请求 —— 取态本身就是按需的(tryAutoLogin 自带 60s 冷却与在途去重)
  if (!hasCookies && cred.username && cred.hasPassword && (await soopApi.tryAutoLogin())) {
    hasCookies = await soopApi.hasJarCookies()
    logger.info('auth', `SOOP 无 Cookie + 有托管账密: 自动重登成功(${maskLoginId(cred.username)})`)
  }
  const v = hasCookies ? await soopApi.verifyLogin() : { isLogin: false, loginId: '', nick: '', netFail: false }
  const state: SoopAccountState = {
    hasCookies,
    realLogin: v.isLogin,
    netFail: v.netFail,
    loginId: v.loginId,
    nick: v.nick,
    credentialUser: cred.username
  }
  logger.info(
    'auth',
    `SOOP 登录态核对: cookie=${hasCookies ? '有' : '无'} ` +
      `官方校验=${v.netFail ? '请求失败(网络/风控)' : v.isLogin ? `已登录 ${maskLoginId(v.loginId)}` : '未登录'} ` +
      `托管账密=${cred.username ? maskLoginId(cred.username) : '无'}`
  )
  return state
}

async function pushAccounts(): Promise<AccountStates> {
  const states: AccountStates = { pandalive: await pandaAccount(), soop: await soopAccount() }
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(EV.account, states)
  return states
}

/** SOOP Cookie 导入: 先用 Node 直发做"试验证", 通过才落罐
 *  (实测 Chromium 会忽略手工 Cookie 头, 所以校验不能走会话通道, 否则会拿罐里的旧 Cookie 冒充新 Cookie) */
async function importSoopCookies(cookieStr: string): Promise<{ ok: boolean; message: string }> {
  const info = await soopApi.verifyLogin(String(cookieStr || '').trim())
  if (info.netFail) {
    logger.warn('auth', 'SOOP Cookie 导入被拒: 校验接口请求失败(网络/风控)')
    return { ok: false, message: mt('soop.importNetFail') }
  }
  if (!info.isLogin) {
    logger.warn('auth', 'SOOP Cookie 导入被拒: get_private_info 未返回 LOGIN_ID(过期/无效)')
    return { ok: false, message: mt('soop.importInvalid') }
  }
  const n = await soopApi.storeCookies(cookieStr)
  logger.info('auth', `SOOP Cookie 导入成功: ${maskLoginId(info.loginId)}(${n} 枚)`)
  pushAccounts()
  return { ok: true, message: mt('soop.importOk', { id: info.loginId }) }
}

export function registerIpc(): void {
  // ---------- 账号(两套登录态互不影响) ----------
  ipcMain.handle(CH.authState, () => pushAccounts())

  ipcMain.handle(CH.authOpenWindow, async (e, platform: Platform) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false, message: mt('auth.winMissing') }
    const r = await openLoginWindow(win, isPlatform(platform) ? platform : DEFAULT_PLATFORM)
    const plat = isPlatform(platform) ? platform : DEFAULT_PLATFORM
    if (r.ok) {
      logger.info('auth', `${plat} 网页登录成功`)
      if (plat === 'soop') soopApi.clearPlayCache() // 匿名态签发的源对 19+/限区房无效, 登录后一律重取
    } else {
      logger.info('auth', `${plat} 网页登录未完成: ${r.message}`)
    }
    pushAccounts()
    return r
  })

  ipcMain.handle(CH.authImportCookies, async (_e, cookieStr: string, platform: Platform) => {
    const plat = isPlatform(platform) ? platform : DEFAULT_PLATFORM
    if (plat === 'soop') return importSoopCookies(cookieStr)
    // 解析 "k=v; k=v" 形式的 cookie 字符串
    const jar: Record<string, string> = {}
    for (const part of String(cookieStr || '').split(/;\s*/)) {
      const i = part.indexOf('=')
      if (i > 0) {
        const k = part.slice(0, i).trim()
        const v = part.slice(i + 1).trim()
        if (k) jar[k] = v
      }
    }
    if (!jar['sessKey']) {
      logger.warn('auth', 'Cookie 导入被拒: 缺 sessKey')
      return { ok: false, message: mt('auth.importNoSess') }
    }
    // M2: 先试验证再落盘 —— 过期 Cookie 不得连带注销现有有效会话;
    //     且 infoPre 直传消重, 不再让 importCookies 内部重复发 login_info
    const info = await api.checkLoginInfo(jar)
    if (!info.isLogin) {
      logger.warn('auth', 'Cookie 导入被拒: login_info 校验未通过(过期/无效)')
      return { ok: false, message: mt('auth.importInvalid') }
    }
    await api.importCookies(jar, info)
    logger.info('auth', `Cookie 导入成功(成人认证=${info.isAdult ? '有' : '无'})`)
    pushAccounts()
    return { ok: true, message: info.isAdult ? mt('auth.importOkAdult') : mt('auth.importOkNoAdult') }
  })

  ipcMain.handle(CH.authLogout, async (_e, platform: Platform) => {
    const plat = isPlatform(platform) ? platform : DEFAULT_PLATFORM
    if (plat === 'soop') {
      // logout() 里连同托管账密一起清: 否则下一次 -6 会把用户刚登出的会话又静默登回来
      await soopApi.logout()
      logger.info('auth', '退出 SOOP: 会话 Cookie/站点存储/托管账密已清')
      pushAccounts()
      return true
    }
    api.clearCookies()
    logger.info('auth', '退出登录: Cookie/站点存储已清')
    try {
      await session.fromPartition(SESSION_PARTITION).clearStorageData()
    } catch { /* ignore */ }
    pushAccounts()
    return true
  })

  ipcMain.handle(CH.authSaveSoopCredentials, async (_e, username: string, password: string) => {
    const u = String(username || '').trim()
    if (!u) {
      soopApi.clearCredentials()
      logger.info('auth', '已解除 SOOP 账密托管')
      pushAccounts()
      return { ok: true, message: mt('soop.credCleared') }
    }
    try {
      // 先真登一次再落库: 错凭据存下来只会在下次 -6 时静默失败, 等于埋个哑弹
      const info = await soopApi.loginWithPassword(u, String(password || ''))
      soopApi.saveCredentials(u, String(password || ''))
      logger.info('auth', `SOOP 账密托管成功: ${maskLoginId(info.loginId)}`)
      pushAccounts()
      return { ok: true, message: mt('soop.credSaved', { id: info.loginId }) }
    } catch (e) {
      const msg = String((e as Error).message || e)
      logger.warn('auth', `SOOP 账密托管失败: ${msg}`)
      return { ok: false, message: msg }
    }
  })

  // ---------- 主播 ----------
  ipcMain.handle(CH.anchorsList, () => store.listAnchors())

  ipcMain.handle(CH.anchorsAdd, async (_e, input: string, platform?: Platform) => {
    // 支持粘贴 URL: https://www.pandalive.co.kr/play/xxx | https://play.sooplive.com/频道名/场次号; 裸 ID 归所选/默认平台
    const parsed = parseRoomInput(input || '', isPlatform(platform) ? platform : DEFAULT_PLATFORM)
    if (!parsed) throw new Error(mt('anchors.invalid'))
    const { platform: plat, userId } = parsed
    if (store.listAnchors().find((a) => a.platform === plat && a.userId === userId)) throw new Error(mt('anchors.exists'))

    let nick = userId
    let userIdx: number | null = null
    let userImg = ''
    let title = ''
    let isLive = false
    /** 大厅之外(目前只有 SOOP)从播放页顺手拿到的截图 */
    let pageThumb = ''

    // 优化: 大厅(discovery)里已有该主播数据时直接复用, 省一次 fetchBj 请求且即时点亮
    // 大厅与 fetchBj 都是 pandalive 专有能力, 其它平台先按裸 ID 落库, 由各自轮询补全
    const disc = plat === 'pandalive' ? watcher.getDiscovery().find((d) => d.userId === userId) : undefined
    if (disc) {
      nick = disc.nick
      userIdx = disc.userIdx
      userImg = disc.userImg
    } else if (plat === 'pandalive') {
      try {
        const info = await api.fetchBj(userId)
        nick = info.nick || userId
        userIdx = info.userIdx
        userImg = info.userImg
      } catch {
        /* 主播信息拉取失败也允许添加, 等轮询补全 */
      }
    } else {
      // SOOP 无大厅: 播放页一发就有主播名/标题/在播态, 关注当场点亮卡片
      try {
        const m = await soopApi.fetchPageMeta(userId)
        nick = m.hostName || userId
        title = m.roomName
        isLive = m.living
        pageThumb = m.thumbUrl
      } catch {
        /* 页面拉不到也允许添加(网络/限区), 由轮询兜底 */
      }
    }

    const cfg = store.getSettings()
    const anchor: Anchor = {
      platform: plat,
      userId,
      userIdx,
      nick,
      userImg,
      isLive: isLive || !!disc,
      title: disc?.title || title,
      tags: disc
        ? { isAdult: disc.isAdult, isPw: disc.isPw, type: disc.type, liveType: disc.liveType }
        : null,
      startTime: disc?.startTime || '',
      viewerCount: disc?.viewers || 0,
      likes: disc?.likes || 0,
      fans: disc?.fans || 0,
      thumbUrl: disc?.thumbUrl || pageThumb,
      autoRecord: cfg.autoRecordDefault,
      addedAt: Date.now(),
      lastSeenAt: disc ? Date.now() : 0
    }
    store.addAnchor(anchor)
    watcher.unmarkGone(plat, userId) // 也可能是已修正的新 ID: 允许重新探活
    // 关注"已在播"主播: 后台预取一次直播源(进房零等待)。列表模式下 onLiveStart 只认
    // 离线→在线翻转, 对关注时已在播的主播永不再触发 —— 这里补洞, 与逐个模式语义对齐。
    // 不作废旧缓存: 先进房再关注 = 命中刚拉取的新鲜源, 预取泵自然 no-op, 不重发请求;
    // 密码房已验证源得以保留(playCache 免密复用契约), 不会二次进房重问密码。
    if (anchor.isLive && cfg.prefetchStream) {
      watcher.prewarmNow(anchor.platform, anchor.userId)
    }
    // 不再触发 tick: 大厅数据已即时点亮; 列表不可见的由轮询规范的轮换兜底在后续轮次发现
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.anchors, store.listAnchors())
    return anchor
  })

  ipcMain.handle(CH.anchorsRemove, async (_e, platform: Platform, userId: string) => {
    // 先取关再停录: removeAnchor 先于 await 落库, watcher 的 stillMonitored 守卫立即生效 ——
    // 否则 stop 的慢窗口(remuxing 收尾最长达分钟级)内开播翻转会穿过守卫启动孤儿录制
    store.removeAnchor(platform, userId)
    watcher.unmarkGone(platform, userId) // 查无此人标记一并解除(将来重加/账号恢复可重新探活)
    await recorder.stop(platform, userId)
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.anchors, store.listAnchors())
    return true
  })

  ipcMain.handle(CH.anchorsSetAuto, (_e, platform: Platform, userId: string, auto: boolean) => {
    store.updateAnchor(platform, userId, { autoRecord: auto })
    return true
  })

  ipcMain.handle(CH.anchorsRefresh, () => {
    watcher.tick()
    return true
  })

  // ---------- 播放 ----------
  ipcMain.handle(CH.livePlay, async (_e, platform: Platform, userId: string, password?: string, fresh?: boolean): Promise<PlayInfo> => {
    let r
    try {
      r = await sourceFor(platform).getPlayCached(userId, password || '', !!fresh)
    } catch (e) {
      // 网络异常/风控(403/429 等)——必须回落为 ok:false, 否则前端永远停在"获取直播流…"
      return { ok: false, error: mt('ipc.playFail', { msg: (e as Error).message || String(e) }) }
    }
    if (!r.ok) {
      // needLogin 必须透传: 前端据此弹"去登录"引导, 丢了就只剩一句无法行动的报错文案
      return { ok: false, needPassword: r.needPassword, needLogin: r.needLogin, error: r.error }
    }
    applyPlayMeta(platform, userId, r) // SOOP: 点开播就把开播时刻/密码房标记补回关注卡(零额外请求)
    return {
      ok: true,
      vod: !!r.vod,
      m3u8: r.m3u8,
      variants: r.variants,
      hlsBackups: r.hlsBackups,
      fetchedAt: r.fetchedAt,
      title: r.title || '',
      nick: r.nick || '',
      thumbUrl: r.thumbUrl || '',
      userImg: r.userImg || '',
      tags: r.media
        ? {
            isAdult: !!r.media.isAdult,
            isPw: !!r.media.isPw,
            type: String(r.media.type || ''),
            liveType: String(r.media.liveType || '')
          }
        : undefined
    }
  })

  ipcMain.handle(CH.liveSrcCache, () => cachedSourceIdsAll())
  ipcMain.handle(CH.liveKeepaliveStatus, (_e, platform: Platform, userId: string) => api.keepaliveStatus(platform, String(userId)))

  // ---------- 大厅 ----------
  ipcMain.handle(CH.discoveryList, () => watcher.getDiscovery())

  // ---------- 录制 ----------
  ipcMain.handle(CH.recList, () => recorder.list())
  // 每次取历史先对账外部删改(启动首拉/进库刷新同走此口), 渲染层所见即磁盘实况
  ipcMain.handle(CH.recHistory, () => {
    recorder.reconcileHistory()
    return store.listHistory()
  })

  ipcMain.handle(CH.recStart, async (_e, platform: Platform, userId: string, password?: string) => {
    // 允许录制未监控的主播(大厅/播放页直接录制)
    const anchor = store.listAnchors().find((a) => a.platform === platform && a.userId === userId)
    let nick = anchor?.nick || userId
    let title = anchor?.title || ''
    if (!anchor && platform === 'pandalive') {
      try {
        const info = await api.fetchBj(userId)
        nick = info.nick || userId
        title = info.media?.title || ''
      } catch {
        /* 拿不到信息也允许尝试录制 */
      }
    } else if (!anchor && platform === 'soop') {
      // SOOP 同样要在建目录前拿到真名: 落盘路径是 <根>/soop/<主播名(主播ID)>, 用频道号占位会得到不可读目录
      try {
        const m = await soopApi.fetchPageMeta(userId, true)
        nick = m.hostName || userId
        title = m.roomName || ''
      } catch {
        /* 拿不到信息也允许尝试录制 */
      }
    }
    try {
      return await recorder.start({
        platform,
        userId,
        nick,
        title,
        password: password || '',
        auto: false
      })
    } catch (e) {
      const err = e as Error & { needPassword?: boolean }
      return { ok: false, needPassword: !!err.needPassword, error: err.message }
    }
  })

  ipcMain.handle(CH.recStop, (_e, platform: Platform, userId: string) => recorder.stop(platform, userId))

  ipcMain.handle(CH.recOpenFolder, async (_e, dir: string) => {
    // M10: 只允许打开录制/应用数据相关目录(任意路径探测封堵; 对照 openExternal 已有白名单)
    const resolved = path.resolve(String(dir || ''))
    const roots = new Set<string>([
      path.resolve(store.getSettings().savePath || defaultRecordRoot()),
      path.resolve(defaultRecordRoot()),
      // 设置页「打开目录」按钮传的是应用数据目录(data/), 与录制根平级 —— 不放行则恒被拒
      path.resolve(dataDir())
    ])
    for (const h of store.listHistory()) if (h.dirPath) roots.add(path.resolve(h.dirPath))
    const ok = [...roots].some((root) => {
      const rel = path.relative(root, resolved)
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    })
    if (ok) {
      await shell.openPath(resolved)
    } else {
      logger.warn('ipc', `打开目录被白名单拒绝: ${resolved}`)
    }
    return ok
  })

  ipcMain.handle(CH.recThumb, (_e, taskId: string) => ({ ok: true, url: thumbs.ensure(String(taskId)).url }))

  ipcMain.handle(CH.recDelete, (_e, taskId: string) => recorder.deleteTask(String(taskId)))

  ipcMain.handle(CH.recDeleteFile, (_e, taskId: string, absPath: string) => recorder.deleteFile(String(taskId), String(absPath)))

  ipcMain.handle(CH.recDiskFree, () => {
    const cfg = store.getSettings()
    return diskFreeGb(cfg.savePath || defaultRecordRoot())
  })

  ipcMain.handle(CH.recMerge, (_e, taskId: string) => recorder.mergeTask(String(taskId)))

  // ---------- 设置 ----------
  // tgTokenSet 只作投影下发(UI 显隐用), 真值永不出 secrets 保险箱 ——
  // 不把活引用直接递给渲染层, 防投影写回 db.json
  const projectTg = (): Settings => ({ ...store.getSettings(), tgTokenSet: Boolean(secrets.get('tgToken')) })

  ipcMain.handle(CH.settingsGet, () => projectTg())

  ipcMain.handle(CH.settingsSet, (_e, patch: Partial<Settings>) => {
    // tgTokenSet 是主进程投影字段, 渲染层误提交一律忽略(防真值开关被当设置落盘)
    const p = { ...patch }
    delete p.tgTokenSet
    const before = store.getSettings()
    const cfg = store.setSettings(p)
    // 变更留痕(排查"参数什么时候被改过"类问题; 代理地址可能内嵌凭据, 一律掩码)
    const diffs = (Object.keys(p) as (keyof Settings)[])
      .filter((k) => p[k] !== undefined && before[k] !== cfg[k])
      .map((k) =>
        k === 'proxyUrl' || k === 'tgProxy'
          ? (cfg[k] ? `${k}=已设置` : `${k}=已清空`)
          : `${k}=${String(before[k])}→${String(cfg[k])}`
      )
    if (diffs.length) logger.info('app', `设置变更: ${diffs.join(', ')}`)
    applyProxy(cfg.proxyUrl)
    setMainLocale(cfg.locale) // 语言变更即时注入主进程 i18n(单向数据流)
    // 只有轮询相关设置的【值真的变了】才即时拉一轮(前端提交的是全量对象, 不能按 key 存在判断)
    const WATCH_KEYS: (keyof Settings)[] = ['watchMode', 'pollIntervalSec', 'requestGapMs', 'proxyUrl']
    if (WATCH_KEYS.some((k) => before[k] !== cfg[k])) {
      watcher.tick()
    }
    return projectTg()
  })

  ipcMain.handle(CH.telegramSetToken, (_e, token: string) => {
    const t = String(token || '').trim()
    secrets.set('tgToken', t)
    logger.info('app', t ? 'Telegram bot token 已保存到保险箱' : 'Telegram bot token 已清除')
    return projectTg()
  })

  ipcMain.handle(CH.telegramTest, async (_e, token: string, chatId: string) => {
    const t = String(token || '').trim() || secrets.get('tgToken')
    const r = await tgSendMessage(t, String(chatId || ''), mt('tg.testBody'))
    return r.ok ? { ok: true, message: mt('tg.testOk') } : { ok: false, message: r.message }
  })

  ipcMain.handle(CH.settingsSelectDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.getSettings().savePath || app.getPath('videos')
    })
    return r.canceled ? '' : r.filePaths[0]
  })

  // ---------- 轮询 ----------
  ipcMain.handle(CH.watcherStatus, () => watcher.status)

  // ---------- 窗口控制 / 外部链接 ----------
  ipcMain.handle(CH.winControl, (e, action: 'min' | 'max' | 'close') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'min') win.minimize()
    else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else if (action === 'close') win.close()
  })

  ipcMain.handle(CH.openExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(CH.appDataDir, () => dataDir())

  // 渲染层诊断日志入档(hls.js 报错等主进程不可见事件); 限流 30 条/分防刷屏
  let rlogCount = 0
  let rlogWindow = Date.now()
  ipcMain.on(CH.appLog, (_e, level: unknown, msg: unknown) => {
    if (typeof msg !== 'string' || !msg) return
    const now = Date.now()
    if (now - rlogWindow > 60_000) {
      rlogWindow = now
      rlogCount = 0
    }
    if (++rlogCount > 30) return
    logger[level === 'warn' ? 'warn' : 'info']('renderer', String(msg).slice(0, 1500))
  })

  ipcMain.handle(CH.appOpenLogs, async () => {
    const dir = logger.dir()
    await shell.openPath(dir)
    return dir
  })

  // ---------- 关于 / 检查更新 ----------
  ipcMain.handle(CH.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    author: APP_META.author,
    repo: APP_META.repo,
    releasesPage: APP_META.releasesPage
  }))

  ipcMain.handle(CH.appCheckUpdate, async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    try {
      // 走 releases/latest 网页 302 跳转而非 REST API(匿名 API 有每 IP 60 次/时限流, 共享出口 IP 易爆)
      const res = await net.fetch(APP_META.releasesPage + '/latest', { headers: { 'User-Agent': UA } })
      if (res.status === 404) {
        // 仓库尚无 Release: 视为已是最新
        return { ok: true, current, latest: '', hasUpdate: false, url: APP_META.releasesPage }
      }
      if (res.status !== 200) throw new Error(`GitHub 响应 HTTP ${res.status}`)
      // 有 Release 时最终 URL 形如 .../releases/tag/vX.Y.Z
      const m = /\/releases\/tag\/(v?[\w.-]+)/.exec(res.url || '')
      if (!m) return { ok: true, current, latest: '', hasUpdate: false, url: APP_META.releasesPage }
      return {
        ok: true,
        current,
        latest: m[1].replace(/^v/i, ''),
        hasUpdate: cmpSemver(m[1], current) > 0,
        url: res.url || APP_META.releasesPage
      }
    } catch (e) {
      logger.warn('app', `检查更新失败: ${String((e as Error).message || e)}`)
      return { ok: false, current, error: mt('app.updFail', { msg: String((e as Error).message || e) }) }
    }
  })

  // 启动即清扫孤儿缩略图(历史已删/外部移除), 与历史表对账
  try {
    thumbs.sweep(store.listHistory().map((h) => h.id))
  } catch { /* 清扫失败不影响启动 */ }
}

export { pushAccounts }
