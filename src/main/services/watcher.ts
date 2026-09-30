import { BrowserWindow } from 'electron'
import { api, RiskError, BjNotFoundError, LiveItem } from './pandalive'
import { soopApi, SoopFavoriteRow } from './soop'
import { sourceFor, applyPlayMeta } from './source'
import { store } from './store'
import { EV, Platform, roomKey, WatcherStatus, Anchor, DiscoveryItem } from '../../shared/types'
import { recorder } from './recorder'
import { sendToast } from './notify'
import { sleep } from '../util'
import { logger } from './logger'
import { mt } from '../i18n'

// ============ 轮询引擎 ============
// list 模式: 每轮拉全站直播列表(分页, 每页一个请求), 本地匹配监控主播 —— 防封核心
// per-anchor 模式: 逐个 member/bj (兜底, 限速队列生效)
// SOOP: 每轮一发站内关注列表(带 is_live/broad_info)本地匹配, 列表覆盖不到的房才回落播放页探针
// 列表外离线关注(pumpIdle): 轮次间隙按 gap 持续轮扫, 开播发现延迟 ≈ N×gap, 与轮询间隔脱钩
// 熔断: 连续失败 N 轮 -> 暂停 + 指数退避, 并通知 UI
// ==================================

const MAX_PAGES = 5
const PAGE_SIZE = 100

/** 平台 startTime("YYYY-MM-DD HH:MM:SS", 韩国时区) -> 已播秒数; 解析失败/未来时间归 0 */
function liveElapsedSec(startTime: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(startTime || '').trim())
  if (!m) return 0
  const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]) // KST=UTC+9
  if (Number.isNaN(ts)) return 0
  return Math.max(0, Math.floor((Date.now() - ts) / 1000))
}

class Watcher {
  running = false
  private timer: NodeJS.Timeout | null = null
  private errorStreak = 0
  private cooldownUntil = 0
  private roundInFlight = false
  private sessionDeadStreak = 0
  private discovery: DiscoveryItem[] = []
  /** 在播数分平台记: Panda 冷却/熔断的那几轮不复查 Panda, 只能沿用上次已知值, 不能被 SOOP 覆盖成 0 */
  private pandaLiveFound = 0
  private soopLiveFound = 0
  /** 上次真发 SOOP 探针的时刻: Panda 冷却期轮次会压到 30s, 用它把 SOOP 的速率钉回用户配的间隔 */
  private lastSoopRoundAt = 0
  /** SOOP 连续"整轮全灭"轮数: 单轮失败可能是抖动, 连续两轮说明改版/风控/断网, 必须让用户看见 */
  private soopFailStreak = 0
  /** roomKey -> 连续"播放页报下播"轮数: 见 roundSoop, 单次读数不翻转状态 */
  private soopOfflineStreak = new Map<string, number>()
  status: WatcherStatus = {
    running: false,
    mode: 'list',
    lastRoundAt: null,
    roundMs: 0,
    liveCount: 0,
    monitored: 0,
    liveFound: 0,
    circuitOpen: false,
    message: '',
    byPlatform: {
      pandalive: { running: false, lastRoundAt: null, roundMs: 0, monitored: 0, liveFound: 0, circuitOpen: false, roundFailed: 0, message: '' },
      soop: { running: false, lastRoundAt: null, roundMs: 0, monitored: 0, liveFound: 0, circuitOpen: false, roundFailed: 0, message: '' }
    }
  }

  getDiscovery(): DiscoveryItem[] {
    return this.discovery
  }

  private push(): void {
    const win = BrowserWindow.getAllWindows()[0]
    this.status.running = this.running
    // 合并视图 = 两平台之和/或: 供日志与 TG 侧用; 渲染层一律读 byPlatform[当前平台]
    const b = this.status.byPlatform
    b.pandalive.running = this.running
    b.soop.running = this.running
    this.status.monitored = b.pandalive.monitored + b.soop.monitored
    this.status.liveFound = b.pandalive.liveFound + b.soop.liveFound
    this.status.circuitOpen = b.pandalive.circuitOpen
    this.status.message = [b.pandalive.message, b.soop.message].filter(Boolean).join(' · ')
    win?.webContents.send(EV.watcher, JSON.parse(JSON.stringify(this.status)) as WatcherStatus)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.errorStreak = 0
    this.cooldownUntil = 0
    this.soopFailStreak = 0
    this.schedule(300)
    this.push()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.push()
  }

