import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import {
  CH, EV, AccountState, Anchor, PlayInfo, Settings
} from '../shared/types'
import { api, SESSION_PARTITION, applyProxy } from './services/pandalive'
import { store } from './services/store'
import { vault } from './services/vault'
import { watcher } from './services/watcher'
import { recorder } from './services/recorder'
import { openLoginWindow } from './services/authWin'
import { sendToast } from './services/notify'
import { dataDir } from './util'

async function pushAccount(): Promise<AccountState> {
  let realLogin = false
  let isAdult = false
  if (api.hasSession()) {
    const info = await api.checkLoginInfo()
    realLogin = info.isLogin
    isAdult = info.isAdult
  }
  const state: AccountState = {
    loggedIn: api.hasSession(),
    cookieValid: api.hasSession() && (api.cookieValid || realLogin),
    realLogin,
    isAdult,
    nick: '',
    userIdx: null,
    loginAt: null,
    encrypted: vault.encrypted
  }
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(EV.account, state)
  return state
}

export function registerIpc(): void {
  // ---------- 账号 ----------
  ipcMain.handle(CH.authState, () => pushAccount())

  ipcMain.handle(CH.authLoginPassword, async (_e, loginId: string, password: string) => {
    const r = await api.login(loginId, password)
    pushAccount()
    return r
  })

  ipcMain.handle(CH.authOpenWindow, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false, message: '窗口不存在' }
    const r = await openLoginWindow(win)
    pushAccount()
    return r
  })

  ipcMain.handle(CH.authImportCookies, async (_e, cookieStr: string) => {
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
      return { ok: false, message: '未找到 sessKey, 请确认粘贴的是 pandalive.co.kr 的完整 Cookie' }
    }
    await api.importCookies(jar)
    const info = await api.checkLoginInfo()
    if (!info.isLogin) {
      api.clearCookies()
      return { ok: false, message: 'Cookie 已过期或无效(官方会话校验未通过), 请在浏览器中重新登录后再复制' }
    }
    pushAccount()
    return { ok: true, message: info.isAdult ? '导入成功, 账号含成人认证' : '导入成功(账号暂未通过成人认证)' }
  })

  ipcMain.handle(CH.authLogout, async () => {
    api.clearCookies()
    try {
      await session.fromPartition(SESSION_PARTITION).clearStorageData()
    } catch { /* ignore */ }
    pushAccount()
    return true
  })

  // ---------- 主播 ----------
  ipcMain.handle(CH.anchorsList, () => store.listAnchors())

  ipcMain.handle(CH.anchorsAdd, async (_e, input: string) => {
    let userId = (input || '').trim()
    // 支持粘贴 URL: https://www.pandalive.co.kr/play/xxx 或 lbj 形式
    const m = userId.match(/pandalive\.co\.kr\/(?:play\/)?([\w-]+)/)
    if (m) userId = m[1]
    userId = userId.replace(/[^\w-]/g, '')
    if (!userId) throw new Error('无效的主播 ID 或链接')
    if (store.listAnchors().find((a) => a.userId === userId)) throw new Error('该主播已在监控列表中')

    let nick = userId
    let userIdx: number | null = null
    let userImg = ''

    // 优化: 大厅(discovery)里已有该主播数据时直接复用, 省一次 fetchBj 请求且即时点亮
    const disc = watcher.getDiscovery().find((d) => d.userId === userId)
    if (!disc) {
      try {
        const info = await api.fetchBj(userId)
        nick = info.nick || userId
        userIdx = info.userIdx
        userImg = info.userImg
      } catch {
        /* 主播信息拉取失败也允许添加, 等轮询补全 */
      }
    } else {
      nick = disc.nick
      userIdx = disc.userIdx
      userImg = disc.userImg
    }

    const cfg = store.getSettings()
    const anchor: Anchor = {
      userId,
      userIdx,
      nick,
      userImg,
      isLive: !!disc,
      title: disc?.title || '',
      tags: disc
        ? { isAdult: disc.isAdult, isPw: disc.isPw, type: disc.type, liveType: disc.liveType }
        : null,
      startTime: disc?.startTime || '',
      viewerCount: disc?.viewers || 0,
      likes: disc?.likes || 0,
      fans: disc?.fans || 0,
      thumbUrl: disc?.thumbUrl || '',
      autoRecord: cfg.autoRecordDefault,
      addedAt: Date.now(),
      lastSeenAt: disc ? Date.now() : 0
    }
    store.addAnchor(anchor)
    // 不再触发 tick: 大厅数据已即时点亮; 列表不可见的由轮询规范的轮换兜底在后续轮次发现
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.anchors, store.listAnchors())
    return anchor
  })

  ipcMain.handle(CH.anchorsRemove, async (_e, userId: string) => {
    await recorder.stop(userId)
    store.removeAnchor(userId)
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.anchors, store.listAnchors())
    return true
  })

  ipcMain.handle(CH.anchorsSetAuto, (_e, userId: string, auto: boolean) => {
    store.updateAnchor(userId, { autoRecord: auto })
    return true
  })

  ipcMain.handle(CH.anchorsRefresh, () => {
    watcher.tick()
    return true
  })

  // ---------- 播放 ----------
  ipcMain.handle(CH.livePlay, async (_e, userId: string, password?: string): Promise<PlayInfo> => {
    let r
    try {
      r = await api.fetchPlay(userId, password || '')
    } catch (e) {
      // 网络异常/风控(403/429 等)——必须回落为 ok:false, 否则前端永远停在"获取直播流…"
      return { ok: false, error: `获取直播流失败: ${(e as Error).message || String(e)}(可能是临时风控或网络问题, 稍后重试)` }
    }
    if (!r.ok) {
      return { ok: false, needPassword: r.needPassword, error: r.error }
    }
    return {
      ok: true,
      m3u8: r.m3u8,
      variants: r.variants,
      hlsBackups: r.hlsBackups,
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

  // ---------- 大厅 ----------
  ipcMain.handle(CH.discoveryList, () => watcher.getDiscovery())

  // ---------- 录制 ----------
  ipcMain.handle(CH.recList, () => recorder.list())
  ipcMain.handle(CH.recHistory, () => store.listHistory())

  ipcMain.handle(CH.recStart, async (_e, userId: string, password?: string) => {
    // 允许录制未监控的主播(大厅/播放页直接录制)
    const anchor = store.listAnchors().find((a) => a.userId === userId)
    let nick = anchor?.nick || userId
    let title = anchor?.title || ''
    if (!anchor) {
      try {
        const info = await api.fetchBj(userId)
        nick = info.nick || userId
        title = info.media?.title || ''
      } catch {
        /* 拿不到信息也允许尝试录制 */
      }
    }
    try {
      return await recorder.start({
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

  ipcMain.handle(CH.recStop, (_e, userId: string) => recorder.stop(userId))

  ipcMain.handle(CH.recOpenFolder, async (_e, dir: string) => {
    if (dir) await shell.openPath(dir)
    return true
  })

  ipcMain.handle(CH.recClearHistory, () => {
    store.clearHistory()
    return true
  })

  // ---------- 设置 ----------
  ipcMain.handle(CH.settingsGet, () => store.getSettings())

  ipcMain.handle(CH.settingsSet, (_e, patch: Partial<Settings>) => {
    const before = store.getSettings()
    const cfg = store.setSettings(patch)
    applyProxy(cfg.proxyUrl)
    // 只有轮询相关设置的【值真的变了】才即时拉一轮(前端提交的是全量对象, 不能按 key 存在判断)
    const WATCH_KEYS: (keyof Settings)[] = ['watchMode', 'pollIntervalSec', 'requestGapMs', 'proxyUrl']
    if (WATCH_KEYS.some((k) => before[k] !== cfg[k])) {
      watcher.tick()
    }
    return cfg
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
  ipcMain.handle(CH.watcherStart, () => watcher.start())
  ipcMain.handle(CH.watcherStop, () => watcher.stop())

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
}

export { pushAccount }
