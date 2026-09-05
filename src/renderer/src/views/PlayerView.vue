<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSkeleton, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import HlsPlayer from '@/components/HlsPlayer.vue'
import SpinIcon from '@/components/SpinIcon.vue'
import { useI18n } from 'vue-i18n'
import { fmtLiveDuration } from '@/utils/media'
import type { AnchorTag, KeepaliveStatus } from '@shared/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useAppStore()
const message = useMessage()

const userId = String(route.params.userId)
const anchor = computed(() => store.anchors.find((a) => a.userId === userId))
const following = computed(() => store.isFollowing(userId))

const loading = ref(true)
const errorMsg = ref('')
const m3u8 = ref('')
const title = ref('')
const nick = ref(anchor.value?.nick || userId)
const userImg = ref(anchor.value?.userImg || '')
const thumb = ref(anchor.value?.thumbUrl || '')
const tags = ref<AnchorTag | null>(anchor.value?.tags || null)
const needPw = ref(false)
const pwdInput = ref('')
const quality = ref(0)
const variants = ref<{ url: string; bandwidth: number; resolution: string }[]>([])
const lastFailedUrl = ref('') // 上一次失效的源(仅展示)
const backups = ref<string[]>([]) // 备用线路(hls2/hls3 master, hls.js 自动选档)
const activeLine = ref(0) // 0=主线, 1..N=备用线路
const fetchedAt = ref(0) // 当前源包(主线分档+备用线路)在主进程缓存中的生成时刻

const recording = computed(() => store.isRecording(userId))
const discoveryItem = computed(() => store.discovery.find((d) => d.userId === userId))
const viewers = computed(() => anchor.value?.viewerCount || discoveryItem.value?.viewers || 0)

const isVod = computed(() => tags.value?.liveType === 'rec')

/** 档位选项: 解析出分辨率 → N P; 否则最高档/档位 N */
const levelOptions = computed(() =>
  variants.value.map((v, i) => ({
    label: v.resolution && v.resolution !== 'master' ? `${v.resolution.split('x')[1]}P` : i === 0 ? t('player.qBest') : t('player.qLevel', { n: i + 1 }),
    value: i
  }))
)

/** 开播时长(来自关注卡/大厅的 startTime; utils.fmtLiveDuration 收敛) */
const liveDuration = computed(() => fmtLiveDuration(anchor.value?.startTime || discoveryItem.value?.startTime, t))

const sinceText = computed(() => {
  const st = anchor.value?.startTime || discoveryItem.value?.startTime
  return st ? t('player.liveSince', { t: st.slice(5, 16) }) : ''
})

