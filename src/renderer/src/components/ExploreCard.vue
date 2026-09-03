<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import { useMessage, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import type { DiscoveryItem } from '@shared/types'

const props = defineProps<{ item: DiscoveryItem }>()
const router = useRouter()
const store = useAppStore()
const message = useMessage()

const x = computed(() => props.item)
const following = computed(() => store.isFollowing(x.value.userId))
const recording = computed(() => store.isRecording(x.value.userId))

const liveDuration = computed(() => {
  if (!x.value.startTime) return ''
  const ts = new Date(x.value.startTime.replace(' ', 'T')).getTime()
  if (Number.isNaN(ts)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return t(h > 0 ? 'card.h' : 'card.m', { h, m })
})

function fmtNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + t('common.myriad')
  return String(n)
}

function watchLive() {
  router.push({ name: 'player', params: { userId: x.value.userId } })
}

async function toggleFollow() {
  try {
    if (following.value) {
      await store.unfollow(x.value.userId)
      message.success(t('card.unfollowed', { nick: x.value.nick }))
    } else {
      await store.follow(x.value.userId)
      message.success(t('card.followed', { nick: x.value.nick }))
    }
  } catch (e) {
    message.error(String((e as Error).message || e).replace(/^.*Error: /, ''))
  }
}

async function toggleRecord() {
  if (recording.value) {
    await api.recStop(x.value.userId)
    message.success(t('card.recStopped'))
  } else {
    const r = await api.recStart(x.value.userId)
    if ('userId' in r) {
      message.success(t('card.recStartedNick', { nick: x.value.nick }))
    } else if (r.needPassword) {
      const pwd = window.prompt(t('card.pwPrompt'))
      if (pwd !== null) {
        const r2 = await api.recStart(x.value.userId, pwd)
        'userId' in r2 ? message.success(t('card.recStarted')) : message.error(r2.error || t('card.recFail'))
      }
    } else {
      message.error(r.error || t('card.recFail'))
    }
  }
}
</script>

<template>
  <!-- 整体直播间卡片: 缩略图仅状态徽章, 数据下移至结构化行 -->
  <div
    class="group cursor-pointer bg-card border border-line rounded-xl overflow-hidden shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-pop"
    @click="watchLive"
  >
    <!-- 缩略图: 仅左上直播状态 / 右上19+ -->
    <div class="relative aspect-video bg-fill overflow-hidden">
      <img
        v-if="x.thumbUrl"
        :src="x.thumbUrl"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <div v-else class="w-full h-full grid place-items-center bg-gradient-to-br from-fill to-fillh">
        <div class="w-14 h-14 rounded-full bg-card grid place-items-center text-2xl text-ink3 shadow-sm">{{ x.nick.slice(0, 1) }}</div>
      </div>

      <!-- 左上: 直播状态 (+录制中) -->
      <div class="absolute top-2 left-2 flex gap-1.5">
        <span class="flex items-center gap-1 px-2 py-[3px] rounded bg-live text-[11px] font-bold text-white shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-white animate-breathe"></span>{{ t('card.live') }}
        </span>
        <span v-if="recording" class="flex items-center gap-1 px-2 py-[3px] rounded bg-black/60 text-[11px] font-bold text-white">
          <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-breathe"></span>REC
        </span>
      </div>

      <!-- 右上: 19+ -->
      <span v-if="x.isAdult" class="absolute top-2 right-2 px-1.5 py-[3px] rounded bg-red-500/90 text-[11px] font-bold text-white shadow-sm">19+</span>

      <!-- hover: 关注/录制 -->
      <div class="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200">
        <n-tooltip trigger="hover" :delay="300"><template #trigger>
          <button
            class="w-8 h-8 rounded-lg bg-card/95 grid place-items-center shadow-md hover:scale-105 transition-transform"
            :class="following ? 'text-live' : 'text-ink2'"
            @click.stop="toggleFollow"
          >
            <svg class="w-[17px] h-[17px]" viewBox="0 0 24 24" :fill="following ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6.3 5.4 5.4 0 0121.3 12C19 16.4 12 21 12 21z"/>
            </svg>
          </button>
        </template>{{ following ? t('card.unfollow') : t('card.follow') }}</n-tooltip>
        <n-tooltip trigger="hover" :delay="300"><template #trigger>
          <button
            class="w-8 h-8 rounded-lg grid place-items-center shadow-md hover:scale-105 transition-transform"
            :class="recording ? 'bg-red-500 text-white' : 'bg-card/95 text-red-500'"
            @click.stop="toggleRecord"
          >
            <svg v-if="!recording" class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>
            <svg v-else class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>
          </button>
        </template>{{ recording ? t('card.stopRec') : t('card.record') }}</n-tooltip>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="px-3 pt-2.5 pb-3">
      <!-- 第一行: 标题 -->
      <h3 class="text-[13.5px] font-semibold text-ink1 leading-snug truncate group-hover:text-live transition-colors" :title="x.title">
        <span v-if="x.isPw" class="text-sky-500 font-normal">[{{ t('card.pw') }}] </span><span v-if="x.liveType === 'rec'" class="text-amber-500 font-normal">[{{ t('card.rec') }}] </span><span v-if="x.type === 'fan'" class="text-violet-500 font-normal">[{{ t('card.fan') }}] </span>{{ x.title || t('card.roomOf', { nick: x.nick }) }}
      </h3>

      <!-- 第二行: 头像 + 昵称 + 主播ID -->
      <div class="flex items-center gap-1.5 mt-2">
        <img v-if="x.userImg" :src="x.userImg" class="w-[20px] h-[20px] rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />
        <svg v-else class="w-[20px] h-[20px] shrink-0" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>
        <span class="text-[12px] text-ink1 font-medium truncate">{{ x.nick }}</span>
        <svg v-if="following" class="w-3.5 h-3.5 text-live shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6.3 5.4 5.4 0 0121.3 12C19 16.4 12 21 12 21z"/>
        </svg>
        <span class="text-[11.5px] text-ink3 truncate shrink-0 ml-auto">@{{ x.userId }}</span>
      </div>

      <!-- 第三行: 数据行(统一线性图标) -->
      <div class="flex items-center gap-3 mt-2 pt-2 border-t border-line/70 text-[11.5px] text-ink3">
        <span class="flex items-center gap-1" :title="t('card.viewers')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          {{ fmtNum(x.viewers) }}
        </span>
        <span class="flex items-center gap-1" :title="t('card.likes')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.9-9.7-9.2A5.6 5.6 0 0112 5.9a5.6 5.6 0 019.7 5.4c-2.2 4.3-9.7 9.2-9.7 9.2z"/></svg>
          {{ fmtNum(x.likes) }}
        </span>
        <span class="flex items-center gap-1" :title="t('card.fans')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>
          {{ fmtNum(x.fans) }}
        </span>
        <span class="ml-auto tabular-nums" :title="t('card.duration')">{{ liveDuration || '—' }}</span>
      </div>
    </div>
  </div>
</template>
