import { safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { dataDir } from '../util'

// Cookie 保险箱: safeStorage(Windows DPAPI) 加密落盘; 不可用时降级明文(仅警告)
const FILE = () => path.join(dataDir(), 'vault.dat')

export interface CookieJar {
  [name: string]: string
}

export const vault = {
  encrypted: false,

  save(jar: CookieJar): void {
    const raw = JSON.stringify(jar)
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const enc = safeStorage.encryptString(raw)
        fs.writeFileSync(FILE(), 'enc:' + enc.toString('base64'), 'utf-8')
        this.encrypted = true
        return
      }
    } catch (e) {
      console.warn('safeStorage encrypt failed, fallback to plain', e)
    }
    fs.writeFileSync(FILE(), 'plain:' + Buffer.from(raw, 'utf-8').toString('base64'), 'utf-8')
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
