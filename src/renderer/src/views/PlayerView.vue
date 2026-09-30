<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSkeleton, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import HlsPlayer from '@/components/HlsPlayer.vue'
import SpinIcon from '@/components/SpinIcon.vue'
import PlatTag from '@/components/PlatTag.vue'
import { useI18n } from 'vue-i18n'
import { fmtLiveDuration } from '@/utils/media'
import { DEFAULT_PLATFORM, isPlatform, platformName, REC_RETRY_MAX, sanitizePathPart, type AnchorTag, type KeepaliveStatus, type Platform } from '@shared/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useAppStore()
const message = useMessage()

// 路由带平台段(/player/:plat/:userId); 手输/旧链接缺段时由路由兼容记录补默认平台
const platform: Platform = isPlatform(route.params.plat) ? route.params.plat : DEFAULT_PLATFORM
const userId = String(route.params.userId)
const isSoop = platform === 'soop'
const anchor = computed(() => store.anchors.find((a) => a.platform === platform && a.userId === userId))
const following = computed(() => store.isFollowing(platform, userId))

const loading = ref(true)
const errorMsg = ref('')
const m3u8 = ref('')
const title = ref('')
const nick = ref(anchor.value?.nick || userId)
const userImg = ref(anchor.value?.userImg || '')
const thumb = ref(anchor.value?.thumbUrl || '')
const tags = ref<AnchorTag | null>(anchor.value?.tags || null)
const needPw = ref(false)
/** 该房要登录态(SOOP 的 19+/限区房): 给"去登录"入口, 不能当成未开播 */
const needLogin = ref(false)
const pwdInput = ref('')
/** 本场已用过密码: 面板提交成功就消失, 不回显一次用户只会以为"这房根本没设密码"(设计稿 5.1) */
const pwdSent = ref(false)
const quality = ref(0)
const variants = ref<{ url: string; bandwidth: number; resolution: string; label?: string }[]>([])
const lastFailedUrl = ref('') // 上一次失效的源(仅展示)
const backups = ref<string[]>([]) // 备用线路(hls2/hls3 master, hls.js 自动选档)
const activeLine = ref(0) // 0=主线, 1..N=备用线路
const fetchedAt = ref(0) // 当前源包(主线分档+备用线路)在主进程缓存中的生成时刻

const recording = computed(() => store.isRecording(platform, userId))
// 「站内发现」数据源只覆盖 pandalive 房间(SOOP 无全站列表接口)
const discoveryItem = computed(() => (platform === 'pandalive' ? store.discovery.find((d) => d.userId === userId) : undefined))
const viewers = computed(() => anchor.value?.viewerCount || discoveryItem.value?.viewers || 0)

const isVod = computed(() => tags.value?.liveType === 'rec')

// ---- 侧栏信息卡取数(设计稿 S5: 失效自动续录 / 房间信息 / 本房间录制参数) ----
const st = computed(() => store.settings)
/** 房间信息不是实时推流, 是随轮询刷的 —— 把节奏写在卡头上, 免得用户拿它当秒级读数 */
const pollSec = computed(() => st.value?.pollIntervalSec ?? 0)
/** 房态标签: 官方没有"分区"字段可给, 只有 19+/密码/粉丝/回放四种房态; 一个都没有就是「—」 */
const labelList = computed(() => {
  const g = tags.value
  if (!g) return ''
  const out: string[] = []
  if (g.isAdult) out.push('19+')
  if (g.isPw) out.push(t('account.tagPw'))
  if (g.type === 'fan') out.push(t('account.tagFan'))
  if (g.liveType === 'rec') out.push(t('account.tagRec'))
  return out.join(' · ')
})
/** 点赞/粉丝只有 Panda 的关注列表回传; SOOP 侧官方不给 → 写「不适用 + 原因」, 不许填 0(3.2) */
function numOrNa(v: number | undefined): string {
  if (isSoop) return t('player.naSoop')
  return v ? String(v) : '—'
}
/** 自动续录: 上限来自共享常量 REC_RETRY_MAX(与主进程同一个数, 不是抄的); 回放下载不续 —— 进度无法无损接回 */
const retryText = computed(() => {
  if (isVod.value) return t('player.retryNaVod')
  return st.value?.autoRetryRecord ? t('player.retryOn', { n: REC_RETRY_MAX }) : t('player.retryOff')
})
const retryCls = computed(() => (isVod.value || !st.value?.autoRetryRecord ? 'kv-v text-ink3' : 'kv-v text-okink'))
const outText = computed(() => {
  const s = st.value
  if (!s) return '—'
  if (!s.autoMp4) return t('player.outTs')
  return s.mergeMp4 ? t('player.outMerge') : t('player.outMp4')
})
const segText = computed(() => (st.value?.splitSeconds ? t('player.segN', { n: Math.round(st.value.splitSeconds / 60) }) : '—'))
/** 落盘目录 = 录制根/平台/主播名(房间 ID), 与主进程 recorder.start 同一把尺(sanitizePathPart);
 *  这里只是"将要写到哪"的预告, 根目录未设置时显示默认根 */
