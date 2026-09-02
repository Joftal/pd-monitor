import { BrowserWindow, Notification } from 'electron'
import { EV, Toast } from '../../shared/types'
import { store } from './store'

export function sendToast(t: Toast): void {
  // 1) 渲染层气泡
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(EV.toast, t)
  // 2) 系统通知
  try {
    const cfg = store.getSettings()
    if (cfg.notifySystem && Notification.isSupported()) {
      const n = new Notification({ title: t.title, body: t.body, silent: !cfg.notifySound })
      n.on('click', () => {
        win?.show()
        win?.focus()
      })
      n.show()
    }
  } catch {
    /* ignore */
  }
}
