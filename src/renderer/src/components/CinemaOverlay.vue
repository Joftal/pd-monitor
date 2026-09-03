<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import SpinIcon from '@/components/SpinIcon.vue'
import { fmtBytes, fmtDur, mergeableTask } from '@/utils/media'
import type { RecHistoryItem } from '@shared/types'

// ============ 影院浮层(视频库点播) ============
// 全屏磨砂玻璃覆盖层: 重模糊背景 + 玻璃面板
//   顶栏: 返回 / 标题 / 状态 / 文件数 / 关闭
//   主体: 左侧播放器(舞台位) | 右侧信息 k-v + 分段列表 + 操作行
// 仅播放 MP4(plocal 协议); 合并按钮仅在可合并时出现
// ==========================================

const props = defineProps<{ show: boolean; task: RecHistoryItem | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void; (e: 'merge', task: RecHistoryItem): void }>()

const { t } = useI18n()
const message = useMessage()
const store = useAppStore()
const current = ref('')
const playError = ref('')

const files = computed(() => (props.task?.files || []).filter((f) => f.toLowerCase().endsWith('.mp4')))
const canMerge = computed(() => (props.task ? mergeableTask(props.task) : false))

// ---- 分段级删除(回收站): 行内二段确认 ----
const delSegTarget = ref('')
const delSegBusy = ref(false)
async function onDeleteSegment(): Promise<void> {
  const h = props.task
  const f = delSegTarget.value
  if (!h || !f || delSegBusy.value) return
  delSegBusy.value = true
  try {
    const r = await api.recDeleteFile(h.id, f)
    if (r.ok) {
      message.success(t('rec.delSegDone'))
      delSegTarget.value = ''
    } else {
      message.error(t('rec.delFail', { msg: r.error || 'unknown' }))
      delSegTarget.value = ''
    }
    await store.refreshHistory()
  } finally {
    delSegBusy.value = false
  }
}

// ---- 删除(移入回收站): 二段确认, 与磨砂同风格 ----
const confirmDel = ref(false)
const deleting = ref(false)
const mediaFiles = computed(() => (props.task?.files || []).filter((f) => /\.(mp4|ts)$/i.test(f)))
const delHintText = computed(() => {
  const h = props.task
  if (!h) return ''
  return mediaFiles.value.length ? t('rec.delHint', { n: mediaFiles.value.length, size: fmtBytes(h.bytes) }) : t('rec.delNone')
})
async function onDelete(): Promise<void> {
  const h = props.task
  if (!h || deleting.value) return
  deleting.value = true
  try {
    const r = await api.recDelete(h.id)
    if (r.ok) {
      message.success(t('rec.delDone', { n: r.deletedFiles, size: fmtBytes(r.freedBytes) }))
      confirmDel.value = false
      emit('update:show', false)
      await store.refreshHistory()
    } else {
      message.error(t('rec.delFail', { msg: r.error || 'unknown' }))
      confirmDel.value = false
      await store.refreshHistory()
    }
  } finally {
    deleting.value = false
  }
}

watch(
  () => [props.show, props.task?.id],
  () => {
    if (props.show) {
      current.value = files.value[0] || ''
      playError.value = ''
      confirmDel.value = false
      deleting.value = false
      delSegTarget.value = ''
      delSegBusy.value = false
    }
  },
  { immediate: true }
)
watch(current, () => {
  playError.value = ''
})
// 文件集变化(删段/合并/对账): 当前播放段没了 → 自动切到可用段
watch(files, (list) => {
  if (props.show && list.length && !list.includes(current.value)) current.value = list[0]
})

const src = computed(() => (props.show && current.value ? api.localFileUrl(current.value) : ''))

function onVideoError(): void {
  // 某一段失效(外部删除/损坏) → 自动跳下一段; 全灭才报错
  const i = files.value.indexOf(current.value)
  if (i >= 0 && i < files.value.length - 1) {
    current.value = files.value[i + 1]
    return
  }
  playError.value = t('playback.err')
}