const dirText = computed(() => `…/${platform}/${sanitizePathPart(nick.value) || t('common.unnamed')}(${userId})/`)
const autoRecHere = computed(() => !!anchor.value?.autoRecord)

/** 档位选项: 高度优先(pandalive 给 "1920x1080", SOOP 给 "1080p"), 取不到才用平台清晰度名/档位序号 */
const levelOptions = computed(() =>
  variants.value.map((v, i) => {
    const h = /x(\d{3,4})/i.exec(v.resolution)?.[1] || /(\d{3,4})p/i.exec(v.resolution)?.[1]
    const name = h ? `${h}P` : v.label || v.resolution
    return { label: name && name !== 'master' ? name : i === 0 ? t('player.qBest') : t('player.qLevel', { n: i + 1 }), value: i }
  })
)

/** 开播时长(来自关注卡 / 站内发现快照的 startTime; utils.fmtLiveDuration 收敛) */
const liveDuration = computed(() => fmtLiveDuration(anchor.value?.startTime || discoveryItem.value?.startTime, t))

const sinceText = computed(() => {
  const st = anchor.value?.startTime || discoveryItem.value?.startTime
  if (!st) return ''
  // startTime 为 KST(UTC+9)钟面: 转本地时间再显示, 裸切片会把韩国钟点当本地时刻(差 1 小时)
  const d = new Date(st.replace(' ', 'T') + '+09:00')
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return t('player.liveSince', { t: `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` })
})

/** 返回 = 原路返回(从哪来回哪去, 不跨平台)。上一站若是同平台的直播页或录制页就走历史栈 ——
 *  它连 `?view=` 与滚动位一起带回去: 从站内发现进的房, 返回不该落在在播关注。
 *  栈是空的(TG 推送/收藏直接进播放页)或上一站是对面平台时, 落本平台直播页, 不把用户甩出当前工作区。
 *  按钮写的就是它会去的地方: 从录制页进来的人看见「返回 直播」是句假话。 */
