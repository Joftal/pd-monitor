<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NEmpty } from 'naive-ui'
import { api } from '@/api'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import type { RecHistoryItem } from '@shared/types'

// ============ 录制回看弹窗 ============
// 仅播放 MP4(Chromium 不支持 MPEG-TS); 多分段任务右侧分段列表切换
// 源 URL 走 plocal:// 自定义协议(主进程白名单 + Range 透传)
// ==================================

const props = defineProps<{ show: boolean; task: RecHistoryItem | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const current = ref('')
const playError = ref('')

const files = computed(() => (props.task?.files || []).filter((f) => f.toLowerCase().endsWith('.mp4')))

watch(
  () => [props.show, props.task?.id],
  () => {
    if (props.show) {
      current.value = files.value[0] || ''
      playError.value = ''
    }
  },
  { immediate: true }
)

function onVideoError(): void {
  playError.value = t('playback.err')
}

// 切换分段时清除错误态, 允许尝试其他分段
watch(current, () => {
  playError.value = ''
})

const src = computed(() => (props.show && current.value ? api.localFileUrl(current.value) : ''))

function fname(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    class="!w-[880px] !max-w-[94vw]"
    :bordered="false"
    :title="(task?.nick || '') + ' · ' + t('playback.suffix')"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="flex gap-4 min-h-0">
      <!-- 播放区 -->
      <div class="flex-1 min-w-0">
        <div class="rounded-xl overflow-hidden bg-black aspect-video relative">
          <video v-if="src && !playError" :key="src" :src="src" controls autoplay class="w-full h-full" @error="onVideoError"></video>
          <div v-else class="w-full h-full grid place-items-center">
            <n-empty :description="playError || t('playback.noMp4')" size="small" class="text-ink3" />
          </div>
        </div>
        <p class="mt-2.5 text-[13px] text-ink1 font-medium truncate" :title="task?.title">{{ task?.title || '—' }}</p>
        <p class="text-[11.5px] text-ink3 mt-0.5 truncate">
          @{{ task?.userId }} · {{ task ? fmtClock(task.startedAt) : '' }} · {{ t('playback.nMp4', { n: files.length }) }}
        </p>
      </div>

      <!-- 分段列表(多段才显示) -->
      <div v-if="files.length > 1" class="w-60 shrink-0">
        <div class="text-[12px] font-semibold text-ink2 mb-2">{{ t('playback.segs', { n: files.length }) }}</div>
        <div class="max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
          <button
            v-for="(f, i) in files"
            :key="f"
            class="w-full text-left px-3 py-2 rounded-lg border text-[12px] transition-colors truncate"
            :class="f === current
              ? 'border-live/50 bg-live/5 text-live font-semibold'
              : 'border-line bg-card text-ink2 hover:border-live/40 hover:text-ink1'"
            :title="fname(f)"
            @click="current = f"
          >
            <span class="tabular-nums mr-1.5" :class="f === current ? 'text-live/70' : 'text-ink3'">#{{ i + 1 }}</span>{{ fname(f) }}
          </button>
        </div>
      </div>
    </div>
  </n-modal>
</template>