  /** 立即触发一轮(不等待定时器); 一轮进行中则跳过; schedule() 会覆盖未触发的旧定时器, 连续 tick 自然合并为一轮 */
  tick(): void {
    if (this.running && !this.roundInFlight) this.schedule(0)
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.round(), delay)
  }

  private async round(): Promise<void> {
    if (!this.running || this.roundInFlight) return
    this.roundInFlight = true
    const begin = Date.now()
    const cfg = store.getSettings()
    // 两份平台状态各自拥有: 顶栏/卡片读 byPlatform[当前平台], 不再互相抢话
    // (旧实现只有一个全局 message, 导致 SOOP 瞎了必须看"Panda 是否健康"才敢出声)
    const P = this.status.byPlatform.pandalive
    const S = this.status.byPlatform.soop
    this.status.mode = cfg.watchMode
    api.setGap(cfg.requestGapMs)

    try {
      // 本引擎只认 pandalive(api 即 pandalive 客户端): 必须按平台取子集,
      // 否则 SOOP 关注会被当成"列表里缺失的主播"送去 member/bj 复查 —— 拿频道名打错站接口。
      const all = store.listAnchors()
      const anchors = all.filter((a) => a.platform === 'pandalive')
      const soopAnchors = all.filter((a) => a.platform === 'soop')
      P.monitored = anchors.length
      S.monitored = soopAnchors.length

      // 冷却只退避 pandalive: SOOP 是另一套域名与会话, Panda 被风控无权连坐停掉 SOOP 监控
      // (注意: 此分支的 schedule/push 由 finally 统一兜底, 不写重复调用)
      const cooling = Date.now() < this.cooldownUntil
      // Panda 这一轮的异常先攒着: 抛出去会跳过下面的 SOOP 探针(连坐), 熔断语义延后到 SOOP 跑完再交外层
      let pandaErr: unknown = null
      if (cooling) {
        const remain = Math.ceil((this.cooldownUntil - Date.now()) / 1000)
        P.message = mt('watcher.cooling', { remain })
      } else {
        const pBegin = Date.now()
        try {
          if (cfg.watchMode === 'list') {
            this.pandaLiveFound = await this.roundByList(anchors)
          } else {
            // 逐个模式下大厅无数据源: 清空并广播, 让大厅显示"模式不可用"空态
            this.idleQueue = [] // per-anchor 每轮全量复查: list 残留的 rest 快照作废, 间隙泵在此模式无职责
            if (this.discovery.length) {
              this.discovery = []
              this.pushDiscovery()
            }
            this.pandaLiveFound = await this.roundByBj(anchors)
          }
          this.errorStreak = 0
          P.circuitOpen = false
          P.message = ''
        } catch (e) {
          pandaErr = e
        }
        // 真发了请求才记时: 冷却轮沿用旧读数, 不能把"Panda 上次成功"刷成"刚刚检查过"
        P.liveFound = this.pandaLiveFound
        P.roundMs = Date.now() - pBegin
        P.lastRoundAt = Date.now()
      }

      // SOOP 每轮一发关注列表(myapi/favorite)即可覆盖全部站内关注; 列表覆盖不到的房才逐发播放页探针。
      // (全站列表 main_broad_list_api.php 匿名可用但要翻满 43 页/2.7MB 才盖到小主播, 大厅/搜索另开一期)
      // 冷却期轮次被压到 30s(为早点探 Panda 恢复), SOOP 不跟着加速: 仍按用户配的间隔到期才发
      if (!soopAnchors.length) {
        this.soopLiveFound = 0
        this.soopFailStreak = 0
        S.liveFound = 0
        S.roundFailed = 0
        S.message = ''
      } else if (!cooling || Date.now() - this.lastSoopRoundAt >= cfg.pollIntervalSec * 1000) {
        this.lastSoopRoundAt = Date.now()
        const sBegin = Date.now()
        this.soopLiveFound = await this.roundSoop(soopAnchors, cfg.requestGapMs)
        S.liveFound = this.soopLiveFound
        S.roundMs = Date.now() - sBegin
        S.lastRoundAt = Date.now()
        // SOOP 探针永不抛错(防 Panda 连坐), 所以它瞎了必须由这里出声: 顶栏绿点照常跳、卡片保留旧状态,
        // 用户读到的却是"一切正常"。单轮失败可能是抖动, 连续两轮才够格说"这一站在我们眼里已经哑了"
        S.message =
          this.soopFailStreak >= 2
            ? mt('watcher.soopDown', { n: soopAnchors.length, r: this.soopFailStreak })
            : // 整轮全灭以外的情况: 探到几个读不到就说几个, 卡片保留旧读数不等于状态正常(设计稿 7.2「整轮部分失败」)
              S.roundFailed > 0
              ? mt('watcher.soopPartial', { n: S.roundFailed })
              : ''
      }
      if (pandaErr) throw pandaErr

      // 轮次心跳: 每 10 轮落一行摘要 —— 事后可证"轮询在这些小时里活着且看得见全站"
      // (每轮都写会刷屏: 30s 间隔下一天 2880 行; 抽稀到 ~5 分钟一行, 14 天约 100KB)
      if (++this.roundCnt % 10 === 0) {
        const monitored = P.monitored + S.monitored
        const liveFound = P.liveFound + S.liveFound
        logger.info(
          'watcher',
          this.status.mode === 'list'
            ? `第 ${this.roundCnt} 轮 list 全站=${this.status.liveCount} 关注=${monitored} 在播=${liveFound} 本轮=${Date.now() - begin}ms`
            : `第 ${this.roundCnt} 轮 per-anchor 关注=${monitored} 在播=${liveFound} 本轮=${Date.now() - begin}ms`
        )
      }
    } catch (e) {
      this.noteFailure(e)
    } finally {
      this.roundInFlight = false
      this.status.lastRoundAt = Date.now()
      this.status.roundMs = Date.now() - begin
      this.push()
      if (this.running) {
        store.flush()
        const interval = P.circuitOpen ? 30_000 : store.getSettings().pollIntervalSec * 1000
        this.schedule(interval)
        void this.pumpIdle() // 轮次间隙: 启动离线关注兜底泵(幂等, 在跑则 no-op)
      }
    }
  }

  // ---- 查无此人(改名/注销/错 id)单点处置: 标离线 + 一次性提醒 + 后续不再发请求 ----
  // 绝不计入 errorStreak/熔断: 单主播数据错误无权拖垮全局轮询
  private bjGone = new Set<string>()
  private onBjNotFound(a: Anchor): void {
    this.bjGone.add(roomKey(a.platform, a.userId))
    // 与 onLiveEnd 同规约: 判死当场收尸缓存源。查无此人=这个 id 已不存在, 旧源必死,
    // 留着只会让卡片挂着「秒开」徽标骗人, 点进去 404
    sourceFor(a.platform).invalidatePlay(a.userId)
    if (a.isLive) {
      store.updateAnchor(a.platform, a.userId, this.offPatch(a))
      this.pushAnchors()
    }
    logger.warn('watcher', `关注的主播查无此人(改名/注销/错 id): @${a.userId}`)
    sendToast(
      { type: 'info', platform: a.platform, title: mt('watcher.bjGone', { id: a.userId }), body: mt('watcher.bjGoneHint') },
      { ev: 'generic', ctx: { anchor: a, detail: mt('watcher.bjGoneHint') } }
    )
  }
  /** 该房间是否已确认不存在: true 则所有 bj 复查路径直接跳过(不再发请求) */
  private isGone(a: Anchor): boolean {
    return this.bjGone.has(roomKey(a.platform, a.userId))
  }

  /** 关注增删时清除"查无此人"标记: 移除可重加, 改名/错 id 修正(或平台恢复)后重新探活 */
  unmarkGone(platform: Platform, userId: string): void {
    this.bjGone.delete(roomKey(platform, userId))
  }

  /** 翻离线的统一补丁。lastLiveAt 必须在这里、在 Object.assign 之前从 a.startTime 取:
   *  updateAnchor 改的就是 listAnchors 返回的那个 a 本体, 调用点之后再读 a.startTime 恒为空串,
   *  「上次开播」会被自己抹掉。拿不到开播时刻(旧数据)时保留原值, 不写空。 */
  private offPatch(a: Anchor, extra: Partial<Anchor> = {}): Partial<Anchor> {
    return {
      isLive: false,
      title: '',
      tags: null,
      startTime: '',
      viewerCount: 0,
      thumbUrl: '',
      lastLiveAt: a.startTime || a.lastLiveAt,
      ...extra
    }
  }

  /** 轮询/间隙泵统一失败处置: 连续失败熔断 + 指数退避 + UI 通知(原 round catch 原语义)
   *  只作用于 Panda: 这两个泵发的都是 pandalive 请求, SOOP 探针自己攒 soopFailStreak */
  private noteFailure(e: unknown): void {
    const P = this.status.byPlatform.pandalive
    this.errorStreak++
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof RiskError || this.errorStreak >= 3) {
      // 指数退避: 1min -> 2 -> 4 -> ... 上限 15min
      const minutes = Math.min(15, 2 ** Math.min(4, this.errorStreak - 1))
      this.cooldownUntil = Date.now() + minutes * 60_000
      P.circuitOpen = true
      P.message = mt('watcher.circuit', { msg, minutes })
      logger.warn('watcher', P.message)
      sendToast({ type: 'error', platform: 'pandalive', title: mt('watcher.circuitTitle'), body: P.message }, { ev: 'circuit', ctx: { detail: P.message } })
    } else {
      P.message = mt('watcher.roundFail', { msg })
      logger.warn('watcher', `本轮失败(#${this.errorStreak}): ${msg}`)
    }
  }

  /** list 模式: 拉全站列表, 本地匹配; 全量列表同时作为大厅数据源。返回 Panda 侧在播数 */
  private async roundByList(anchors: Anchor[]): Promise<number> {
    const liveMap = new Map<string, LiveItem>()
    let page = 0
    let loginInfo: unknown = undefined
    while (page < MAX_PAGES) {
      const { list, loginInfo: li } = await api.fetchLivePage(page * PAGE_SIZE, PAGE_SIZE)
      loginInfo = li
      for (const item of list) liveMap.set(item.userId, item)
      // 没到满页即已到列表底部
      if (list.length < PAGE_SIZE) break
      page++
    }
    this.status.liveCount = liveMap.size

    // 全量在播列表 -> 大厅(按观众数降序)
    this.discovery = [...liveMap.values()]
      .sort((a, b) => (b.user || 0) - (a.user || 0))
      .map((x) => ({
        userId: x.userId,
        userIdx: x.userIdx ?? null,
        nick: x.userNick || x.userId,
        title: x.title || '',
        isAdult: !!x.isAdult,
        isPw: !!x.isPw,
        type: x.type || '',
        liveType: x.liveType || '',
        viewers: x.user || 0,
        likes: x.likeCnt || 0,
        fans: x.fanCnt || 0,
        bookmarks: x.bookmarkCnt || 0,
        plays: x.playCnt || 0,
        startTime: x.startTime || '',
        thumbUrl: x.thumbUrl || '',
        userImg: x.userImg || ''
      }))
    this.pushDiscovery()

    const now = Date.now()
    let liveFound = 0
    const missing: Anchor[] = []
    for (const a of anchors) {
      const item = liveMap.get(a.userId)
      if (!item) {
        missing.push(a)
        continue
      }
      const wasLive = a.isLive
      const prevTags = a.tags // updateAnchor 原地改 a, 变更判定必须先拍旧标签快照
      liveFound++
      const patch: Partial<Anchor> = {
        isLive: true,
        nick: item.userNick || a.nick,
        userIdx: item.userIdx ?? a.userIdx,
        userImg: item.userImg || a.userImg,
        title: item.title || '',
        tags: { isAdult: !!item.isAdult, isPw: !!item.isPw, type: item.type || '', liveType: item.liveType || '' },
        startTime: item.startTime || '',
        viewerCount: item.user || 0,
        likes: item.likeCnt || 0,
        fans: item.fanCnt || 0,
        thumbUrl: item.thumbUrl || '',
        lastSeenAt: now,
        // 在播期间就落「上次开播」: 未必守得到他下播那一轮(应用退出/关注移除), 事后无从补
        lastLiveAt: item.startTime || a.lastLiveAt
      }
      store.updateAnchor(a.platform, a.userId, patch)
      if (!wasLive) this.onLiveStart({ ...a, ...patch } as Anchor)
      else this.onRoomShift(a, prevTags, patch.tags as NonNullable<Anchor['tags']>)
    }

    // 兜底: 列表不可见的关注主播(19+/隐藏房/500名外) member/bj 节流复查
    // - urgent: 上轮还在播的, 全部立即复查(防止误判下播) —— 轮内完成
    // - rest: 离线关注交间隙泵(pumpIdle)在轮询空档持续轮扫 —— 发现延迟 ≈ N×gap, 与轮询间隔脱钩
    const urgent = missing.filter((a) => a.isLive && !this.isGone(a))
    for (const a of urgent) {
      try {
        const info = await api.fetchBj(a.userId)
        liveFound += await this.applyBj(a, info)
      } catch (e) {
        if (e instanceof BjNotFoundError) {
          this.onBjNotFound(a)
          continue // 单点数据错误: 不污染本轮(不升级熔断/连败)
        }
        throw e // 其余错误维持轮次失败语义
      }
    }
    this.idleQueue = missing.filter((a) => !a.isLive) // 新快照整批替换(上轮未扫完的按最新状态重排)

    // 登录态检测: loginInfo 非空即视为 cookie 有效(结构宽容);
    // 有效→无效 连续 2 轮才宣判作废(单轮缺字段可能是末页响应抖动)。
    // 判死前 cookieValid 保持 true(它同时是"未通知过"闩锁), 宣判当轮才翻 false 并通知一次;
    // 启动即死/曾通知过都不再重复, 重新登录(importCookies)会重新置 true 武装下次检测
    if (api.hasSession()) {
      const alive = Boolean(loginInfo)
      if (alive) {
        this.sessionDeadStreak = 0
        api.cookieValid = true
      } else if (api.cookieValid && ++this.sessionDeadStreak >= 2) {
        this.sessionDeadStreak = 0
        api.cookieValid = false
        logger.warn('watcher', '会话已被服务端作废: 列表响应连续 2 轮不再返回 loginInfo')
        sendToast({ type: 'session', platform: 'pandalive', title: mt('watcher.sessionDeadT'), body: mt('watcher.sessionDeadB') })
      }
    } else {
      api.cookieValid = false
      this.sessionDeadStreak = 0
    }
    this.pushAnchors()
    return liveFound
  }

  /** 用 member/bj 的响应更新主播状态, 返回 1=在播 0=离线 */
  private async applyBj(
    a: Anchor,
    info: { nick: string; userIdx: number | null; userImg: string; media: LiveItem | null }
  ): Promise<number> {
    const now = Date.now()
    const { nick, userIdx, userImg, media } = info
    // 先拍翻转快照: updateAnchor 是原地 Object.assign(listAnchors 返回原数组, 改的就是 a 本体),
    // 改后再读 a.isLive 恒为新值 → 开播翻转判定会被吞(通知/预取/自录/源作废全丢);
    // 与主循环 wasLive 同规约
    const wasLive = a.isLive
    const prevTags = a.tags // 同主循环: updateAnchor 原地改 a, 变更判定先拍旧标签
    if (media && media.isLive) {
      const patch: Partial<Anchor> = {
        isLive: true,
        nick: media.userNick || nick,
        userIdx,
        userImg: (media as unknown as { userImg?: string }).userImg || userImg,
        title: media.title || '',
        tags: { isAdult: !!media.isAdult, isPw: !!media.isPw, type: media.type || '', liveType: media.liveType || '' },
        startTime: media.startTime || '',
        viewerCount: media.user || 0,
        likes: media.likeCnt || 0,
        fans: media.fanCnt || 0,
        thumbUrl: (media as unknown as { thumbUrl?: string }).thumbUrl || '',
        lastSeenAt: now,
        lastLiveAt: media.startTime || a.lastLiveAt
      }
      store.updateAnchor(a.platform, a.userId, patch)
      if (!wasLive) this.onLiveStart({ ...a, ...patch } as Anchor)
      else this.onRoomShift(a, prevTags, patch.tags as NonNullable<Anchor['tags']>)
      return 1
    }
    if (wasLive) {
      store.updateAnchor(a.platform, a.userId, this.offPatch(a))
      this.onLiveEnd(a)
    }
    if (nick && nick !== a.nick) store.updateAnchor(a.platform, a.userId, { nick })
    return 0
  }

  /** per-anchor 模式: 逐个 member/bj。返回 Panda 侧在播数 */
  private async roundByBj(anchors: Anchor[]): Promise<number> {
    let liveFound = 0
    for (const a of anchors) {
      if (this.isGone(a)) continue
      try {
        liveFound += await this.applyBj(a, await api.fetchBj(a.userId))
      } catch (e) {
        if (e instanceof BjNotFoundError) {
          this.onBjNotFound(a)
          continue
        }
        throw e
      }
    }
    this.pushAnchors()
    return liveFound
  }

  /** SOOP 轮询: 优先「一发关注列表 + 本地匹配」(myapi/favorite 带 is_live/broad_info, 718 关注也只需一发),
   *  列表不可用(未登录/风控/改版)或该房不在列表里(应用内关注 ≠ 站内关注)→ 逐房回落到播放页探针。
   *  - 三态必分沿用旧规约: 在播 / 明确下播 / 读数不足则本轮不动它, 绝不把"没读到"写成"已下播"
   *  - 节流: 兜底探针与 Panda 共用 requestGapMs; 列表模式下不发探针, 平台压力从 N 发/轮降到 1 发/轮 */
  private async roundSoop(anchors: Anchor[], gapMs: number): Promise<number> {
    const now = Date.now()
    // 抖动计数只服务当前关注集: 已取关的房间即时清账, 防这张表无界增长
    const monitored = new Set(anchors.map((a) => roomKey(a.platform, a.userId)))
    for (const key of [...this.soopOfflineStreak.keys()]) if (!monitored.has(key)) this.soopOfflineStreak.delete(key)

    let found = 0
    // 这一发绝不能把异常抛出去: roundSoop 的契约是"永不抛错"(防 Panda 连坐熔断), 列表挂了就等于没列表
    const rows = anchors.length
      ? await soopApi.fetchFavorites().catch((e) => {
          logger.warn('soop', `关注列表异常: ${String((e as Error).message || e)}`)
          return null
        })
      : null
    const byId = rows ? new Map(rows.map((r) => [r.userId, r])) : null
    // 列表里判不了状态的房回落播放页探针: 整表拿不到(未登录/风控/改版)=全部回落,
    // 单房缺席(应用内关注 ≠ 站内关注)或"说在播却没给场次"=只回落它
    const probe: Anchor[] = []
    for (const a of anchors) {
      const row = byId?.get(a.userId)
      if (row && (!row.isLive || row.live)) {
        found += this.applySoopRow(a, row, now)
      } else {
        if (row) logger.info('soop', `列表报在播但无场次信息, 回落播放页 @${a.userId}`)
        probe.push(a)
      }
    }

    let fail = 0
    for (const a of probe) {
      const st = await this.probeSoopOne(a, now)
      if (st === 'live') found++
      else if (st === 'fail') fail++
      if (gapMs > 0) await sleep(Math.max(300, gapMs) * (0.8 + Math.random() * 0.4))
    }

    // 全部关注都读不到才计失败: 列表命中/部分房间抖动都不构成"平台级失明"
    const allFail = anchors.length > 0 && fail === anchors.length
    this.status.byPlatform.soop.roundFailed = fail // 列表整表覆盖时 fail=0, 这里同时负责复位
    this.soopFailStreak = allFail ? this.soopFailStreak + 1 : 0
    if (allFail) logger.warn('watcher', `SOOP 本轮 ${anchors.length} 个频道全部取页失败(网络/风控/改版) 连续 ${this.soopFailStreak} 轮`)
    if (this.soopFailStreak === 2) {
      // 只在跨阈值时提醒一次(与登录失效同语义): 恢复后 streak 归零才会重新武装
      sendToast(
        { type: 'error', platform: 'soop', title: mt('watcher.soopDownT'), body: mt('watcher.soopDown', { n: anchors.length, r: this.soopFailStreak }) },
        { ev: 'generic', ctx: { detail: mt('watcher.soopDown', { n: anchors.length, r: this.soopFailStreak }) } }
      )
    }
    this.pushAnchors()
    return found
  }

  /** 关注列表行 → Anchor: 列表把 is_live/broad_info 直接给了, 连开播时刻都是原值
   *  (播放页 HTML 里没有任何时间串, 旧链路只能靠拉源回 BTIME 反推)。返回 1=本轮在播 */
  private applySoopRow(a: Anchor, row: SoopFavoriteRow, now: number): number {
    const key = roomKey(a.platform, a.userId)
    const wasLive = a.isLive // updateAnchor 原地改 a, 翻转判定必须先拍旧状态
    const live = row.live
    if (row.isLive && live) {
      const patch: Partial<Anchor> = {
        isLive: true,
        nick: row.nick || a.nick,
        title: live.title || a.title,
        // 新开播必须落列表给的 broad_start; 拿不到(格式异常)才沿用上一轮 —— 清空会让卡片时长归零,
        // 沿用上一场的旧值则由 applyPlayMeta 用 BTIME 真值再修正一次
        startTime: live.startTime || a.startTime,
        thumbUrl: live.thumbUrl || a.thumbUrl,
        viewerCount: live.viewers,
        tags: { isAdult: live.isAdult, isPw: live.isPw, type: '', liveType: 'live' },
        lastSeenAt: now,
        // 在播期间就同步落「上次开播」: 我们未必守得到他下播那一轮(应用退出/关注移除), 事后无从补
        lastLiveAt: live.startTime || a.startTime || a.lastLiveAt
      }
      store.updateAnchor(a.platform, a.userId, patch)
      this.soopOfflineStreak.delete(key) // 在播即清零(下播判定只数连续轮)
      if (!wasLive) this.onLiveStart({ ...a, ...patch } as Anchor)
      return 1
    }
    if (wasLive) {
      // 单轮读数不翻转状态: 列表瞬回离线/改版丢字段都可能, 而这一翻要发通知+停自录
      const n = (this.soopOfflineStreak.get(key) || 0) + 1
      this.soopOfflineStreak.set(key, n)
      if (n < 2) {
        logger.info('soop', `关注列表报下播, 待第二轮确认 @${a.userId}`)
      } else {
        this.soopOfflineStreak.delete(key)
        store.updateAnchor(a.platform, a.userId, this.offPatch(a, { lastSeenAt: now }))
        this.onLiveEnd(a)
      }
    } else {
      // 离线行: 站内直接给了 last_broad_start, 它比我们自己的观测权威 —— 我们未必守得到他那一整场
      const patch: Partial<Anchor> = {}
      if (row.nick && row.nick !== a.nick) patch.nick = row.nick
      if (row.lastStartTime && row.lastStartTime !== a.lastLiveAt) patch.lastLiveAt = row.lastStartTime
      if (Object.keys(patch).length) store.updateAnchor(a.platform, a.userId, patch)
    }
    return 0
  }

  /** 播放页探针(列表覆盖不到的房): 三态必分, 单房失败只算它自己 */
  private async probeSoopOne(a: Anchor, now: number): Promise<'live' | 'other' | 'fail'> {
    try {
      const m = await soopApi.fetchPageMeta(a.userId, true)
      const wasLive = a.isLive
      if (m.living) {
        const patch: Partial<Anchor> = {
          isLive: true,
          nick: m.hostName || a.nick,
          title: m.roomName || a.title,
          // 开播时刻: 播放页 HTML 里没有任何时间串(实测), 唯一真值是随后拉源回的 BTIME 反推
          // (applyPlayMeta 负责写)。所以新开播这一发必须清空 —— 沿用上一场的旧值等于
          // 把"昨晚开了 3 小时"贴到今天刚开播的房上, 通知与卡片时长一起失真。
          startTime: wasLive ? a.startTime : '',
          // 截图就在同一份播放页 HTML 里(szBroadThumPath), 不额外发请求; 取不到则保留上一轮的
          thumbUrl: m.thumbUrl || a.thumbUrl,
          lastSeenAt: now
        }
        store.updateAnchor(a.platform, a.userId, patch)
        this.soopOfflineStreak.delete(roomKey(a.platform, a.userId)) // 在播即清零(下播判定只数连续轮)
        if (!wasLive) this.onLiveStart({ ...a, ...patch } as Anchor)
        return 'live'
      }
      if (m.explicitOffline) {
        if (wasLive) {
          // 单轮读数不翻转状态: 播放页改版/风控插页都可能瞬回"无场次", 而这一翻要发通知+停自录。
          // 与 Panda 侧"列表缺失→轮内 member/bj 复查再判"同规约, 代价是下播提醒晚一轮
          const key = roomKey(a.platform, a.userId)
          const n = (this.soopOfflineStreak.get(key) || 0) + 1
          this.soopOfflineStreak.set(key, n)
          if (n < 2) {
            logger.info('soop', `播放页报下播, 待第二轮确认 @${a.userId}`)
          } else {
            this.soopOfflineStreak.delete(key)
            store.updateAnchor(a.platform, a.userId, this.offPatch(a, { lastSeenAt: now }))
            this.onLiveEnd(a)
          }
        } else if (m.hostName && m.hostName !== a.nick) {
          store.updateAnchor(a.platform, a.userId, { nick: m.hostName, lastSeenAt: now })
        }
      }
      // 第三态(既无场次号也没说下播): 页面异常, 保持上次已知状态
      return 'other'
    } catch (e) {
      logger.warn('watcher', `SOOP 轮询失败 @${a.userId}: ${String((e as Error).message || e)}`)
      return 'fail'
    }
  }

  // ---- 轮次间隙兜底泵: rest(离线且列表不可见的关注)在轮询空档持续轮扫 ----
  // 与主轮询共用同一限速队列(gap+抖动), 单请求速率与轮内完全一致, 但节奏摊平到整条
  // 时间轴: 发现延迟 ≈ N×gap(50 离线 ≈ 60s), 与 pollIntervalSec 无关 —— 不论 30s 还是
  // 300s 一档, 空闲时间轴全部利用起来。让路规则: round 进行中不跑; 熔断期清空停扫;
  // 每人每轮至多扫一次(快照消费制, 新 round 发新快照)。
  private idleQueue: Anchor[] = []
  private idlePumping = false

  private async pumpIdle(): Promise<void> {
    if (this.idlePumping) return
    this.idlePumping = true
    try {
      while (this.idleQueue.length) {
        // 让路: 下一轮开始即停(下轮会发新快照); 停轮(stop)同样中止
        if (!this.running || this.roundInFlight) break
        if (this.status.byPlatform.pandalive.circuitOpen) {
          // 熔断高压期避开(与 prewarm 泵同语义)
          this.idleQueue.length = 0
          break
        }
        const a = this.idleQueue.shift()!
        // 快照生成后被取关: 跳过(不再为其发请求; 事件层另有 onLiveStart/onLiveEnd 守卫双保险)
        if (!this.stillMonitored(a.platform, a.userId)) continue
        if (this.isGone(a)) continue // 查无此人: 不发请求(每轮都会被快照带回, 必须在消费前挡)
        api.setGap(store.getSettings().requestGapMs) // 与轮内同节奏(设置页改动即时生效)
        try {
          const info = await api.fetchBj(a.userId)
          if (!this.running) break // 请求在飞期间已停轮: 事件不落, 剩余快照直接作废
          const found = await this.applyBj(a, info)
          if (found) this.pushAnchors() // rest 上"在播"恒为开播翻转: 即时点亮 UI(不等下一轮)
        } catch (e) {
          if (e instanceof BjNotFoundError) {
            this.onBjNotFound(a)
            continue // 查无此人: 不熔断不停泵, 继续消磨剩余快照
          }
          this.noteFailure(e)
          this.push()
          break // 出错即停, 剩余待下轮新快照(保守: 不在风控/坏网下硬闯)
        }
      }
    } finally {
      this.idlePumping = false
    }
  }

  // ---- 开播预取源泵: 逐个节流拉源写缓存, 点进房间即命中(两平台共用, 取流走 sourceFor 契约) ----
  private prewarmQueue: string[] = []
  private prewarmPumping = false

  private enqueuePrewarm(platform: Platform, userId: string): void {
    const key = roomKey(platform, userId)
    if (this.prewarmQueue.includes(key)) return
    this.prewarmQueue.push(key)
    void this.pumpPrewarm()
  }

  /** 对外入口: 关注"已在播"主播时补一发预取(列表模式下该类主播永不再触发 onLiveStart, 预取泵对其缺席) */
  prewarmNow(platform: Platform, userId: string): void {
    this.enqueuePrewarm(platform, userId)
  }

  private async pumpPrewarm(): Promise<void> {
    if (this.prewarmPumping) return
    this.prewarmPumping = true
    try {
      while (this.prewarmQueue.length) {
        // 熔断期间不预取(避免高压撞墙)
        if (this.status.byPlatform.pandalive.circuitOpen) {
          this.prewarmQueue.length = 0
          break
        }
        const key = this.prewarmQueue.shift()!
        const sep = key.indexOf(':')
        const platform = (sep > 0 ? key.slice(0, sep) : 'pandalive') as Platform
        const uid = sep > 0 ? key.slice(sep + 1) : key
        // 入队后被取关: 不再为其拉源(与 pumpIdle/事件守卫同规约; 开播入口(onLiveStart)已挡)
        if (!this.stillMonitored(platform, uid)) continue
        const cfg = store.getSettings()
        api.setGap(cfg.requestGapMs)
        const r = await sourceFor(platform).getPlayCached(uid).catch(() => undefined) // 失败静默(不打扰用户流)
        if (r) applyPlayMeta(platform, uid, r) // SOOP: 顺手把 BTIME 反推的开播时刻/密码房标记写回关注卡
        await sleep(Math.max(1200, cfg.requestGapMs) * (0.8 + Math.random() * 0.4))
      }
    } finally {
      this.prewarmPumping = false
    }
  }

  /** 翻转事件统一守卫: 拉列表/拉 bj 飞行窗口内主播可能已被取关; 事件不得落(防幽灵 toast/自录) */
  private stillMonitored(platform: Platform, userId: string): boolean {
    return store.listAnchors().some((x) => x.platform === platform && x.userId === userId)
  }

  private roundCnt = 0

  private onLiveStart(a: Anchor): void {
    if (!this.stillMonitored(a.platform, a.userId)) return
    sourceFor(a.platform).invalidatePlay(a.userId) // 主播(重)开播: 旧源作废
    logger.info('watcher', `开播: ${a.nick}(@${a.userId}) title"${a.title}" 自录=${a.autoRecord ? '开' : '关'}`)
    const cfg = store.getSettings()
    if (cfg.prefetchStream) this.enqueuePrewarm(a.platform, a.userId) // 后台预取新源写缓存
    if (a.tags?.type === 'fan') {
      // 粉丝房开播: 专用通知(与普通开播区分, 仍进系统通知与应用内气泡)
      sendToast({ type: 'fanLive', platform: a.platform, title: mt('watcher.fanLiveStart', { nick: a.nick }), body: a.title || mt('watcher.clickWatch') }, { ev: 'fanLive', ctx: { anchor: a } })
    } else {
      sendToast({ type: 'live', platform: a.platform, title: mt('watcher.liveStart', { nick: a.nick }), body: a.title || mt('watcher.clickWatch') }, { ev: 'live', ctx: { anchor: a, liveSec: liveElapsedSec(a.startTime) } })
    }
    if (a.autoRecord) {
      // getSettings 恒返回对象(恒真判定已移除)
      void recorder.start({ platform: a.platform, userId: a.userId, nick: a.nick, title: a.title, password: '', auto: true }).catch(() => undefined)
    }
  }

  /** 持续在播中的房态翻转: 由不敏感变为 19+ 房 或 粉丝房时补发一次通知(新开播走 onLiveStart, 不在此列) */
  private onRoomShift(a: Anchor, oldTags: Anchor['tags'], newTags: NonNullable<Anchor['tags']>): void {
    if (!oldTags) return // 上轮无标签(理论不达: wasLive 分支上轮已在播): 不臆断为变更
    const toAdult = !oldTags.isAdult && newTags.isAdult
    const toFan = oldTags.type !== 'fan' && newTags.type === 'fan'
    if (!toAdult && !toFan) return
    if (!this.stillMonitored(a.platform, a.userId)) return
    const kind = toAdult && toFan ? mt('watcher.roomBoth') : toAdult ? mt('watcher.roomAdult') : mt('watcher.roomFan')
    logger.info('watcher', `房态变更: ${a.nick}(@${a.userId}) ${kind}`)
    sendToast(
      { type: 'roomChange', platform: a.platform, title: `${a.nick} ${kind}`, body: a.title || mt('watcher.clickWatch') },
      { ev: 'roomChange', ctx: { anchor: a, liveSec: liveElapsedSec(a.startTime), detail: kind } }
    )
  }

  private onLiveEnd(a: Anchor): void {
    if (!this.stillMonitored(a.platform, a.userId)) return // 同 onLiveStart 守卫: 已取关不弹下播
    logger.info('watcher', `下播: ${a.nick}(@${a.userId})`)
    // 下播即频道死(实测: 之后 play 宽限期还会假发旧频道源, master 必 404) ——
    // 缓存源必须当场作废: 保活泵对已知下播不再心跳, 不清就会留死源骗"秒开"徽标, 点播放/录制必暴毙
    sourceFor(a.platform).invalidatePlay(a.userId)
    sendToast({ type: 'offline', platform: a.platform, title: mt('watcher.liveEnd', { nick: a.nick }), body: '' }, { ev: 'offline', ctx: { anchor: a, liveSec: liveElapsedSec(a.startTime) } })
  }

  private pushAnchors(): void {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.anchors, store.listAnchors())
  }

  private pushDiscovery(): void {
    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send(EV.discovery, this.discovery)
  }
}

export const watcher = new Watcher()
