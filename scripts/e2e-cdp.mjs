// E2E 全链路审计: CDP 驱动真实应用 (window.api -> IPC -> 主进程 -> pandalive)
// 流程: 登录 -> 挑选在播主播 -> 添加监控 -> 等待轮询命中 -> 取流 -> 录制 15s -> 停止 -> 校验历史
import { spawn } from 'child_process'

const PORT = 9333
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  -- ' + String(extra).slice(0, 140) : ''}`)
}

// ---------- 0. 预检: 选一个当前在播的主播 ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36'
let target = 'zenith6666'
try {
  const r = await fetch('https://api.pandalive.co.kr/v1/live?hotyn=Y&offset=0&limit=5', { headers: { 'User-Agent': UA, 'x-device-info': '{"t":"webPc"}' } })
  const j = await r.json()
  if (j.list?.length) target = j.list[0].userId
} catch { /* fallback zenith6666 */ }
console.log('在播目标主播:', target)

// ---------- 1. 启动应用 ----------
const app = spawn('node_modules/electron/dist/electron.exe', ['.', `--remote-debugging-port=${PORT}`], { detached: false })
let ws, msgId = 0
const pending = new Map()

async function getPageWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(500)
  }
  throw new Error('CDP page target not found')
}

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}

try {
  const url = await getPageWsUrl()
  ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
    }
  }

  check('应用启动并通过 CDP 连接', true)

  // ---------- 2. 登录 ----------
  const login = await evaluate(`window.api.authLoginPassword(${JSON.stringify(process.env.PD_USER || '')}, ${JSON.stringify(process.env.PD_PASS || '')})`)
  check('账号密码登录', login?.ok, login?.message)
  const acc = await evaluate(`window.api.authState()`)
  check('账号状态 loggedIn=true', acc?.loggedIn === true)

  // ---------- 3. 添加主播(先幂等清理) ----------
  await evaluate(`window.api.anchorsRemove('${target}').catch(() => false)`)
  const added = await evaluate(`window.api.anchorsAdd('${target}')`)
  check('添加主播', added?.userId === target, `nick=${added?.nick}`)

  // ---------- 4. 等待轮询命中(最多 40s) ----------
  let anchor = null
  for (let i = 0; i < 8; i++) {
    await sleep(5000)
    const list = await evaluate(`window.api.anchorsList()`)
    anchor = list.find(a => a.userId === target)
    if (anchor?.isLive) break
  }
  check('轮询引擎检测开播', anchor?.isLive === true, `title=${anchor?.title?.slice(0, 30)} viewers=${anchor?.viewerCount} thumb=${!!anchor?.thumbUrl}`)
  check('开播标签字段齐全', anchor?.tags && typeof anchor.tags.isAdult === 'boolean', JSON.stringify(anchor?.tags))

  const wst = await evaluate(`window.api.watcherStatus()`)
  check('轮询状态运行中且无熔断', wst?.running === true && wst?.circuitOpen === false, `mode=${wst?.mode} roundMs=${wst?.roundMs}`)

  // ---------- 5. 取流 ----------
  const play = await evaluate(`window.api.livePlay('${target}')`)
  check('livePlay 返回 m3u8', play?.ok === true && typeof play?.m3u8 === 'string' && play.m3u8.includes('.m3u8'), play?.m3u8?.slice(60, 100))
  check('livePlay 附带元数据', typeof play?.title === 'string', play?.title?.slice(0, 30))

  // m3u8 可拉流(走渲染进程同 session 的头注入)
  const m3u8ok = await evaluate(`fetch(${JSON.stringify(play?.m3u8 || '')}).then(r => r.status).catch(e => 'ERR:' + e.message)`)
  check('渲染进程直接拉 m3u8 (Origin 头注入生效)', m3u8ok === 200, `HTTP ${m3u8ok}`)

  // ---------- 6. 录制 15 秒 ----------
  await evaluate(`window.api.recStart('${target}')`)
  await sleep(3000)
  const rec1 = await evaluate(`window.api.recList()`)
  const task1 = rec1.find(t => t.userId === target)
  check('录制任务已创建', task1?.status === 'recording', `auto=${task1?.auto}`)
  await sleep(12000)
  const rec2 = await evaluate(`window.api.recList()`)
  const task2 = rec2.find(t => t.userId === target)
  check('录制中数据持续增长 (bytes>100KB)', (task2?.bytes || 0) > 100 * 1024, `bytes=${task2?.bytes} files=${task2?.files?.length} current=${task2?.currentFile?.split(/[/\\\\]/).pop()}`)
  check('录制事件不含密码字段', !('password' in (task2 || {})))

  await evaluate(`window.api.recStop('${target}')`)
  await sleep(6000)
  const hist = await evaluate(`window.api.recHistory()`)
  const h = hist.find(x => x.userId === target)
  check('停止后写入历史记录', !!h, `status=${h?.status} bytes=${h?.bytes}`)
  check('历史状态为 stopped/done', ['stopped', 'done', 'remuxing'].includes(h?.status))
  check('历史记录同样不含密码字段', !('password' in (h || {})))

  // ---------- 7. 大厅(discovery)与未关注录制 ----------
  const disc = await evaluate(`window.api.discoveryList()`)
  check('大厅返回全站在播列表', Array.isArray(disc) && disc.length > 0, `count=${disc?.length} first=${disc?.[0]?.nick}`)
  check('大厅条目字段齐全', disc?.[0] && typeof disc[0].viewers === 'number' && typeof disc[0].thumbUrl === 'string', JSON.stringify(disc?.[0]?.tags || { pw: disc?.[0]?.isPw }))
  // 先取消关注, 再直接录制(大厅场景: 录制未关注主播)
  await evaluate(`window.api.recStop('${target}').catch(()=>0)`)
  await evaluate(`window.api.anchorsRemove('${target}')`)
  const t0 = Date.now()
  const ru = await evaluate(`window.api.recStart('${target}')`)
  check('录制未关注主播(大厅场景)', 'userId' in (ru || {}), `耗时${Date.now() - t0}ms`)
  await sleep(6000)
  await evaluate(`window.api.recStop('${target}')`)

  // ---------- 8. 清理 ----------
  await evaluate(`window.api.anchorsRemove('${target}').catch(()=>0)`)
  await evaluate(`window.api.authLogout()`)
  console.log('\n已清理测试数据(移除关注+退出登录)')
} catch (e) {
  check('流程执行', false, e.message)
} finally {
  ws?.close()
  await sleep(800)
  spawn('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' })
  await sleep(1500)
  const bad = results.filter(r => !r.pass)
  console.log(`\n===== E2E 结果: ${results.length - bad.length}/${results.length} 通过 =====`)
  process.exit(bad.length ? 1 : 0)
}
