import { BrowserWindow, session } from 'electron'
import { api, SESSION_PARTITION } from './pandalive'
import { UA } from '../util'
import { CookieJar } from './vault'
import { store } from './store'

// ============ 网页登录窗(事件驱动版) ============
// 打开官网让用户自行登录(验证码/二次验证都能过)
// 登录成功探测零轮询压力:
//   - 主触发: session cookie 变化事件(防抖 1.2s) + 页面导航完成事件
//   - 兜底: 每 15s 一次慢速校验(防事件丢失)
//   - 校验通过(isLogin=true)才落地 cookie 并关窗; 验证中不往磁盘写任何东西
// ==================================================

export function openLoginWindow(parent: BrowserWindow): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const ses = session.fromPartition(SESSION_PARTITION)
    const win = new BrowserWindow({
      parent,
      modal: true,
      width: 560,
      height: 860,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: '登录 PandaLive',
      autoHideMenuBar: true,
      // 窗口底色随应用主题(页面本体为官网, 内容区颜色由站点决定)
      backgroundColor: store.getSettings().theme === 'dark' ? '#181818' : '#ffffff',
      webPreferences: { session: ses }
    })

    let done = false
    let verifying = false
    let debounceTimer: NodeJS.Timeout | null = null

    const cleanup = () => {
      clearInterval(slowTimer)
      if (debounceTimer) clearTimeout(debounceTimer)
      try {
        ses.cookies.removeAllListeners('changed')
      } catch {
        /* ignore */
      }
    }

    const finish = (ok: boolean, message: string) => {
      if (done) return
      done = true
      cleanup()
      try {
        win.close()
      } catch {
        /* ignore */
      }
      resolve({ ok, message })
    }

    const verifyNow = async () => {
      if (verifying || done) return
      verifying = true
      try {
        const cookies = await ses.cookies.get({ domain: '.pandalive.co.kr' })
        const jar: CookieJar = {}
        for (const c of cookies) jar[c.name] = c.value
        if (!jar['sessKey']) return // 连匿名会话都没有就不用验了
        // 试验证: 不落盘、不污染主请求通道的 cookie
        const info = await api.checkLoginInfo(jar)
        if (info.isLogin) {
          await api.importCookies(jar)
          finish(true, info.isAdult ? '登录成功, 账号含成人认证' : '登录成功(账号未通过 pandalive 成人认证)')
        }
      } catch {
        /* 网络抖动不致命, 等下个触发 */
      } finally {
        verifying = false
      }
    }

    const debouncedVerify = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void verifyNow(), 1200)
    }

    // 主触发: cookie 写入/变化(登录成功瞬间必有 Set-Cookie)
    ses.cookies.on('changed', debouncedVerify)
    // 副触发: 登录成功后站点通常发生导航
    win.webContents.on('did-navigate', debouncedVerify)
    win.webContents.on('did-navigate-in-page', debouncedVerify)
    // 兜底: 15s 慢速校验
    const slowTimer = setInterval(() => void verifyNow(), 15000)

    win.on('closed', () => finish(false, '已取消登录'))
    win.webContents.setUserAgent(UA)
    void win.loadURL('https://www.pandalive.co.kr/')
  })
}
