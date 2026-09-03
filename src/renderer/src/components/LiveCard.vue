<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NTooltip, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useI18n } from 'vue-i18n'
import { fmtLiveDuration, fmtNum } from '@/utils/media'

// ============ 统一直播间卡片(大厅/已关注共用) ============
// AnchorCard 与 ExploreCard 历史两套近乎逐行重复的模板收敛至此:
//   - 通过归一化 model(props) 驱动; 差异操作走 slots
//   - slot=hoverActions: 缩略图右下悬浮操作(如关注心形)
//   - slot=meta:        第二行右侧扩展(如关注卡的 ⋯ 菜单)
// ======================================================

export interface LiveCardModel {
  userId: string
  nick: string
  title: string
  thumbUrl: string
  userImg: string
  isLive: boolean
  recording: boolean
  following?: boolean
  isAdult?: boolean
  isPw?: boolean
  isRec?: boolean
  isFan?: boolean
  viewers: number
  likes: number
  fans: number
  startTime?: string
}

const props = defineProps<{ model: LiveCardModel }>()
const router = useRouter()
const message = useMessage()
const { t, locale } = useI18n()

const m = computed(() => props.model)
const isZh = computed(() => locale.value === 'zh-CN')
const liveDuration = computed(() => (m.value.isLive ? fmtLiveDuration(m.value.startTime, t) : ''))

function watchLive(): void {
  if (m.value.isLive) router.push({ name: 'player', params: { userId: m.value.userId } })
}

async function toggleRecord(): Promise<void> {
  if (m.value.recording) {
    await api.recStop(m.value.userId)
    message.success(t('card.recStopped'))
  } else {
    const r = await api.recStart(m.value.userId)
    if ('userId' in r) {
      message.success(t('card.recStartedNick', { nick: m.value.nick }))
    } else if (r.needPassword) {
      const pwd = window.prompt(t('card.pwPrompt'))
      if (pwd !== null) {
        const r2 = await api.recStart(m.value.userId, pwd)
        'userId' in r2 ? message.success(t('card.recStarted')) : message.error(r2.error || t('card.recFail'))
      }
    } else {
      message.error(r.error || t('card.recFail'))
    }
  }
}
</script>

<template>
  <div
    class="group cursor-pointer bg-card rounded-xl overflow-hidden shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-pop border"
    :class="[m.isLive ? 'border-live/30 shadow-glow-live' : 'border-line']"
    @click="watchLive"
  >
    <!-- 缩略图: 左上状态 / 右上 19+ / 右下悬浮操作 -->
    <div class="relative aspect-video bg-fill overflow-hidden">
      <img
        v-if="m.isLive && m.thumbUrl"
        :src="m.thumbUrl"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <div v-else class="w-full h-full grid place-items-center bg-gradient-to-br from-fill to-fillh">
        <img v-if="m.userImg" :src="m.userImg" class="w-16 h-16 rounded-full object-cover opacity-70" referrerpolicy="no-referrer" />
        <div v-else class="w-16 h-16 rounded-full bg-card grid place-items-center text-2xl text-ink3 shadow-sm">{{ m.nick.slice(0, 1) }}</div>
      </div>

      <!-- 左上: 直播状态 (+录制中) -->
      <div class="absolute top-2 left-2 flex gap-1.5">
        <span v-if="m.isLive" class="flex items-center gap-1 px-2 py-[3px] rounded bg-live text-[11px] font-bold text-white shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-white animate-breathe"></span>{{ t('card.live') }}
        </span>
        <span v-else class="px-2 py-[3px] rounded bg-black/45 text-[11px] text-white/85">{{ t('card.offlineBadge') }}</span>
        <span v-if="m.recording" class="flex items-center gap-1 px-2 py-[3px] rounded bg-black/60 text-[11px] font-bold text-white">
          <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-breathe"></span>REC
        </span>
      </div>

      <!-- 右上: 19+ -->
      <span v-if="m.isAdult" class="absolute top-2 right-2 px-1.5 py-[3px] rounded bg-red-500/90 text-[11px] font-bold text-white shadow-sm">19+</span>

      <!-- hover: 扩展操作 + 录制 -->
      <div v-if="m.isLive" class="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200">
        <slot name="hoverActions" />
        <n-tooltip trigger="hover" :delay="300"><template #trigger>
          <button
            class="w-8 h-8 rounded-lg grid place-items-center shadow-md hover:scale-105 transition-transform"
            :class="m.recording ? 'bg-red-500 text-white' : 'bg-card/95 text-red-500'"
            @click.stop="toggleRecord"
          >
            <svg v-if="!m.recording" class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>
            <svg v-else class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>
          </button>
        </template>{{ m.recording ? t('card.stopRec') : t('card.record') }}</n-tooltip>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="px-3 pt-2.5 pb-3">
      <!-- 第一行: 标题 -->
      <h3 class="text-[13.5px] font-semibold text-ink1 leading-snug truncate group-hover:text-live transition-colors" :title="m.isLive ? m.title : m.nick">
        <span v-if="m.isPw" class="text-sky-500 font-normal">[{{ t('card.pw') }}] </span><span v-if="m.isRec" class="text-amber-500 font-normal">[{{ t('card.rec') }}] </span><span v-if="m.isFan" class="text-violet-500 font-normal">[{{ t('card.fan') }}] </span>{{ m.isLive ? (m.title || t('card.roomOf', { nick: m.nick })) : m.nick }}
      </h3>

      <!-- 第二行: 头像 + 昵称 + ID + 扩展区 -->
      <div class="flex items-center gap-1.5 mt-2">
        <img v-if="m.userImg" :src="m.userImg" class="w-[20px] h-[20px] rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />
        <svg v-else class="w-[20px] h-[20px] shrink-0" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>
        <span v-if="m.isLive" class="text-[12px] text-ink1 font-medium truncate">{{ m.nick }}</span>
        <svg v-if="m.following" class="w-3.5 h-3.5 text-live shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6.3 5.4 5.4 0 0121.3 12C19 16.4 12 21 12 21z"/>
        </svg>
        <span class="text-[11.5px] text-ink3 truncate shrink-0 ml-auto">@{{ m.userId }}</span>
        <slot name="meta" />
      </div>

      <!-- 第三行: 数据行(统一线性图标, 仅直播中有数据) -->
      <div v-if="m.isLive" class="flex items-center gap-3 mt-2 pt-2 border-t border-line/70 text-[11.5px] text-ink3">
        <span class="flex items-center gap-1" :title="t('card.viewers')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          {{ fmtNum(m.viewers, isZh) }}
        </span>
        <span class="flex items-center gap-1" :title="t('card.likes')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.9-9.7-9.2A5.6 5.6 0 0112 5.9a5.6 5.6 0 019.7 5.4c-2.2 4.3-9.7 9.2-9.7 9.2z"/></svg>
          {{ fmtNum(m.likes, isZh) }}
        </span>
        <span class="flex items-center gap-1" :title="t('card.fans')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>
          {{ fmtNum(m.fans, isZh) }}
        </span>
        <span class="ml-auto tabular-nums" :title="t('card.duration')">{{ liveDuration || '—' }}</span>
      </div>
    </div>
  </div>
</template>
