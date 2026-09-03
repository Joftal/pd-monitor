<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSelect, NSkeleton, NTag, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import HlsPlayer from '@/components/HlsPlayer.vue'
import SpinIcon from '@/components/SpinIcon.vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import type { AnchorTag } from '@shared/types'

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
const playerRef = ref<InstanceType<typeof HlsPlayer> | null>(null)
const quality = ref(0)
const variants = ref<{ url: string; bandwidth: number; resolution: string }[]>([])
const lastFailedUrl = ref('') // 上一次失效的源(仅展示)
const backups = ref<string[]>([]) // 备用线路(hls2/hls3 master, hls.js 自动选档)
const activeLine = ref(0) // 0=主线, 1..N=备用线路

const recording = computed(() => store.isRecording(userId))
const discoveryItem = computed(() => store.discovery.find((d) => d.userId === userId))
const viewers = computed(() => anchor.value?.viewerCount || discoveryItem.value?.viewers || 0)
// master 短寿, 变体长寿: 清晰度选项来自主进程解析后的变体列表
const levelOptions = computed(() =>
  variants.value.map((v, i) => ({
    label: v.resolution && v.resolution !== 'master' ? `${v.resolution.split('x')[1]}P` : i === 0 ? t('player.qBest') : t('player.qLevel', { n: i + 1 }),
    value: i
  }))
)

