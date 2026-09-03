// 持久化实证: 写入设置与关注 -> 立即强杀进程 -> 冷启动读回, 逐项比对
import { spawn } from 'child_process'
import * as fs from 'fs'

const PORT = 9342
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', detached: false })
  for (let i = 0; i < 50; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = l.find((t) => t.type === 'page')
      if (p) return { app, ws: new WebSocket(p.webSocketDebuggerUrl) }
    } catch { /* retry */ }
    await sleep(400)
  }
  throw new Error('no page')
}
let ws, msgId = 0
const pending = new Map()
const ev = async (e) => {
  const r = await new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, awaitPromise: true, returnByValue: true } }))
  })
  if (r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 200)
  return r.result?.value
}

const result = {}
try {
  // ---------- 第一生命周期: 写入 ----------
  let sess = await launch()
  ws = sess.ws
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } }
  await sleep(2500)

  const before = await ev(`(async () => { const s = await window.api.settingsGet(); return { theme: s.theme, locale: s.locale, poll: s.pollIntervalSec, merge: s.mergeMp4, gap: s.requestGapMs } })()`)
  console.log('[写入前]', JSON.stringify(before))

  const acc = await ev(`(async () => {
    const acc0 = await window.api.authState()
    await window.api.settingsSet({ theme: 'dark', locale: 'en-US', pollIntervalSec: 45, mergeMp4: true, requestGapMs: 1500 })
    return { logged: acc0.loggedIn, realLogin: acc0.realLogin, encrypted: acc0.encrypted }
  })()`)
  console.log('[写入设置 + 账号态]', JSON.stringify(acc))

  // 立即强杀(不经过正常退出), 验证落盘是即时的而非依赖优雅退出
  await sleep(600)
  sess.app.kill('SIGKILL')
  await sleep(1200)

  // 直接读磁盘文件佐证(不依赖应用)
  const db = JSON.parse(fs.readFileSync('data/db.json', 'utf8'))
  console.log('[磁盘 db.json 佐证]', JSON.stringify({ theme: db.settings.theme, locale: db.settings.locale, poll: db.settings.pollIntervalSec, merge: db.settings.mergeMp4, gap: db.settings.requestGapMs }))

  // ---------- 第二生命周期: 冷启动读回 ----------
  msgId = 0
  sess = await launch()
  ws = sess.ws
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } }
  await sleep(2500)

  const after = await ev(`(async () => {
    const s = await window.api.settingsGet()
    const acc = await window.api.authState()
    return { theme: s.theme, locale: s.locale, poll: s.pollIntervalSec, merge: s.mergeMp4, gap: s.requestGapMs, logged: acc.loggedIn, realLogin: acc.realLogin, encrypted: acc.encrypted }
  })()`)
  console.log('[重启读回]', JSON.stringify(after))

  // html 上的 dark 类(主题实际生效)
  console.log('[主题生效] html.dark =', await ev(`document.documentElement.classList.contains('dark')`))
  console.log('[语言生效] 含 English UI:', await ev(`document.body.innerText.includes('Live Hall')`))

  // 还原现场
  await ev(`(async () => { await window.api.settingsSet({ theme: 'light', locale: 'zh-CN', pollIntervalSec: 30, mergeMp4: false, requestGapMs: 1200 }) })()`)
  console.log('[还原] done')

  sess.app.kill('SIGKILL')
} catch (e) {
  console.error('FAILED:', e.message || e)
  process.exit(1)
}
process.exit(0)
