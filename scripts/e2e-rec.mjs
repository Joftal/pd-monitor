// 端到端验证: 登录 -> live/play -> ffmpeg 录制 18 秒 -> 检查产物
import { spawn } from 'child_process'
import { existsSync, statSync, mkdirSync } from 'fs'
import ffmpegPath from 'ffmpeg-static'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
let cookies = {}
const COMMON = { 'User-Agent': UA, 'Origin': 'https://www.pandalive.co.kr', 'Referer': 'https://www.pandalive.co.kr/', 'x-device-info': '{"t":"webPc","v":"1.0","ui":24631221}' }
function harvest(res) { for (const c of res.headers.getSetCookie?.() || []) { const [p] = c.split(';'); const i = p.indexOf('='); if (i > 0) cookies[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } }
function ch() { return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') }
async function req(method, path, body) {
  const headers = { ...COMMON }
  if (ch()) headers['Cookie'] = ch()
  let payload; if (body) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body) }
  const res = await fetch('https://api.pandalive.co.kr' + path, { method, headers, body: payload })
  harvest(res)
  const t = await res.text()
  try { return JSON.parse(t) } catch { return {} }
}

await req('POST', '/v1/member/login', { loginId: process.env.PD_USER, password: process.env.PD_PASS })
console.log('login:', cookies.sessKey ? 'OK' : 'FAIL')
await sleep(2500)

const play = await req('POST', '/v1/live/play', { action: 'watch', userId: 'zenith6666', password: '', shareLinkType: '' })
const m3u8 = play?.PlayList?.hls?.[0]?.url
console.log('play m3u8:', m3u8 ? 'OK' : 'FAIL ' + JSON.stringify(play).slice(0, 200))
if (!m3u8) process.exit(1)

mkdirSync('tmp-rec', { recursive: true })
const out = 'tmp-rec/e2e_%03d.ts'
const args = [
  '-y', '-loglevel', 'error', '-hide_banner',
  '-user_agent', UA,
  '-headers', 'Origin: https://www.pandalive.co.kr\r\nReferer: https://www.pandalive.co.kr/\r\n',
  '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
  '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '15',
  '-rw_timeout', '50000000',
  '-i', m3u8,
  '-map', '0', '-c', 'copy',
  '-f', 'segment', '-segment_time', '10', '-segment_format', 'mpegts', '-reset_timestamps', '1',
  out
]
console.log('recording 18s...')
const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
ff.stderr.on('data', d => console.log('ffmpeg:', d.toString().trim().slice(0, 200)))
await sleep(18000)
ff.stdin.write('q'); ff.stdin.end()
await new Promise(r => ff.on('exit', r))
await sleep(1000)

for (const f of ['tmp-rec/e2e_001.ts', 'tmp-rec/e2e_002.ts']) {
  if (existsSync(f)) console.log(f, statSync(f).size, 'bytes')
}
console.log('E2E_DONE')
