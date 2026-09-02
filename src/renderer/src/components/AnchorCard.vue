<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { NPopover, NSwitch, NTooltip, useMessage } from 'naive-ui'
import type { Anchor } from '@shared/types'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'

const props = defineProps<{ anchor: Anchor }>()
const emit = defineEmits<{ (e: 'remove', userId: string): void }>()
const router = useRouter()
const store = useAppStore()
const message = useMessage()

const a = computed(() => props.anchor)
const recording = computed(() => store.isRecording(a.value.userId))

const liveDuration = computed(() => {
  if (!a.value.isLive || !a.value.startTime) return ''
  const t = new Date(a.value.startTime.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`
})

function fmtNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  return String(n)
}

function watchLive() {
  router.push({ name: 'player', params: { userId: a.value.userId } })
}

async function toggleRecord() {
  if (recording.value) {
    await api.recStop(a.value.userId)
    message.success('已停止录制')
  } else {
    const r = await api.recStart(a.value.userId)
    if ('userId' in r) {
      message.success('开始录制')
    } else if (r.needPassword) {
      const pwd = window.prompt('该直播间为密码房, 请输入密码:')
      if (pwd !== null) {
        const r2 = await api.recStart(a.value.userId, pwd)
        'userId' in r2 ? message.success('开始录制') : message.error(r2.error || '启动失败')
      }
    } else {
      message.error(r.error || '启动录制失败')
    }
  }
}

async function setAuto(v: boolean) {
  await api.anchorsSetAuto(a.value.userId, v)
  store.anchors = await api.anchorsList()
}
</script>

<template>
  <!-- 与大厅一致的整体直播间卡片 -->
  <div
    class="group cursor-pointer bg-white rounded-xl overflow-hidden shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-pop border"
    :class="a.isLive ? 'border-live/30 shadow-glow-live' : 'border-line'"
    @click="a.isLive && watchLive()"
  >
    <!-- 缩略图: 仅左上直播状态 / 右上19+ -->
    <div class="relative aspect-video bg-gray-200 overflow-hidden">
      <img
        v-if="a.isLive && a.thumbUrl"
        :src="a.thumbUrl"
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
        <img v-if="a.userImg" :src="a.userImg" class="w-16 h-16 rounded-full object-cover opacity-70" referrerpolicy="no-referrer" />
        <div v-else class="w-16 h-16 rounded-full bg-white grid place-items-center text-2xl text-ink3 shadow-sm">{{ a.nick.slice(0, 1) }}</div>
      </div>

      <!-- 左上: 直播状态 (+录制中) -->
      <div class="absolute top-2 left-2 flex gap-1.5">
        <span v-if="a.isLive" class="flex items-center gap-1 px-2 py-[3px] rounded bg-live text-[11px] font-bold text-white shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-white animate-breathe"></span>直播中
        </span>
        <span v-else class="px-2 py-[3px] rounded bg-black/45 text-[11px] text-white/85">离线</span>
        <span v-if="recording" class="flex items-center gap-1 px-2 py-[3px] rounded bg-black/60 text-[11px] font-bold text-white">
          <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-breathe"></span>REC
        </span>
      </div>

      <!-- 右上: 19+ -->
      <span v-if="a.isLive && a.tags?.isAdult" class="absolute top-2 right-2 px-1.5 py-[3px] rounded bg-red-500/90 text-[11px] font-bold text-white shadow-sm">19+</span>

      <!-- hover: 录制 -->
      <div v-if="a.isLive" class="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200">
        <n-tooltip trigger="hover" :delay="300"><template #trigger>
          <button
            class="w-8 h-8 rounded-lg grid place-items-center shadow-md hover:scale-105 transition-transform"
            :class="recording ? 'bg-red-500 text-white' : 'bg-white/95 text-red-500'"
            @click.stop="toggleRecord"
          >
            <svg v-if="!recording" class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>
            <svg v-else class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>
          </button>
        </template>{{ recording ? '停止录制' : '录制' }}</n-tooltip>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="px-3 pt-2.5 pb-3">
      <!-- 第一行: 标题 -->
      <h3 class="text-[13.5px] font-semibold text-ink1 leading-snug truncate group-hover:text-live transition-colors" :title="a.isLive ? a.title : a.nick">
        <template v-if="a.isLive && a.tags">
          <span v-if="a.tags.isPw" class="text-sky-500 font-normal">[密码] </span><span v-if="a.tags.liveType === 'rec'" class="text-amber-500 font-normal">[回放] </span><span v-if="a.tags.type === 'fan'" class="text-violet-500 font-normal">[粉丝] </span>
        </template>
        {{ a.isLive ? (a.title || a.nick + '的直播间') : a.nick }}
      </h3>

      <!-- 第二行: 头像 + 昵称 + 主播ID + 菜单 -->
      <div class="flex items-center gap-1.5 mt-2">
        <img v-if="a.userImg" :src="a.userImg" class="w-[20px] h-[20px] rounded-full object-cover shrink-0" referrerpolicy="no-referrer" />
        <svg v-else class="w-[20px] h-[20px] shrink-0" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>
        <span v-if="a.isLive" class="text-[12px] text-ink1 font-medium truncate">{{ a.nick }}</span>
        <span class="text-[11.5px] text-ink3 truncate" :class="a.isLive ? 'shrink-0 ml-auto' : ''">@{{ a.userId }}</span>
        <n-popover trigger="click" placement="bottom-end" :show-arrow="false">
          <template #trigger>
            <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:text-ink1 hover:bg-gray-200/70 transition-colors shrink-0" :class="a.isLive ? '' : 'ml-auto'" @click.stop>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
            </button>
          </template>
          <div class="py-1 w-44">
            <div class="px-3 py-2 flex items-center justify-between text-[12.5px] text-ink1">
              <span>开播自动录制</span>
              <n-switch size="small" :value="a.autoRecord" @update:value="setAuto" />
            </div>
            <div class="px-3 py-2 text-[12.5px] text-ink2 hover:bg-gray-100 cursor-pointer" @click="api.openExternal('https://www.pandalive.co.kr/play/' + a.userId)">
              在浏览器打开
            </div>
            <div class="px-3 py-2 text-[12.5px] text-red-500 hover:bg-red-50 cursor-pointer" @click="emit('remove', a.userId)">
              取消关注
            </div>
          </div>
        </n-popover>
      </div>

      <!-- 第三行: 数据行(统一线性图标, 仅直播中有数据) -->
      <div v-if="a.isLive" class="flex items-center gap-3 mt-2 pt-2 border-t border-line/70 text-[11.5px] text-ink3">
        <span class="flex items-center gap-1" title="观众数">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          {{ fmtNum(a.viewerCount) }}
        </span>
        <span class="flex items-center gap-1" title="点赞数">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.9-9.7-9.2A5.6 5.6 0 0112 5.9a5.6 5.6 0 019.7 5.4c-2.2 4.3-9.7 9.2-9.7 9.2z"/></svg>
          {{ fmtNum(a.likes) }}
        </span>
        <span class="flex items-center gap-1" title="粉丝团人数">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>
          {{ fmtNum(a.fans) }}
        </span>
        <span class="ml-auto tabular-nums" title="直播时长">{{ liveDuration || '—' }}</span>
      </div>
    </div>
  </div>
</template>