async function loadPlay(password = '', forceFresh = false): Promise<boolean> {
  let r
  try {
    r = await api.livePlay(userId, password, forceFresh)
  } catch (e) {
    errorMsg.value = t('player.playFail') + String((e as Error).message || e).replace(/^.*Error: /, '')
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
  loading.value = false
  return true
}

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
    message.error(String((e as Error).message || e).replace(/^.*Error: /, ''))
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

onMounted(async () => {
  await loadPlay()
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
    // Electron 旧路径兜底
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
    ok ? message.success(t('player.refreshed')) : undefined
  } finally {
    manualRefreshing.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
    <!-- 播放区 -->
    <div class="flex-1 min-w-0 flex flex-col p-5 gap-3.5">
      <div class="flex items-center gap-3 shrink-0">
        <button class="flex items-center gap-1.5 text-[12.5px] text-ink2 hover:text-ink1 transition-colors" @click="router.back()">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
          {{ t('player.back') }}
        </button>
      </div>

      <div class="flex-1 min-h-0 rounded-2xl overflow-hidden bg-black relative shadow-card">
        <HlsPlayer v-if="m3u8" ref="playerRef" :src="m3u8" autoplay @fatal="(m) => (errorMsg = m)" @url-dead="onUrlDead" />
        <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-900/95">
          <template v-if="loading">
            <n-skeleton class="!w-24 !h-3 rounded" :sharp="false" />
            <n-skeleton class="!w-40 !h-3 rounded" :sharp="false" />
            <span class="text-[12.5px] text-ink3">{{ t('player.loading') }}</span>
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
            <p class="text-[13px] text-ink3 max-w-[320px] text-center leading-relaxed">{{ errorMsg || t('player.offline') }}</p>
            <div class="flex gap-2">
              <n-button size="small" secondary @click="router.back()">{{ t('player.backExplore') }}</n-button>
              <n-button size="small" type="primary" @click="loadPlay(pwdInput, true)">{{ t('player.retry') }}</n-button>
            </div>
          </template>
        </div>
      </div>

      <!-- 控制条 -->
      <div class="shrink-0 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-card border border-gray-200/70 shadow-card">
        <span class="text-[12px] text-ink2">{{ t('player.quality') }}</span>
        <n-select
          size="small"
          class="!w-36"
          :value="quality"
          :options="levelOptions"
          :disabled="activeLine !== 0"
          @update:value="switchQuality"
        />
        <span v-if="activeLine !== 0" class="text-[11.5px] text-ink3">{{ t('player.lineAuto') }}</span>
        <div class="flex-1"></div>
        <n-button size="small" secondary type="primary" round :disabled="manualRefreshing" @click="manualRefresh" class="!w-[72px]">
          <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="manualRefreshing" :size="12" />{{ t('player.refresh') }}</span>
        </n-button>
        <n-button size="small" round :secondary="following" :type="following ? 'default' : 'primary'" @click="toggleFollow">
          {{ following ? t('player.unfollow') : t('player.follow') }}
        </n-button>
        <n-button size="small" round type="error" :secondary="!recording" @click="toggleRecord">
          {{ recording ? t('player.stopRec') : tags?.liveType === 'rec' ? t('player.dlVod') : t('player.startRec') }}
        </n-button>
      </div>
    </div>

    <!-- 信息侧栏 -->
    <aside class="w-full lg:w-[316px] shrink-0 p-5 lg:pl-0 flex flex-col gap-4 overflow-y-auto">
      <div class="rounded-2xl bg-card border border-gray-200/70 shadow-card overflow-hidden">
        <img v-if="thumb" :src="thumb" class="w-full aspect-video object-cover" referrerpolicy="no-referrer" />
        <div class="p-4 space-y-3">
          <div class="flex items-center gap-3">
            <img v-if="userImg" :src="userImg" class="w-11 h-11 rounded-full object-cover ring-2 ring-gray-100" referrerpolicy="no-referrer" />
            <div class="w-11 h-11 rounded-full bg-fill grid place-items-center text-xl text-ink3" v-else>{{ nick.slice(0, 1) }}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[14.5px] font-bold text-ink1 truncate">{{ nick }}</div>
              <div class="text-[11.5px] text-ink3 truncate">@{{ userId }}</div>
            </div>
            <span v-if="viewers" class="flex items-center gap-1 text-[12px] text-ink2">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 3.5-10.5 7C3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.5a3 3 0 100 6 3 3 0 000-6z"/></svg>
              {{ viewers }}
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <n-tag v-if="tags?.liveType === 'rec'" size="small" :bordered="false" type="warning">{{ t('account.tagRec') }}</n-tag>
            <n-tag v-if="tags?.isPw" size="small" :bordered="false" type="info">{{ t('account.tagPw') }}</n-tag>
            <n-tag v-if="tags?.isAdult" size="small" :bordered="false" type="error">19+</n-tag>
            <n-tag v-if="tags?.type === 'fan'" size="small" :bordered="false" type="warning">{{ t('account.tagFan') }}</n-tag>
          </div>
          <p class="text-[12.5px] text-ink2 leading-relaxed break-words">{{ title || '—' }}</p>
          <div class="text-[11.5px] text-ink3" v-if="anchor?.startTime || discoveryItem?.startTime">
            {{ t('player.liveSince', { t: (anchor?.startTime || discoveryItem?.startTime || '').slice(5, 16) }) }}
          </div>
        </div>
      </div>
      <!-- 当前源链接(单行截断 + 复制, 附上次失效记录) -->
      <div class="rounded-2xl bg-card border border-gray-200/70 shadow-card p-4 space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-[12.5px] font-semibold text-ink1">{{ t('player.curSource') }}</span>
          <n-button size="tiny" tertiary round @click="copyUrl" :disabled="!m3u8">{{ t('player.copy') }}</n-button>
        </div>
        <p class="text-[11px] text-ink2 font-mono truncate" :title="m3u8">
          {{ m3u8 ? shortUrl(m3u8) + ' · ' + (activeLine === 0 ? levelOptions[quality]?.label || '' : t('player.lineTag')) : t('player.noSource') }}
        </p>
        <!-- 线路切换: 主线 + hls2/hls3 备用(master 地址, hls.js 自动选档) -->
        <div v-if="backups.length" class="flex items-center gap-1.5 pt-1.5">
          <span class="text-[11px] text-ink3 shrink-0">{{ t('player.line') }}</span>
          <button
            v-for="i in backups.length + 1"
            :key="i"
            class="px-2 py-0.5 rounded text-[11px] transition-colors"
            :class="activeLine === i - 1
              ? 'bg-live/10 text-live font-semibold'
              : 'text-ink3 hover:text-ink1 bg-fill hover:bg-fillh'"
            @click="switchLine(i - 1)"
          >{{ i === 1 ? t('player.lineMain') : t('player.lineBak', { n: i - 1 }) }}</button>
        </div>
        <p v-if="lastFailedUrl" class="text-[10.5px] text-ink3/80 font-mono truncate" :title="lastFailedUrl">
          {{ t('player.lastFailed') }}{{ shortUrl(lastFailedUrl) }}
        </p>
      </div>

      <div class="rounded-2xl bg-live/5 border border-live/15 p-4 text-[12px] text-live/80 leading-relaxed">
        {{ t('player.tips') }}
      </div>
    </aside>
  </div>
</template>
