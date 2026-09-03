<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { baseName, fmtBytes, fmtDur, fmtDurHMS } from '@/utils/media'
import type { RecTask } from '@shared/types'

const { t } = useI18n()
const store = useAppStore()
const message = useMessage()

const diskFree = ref(0)
const tick = ref(0)
let timer: number | null = null

onMounted(async () => {
  timer = window.setInterval(() => {
    tick.value++
    if (tick.value % 30 === 0) void api.recDiskFree().then((v) => (diskFree.value = v))
  }, 1000)
  diskFree.value = await api.recDiskFree()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

// ---- 实时码率/下载速度: 复用 2s 任务推送做字节差分(纯前端, 零请求) ----
const rates = ref<Record<string, number>>({}) // userId -> bytes/s
let prevSnap: Record<string, { bytes: number; at: number }> = {}
watch(
  () => store.recordings,
  (list) => {
    const now = Date.now()
    const next: typeof prevSnap = {}
    const out: Record<string, number> = {}
    for (const task of list) {
      const p = prevSnap[task.userId]
      if (p && now > p.at) {
        out[task.userId] = Math.max(0, (task.bytes - p.bytes) / ((now - p.at) / 1000))
      }
      next[task.userId] = { bytes: task.bytes, at: now }
    }
    prevSnap = next
    rates.value = out
  }
)
/** 直播录制 → Mbps; 回放下载 → MB/s */
function fmtRate(task: RecTask): string {
  const v = rates.value[task.userId]
  if (v === undefined) return '—'
  return task.vod ? `${(v / 1048576).toFixed(1)}` : `${((v * 8) / 1e6).toFixed(1)}`
}

const fmtDurSec = fmtDurHMS

// ---- 概览 ----
const active = computed(() => store.activeRecs)
const activeBytes = computed(() => active.value.reduce((s, task) => s + (task.bytes || 0), 0))
const diskLow = computed(() => diskFree.value < (store.settings?.diskLimitGb ?? 1) * 2)
const diskCaption = computed(() => {
  const limit = store.settings?.diskLimitGb ?? 1
  if (diskFree.value < limit) return t('rec.diskDanger')
  return diskLow.value ? t('rec.diskWarn') : t('rec.diskFull')
})
const splitMin = computed(() => Math.round((store.settings?.splitSeconds ?? 900) / 60))

// ---- VOD 进度 ----
function vodPct(task: RecTask): number | null {
  if (!task.vodTotalSec || !task.vodDoneSec) return null
  return Math.min(100, Math.floor((100 * task.vodDoneSec) / task.vodTotalSec))
}
function vodTotalLabel(task: RecTask): string {
  if (!task.vodTotalSec) return ''
  return task.vodTotalSec < 3600 ? `~${Math.round(task.vodTotalSec / 60)} ${t('common.min')}` : `~${fmtDurSec(task.vodTotalSec)}`
}

async function stop(userId: string) {
  await api.recStop(userId)
  message.success(t('rec.stopped'))
}
async function openFolder(dir: string) {
  await api.recOpenFolder(dir)
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
      <!-- ① 页头 + 概览条 -->
      <div class="flex items-end gap-4 pt-5">
        <div class="shrink-0">
          <h1 class="text-[21px] font-extrabold text-ink1 tracking-tight">{{ t('rec.title') }}</h1>
        </div>
        <div class="ml-auto flex items-stretch bg-card rounded-2xl shadow-card overflow-hidden divide-x divide-line/70">
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3 flex items-center gap-1.5">
              <span class="w-[7px] h-[7px] rounded-full bg-red-500" :class="active.length ? 'animate-breathe' : ''"></span>{{ t('rec.ovActive') }}
            </div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums" :class="active.length ? 'text-red-500' : 'text-ink1'">
              {{ t('rec.ovActiveN', { n: active.length }) }}
            </div>
          </div>
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3">{{ t('rec.ovBytes') }}</div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums text-ink1">{{ fmtBytes(activeBytes) }}</div>
          </div>
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3">{{ t('rec.ovDisk') }}</div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums" :class="diskLow ? 'text-red-500' : 'text-ink1'">
              {{ diskFree.toFixed(1) }}<span class="text-[11px] font-medium text-ink3 ml-1">GB</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ② 进行中 · 大卡片 -->
      <div class="flex items-center gap-2 mt-6 mb-3 px-0.5">
        <h2 class="text-[14.5px] font-extrabold text-ink1 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500" :class="active.length ? 'animate-breathe' : ''"></span>{{ t('rec.secActive') }}
          <span class="text-[11.5px] font-medium text-ink3">{{ t('rec.secActiveN', { n: active.length }) }}</span>
        </h2>
        <span class="ml-auto text-[11.5px] text-ink3">{{ t('rec.rateNote') }}</span>
      </div>

      <div v-if="active.length" class="space-y-3.5">
        <div
          v-for="task in active"
          :key="task.id"
          class="relative bg-card rounded-2xl shadow-card hover:shadow-card-hover transition-all duration-200 px-5 pt-[18px] pb-4 overflow-hidden animate-pop"
        >
          <div class="flex items-center gap-4">
            <!-- 直播间封面 + 呼吸点(无封面时回退昵称首字) -->
            <div class="relative shrink-0">
              <img
                v-if="task.thumbUrl"
                :src="task.thumbUrl"
                class="block w-14 h-14 rounded-2xl object-cover"
                referrerpolicy="no-referrer"
              />
              <div
                v-else
                class="w-14 h-14 rounded-2xl grid place-items-center text-[21px] font-bold"
                :class="task.vod ? 'bg-[#f0a020]/10 text-[#d98a08]' : 'bg-live/10 text-live'"
              >
                {{ Array.from(task.nick)[0] }}
              </div>
              <span
                class="absolute -right-[3px] -bottom-[3px] w-3.5 h-3.5 rounded-full ring-[2.5px] ring-card animate-breathe"
                :class="task.vod ? 'bg-[#f0a020]' : 'bg-red-500'"
              ></span>
            </div>
            <!-- 信息列 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-[16px] font-extrabold text-ink1 truncate">{{ task.nick }}</span>
                <span v-if="task.vod" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#f0a020]/[0.14] text-[#d98a08]">{{ t('rec.tagVod') }}</span>
                <span v-else class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-red-500/10 text-red-500">{{ t('rec.tagLive') }}</span>
                <span v-if="task.auto" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-sky-500/10 text-sky-600">{{ t('rec.tagAuto') }}</span>
              </div>
              <div class="text-[12.5px] text-ink2 truncate mt-1" :title="task.title">{{ task.title || '—' }}</div>
              <div class="text-[11px] text-ink3 truncate mt-0.5 font-mono">{{ baseName(task.dirPath) }}/{{ baseName(task.currentFile) || '…' }}</div>
            </div>
            <!-- 指标簇 -->
            <div class="text-right shrink-0 tabular-nums">
              <div class="text-[22px] font-extrabold leading-none" :class="task.vod ? 'text-[#d98a08]' : 'text-red-500'">
                <!-- tick>=0 恒真仅作秒级刷新依赖(prevent 首秒渲染裸 0) -->
                {{ task.vod && task.vodDoneSec ? fmtDurSec(task.vodDoneSec) : tick >= 0 && fmtDur(task.startedAt, null) }}
              </div>
              <div class="text-[10.5px] text-ink3 mt-1">{{ task.vod ? t('rec.durVod') : t('rec.durLive') }}</div>
            </div>
            <div class="text-right shrink-0 tabular-nums">
              <div class="text-[22px] font-extrabold leading-none text-ink1">{{ fmtBytes(task.bytes) }}</div>
              <div class="text-[10.5px] text-ink3 mt-1">{{ task.vod ? t('rec.writtenVod') : t('rec.writtenLive', { n: task.files.length }) }}</div>
            </div>
            <div class="text-right shrink-0 tabular-nums min-w-[76px]">
              <div class="text-[22px] font-extrabold leading-none text-ink1">
                {{ fmtRate(task) }}<span class="text-[11px] font-medium text-ink3 ml-0.5">{{ task.vod ? 'MB/s' : 'Mbps' }}</span>
              </div>
              <div class="text-[10.5px] text-ink3 mt-1">{{ task.vod ? t('rec.rateVod') : t('rec.rateLive') }}</div>
            </div>
            <!-- 操作 -->
            <div class="flex flex-col gap-1.5 shrink-0 ml-2">
              <n-button v-if="task.vod" size="small" type="error" secondary round class="!w-[88px]" @click="stop(task.userId)">{{ t('rec.stopVod') }}</n-button>
              <n-button v-else size="small" type="error" round class="!w-[88px]" @click="stop(task.userId)">{{ t('rec.stop') }}</n-button>
              <n-button size="small" tertiary round class="!w-[88px]" @click="openFolder(task.dirPath)">{{ t('rec.dir') }}</n-button>
            </div>
          </div>
          <!-- 底部进度带 -->
          <div class="flex items-center gap-3.5 mt-3.5 pl-[72px]">
            <div class="flex-1 h-1.5 rounded bg-fill overflow-hidden relative">
              <span
                v-if="!task.vod || vodPct(task) === null"
                class="absolute top-0 bottom-0 w-[40%] rounded bg-gradient-to-r from-transparent to-transparent bar-slide"
                :class="task.vod ? 'via-[#f0a020]' : 'via-live'"
              ></span>
              <span v-else class="absolute left-0 top-0 bottom-0 rounded bg-[#f0a020]" :style="{ width: vodPct(task) + '%' }"></span>
            </div>
            <div class="text-[11px] text-ink3 shrink-0 tabular-nums">
              <template v-if="task.vod">
                <b v-if="vodPct(task) !== null" class="text-ink2 font-semibold">{{ vodPct(task) }}%</b>
                <span v-if="vodPct(task) !== null"> · </span>{{ t('rec.vodCap', { done: fmtDurSec(task.vodDoneSec || 0), total: vodTotalLabel(task) }) }}
              </template>
              <template v-else>
                {{ t('rec.segInfo', { min: splitMin }) }} · <b class="font-semibold" :class="diskLow ? 'text-red-500' : 'text-ink2'">{{ diskCaption }}</b> · {{ t('rec.collecting') }}
              </template>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="rounded-2xl border border-dashed border-line py-10 grid place-items-center bg-card/40">
        <div class="text-center">
          <div class="text-3xl mb-2">🎬</div>
          <p class="text-[13px] text-ink3">{{ t('rec.emptyActive') }}</p>
          <p class="text-[11.5px] text-ink3/70 mt-1">{{ t('rec.emptyActiveHint') }}</p>
        </div>
      </div>

    </div>
  </div>
</template>
