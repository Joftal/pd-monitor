import { app, BrowserWindow, Tray, Menu, nativeImage, session } from 'electron'
import * as path from 'path'
import { registerIpc, pushAccount } from './ipc'
import { api, SESSION_PARTITION, applyProxy } from './services/pandalive'
import { store } from './services/store'
import { watcher } from './services/watcher'
import { recorder } from './services/recorder'
import { UA, redirectElectronDataDir } from './util'
import { mt, setMainLocale } from './i18n'
import { logger } from './services/logger'
import { registerMediaScheme, installMediaHandler } from './services/localMedia'

// ============ 应用入口 ============

// 本地录制回看协议(plocal://): 特权声明必须在 app ready 前完成
registerMediaScheme()
// Chromium 运行时数据(session/cache/crashpad)随程序目录: 必须在 app ready 前完成重定向
redirectElectronDataDir()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

/** pandalive 的流(AWS IVS)校验 Origin; 仅对流域注入 Origin/Referer 并补 CORS 响应头 */
function setupHeaderInjection(): void {
  const ses = sessionMain()
  // 注意: 只作用于流域名(live-video.net / cloudfront.net)
  // 绝不可动 api/www.pandalive.co.kr —— 官网带凭证(credentials: include)的请求
  // 遇到 ACAO:* 会被浏览器整体拦截(就是我们之前登录窗 Failed to fetch 的根因)
  const filter = {
    urls: ['https://*.live-video.net/*', 'https://*.cloudfront.net/*']
  }
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['Origin'] = 'https://www.pandalive.co.kr'
    headers['Referer'] = 'https://www.pandalive.co.kr/'
    callback({ requestHeaders: headers })
  })
  ses.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    callback({ responseHeaders: headers })
  })
}

function sessionMain(): Electron.Session {
  // 与登录窗共享持久化 partition, 网页登录态直接生效
  return session.fromPartition(SESSION_PARTITION)
}

function createWindow(): void {
  const cfg = store.getSettings()
  mainWin = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 660,
    frame: false,
    show: false,
    // 启动窗口底色跟随主题, 避免加载瞬间主题不符的闪屏
    backgroundColor: cfg.theme === 'dark' ? '#181818' : '#f1f2f3',
    title: 'PandaLive Monitor',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      session: sessionMain(),
      contextIsolation: true,
      nodeIntegration: false,
      // M9: contextIsolation 前提下 preload 仅用 ipcRenderer+Buffer(沙箱 preload 自带 polyfill), 可收紧沙箱
      sandbox: true
    }
  })

  mainWin.once('ready-to-show', () => mainWin?.show())

  mainWin.on('close', (e) => {
    const c = store.getSettings()
    if (c.closeToTray && !quitting && tray) {
      e.preventDefault()
      mainWin?.hide()
    }
  })
  mainWin.on('closed', () => {
    mainWin = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWin.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWin.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  try {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../resources/icon.png')
    const img = nativeImage.createFromPath(iconPath)
    const icon = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 18, height: 18 })
    if (process.platform === 'darwin') icon.setTemplateImage(true) // mac 托盘随深浅色自适配
    tray = new Tray(icon)
    tray.setToolTip('PandaLive Monitor')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: mt('tray.show'), click: () => (mainWin ? mainWin.show() : createWindow()) },
        {
          label: mt('tray.quit'),
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', () => {
      if (mainWin) {
        mainWin.isVisible() ? mainWin.hide() : mainWin.show()
      } else {
        createWindow()
      }
    })
  } catch (e) {
    console.warn('tray init failed', e)
  }
}

app.whenReady().then(() => {
  // 初始化服务
  logger.cleanup()
  logger.info('app', `PandaLive Monitor v${app.getVersion()} 启动 (packaged=${app.isPackaged})`)
  installMediaHandler()
  const cfg = store.getSettings()
  setMainLocale(cfg.locale)
  api.restoreCookies()
  applyProxy(cfg.proxyUrl)
  sessionMain().setUserAgent(UA)
  setupHeaderInjection()
  registerIpc()
  createWindow()
  createTray()
  pushAccount()

  // 启动轮询
  watcher.start()

  app.on('second-instance', () => {
    if (mainWin) {
      mainWin.show()
      mainWin.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let stoppingForQuit = false
app.on('before-quit', (e) => {
  quitting = true
  // M1: remuxing(转码/合并中)同样不可直接退出, 否则截断 MP4 收尾产物
  const hasActive = recorder.list().some((t) => t.status === 'recording' || t.status === 'remuxing')
  if (hasActive && !stoppingForQuit) {
    e.preventDefault()
    stoppingForQuit = true
    void recorder.stopAll().then(() => {
      store.flush()
      app.quit()
    })
    return
  }
  store.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !store.getSettings().closeToTray) {
    app.quit()
  }
})