const backTarget = computed<{ label: string; run: () => void }>(() => {
  // hash 路由下 state.back 可能带 '#' 前缀, 两种形态都吃(vue-router 把它标成任意 state 字段, 只能 String() 收口)
  const prev = String(router.options.history.state.back ?? '').replace(/^#/, '')
  if (prev.startsWith(`/${platform}/recordings`)) return { label: t('player.backToRec'), run: () => router.back() }
  if (prev.startsWith(`/${platform}/live`)) {
    const v = new URLSearchParams(prev.slice(prev.indexOf('?') + 1)).get('view')
    if (v === 'discover' || v === 'offline')
      return { label: t('player.backToView', { where: v === 'discover' ? t('ws.viewDiscover') : t('ws.viewOffline') }), run: () => router.back() }
  }
  return { label: t('player.backToLive', { plat: platformName(platform) }), run: () => void router.push({ name: 'live', params: { plat: platform } }) }
})
function goBack(): void {
  backTarget.value.run()
}

async function loadPlay(password = '', forceFresh = false): Promise<boolean> {
  let r
  try {
    r = await api.livePlay(platform, userId, password, forceFresh)
  } catch (e) {
    errorMsg.value = t('player.playFail') + String((e as Error).message || e)
    loading.value = false
    return false
  }
  if (!r.ok) {
    // 遮罩是 v-else-if 优先级链: 上一轮的密码/登录面板不清, 就会把这次的真实错误盖掉
    needPw.value = false
    needLogin.value = false
    loading.value = false
    if (r.needPassword) {
      needPw.value = true
      // 没交过密码 = 正常的"请输入密码"提问; 交过还被拒 = 密码不对, 必须当场说清楚而不是静默重画板
      errorMsg.value = password ? r.error || '' : ''
      return false
    }
    // SOOP 的 19+/限区房在匿名态下会被平台拒发播放信息: 这不是"未开播", 得给去登录入口
    if (r.needLogin) {
      needLogin.value = true
      errorMsg.value = ''
      return false
    }
    errorMsg.value = r.error || t('player.noPlay')
    return false
  }
  needPw.value = false
  needLogin.value = false
  errorMsg.value = ''
  variants.value = r.variants || (r.m3u8 ? [{ url: r.m3u8, bandwidth: 0, resolution: 'master' }] : [])
  backups.value = r.hlsBackups || []
  activeLine.value = 0 // 新源到手一律回到主线
  // 默认最高档变体(长效地址)
  const qi = Math.min(quality.value, Math.max(0, variants.value.length - 1))
  const newUrl = variants.value[qi]?.url || r.m3u8 || ''
  if (newUrl && newUrl !== m3u8.value) m3u8.value = newUrl
  if (r.title) title.value = r.title
  if (r.nick) nick.value = r.nick
  if (r.thumbUrl) thumb.value = r.thumbUrl
  if (r.userImg) userImg.value = r.userImg
  if (r.tags) tags.value = r.tags
  if (r.fetchedAt) fetchedAt.value = r.fetchedAt
  loading.value = false
  return true
}

/** 源包获取时刻展示(HH:MM:SS, 本地时区; 绝对时间无歧义, 不需要 ticking) */
const fetchedAtText = computed(() => {
  if (!fetchedAt.value) return '—'
  const d = new Date(fetchedAt.value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
})

/** 「12:04:33 · 21 秒前」(设计稿 S5 侧栏): 长效地址有寿命, 光看绝对时刻读不出"这包还剩多少"。
 *  由保活心跳已有的 5s tick(kaNow)驱动, 不另起计时器 */
const fetchedAgeText = computed(() => {
  if (!fetchedAt.value) return ''
  const s = Math.max(0, Math.round((kaNow.value - fetchedAt.value) / 1000))
  return s < 120 ? t('player.fetchedAgoSec', { n: s }) : t('player.fetchedAgoMin', { n: Math.round(s / 60) })
})

async function submitPwd() {
  const sent = pwdInput.value.trim()
  const ok = await loadPlay(sent)
  if (ok) {
    needPw.value = false
    if (sent) pwdSent.value = true
  }
}

async function toggleFollow() {
  try {
    if (following.value) {
      await store.unfollow(platform, userId)
      message.success(t('player.unfollowedMsg'))
    } else {
      await store.follow(platform, userId)
      message.success(t('player.followedMsg'))
    }
  } catch (e) {
    message.error(String((e as Error).message || e))
  }
}

async function toggleRecord() {
  if (recording.value) {
    await api.recStop(platform, userId)
    message.success(t('player.recStopped'))
  } else {
    const r = await api.recStart(platform, userId, pwdInput.value || undefined)
    if ('userId' in r) {
      message.success(t('player.recStarted'))
    } else if (r.needPassword) {
      needPw.value = true
      message.warning(t('player.recNeedPw'))
    } else {
      message.error(r.error || t('player.recFail'))
    }
  }
}

// ---- 源保活状态展示: 5s 轮询快照 + 相对时间跳动 ----
const ka = ref<KeepaliveStatus | null>(null)
const kaNow = ref(Date.now())
let kaTimer: number | null = null

async function refreshKa(): Promise<void> {
  try {
    ka.value = await api.keepaliveStatus(platform, userId)
  } catch {
    /* ignore */
  }
}

const kaText = computed(() => {
  const k = ka.value
  if (!k) return '—'
  if (isVod.value) return t('player.kaVod')
  // SOOP 没有保活泵(上游清单判死即收尸, 下次播放重铸): 显示"已关闭(设置)"会让人去翻一个不存在的开关
  if (isSoop) return t('player.kaNa')
  if (!k.enabled) return t('player.kaOff')
  if (!k.cached) return t('player.kaNone')
  if (!k.lastOk) return t('player.kaBad')
  if (!k.lastAt) return t('player.kaWait')
  const s = Math.max(0, Math.round((kaNow.value - k.lastAt) / 1000))
  return t('player.kaOn', { s, n: k.variants })
})

const kaClass = computed(() => {
  const k = ka.value
  // 「不适用」两态(回放 / SOOP)用弱化色: 与"运行中/异常"这类真状态一眼可分
  if (!k || isVod.value || isSoop) return 'text-deco'
  if (!k.enabled || !k.cached) return 'text-ink1'
  if (!k.lastOk) return 'text-warnink'
  return 'text-okink'
})

onMounted(async () => {
  await loadPlay()
  void refreshKa()
  kaTimer = window.setInterval(() => {
    kaNow.value = Date.now()
    void refreshKa()
  }, 5000)
})

onUnmounted(() => {
  if (kaTimer) clearInterval(kaTimer)
})

/** 切换清晰度 = 直接换用对应变体的长效地址(仅主线; 备用线路由 hls.js 自动选档) */
function switchQuality(i: number) {
  quality.value = i
  const v = variants.value[i]
  if (v?.url) {
    m3u8.value = v.url
    message.success(t('player.switched', { label: levelOptions.value[i]?.label || 'new' }))
  }
}

/** 切换线路: 0=主线(恢复变体分档), 1..N=备用线路(master 自动清晰度); 失效仍走手动重试, 不自动跳线 */
function switchLine(i: number) {
  const u = i === 0 ? variants.value[Math.min(quality.value, Math.max(0, variants.value.length - 1))]?.url : backups.value[i - 1]
  if (!u || activeLine.value === i) return
  activeLine.value = i
  m3u8.value = u
  message.success(i === 0 ? t('player.switchMain') : t('player.switchedLine', { n: i }))
}

/** 源地址是否来自主进程的本地 HLS 代理(SOOP): 请求头由代理注入, 复制到外部播放器必失效 */
const isProxySource = computed(() => {
  try {
    return new URL(m3u8.value).hostname === '127.0.0.1'
  } catch {
    return false
  }
})

/** 紧凑展示源链接(host + 路径前缀, 不展开占版面) */
function shortUrl(u: string): string {
  if (!u) return '—'
  try {
    const x = new URL(u)
    const tail = x.pathname.split('/').filter(Boolean).pop() || ''
    return `${x.host}/…/${tail.slice(0, 22)}${tail.length > 22 ? '…' : ''}`
  } catch {
    return u.slice(0, 40) + '…'
  }
}

/** 复制当前播放源链接 */
async function copyUrl() {
  if (!m3u8.value) {
    message.warning(t('player.copyEmpty'))
    return
  }
  try {
    await navigator.clipboard.writeText(m3u8.value)
    message.success(t('player.copied'))
  } catch {
    const ta = document.createElement('textarea')
    ta.value = m3u8.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    message.success(t('player.copied'))
  }
}

/** 播放源失效(403/404): 不自动换源, 提示用户手动获取 */
function onUrlDead() {
  if (errorMsg.value) return // 已提示过, 等待手动
  lastFailedUrl.value = m3u8.value // 保留上一次失效的源做展示
  errorMsg.value = t('player.urlDead')
  loading.value = false
  m3u8.value = '' // 切到错误面板, 提供重试入口
  message.warning(t('player.urlDeadMsg'))
}

/** 手动刷新: 对当前直播间重新拉取一次数据 */
const manualRefreshing = ref(false)
async function manualRefresh() {
  if (manualRefreshing.value) return
  manualRefreshing.value = true
  try {
    const ok = await loadPlay(pwdInput.value, true) // 手动刷新强取新源
    if (ok) message.success(t('player.refreshed'))
  } finally {
    manualRefreshing.value = false
  }
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col p-5 gap-3 overflow-y-auto">
    <!-- ① 顶部工具行 -->
    <div class="flex items-center gap-3 shrink-0">
      <button class="flex items-center gap-1.5 text-[12.5px] text-ink2 hover:text-ink1 transition-colors" @click="goBack">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
        {{ backTarget.label }}
      </button>
      <div class="flex-1"></div>
      <span
        class="badge badge-md"
        :class="errorMsg ? 'bg-warn/[0.14] text-warnink' : 'bg-fill text-ink2'"
      >{{ errorMsg ? t('player.srcDead') : t('player.srcOk') }}</span>
    </div>

    <div class="flex-1 min-h-0 flex gap-4">
      <!-- ② 舞台列 -->
      <div class="flex-1 min-w-0 flex flex-col gap-3">
        <!-- 播放器黑卡(限高 + 角标) -->
        <div class="relative flex-1 min-h-[260px] rounded-card overflow-hidden bg-black shadow-card">
          <HlsPlayer v-if="m3u8" :src="m3u8" autoplay class="absolute inset-0" @fatal="errorMsg = t('player.noPlay')" @url-dead="onUrlDead" />
          <!-- 角标: 状态 + 观看数 -->
          <div v-if="m3u8" class="absolute top-3 left-3 flex gap-1.5 pointer-events-none">
            <span class="badge badge-sm text-white shadow-sm" :class="isVod ? 'bg-brand' : 'bg-liveink'">
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-breathe"></span>{{ isVod ? t('account.tagRec') : t('card.live') }}
            </span>
            <span v-if="recording" class="badge badge-sm bg-onimg text-white">
              <span class="w-1.5 h-1.5 rounded-full bg-live animate-breathe"></span>REC
            </span>
          </div>
          <div v-if="m3u8 && viewers" class="absolute top-3 right-3 badge badge-sm bg-onimg text-white tabular-nums">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 3.5-10.5 7C3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.5a3 3 0 100 6 3 3 0 000-6z"/></svg>
            {{ viewers }}
          </div>
          <!-- 非播放态: 加载/密码房/错误 遮罩 -->
          <div v-if="!m3u8" class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/95">
            <template v-if="loading">
              <n-skeleton class="!w-24 !h-3 rounded-md" :sharp="false" />
              <n-skeleton class="!w-40 !h-3 rounded-md" :sharp="false" />
              <span class="text-[12.5px] text-white/65">{{ t('player.loading') }}</span>
            </template>
            <template v-else-if="needPw">
              <div class="text-3xl">🔒</div>
              <p class="text-[13px] text-white/90">{{ t('player.pwRoom') }}</p>
              <p v-if="errorMsg" class="text-[12px] text-errdark max-w-[320px] text-center leading-relaxed">{{ errorMsg }}</p>
              <div class="flex gap-2">
                <n-input v-model:value="pwdInput" type="password" :placeholder="t('player.pwPh')" class="!w-52" @keyup.enter="submitPwd" />
                <n-button type="primary" @click="submitPwd">{{ t('player.pwEnter') }}</n-button>
              </div>
            </template>
            <template v-else-if="needLogin">
              <div class="text-3xl">🔑</div>
              <p class="text-[13px] text-white/90 max-w-[320px] text-center leading-relaxed">{{ t('player.needLogin') }}</p>
              <div class="flex gap-2">
                <n-button size="small" secondary @click="loadPlay(pwdInput, true)">{{ t('player.retry') }}</n-button>
                <n-button size="small" type="primary" @click="router.push({ name: 'account', query: { plat: platform } })">{{ t('player.goLogin') }}</n-button>
              </div>
            </template>
            <template v-else>
              <div class="text-3xl">📡</div>
              <p class="text-[13px] text-white/65 max-w-[320px] text-center leading-relaxed">{{ errorMsg || t('player.offline') }}</p>
              <div class="flex gap-2">
                <n-button size="small" secondary @click="goBack">{{ backTarget.label }}</n-button>
                <n-button size="small" type="primary" @click="loadPlay(pwdInput, true)">{{ t('player.retry') }}</n-button>
              </div>
            </template>
          </div>
        </div>

        <!-- ③ 标题 + 元信息 -->
        <div class="shrink-0">
          <h1 class="text-[17px] font-extrabold text-ink1 leading-snug tracking-tight clamp-2" :title="title">{{ title || t('card.roomOf', { nick }) }}</h1>
          <div class="flex items-center gap-2 mt-1.5 flex-wrap">
            <span v-if="isVod" class="badge badge-md bg-brand/[0.10] text-brand">{{ t('account.tagRec') }}</span>
            <!-- 密码房 / 粉丝团 / 地区限制是内容属性不是状态: 恒用中性徽标, 状态色只留给 19+ 与在播/错误(设计稿 S6 图例) -->
            <span v-if="tags?.isPw" class="badge badge-md bg-fill text-ink2 border border-line">{{ t('account.tagPw') }}</span>
            <!-- 「密码已提供」是本场取源的成功回执, 不是房间属性: 只在提交成功那一次出现, 否则面板消失后用户以为这房根本没设密码(设计稿 5.1) -->
            <span v-if="pwdSent && tags?.isPw" class="badge badge-md bg-ok/10 text-okink">{{ t('player.pwProvided') }}</span>
            <span v-if="tags?.isAdult" class="badge badge-md bg-liveink/90 text-white">19+</span>
            <span v-if="tags?.type === 'fan'" class="badge badge-md bg-fill text-ink2 border border-line">{{ t('account.tagFan') }}</span>
            <span v-if="sinceText" class="text-[12px] text-ink3">{{ sinceText }}</span>
            <template v-if="viewers">
              <span class="text-[12px] text-ink3">·</span>
              <span class="text-[12px] text-ink3 flex items-center gap-1 tabular-nums">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 3.5-10.5 7C3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.5a3 3 0 100 6 3 3 0 000-6z"/></svg>
                {{ viewers }}
              </span>
            </template>
          </div>
        </div>

        <!-- ④ 控制条: 清晰度直选 + 线路直选 + 操作 -->
        <div class="shrink-0 flex items-center gap-3 px-3.5 py-2.5 rounded-card bg-card shadow-card flex-wrap">
          <!-- 清晰度直选: 选项来自房间真实 master 分档; 仅一档(单码率房/master 回退档)时无可切, 整块收起 -->
          <template v-if="levelOptions.length > 1">
            <span class="text-[11px] text-ink3">{{ t('player.quality') }}</span>
            <div class="inline-flex bg-fill rounded-ctl p-0.5 gap-px" :class="activeLine !== 0 ? 'opacity-50 pointer-events-none' : ''">
              <button
                v-for="opt in levelOptions"
                :key="opt.value"
                class="px-2.5 py-1 rounded-md text-[12px] transition-colors tabular-nums"
                :class="quality === opt.value ? 'bg-card text-ink1 font-semibold shadow-card' : 'text-ink2 hover:text-ink1'"
                @click="switchQuality(opt.value)"
              >{{ opt.label }}</button>
            </div>
          </template>
          <span v-if="activeLine !== 0" class="text-[11.5px] text-ink3">{{ t('player.lineAuto') }}</span>
          <template v-if="backups.length">
            <span class="w-px h-5 bg-line/70"></span>
            <span class="text-[11px] text-ink3">{{ t('player.line') }}</span>
            <div class="inline-flex bg-fill rounded-ctl p-0.5 gap-px">
              <button
                v-for="i in backups.length + 1"
                :key="i"
                class="px-2.5 py-1 rounded-md text-[12px] transition-colors"
                :class="activeLine === i - 1 ? 'bg-card text-ink1 font-semibold shadow-card' : 'text-ink2 hover:text-ink1'"
                @click="switchLine(i - 1)"
              >{{ i === 1 ? t('player.lineMain') : t('player.lineBak', { n: i - 1 }) }}</button>
            </div>
          </template>
          <div class="flex-1"></div>
          <n-button size="small" secondary type="primary" :disabled="manualRefreshing" @click="manualRefresh" class="!min-w-[72px]">
            <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="manualRefreshing" :size="12" />{{ t('player.refresh') }}</span>
          </n-button>
          <!-- 取关是这一排唯一的破坏性动作, 不能穿中性灰: 卡片菜单与离线行的取关都是红字, 同一动作在第四处不能反过来最不像它 -->
          <n-button size="small" :secondary="following" :type="following ? 'error' : 'primary'" @click="toggleFollow">
            {{ following ? t('player.unfollow') : t('player.follow') }}
          </n-button>
          <n-button v-if="!isVod" size="small" type="error" :secondary="!recording" @click="toggleRecord">
            {{ recording ? t('player.stopRec') : t('player.startRec') }}
          </n-button>
          <n-button v-else size="small" type="primary" @click="toggleRecord">
            {{ recording ? t('player.stopRec') : t('player.dlVod') }}
          </n-button>
        </div>
      </div>

      <!-- ⑤ 侧栏(300px) -->
      <aside class="w-[300px] shrink-0 flex flex-col gap-3 overflow-y-auto">
        <!-- ① 房间信息卡(设计稿 S5「房间信息」并入主播卡: 两处各列一遍观众数会互相打脸) -->
        <div class="panel">
          <img v-if="thumb" :src="thumb" class="w-full aspect-video object-cover" referrerpolicy="no-referrer" />
          <div class="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
            <img v-if="userImg" :src="userImg" class="w-[42px] h-[42px] rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />
            <div v-else class="w-[42px] h-[42px] rounded-full bg-fill grid place-items-center text-lg text-ink3 font-bold shrink-0">{{ nick.slice(0, 1) }}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[14px] font-bold text-ink1 truncate">{{ nick }}</div>
              <div class="text-[11px] text-ink3 truncate">@{{ userId }}</div>
            </div>
            <PlatTag :platform="platform" size="sm" surface="onsurf" class="shrink-0" />
          </div>
          <div class="panel-b">
            <div class="kv">
              <span class="kv-k">{{ t('player.labels') }}</span>
              <span class="kv-v" :class="labelList ? 'text-ink1' : 'text-ink3'">{{ labelList || '—' }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.viewers') }}</span>
              <span class="kv-v">{{ viewers || '—' }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.liveDur') }}</span>
              <span class="kv-v">{{ liveDuration || '—' }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.likes') }}</span>
              <span class="kv-v" :class="isSoop ? 'text-ink3' : 'text-ink1'">{{ numOrNa(anchor?.likes) }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.fans') }}</span>
              <span class="kv-v" :class="isSoop ? 'text-ink3' : 'text-ink1'">{{ numOrNa(anchor?.fans) }}</span>
            </div>
            <!-- 刷新节奏写在卡尾: 这一栏是轮询读数不是实时推流, 不说清楚就会被当秒级数据读 -->
            <p class="text-[10.5px] text-ink3 mt-1.5">{{ t('player.roomPollNote', { sec: pollSec }) }}</p>
          </div>
        </div>

        <!-- ② 播放源卡 -->
        <div class="panel">
          <div class="panel-h">
            <span class="panel-t">{{ t('player.curSource') }}</span>
            <button class="text-[11px] text-ink3 hover:text-brand hover:bg-brand/[0.10] rounded-md px-1.5 py-0.5 transition-colors" @click="copyUrl">{{ t('player.copy') }}</button>
          </div>
          <div class="panel-b">
            <div class="flex items-center gap-2 bg-fill rounded-ctl px-2.5 py-[7px]">
              <span class="flex-1 min-w-0 truncate font-mono text-[11px] text-ink2" :title="m3u8">{{ m3u8 ? shortUrl(m3u8) : t('player.noSource') }}</span>
            </div>
            <p v-if="isProxySource" class="text-[11px] text-ink3 leading-snug mt-1.5">{{ t('player.srcProxyTip') }}</p>
            <div class="kv mt-1">
              <span class="kv-k">{{ t('player.line') }}</span>
              <!-- SOOP 官方不给线路清单: 写「不适用 + 原因」而不是显示一个恒为「主线」的假状态 -->
              <span v-if="isSoop" class="kv-v text-deco">{{ t('player.lineNa') }}</span>
              <span v-else class="kv-v">{{ activeLine === 0 ? t('player.lineMain') : t('player.lineBak', { n: activeLine }) }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.quality') }}</span>
              <span class="kv-v">{{ activeLine === 0 ? (levelOptions[quality]?.label || '—') : t('player.lineAuto') }}</span>
            </div>
            <!-- 源包获取时刻: 缺值也占一行写「—」(整行隐藏会让人以为这一档被平台吃了) -->
            <div class="kv">
              <span class="kv-k">{{ t('player.fetchedAt') }}</span>
              <span class="kv-v">{{ fetchedAtText }}<span v-if="fetchedAgeText" class="text-ink3 font-normal"> · {{ fetchedAgeText }}</span></span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.keepalive') }}</span>
              <span class="kv-v" :class="kaClass">{{ kaText }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.lastFailed') }}</span>
              <span class="kv-v text-ink3 font-mono" :title="lastFailedUrl">{{ lastFailedUrl ? shortUrl(lastFailedUrl) : '—' }}</span>
            </div>
            <!-- 自动续录上限取共享常量 REC_RETRY_MAX: 主进程改了这个数, 这里不可能说谎 -->
            <div class="kv">
              <span class="kv-k">{{ t('player.autoRetry') }}</span>
              <span :class="retryCls">{{ retryText }}</span>
            </div>
          </div>
        </div>

        <!-- ③ 本房间录制参数: 一期没有 per-房间覆盖设置面, 所以这里如实标「跟随全局设置」,
             只有「开播自动录制」是本主播身上的开关(与设计稿原文的差别已记进 8.1 订正 B) -->
        <div class="panel">
          <div class="panel-h">
            <span class="panel-t">{{ t('player.recParams') }}</span>
            <span class="panel-x">{{ t('player.recParamsNote') }}</span>
          </div>
          <div class="panel-b">
            <div class="kv">
              <span class="kv-k">{{ t('player.recOut') }}</span>
              <span class="kv-v">{{ outText }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.recSeg') }}</span>
              <span class="kv-v">{{ segText }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.recDir') }}</span>
              <span class="kv-v font-mono text-[10.5px]" :title="dirText">{{ dirText }}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{{ t('player.recAuto') }}</span>
              <span class="kv-v" :class="autoRecHere ? 'text-okink' : 'text-ink3'">{{ t(autoRecHere ? 'player.recAutoOn' : 'player.recAutoOff') }}</span>
            </div>
          </div>
        </div>

        <!-- 提示卡: 这是「怎么用」的说明, 不是异常 → 信息承载面(brand 淡底 + brand 字, 设计稿 .banner.info)。
             此前用 live 红底 80% 红字, 把一句普通说明染成了告警色, 且 11.5px 红字压淡红不达标 -->
        <div class="rounded-ctl bg-brand/[0.07] border border-brand/[0.18] p-3.5 text-[11.5px] text-brand leading-relaxed">
          {{ t('player.tips') }}
        </div>
      </aside>
    </div>
  </div>
</template>