async function loadPlay(password = '', forceFresh = false): Promise<boolean> {
  let r
  try {
    r = await api.livePlay(userId, password, forceFresh)
  } catch (e) {
    errorMsg.value = t('player.playFail') + String((e as Error).message || e)
    loading.value = false
    return false
  }
  if (!r.ok) {
    if (r.needPassword) {
      needPw.value = true
      errorMsg.value = ''
      loading.value = false
      return false
    }
    errorMsg.value = r.error || t('player.noPlay')
    loading.value = false
    return false
  }
  needPw.value = false
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

async function submitPwd() {
  const ok = await loadPlay(pwdInput.value)
  if (ok) needPw.value = false
}

async function toggleFollow() {
  try {
    if (following.value) {
      await store.unfollow(userId)
      message.success(t('player.unfollowedMsg'))
    } else {
      await store.follow(userId)
      message.success(t('player.followedMsg'))
    }
  } catch (e) {
    message.error(String((e as Error).message || e))
  }
}

async function toggleRecord() {
  if (recording.value) {
    await api.recStop(userId)
    message.success(t('player.recStopped'))
  } else {
    const r = await api.recStart(userId, pwdInput.value || undefined)
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
    ka.value = await api.keepaliveStatus(userId)
  } catch {
    /* ignore */
  }
}

const kaText = computed(() => {
  const k = ka.value
  if (!k) return '—'
  if (isVod.value) return t('player.kaVod')
  if (!k.enabled) return t('player.kaOff')
  if (!k.cached) return t('player.kaNone')
  if (!k.lastOk) return t('player.kaBad')
  if (!k.lastAt) return t('player.kaWait')
  const s = Math.max(0, Math.round((kaNow.value - k.lastAt) / 1000))
  return t('player.kaOn', { s, n: k.variants })
})

const kaClass = computed(() => {
  const k = ka.value
  if (!k || isVod.value || !k.enabled || !k.cached) return 'text-ink1'
  if (!k.lastOk) return 'text-[#d98a08]'
  return 'text-[#2fad5f]'
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
      <button class="flex items-center gap-1.5 text-[12.5px] text-ink2 hover:text-ink1 transition-colors" @click="router.back()">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
        {{ t('player.back') }}
      </button>
      <div class="flex-1"></div>
      <span
        class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold"
        :class="errorMsg ? 'bg-[#f0a020]/[0.14] text-[#d98a08]' : 'bg-[#61666d]/10 text-ink2'"
      >{{ errorMsg ? t('player.srcDead') : t('player.srcOk') }}</span>
    </div>

    <div class="flex-1 min-h-0 flex gap-4">
      <!-- ② 舞台列 -->
      <div class="flex-1 min-w-0 flex flex-col gap-3">
        <!-- 播放器黑卡(限高 + 角标) -->
        <div class="relative flex-1 min-h-[260px] rounded-2xl overflow-hidden bg-black shadow-card">
          <HlsPlayer v-if="m3u8" :src="m3u8" autoplay class="absolute inset-0" @fatal="errorMsg = t('player.noPlay')" @url-dead="onUrlDead" />
          <!-- 角标: 状态 + 观看数 -->
          <div v-if="m3u8" class="absolute top-3 left-3 flex gap-1.5 pointer-events-none">
            <span class="inline-flex items-center gap-1 px-2 py-[3px] rounded bg-live text-[11px] font-bold text-white shadow-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-white animate-breathe"></span>{{ isVod ? t('account.tagRec') : t('card.live') }}
            </span>
            <span v-if="recording" class="inline-flex items-center gap-1 px-2 py-[3px] rounded bg-black/60 text-[11px] font-bold text-white">
              <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-breathe"></span>REC
            </span>
          </div>
          <div v-if="m3u8 && viewers" class="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-[3px] rounded bg-black/50 text-[11px] text-white tabular-nums">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 3.5-10.5 7C3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.5a3 3 0 100 6 3 3 0 000-6z"/></svg>
            {{ viewers }}
          </div>
          <!-- 非播放态: 加载/密码房/错误 遮罩 -->
          <div v-if="!m3u8" class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-900/95">
            <template v-if="loading">
              <n-skeleton class="!w-24 !h-3 rounded" :sharp="false" />
              <n-skeleton class="!w-40 !h-3 rounded" :sharp="false" />
              <span class="text-[12.5px] text-gray-400">{{ t('player.loading') }}</span>
            </template>
            <template v-else-if="needPw">
              <div class="text-3xl">🔒</div>
              <p class="text-[13px] text-gray-200">{{ t('player.pwRoom') }}</p>
              <div class="flex gap-2">
                <n-input v-model:value="pwdInput" type="password" :placeholder="t('player.pwPh')" class="!w-52" @keyup.enter="submitPwd" />
                <n-button type="primary" @click="submitPwd">{{ t('player.pwEnter') }}</n-button>
              </div>
            </template>
            <template v-else>
              <div class="text-3xl">📡</div>
              <p class="text-[13px] text-gray-400 max-w-[320px] text-center leading-relaxed">{{ errorMsg || t('player.offline') }}</p>
              <div class="flex gap-2">
                <n-button size="small" secondary @click="router.back()">{{ t('player.backExplore') }}</n-button>
                <n-button size="small" type="primary" @click="loadPlay(pwdInput, true)">{{ t('player.retry') }}</n-button>
              </div>
            </template>
          </div>
        </div>

        <!-- ③ 标题 + 元信息 -->
        <div class="shrink-0">
          <h1 class="text-[17px] font-extrabold text-ink1 leading-snug tracking-tight clamp-2" :title="title">{{ title || t('card.roomOf', { nick }) }}</h1>
          <div class="flex items-center gap-2 mt-1.5 flex-wrap">
            <span v-if="isVod" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#f0a020]/[0.14] text-[#d98a08]">{{ t('account.tagRec') }}</span>
            <span v-if="tags?.isPw" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-sky-500/10 text-sky-600">{{ t('account.tagPw') }}</span>
            <span v-if="tags?.isAdult" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-red-500/10 text-red-500">19+</span>
            <span v-if="tags?.type === 'fan'" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-violet-500/10 text-violet-600">{{ t('account.tagFan') }}</span>
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
        <div class="shrink-0 flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-card shadow-card flex-wrap">
          <!-- 清晰度直选: 选项来自房间真实 master 分档; 仅一档(单码率房/master 回退档)时无可切, 整块收起 -->
          <template v-if="levelOptions.length > 1">
            <span class="text-[11px] text-ink3">{{ t('player.quality') }}</span>
            <div class="inline-flex bg-fill rounded-lg p-0.5 gap-px" :class="activeLine !== 0 ? 'opacity-50 pointer-events-none' : ''">
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
            <div class="inline-flex bg-fill rounded-lg p-0.5 gap-px">
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
          <n-button size="small" secondary type="primary" round :disabled="manualRefreshing" @click="manualRefresh" class="!w-[72px]">
            <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="manualRefreshing" :size="12" />{{ t('player.refresh') }}</span>
          </n-button>
          <n-button size="small" round :secondary="following" :type="following ? 'default' : 'primary'" @click="toggleFollow">
            {{ following ? t('player.unfollow') : t('player.follow') }}
          </n-button>
          <n-button v-if="!isVod" size="small" round type="error" :secondary="!recording" @click="toggleRecord">
            {{ recording ? t('player.stopRec') : t('player.startRec') }}
          </n-button>
          <button
            v-else
            class="h-[30px] px-4 rounded-full text-[12.5px] font-semibold text-white bg-[#f0a020] hover:bg-[#d98a08] active:scale-[0.97] transition-all"
            @click="toggleRecord"
          >{{ recording ? t('player.stopRec') : t('player.dlVod') }}</button>
        </div>
      </div>

      <!-- ⑤ 侧栏(300px) -->
      <aside class="w-[300px] shrink-0 flex flex-col gap-3 overflow-y-auto">
        <!-- 主播卡 -->
        <div class="bg-card rounded-xl shadow-card overflow-hidden">
          <img v-if="thumb" :src="thumb" class="w-full aspect-video object-cover" referrerpolicy="no-referrer" />
          <div class="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
            <img v-if="userImg" :src="userImg" class="w-[42px] h-[42px] rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />
            <div v-else class="w-[42px] h-[42px] rounded-full bg-fill grid place-items-center text-lg text-ink3 font-bold shrink-0">{{ nick.slice(0, 1) }}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[14px] font-bold text-ink1 truncate">{{ nick }}</div>
              <div class="text-[11px] text-ink3 truncate">@{{ userId }}</div>
            </div>
          </div>
          <div class="px-3.5 pb-3">
            <div class="flex items-center justify-between text-[11.5px] py-1.5">
              <span class="text-ink3">{{ t('player.viewers') }}</span>
              <span class="text-ink1 font-medium tabular-nums">{{ viewers || '—' }}</span>
            </div>
            <div class="flex items-center justify-between text-[11.5px] py-1.5 border-t border-line/50">
              <span class="text-ink3">{{ t('player.liveDur') }}</span>
              <span class="text-ink1 font-medium tabular-nums">{{ liveDuration || '—' }}</span>
            </div>
          </div>
        </div>

        <!-- 播放源卡 -->
        <div class="bg-card rounded-xl shadow-card overflow-hidden">
          <div class="flex items-center justify-between px-3.5 pt-3 pb-2">
            <span class="text-[12.5px] font-bold text-ink1">{{ t('player.curSource') }}</span>
            <button class="text-[11px] text-ink3 hover:text-live hover:bg-live/10 rounded px-1.5 py-0.5 transition-colors" @click="copyUrl">{{ t('player.copy') }}</button>
          </div>
          <div class="px-3.5 pb-3">
            <div class="flex items-center gap-2 bg-fill rounded-lg px-2.5 py-[7px]">
              <span class="flex-1 min-w-0 truncate font-mono text-[11px] text-ink2" :title="m3u8">{{ m3u8 ? shortUrl(m3u8) : t('player.noSource') }}</span>
            </div>
            <div class="flex items-center justify-between text-[11.5px] py-1.5 mt-1">
              <span class="text-ink3">{{ t('player.line') }}</span>
              <span class="text-ink1 font-medium">{{ activeLine === 0 ? t('player.lineMain') : t('player.lineBak', { n: activeLine }) }}</span>
            </div>
            <div class="flex items-center justify-between text-[11.5px] py-1.5 border-t border-line/50">
              <span class="text-ink3">{{ t('player.quality') }}</span>
              <span class="text-ink1 font-medium tabular-nums">{{ activeLine === 0 ? (levelOptions[quality]?.label || '—') : t('player.lineAuto') }}</span>
            </div>
            <div v-if="fetchedAt" class="flex items-center justify-between text-[11.5px] py-1.5 border-t border-line/50">
              <span class="text-ink3">{{ t('player.fetchedAt') }}</span>
              <span class="text-ink1 font-medium tabular-nums">{{ fetchedAtText }}</span>
            </div>
            <!-- 源保活运行状态: 心跳是否正常/几秒前 -->
            <div v-if="ka" class="flex items-center justify-between text-[11.5px] py-1.5 border-t border-line/50">
              <span class="text-ink3">{{ t('player.keepalive') }}</span>
              <span class="font-medium" :class="kaClass">{{ kaText }}</span>
            </div>
            <div v-if="lastFailedUrl" class="flex items-center justify-between text-[11.5px] py-1.5 border-t border-line/50">
              <span class="text-ink3">{{ t('player.lastFailed') }}</span>
              <span class="text-ink3/80 font-mono truncate max-w-[170px]" :title="lastFailedUrl">{{ shortUrl(lastFailedUrl) }}</span>
            </div>
          </div>
        </div>

        <!-- 提示卡(弱化) -->
        <div class="rounded-xl bg-live/5 p-3.5 text-[11.5px] text-live/80 leading-relaxed">
          {{ t('player.tips') }}
        </div>
      </aside>
    </div>
  </div>
</template>
