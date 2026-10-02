import { AsyncLocalStorage } from 'node:async_hooks'
import { sleep } from '../util'
import { logger } from './logger'

// ============ 按站后台车道(㊕) ============
// 审出来的形状不是"某一个循环发得太快" —— 每一条后台循环自己都有节流(探针、预取泵、Panda 的限速队列都按
// requestGapMs 睡觉)。漏的是"跨条": 探针循环、预取泵、保活重铸、登录探针各自排队, 谁也不知道同一站上
// 别人此刻正在发第几发, 于是 N 条循环撞在同一站上就是 N 倍瞬时速率, 而 60 秒一轮里它们的相位还会漂移对齐
// (实测 Panda 的 403 就落在 api 站)。这一层只管一件事: 同一个主机名上, 后台请求一次只发一发,
// 并且两发之间留出一个间隔 —— 用户那一路除外(见 asUser)。
//
// 只管 API 站, 不管媒体/CDN: 分片与清单要的是"不断流"(保活泵 5 条泳道 60 秒内要跑完 17 个房 × 若干档),
// 把它们串成一条会直接把源饿死 —— 那正好触发重铸风暴, 比省下的那几发贵得多。媒体面的重复已经在
// hlsProxy 的在途合流里收口, 扇出面(该养几档)是另一条账(见台账 ㊕ D 项)。
// =========================================

/** 排队上限: 车道再挤也不许把一次后台读取拖过这个数。超了就按上限等 ——
 *  时效性是这一层的第一目标, 宁可这一发挤一挤, 也不让预取队列整体滞后 */
const MAX_WAIT_MS = 8_000

type Lane = { last: number; tail: Promise<unknown> }

const lanes = new Map<string, Lane>()

/** 用户级标记: 沿异步链一路传到底, 于是取流链中间任何一跳都知道"这一发是谁要的"。
 *  用 AsyncLocalStorage 而不是逐个函数加参数: 快速道要覆盖的是整条链,
 *  而 fetchPlay → runPlayChain → fetchAid → req 中间隔着四个私有函数, 加参数等于把每一层都改一遍 */
const userMark = new AsyncLocalStorage<boolean>()

/** 把这段调用标成"用户亲自在等"(点播放、点录制): 车道上的后台请求一律给它让路 */
export function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return userMark.run(true, fn)
}

export function isUserCall(): boolean {
  return userMark.getStore() === true
}

/** 用户那一路也在这里落笔: 它不排队, 但它发过之后后台要自己让开一个间隔
 *  (否则"用户点一下 + 后台 17 发"会在同一站上叠成同一瞬时的 18 发) */
function stamp(lane: Lane): void {
  lane.last = Date.now()
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}

let overCnt = 0
let overLogUntil = 0

/** 走一趟按站车道。baseMs=0 即完全放行(设置的钳制下限是 300ms, 0 只有验证脚本会用到) */
export async function laneRun<T>(host: string, baseMs: number, run: () => Promise<T>): Promise<T> {
  const lane: Lane = lanes.get(host) || { last: 0, tail: Promise.resolve() }
  lanes.set(host, lane)
  if (isUserCall()) {
    stamp(lane)
    try {
      return await run()
    } finally {
      stamp(lane)
    }
  }
  // 在飞的后台请求一次只允许一个: 后来者排在上一发的落定之后(同站并发的形状正是这一层要消灭的)
  const prev = lane.tail
  let release = () => {}
  lane.tail = new Promise<void>((r) => {
    release = r
  })
  await prev
  const want = lane.last + Math.max(0, baseMs) * (0.9 + Math.random() * 0.2) - Date.now()
  const wait = Math.min(Math.max(want, 0), MAX_WAIT_MS)
  if (want > MAX_WAIT_MS) {
    // 挤到超出上限 = 这一站的后台活排不过来了; 60 秒报一次, 静默窗口内的次数在下一句里一起报
    overCnt++
    const now = Date.now()
    if (now >= overLogUntil) {
      overLogUntil = now + 60_000
      logger.warn('net', `${host} 后台车道排队超出 ${Math.round(MAX_WAIT_MS / 1000)} 秒上限 ×${overCnt}, 按上限等待后放行`)
      overCnt = 0
    }
  }
  if (wait > 0) await sleep(wait)
  stamp(lane)
  try {
    return await run()
  } finally {
    release()
  }
}

/** 诊断读数: 当前有几条车道(每站一条, 站点数是个位数, 不需要回收) */
export function laneHosts(): string[] {
  return [...lanes.keys()]
}