function fname(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

const statusKey = computed(() => (props.task ? `rec.st${props.task.status[0].toUpperCase()}${props.task.status.slice(1)}` : ''))
const statusLabel = computed(() => (statusKey.value ? t(statusKey.value) : ''))
const statusCls = computed(() => {
  const s = props.task?.status
  return s === 'done' ? 'text-emerald-400' : s === 'error' ? 'text-red-400' : 'text-white/60'
})
const avgMbps = computed(() => {
  const h = props.task
  if (!h || !h.endedAt) return ''
  const sec = Math.max(1, Math.floor((h.endedAt - h.startedAt) / 1000))
  return ((h.bytes * 8) / 1e6 / sec).toFixed(1)
})

/** 信息面板行 */
const infoRows = computed(() => {
  const h = props.task
  if (!h) return []
  const rows: { label: string; value: string; cls?: string }[] = [
    { label: t('library.anchor'), value: h.nick },
    { label: t('library.time'), value: new Date(h.startedAt).toLocaleString() },
    { label: t('rec.durLabel'), value: fmtDur(h.startedAt, h.endedAt) },
    { label: t('rec.sizeLabel'), value: fmtBytes(h.bytes) },
    { label: 'Mbps', value: avgMbps.value },
    { label: t('playback.segs', { n: files.value.length }).replace(/\s*\(\d+\)\s*$/, ''), value: t('playback.nMp4', { n: files.value.length }) },
    { label: '', value: statusLabel.value, cls: statusCls.value }
  ]
  return rows
})

function openDir(): void {
  if (props.task?.dirPath) void api.recOpenFolder(props.task.dirPath)
}
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <!-- 磨砂玻璃遮罩: 重模糊 + 轻微饱和提升, 底下界面朦胧透出 -->
      <div
        v-if="show"
        class="fixed inset-0 z-50 bg-black/55 backdrop-blur-2xl backdrop-saturate-150 flex flex-col text-[#e8eaf0]"
        @click.self="emit('update:show', false)"
      >
        <!-- 顶栏(玻璃条) -->
        <div class="shrink-0 flex items-center gap-3 px-5 h-[56px] bg-black/25 backdrop-blur-md border-b border-white/10">
          <button
            class="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            @click="emit('update:show', false)"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
            {{ t('library.backToLib') }}
          </button>
          <div class="flex-1 min-w-0 flex items-center gap-2.5">
            <div class="text-[15px] font-bold text-white truncate" :title="task?.title">{{ task?.title || '—' }}</div>
            <span class="shrink-0 h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-white/10 border border-white/10 text-white/85">{{ task?.nick }}</span>
          </div>
          <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-white/10 border border-white/10" :class="statusCls">{{ statusLabel }}</span>
          <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-medium bg-white/5 border border-white/10 text-white/60 tabular-nums">{{ t('playback.nMp4', { n: files.length }) }}</span>
          <button
            class="w-8 h-8 rounded-lg grid place-items-center bg-white/10 hover:bg-white/20 border border-white/10 text-white/80 transition-colors"
            @click="emit('update:show', false)"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- 主体: 居中大容器, 左舞台右栏 -->
        <div class="flex-1 min-h-0 w-full max-w-[1500px] mx-auto flex gap-5 px-6 py-5">
          <!-- 视频舞台 -->
          <div class="flex-1 min-w-0 self-center rounded-2xl overflow-hidden bg-black/80 border border-white/10 shadow-2xl aspect-video max-h-full relative">
            <video v-if="src && !playError" :key="src" :src="src" controls autoplay class="w-full h-full" @error="onVideoError"></video>
            <div v-else class="w-full h-full grid place-items-center text-[12.5px] text-white/50">
              {{ playError || t('playback.noMp4') }}
            </div>
          </div>

          <!-- 右侧栏: 玻璃面板纵向排列 -->
          <aside class="w-[280px] shrink-0 flex flex-col gap-3 min-h-0">
            <!-- 信息 k-v -->
            <div class="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 px-4 py-3.5">
              <div class="text-[12px] font-bold text-white mb-1">{{ t('library.info') }}</div>
              <div v-for="(r, i) in infoRows" :key="i" class="flex justify-between items-baseline gap-3 text-[11.5px] py-[5px]" :class="i ? 'border-t border-white/5' : ''">
                <span class="text-white/45 shrink-0">{{ r.label }}</span>
                <span class="text-white/90 font-medium truncate text-right" :class="[r.cls || '', r.label ? 'tabular-nums' : '']" :title="r.value">{{ r.value }}</span>
              </div>
            </div>

            <!-- 分段列表(>1 时出现, 余量生长) -->
            <div v-if="files.length > 1" class="rounded-2xl bg-white/[0.06] backdrop-blur-md border border-white/10 px-3 py-3 flex-1 min-h-0 overflow-y-auto">
              <div class="text-[12px] font-bold text-white mb-1.5 px-1">{{ t('playback.segs', { n: files.length }) }}</div>
              <template v-for="(f, i) in files" :key="f">
                <!-- 行内二段确认 -->
                <div
                  v-if="delSegTarget === f"
                  class="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg bg-red-500/15 border border-red-500/30 text-[11.5px] text-red-200"
                >
                  <span class="truncate min-w-0">{{ t('rec.delSegQ') }}</span>
                  <span class="ml-auto flex items-center gap-1 shrink-0">
                    <button
                      class="h-[22px] px-2 rounded-md bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-[10.5px] font-bold inline-flex items-center gap-1 transition-colors"
                      :disabled="delSegBusy"
                      @click="onDeleteSegment"
                    ><SpinIcon v-if="delSegBusy" class="w-2.5 h-2.5" />✓</button>
                    <button
                      class="h-[22px] px-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white/80 text-[10.5px] transition-colors"
                      :disabled="delSegBusy"
                      @click="delSegTarget = ''"
                    >✕</button>
                  </span>
                </div>
                <!-- 分段行(hover 露出删除) -->
                <div
                  v-else
                  class="group w-full flex items-center gap-2 px-2.5 py-[7px] rounded-lg text-[11.5px] transition-colors text-left cursor-pointer"
                  :class="f === current ? 'bg-live/25 border border-live/40 text-[#ffd9e3] font-semibold' : 'text-white/70 hover:bg-white/8 border border-transparent'"
                  :title="fname(f)"
                  @click="current = f"
                >
                  <span class="text-white/40 text-[10.5px] tabular-nums shrink-0">#{{ i + 1 }}</span>
                  <span class="truncate min-w-0">{{ fname(f) }}</span>
                  <span
                    class="ml-auto shrink-0 w-[18px] h-[18px] grid place-items-center rounded text-white/35 hover:text-red-300 hover:bg-red-500/25 opacity-0 group-hover:opacity-100 transition-all"
                    @click.stop="delSegTarget = f"
                  >
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </span>
                </div>
              </template>
            </div>

            <!-- 操作行(吸底): 合并文案长 → 独占整行防换行; 打开目录/删除并排 -->
            <div v-if="!confirmDel" class="flex flex-col gap-2 shrink-0 mt-auto">
              <button
                v-if="canMerge"
                class="w-full h-[34px] rounded-lg bg-live hover:bg-live-dark text-white text-[12px] font-semibold whitespace-nowrap transition-all active:scale-[0.97]"
                @click="emit('merge', task!)"
              >{{ t('rec.actMerge') }}</button>
              <div class="flex gap-2">
                <button
                  class="flex-1 h-[34px] rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-[#e8eaf0] text-[12px] font-medium whitespace-nowrap transition-all active:scale-[0.97]"
                  @click="openDir"
                >{{ t('rec.actDir') }}</button>
                <button
                  class="flex-1 h-[34px] rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-[12px] font-medium whitespace-nowrap transition-all active:scale-[0.97]"
                  @click="confirmDel = true"
                >{{ t('rec.delAct') }}</button>
              </div>
            </div>
            <!-- 删除二段确认: 与浮层同风格磨砂玻璃, 红描边示意危险 -->
            <div v-else class="shrink-0 mt-auto rounded-2xl bg-white/[0.06] backdrop-blur-md border border-red-400/30 px-3.5 py-3">
              <div class="flex items-start gap-2.5">
                <svg class="w-4 h-4 text-red-400 shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] font-bold text-red-200">{{ t('rec.delQ') }}</div>
                  <div class="text-[11px] text-white/55 mt-0.5 leading-relaxed">{{ delHintText }}</div>
                </div>
              </div>
              <div class="flex gap-2 mt-3">
                <button
                  class="flex-1 h-[30px] rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5 active:scale-[0.97]"
                  :disabled="deleting"
                  @click="onDelete"
                >
                  <SpinIcon v-if="deleting" class="w-3 h-3" />
                  {{ t('rec.delConfirm') }}
                </button>
                <button
                  class="flex-1 h-[30px] rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-[#e8eaf0] text-[12px] font-medium transition-all active:scale-[0.97]"
                  :disabled="deleting"
                  @click="confirmDel = false"
                >{{ t('rec.delCancel') }}</button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </transition>
  </teleport>
</template>
