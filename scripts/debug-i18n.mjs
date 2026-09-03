// i18n 实证(用户路径): 在设置页点 English -> 逐页断言英文渲染 -> 再点回简体中文
import { spawn } from 'child_process'

const PORT = 9341
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], { stdio: 'ignore' })

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = l.find((t) => t.type === 'page')
      if (p) return p.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(400)
  }
  throw new Error('no page')
}
let ws, msgId = 0
const pending = new Map()
const cdp = (m, p = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const ev = async (e) => {
  const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return 'EXC:' + JSON.stringify(r.exceptionDetails).slice(0, 220)
  return r.result?.value
}

// 按文本点击单选按钮(返回是否点到)
const clickByText = (txt) => `(function(){
  const els=[...document.querySelectorAll('.n-radio-button,button')]
  const el=els.find(x=>x.textContent.trim().includes(${JSON.stringify(txt)}))
  if(!el) return false
  el.click(); return true
})()`

const SCAN = `(function(){
  const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n
  while((n=w.nextNode())){const p=n.parentElement;if(!p||p.closest('script,style'))continue
  const t=n.textContent.trim();if(!t||!/[\\u4e00-\\u9fff]/.test(t))continue
  const r=p.getBoundingClientRect();if(r.width<1||r.height<1)continue
  out.add(t.slice(0,50));if(out.size>=12)break}
  return [...out]
})()`
const HAS = (s) => `(()=>document.body.innerText.includes(${JSON.stringify(s)}))()`

try {
  ws = new WebSocket(await getWs())
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } }
  await sleep(3000)

  // 1) 到设置页点 English
  await ev(`location.hash = '#/settings'`)
  await sleep(1200)
  console.log('[1] 点击 English =>', await ev(clickByText('English')))
  await sleep(1200)

  // 2) 逐页断言英文 + 中文残留
  const pages = [
    ['explore', '#/', 'Live Hall'],
    ['monitor', '#/monitor', 'Following'],
    ['recordings', '#/recordings', 'Recordings'],
    ['account', '#/account', 'Login methods'],
    ['settings', '#/settings', 'Appearance']
  ]
  for (const [name, hash, expect] of pages) {
    await ev(`location.hash = ''`)
    await sleep(250)
    await ev(`location.hash = '${hash}'`)
    await sleep(900)
    console.log(`[${name}] '${expect}':`, await ev(HAS(expect)), '| 中文残留:', JSON.stringify(await ev(SCAN)))
  }

  // 3) 点回简体中文恢复
  await ev(`location.hash = '#/settings'`); await sleep(900)
  console.log('[3] 点回 简体中文 =>', await ev(clickByText('简体中文')))
  await sleep(1000)
  console.log('[restore] tab 中文恢复:', await ev(HAS('直播大厅')))
} catch (e) {
  console.error('FAILED:', e.message || e)
} finally {
  try { app.kill() } catch { /* ignore */ }
  process.exit(0)
}
