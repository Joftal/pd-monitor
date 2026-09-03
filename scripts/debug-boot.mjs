// 抓取应用启动期 JS 异常(白屏根因)
import { spawn } from 'child_process'
const PORT = 9337
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(500)
  }
  throw new Error('no page')
}
let ws, msgId = 0
const pending = new Map()
const events = []
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
try {
  const url = await getWs()
  ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return }
    if (m.method === 'Runtime.exceptionThrown') events.push('EXC: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 500))
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      events.push(m.params.type.toUpperCase() + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    }
  }
  await cdp('Runtime.enable')
  await sleep(4000)
  const st = await cdp('Runtime.evaluate', { expression: 'document.readyState + " #app=" + (document.getElementById("app")?.innerHTML.length ?? -1) + " body=" + document.body.innerHTML.length', returnByValue: true })
  console.log('STATE:', st.result?.value)
  console.log(events.length ? events.join('\n') : '(no exceptions/console errors captured)')
} catch (e) {
  console.error('FAILED:', e.message || e)
} finally {
  try { app.kill() } catch { /* ignore */ }
  process.exit(0)
}
