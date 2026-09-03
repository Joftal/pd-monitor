import { safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { dataDir } from '../util'

// Cookie 保险箱: safeStorage 系统级加密落盘
//   Windows=DPAPI · macOS=Keychain · Linux=libsecret(gnome-keyring/kwallet,  deb 已装依赖)
//   无系统密钥环境自动降级明文(仅日志警告, 登录态不丢)
const FILE = () => path.join(dataDir(), 'vault.dat')

export interface CookieJar {
  [name: string]: string
}

export const vault = {
  encrypted: false,

  save(jar: CookieJar): void {
    const raw = JSON.stringify(jar)
    // M5: 与 db.json 同款 tmp+rename 原子写, 崩溃/断电不得截断 cookie 文件
    const atomic = (text: string): void => {
      const tmp = FILE() + '.tmp'
      fs.writeFileSync(tmp, text, 'utf-8')
      fs.renameSync(tmp, FILE())
    }
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const enc = safeStorage.encryptString(raw)
        atomic('enc:' + enc.toString('base64'))
        this.encrypted = true
        return
      }
    } catch (e) {
      console.warn('safeStorage encrypt failed, fallback to plain', e)
    }
    atomic('plain:' + Buffer.from(raw, 'utf-8').toString('base64'))
    this.encrypted = false
  },

  load(): CookieJar | null {
    try {
      const text = fs.readFileSync(FILE(), 'utf-8')
      if (text.startsWith('enc:')) {
        const dec = safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'))
        this.encrypted = true
        return JSON.parse(dec)
      }
      if (text.startsWith('plain:')) {
        this.encrypted = false
        return JSON.parse(Buffer.from(text.slice(6), 'base64').toString('utf-8'))
      }
    } catch {
      /* no vault */
    }
    return null
  },

  clear(): void {
    try {
      fs.unlinkSync(FILE())
    } catch {
      /* ignore */
    }
  }
}
