// plocal 协议自检: CDP 驱动真实应用, 验证回看链路的真实 HTTP 状态与 <video> 加载结果
import { spawn } from 'child_process'
import * as path from 'path'

const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })

async function getPageWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(500)
  }
  throw new Error('CDP page target not found')
}

let ws, msgId = 0
const pending = new Map()
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result?.value
}

try {
  const url = await getPageWsUrl()
  ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    const p = pending.get(m.id)
    if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
  }
  await sleep(1500) // 等应用初始化(注册协议/窗口)

  const abs = path.resolve('recording/__plocal_test__/sample.mp4').replace(/\\/g, '\\\\')

  // 1) window.api.localFileUrl 是否存在 + 产出
  const mk = await evaluate(`(function(){ try { return window.api.localFileUrl('${abs}') } catch(e){ return 'ERR:'+e.message } })()`)
  console.log('[1] localFileUrl =>', mk)

  // 2) fetch 实际 HTTP 状态(全文件 200/206 + 404 + 403 三用例)
  const forbUrl = 'plocal://file/' + Buffer.from('C:\\Windows\\notepad.exe', 'utf-8').toString('base64url')
  const missingUrl = typeof mk === 'string' ? mk.replace(/sample\.mp4/, 'nope.mp4') : null
  const cases = { ok: mk, missing: missingUrl, forbidden: forbUrl }
  for (const [name, u] of Object.entries(cases)) {
    if (!u) continue
    const st = await evaluate(`fetch(${JSON.stringify(u)}).then(r=>({status:r.status, ct:r.headers.get('content-type'), cl:r.headers.get('content-length')})).catch(function(e){ return 'ERR:'+e.message })`)
    console.log(`[2:${name}]`, JSON.stringify(st))
  }

  // 3) 真实 <video> 加载: 等 loadedmetadata / error
  const vid = await evaluate(`(async () => {
    const mk = ${JSON.stringify(mk)}
    if (typeof mk !== 'string' || mk.startsWith('ERR')) return { skipped: true }
    const v = document.createElement('video')
    v.muted = true
    const done = new Promise((res) => {
      const t = setTimeout(() => res({ timeout: true, readyState: v.readyState, err: v.error && v.error.code }), 8000)
      v.addEventListener('loadedmetadata', () => { clearTimeout(t); res({ ok: true, dur: v.duration, w: v.videoWidth, h: v.videoHeight, readyState: v.readyState }) })
      v.addEventListener('error', () => { clearTimeout(t); res({ ok: false, err: v.error && v.error.code, msg: v.error && v.error.message }) })
    })
    v.src = ${JSON.stringify(mk)}
    v.load()
    return done
  })()`)
  console.log('[3] <video> result =>', JSON.stringify(vid))
} catch (e) {
  console.error('FAILED:', e.message || e)
} finally {
  try { app.kill() } catch { /* ignore */ }
  process.exit(0)
}
