<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSelect, NSkeleton, NTag, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import HlsPlayer from '@/components/HlsPlayer.vue'
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
const quality = ref(-1)

let refreshTimer: number | null = null

const recording = computed(() => store.isRecording(userId))
const discoveryItem = computed(() => store.discovery.find((d) => d.userId === userId))
const viewers = computed(() => anchor.value?.viewerCount || discoveryItem.value?.viewers || 0)
const levelOptions = computed(() => {
  const opts = [{ label: '自动', value: -1 }]
  const lv = playerRef.value?.levels || []
  for (const l of lv) {
    opts.push({ label: l.height ? `${l.height}P  ${(l.bitrate / 1000).toFixed(0)}k` : `档位 ${l.index + 1}`, value: l.index })
  }
  return opts
})

async function loadPlay(password = ''): Promise<boolean> {
  const r = await api.livePlay(userId, password)
  if (!r.ok) {
    if (r.needPassword) {
      needPw.value = true
      errorMsg.value = ''
      loading.value = false
      return false
    }
    errorMsg.value = r.error || '无法播放'
    loading.value = false
    return false
  }
  needPw.value = false
  errorMsg.value = ''
  const newUrl = r.m3u8 || ''
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
      message.success('已取消关注')
    } else {
      await store.follow(userId)
      message.success('已关注')
    }
  } catch (e) {
    message.error(String((e as Error).message || e).replace(/^.*Error: /, ''))
  }
}

async function toggleRecord() {
  if (recording.value) {
    await api.recStop(userId)
    message.success('已停止录制')
  } else {
    const r = await api.recStart(userId, pwdInput.value || undefined)
    if ('userId' in r) {
      message.success('开始录制')
    } else if (r.needPassword) {
      needPw.value = true
      message.warning('密码房: 请先输入房间密码')
    } else {
      message.error(r.error || '启动录制失败')
    }
  }
}

onMounted(async () => {
  await loadPlay()
  // IVS token ~10 分钟过期, 每 4 分钟静默刷新
  refreshTimer = window.setInterval(() => {
    void loadPlay(pwdInput.value)
  }, 4 * 60 * 1000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <div class="h-full flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">
    <!-- 播放区 -->
    <div class="flex-1 min-w-0 flex flex-col p-5 gap-3.5">
      <div class="flex items-center gap-3 shrink-0">
        <button class="flex items-center gap-1.5 text-[12.5px] text-gray-500 hover:text-gray-900 transition-colors" @click="router.back()">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
          返回
        </button>
      </div>

      <div class="flex-1 min-h-0 rounded-2xl overflow-hidden bg-black relative shadow-card">
        <HlsPlayer v-if="m3u8" ref="playerRef" :src="m3u8" autoplay @fatal="(m) => (errorMsg = m)" />
        <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-900/95">
          <template v-if="loading">
            <n-skeleton class="!w-24 !h-3 rounded" :sharp="false" />
            <n-skeleton class="!w-40 !h-3 rounded" :sharp="false" />
            <span class="text-[12.5px] text-gray-400">正在获取直播流…</span>
          </template>
          <template v-else-if="needPw">
            <div class="text-3xl">🔒</div>
            <p class="text-[13px] text-gray-200">该直播间为密码房</p>
            <div class="flex gap-2">
              <n-input v-model:value="pwdInput" type="password" placeholder="输入房间密码" class="!w-52" @keyup.enter="submitPwd" />
              <n-button type="primary" @click="submitPwd">进入</n-button>
            </div>
          </template>
          <template v-else>
            <div class="text-3xl">📡</div>
            <p class="text-[13px] text-gray-400 max-w-[320px] text-center leading-relaxed">{{ errorMsg || '主播未开播' }}</p>
            <div class="flex gap-2">
              <n-button size="small" secondary @click="router.back()">返回大厅</n-button>
              <n-button size="small" type="primary" @click="loadPlay(pwdInput)">重试</n-button>
            </div>
          </template>
        </div>
      </div>

      <!-- 控制条 -->
      <div class="shrink-0 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-white border border-gray-200/70 shadow-card">
        <span class="text-[12px] text-gray-500">清晰度</span>
        <n-select
          size="small"
          class="!w-36"
          :value="quality"
          :options="levelOptions"
          @update:value="(v: number) => { quality = v; playerRef?.setLevel(v) }"
        />
        <div class="flex-1"></div>
        <n-button size="small" round :secondary="following" :type="following ? 'default' : 'primary'" @click="toggleFollow">
          {{ following ? '已关注' : '+ 关注' }}
        </n-button>
        <n-button size="small" round :type="recording ? 'error' : 'error'" :secondary="!recording" @click="toggleRecord">
          {{ recording ? '■ 停止录制' : '⏺ 开始录制' }}
        </n-button>
      </div>
    </div>

    <!-- 信息侧栏 -->
    <aside class="w-full lg:w-[316px] shrink-0 p-5 lg:pl-0 flex flex-col gap-4 overflow-y-auto">
      <div class="rounded-2xl bg-white border border-gray-200/70 shadow-card overflow-hidden">
        <img v-if="thumb" :src="thumb" class="w-full aspect-video object-cover" referrerpolicy="no-referrer" />
        <div class="p-4 space-y-3">
          <div class="flex items-center gap-3">
            <img v-if="userImg" :src="userImg" class="w-11 h-11 rounded-full object-cover ring-2 ring-gray-100" referrerpolicy="no-referrer" />
            <div class="w-11 h-11 rounded-full bg-gray-100 grid place-items-center text-xl text-gray-400" v-else>{{ nick.slice(0, 1) }}</div>
            <div class="min-w-0 flex-1">
              <div class="text-[14.5px] font-bold text-gray-900 truncate">{{ nick }}</div>
              <div class="text-[11.5px] text-gray-400 truncate">@{{ userId }}</div>
            </div>
            <span v-if="viewers" class="flex items-center gap-1 text-[12px] text-gray-500">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-5 0-9 3.5-10.5 7C3 15.5 7 19 12 19s9-3.5 10.5-7C21 8.5 17 5 12 5zm0 11.5a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7.5a3 3 0 100 6 3 3 0 000-6z"/></svg>
              {{ viewers }}
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <n-tag v-if="tags?.liveType === 'rec'" size="small" :bordered="false" type="warning">回放</n-tag>
            <n-tag v-if="tags?.isPw" size="small" :bordered="false" type="info">密码房</n-tag>
            <n-tag v-if="tags?.isAdult" size="small" :bordered="false" type="error">19+</n-tag>
            <n-tag v-if="tags?.type === 'fan'" size="small" :bordered="false" type="warning">粉丝团</n-tag>
          </div>
          <p class="text-[12.5px] text-gray-600 leading-relaxed break-words">{{ title || '—' }}</p>
          <div class="text-[11.5px] text-gray-400" v-if="anchor?.startTime || discoveryItem?.startTime">
            开播于 {{ (anchor?.startTime || discoveryItem?.startTime || '').slice(5, 16) }}
          </div>
        </div>
      </div>
      <div class="rounded-2xl bg-live/5 border border-live/15 p-4 text-[12px] text-live/80 leading-relaxed">
        播放地址约 10 分钟自动静默续期; 若长时间卡顿, 返回大厅重新进入。密码房录制会使用本次输入的密码。
      </div>
    </aside>
  </div>
</template>
