// 聚焦验证: 录制过程 bytes 增长曲线 (轮询 recList)
import { spawn } from 'child_process'
const PORT = 9334
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws, msgId = 0
const pending = new Map()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0'
let target = 'zenith6666'
try {
  const r = await fetch('https://api.pandalive.co.kr/v1/live?hotyn=Y&offset=0&limit=3', { headers: { 'User-Agent': UA, 'x-device-info': '{"t":"webPc"}' } })
  const j = await r.json(); if (j.list?.length) target = j.list[0].userId
} catch {}
console.log('target:', target)

const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`])
async function getWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = list.find(t => t.type === 'page')
      if (p) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(500)
  }
  throw new Error('no page')
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
try {
  ws = new WebSocket(await getWs())
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }
  await ev(`window.api.authLoginPassword(${JSON.stringify(process.env.PD_USER || '')}, ${JSON.stringify(process.env.PD_PASS || '')})`)
  await ev(`window.api.anchorsRemove('${target}').catch(()=>0)`)
  await ev(`window.api.anchorsAdd('${target}')`)
  const r0 = await ev(`window.api.recStart('${target}')`)
  console.log('recStart ->', JSON.stringify(r0).slice(0, 120))
  for (let i = 0; i < 10; i++) {
    await sleep(3000)
    const list = await ev(`window.api.recList()`)
    const t = list.find(x => x.userId === target)
    console.log(`t+${(i + 1) * 3}s status=${t?.status} bytes=${t?.bytes} files=${t?.files?.length} cur=${t?.currentFile?.split(/[/\\\\]/).pop()}`)
  }
  await ev(`window.api.recStop('${target}')`)
  await sleep(5000)
  const hist = await ev(`window.api.recHistory()`)
  const h = hist.find(x => x.userId === target)
  console.log('FINAL:', h?.status, h?.bytes, 'files:', h?.files?.map(f => f.split(/[/\\\\]/).pop()).join(', '))
  await ev(`window.api.anchorsRemove('${target}').catch(()=>0)`)
  await ev(`window.api.authLogout()`)
} finally {
  ws?.close(); await sleep(500)
  spawn('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' })
}
