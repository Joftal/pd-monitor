<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NEmpty, NTag, useMessage, NPopconfirm, NTooltip } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import LocalPlayerModal from '@/components/LocalPlayerModal.vue'
import type { RecHistoryItem, RecTask } from '@shared/types'

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
    for (const t of list) {
      const p = prevSnap[t.userId]
      if (p && now > p.at) {
        out[t.userId] = Math.max(0, (t.bytes - p.bytes) / ((now - p.at) / 1000))
      }
      next[t.userId] = { bytes: t.bytes, at: now }
    }
    prevSnap = next
    rates.value = out
  }
)
/** 直播录制 → Mbps; 回放下载 → MB/s */
function fmtRate(t: RecTask): string {
  const v = rates.value[t.userId]
  if (v === undefined) return '—'
  return t.vod ? `${(v / 1048576).toFixed(1)}` : `${((v * 8) / 1e6).toFixed(1)}`
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(0, Math.round(n / 1024)) + ' KB'
}
function fmtDur(start: number, end: number | null): string {
  return fmtDurSec(Math.floor(((end ?? Date.now()) - start) / 1000))
}
function fmtDurSec(sec: number): string {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
function fmtClock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
function fname(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

// ---- 应用内回看 / 手动合并 ----
const showPlayer = ref(false)
const playTask = ref<RecHistoryItem | null>(null)
const mergingId = ref('')

function mp4sOf(h: RecHistoryItem): string[] {
  return (h.files || []).filter((f) => f.toLowerCase().endsWith('.mp4'))
}
function playable(h: RecHistoryItem): boolean {
  return mp4sOf(h).length > 0
}
/** 可手动合并: 分段(MP4≥2 或 TS≥2) 且不存已合并整文件 */
function mergeable(h: RecHistoryItem): boolean {
  const mp4s = mp4sOf(h)
  const tss = (h.files || []).filter((f) => f.toLowerCase().endsWith('.ts'))
  const segs = mp4s.length >= 2 ? mp4s : tss
  if (segs.length < 2) return false
  const base = fname(segs[0]).replace(/_(\d{4}|vod)\.(mp4|ts)$/i, '')
  return !mp4s.some((f) => fname(f).toLowerCase() === `${base}.mp4`.toLowerCase())
}
/** 「单文件」= 真·合并产物: 恰好 1 个 MP4 且文件名不带分段尾缀(_0001/_vod)
 *  —— 短录制天然只有 _0001.mp4 时不得误标 */
function isSingleFile(h: RecHistoryItem): boolean {
  const mp4s = mp4sOf(h)
  if (h.vod || mp4s.length !== 1 || (h.files || []).length !== 1) return false
  return !/_(\d{4}|vod)\.mp4$/i.test(fname(mp4s[0]))
}

function play(h: RecHistoryItem) {
  playTask.value = h
  showPlayer.value = true
}

async function merge(h: RecHistoryItem) {
  if (mergingId.value) return
  mergingId.value = h.id
  try {
    const r = await api.recMerge(h.id)
    if (r.ok) {
      message.success('合并完成')
      await store.refreshHistory()
    } else {
      message.warning(r.error || '合并失败')
    }
  } finally {
    mergingId.value = ''
  }
}

// ---- 概览 ----
const active = computed(() => store.activeRecs)
const activeBytes = computed(() => active.value.reduce((s, t) => s + (t.bytes || 0), 0))
const diskLow = computed(() => diskFree.value < (store.settings?.diskLimitGb ?? 1) * 2)
const diskCaption = computed(() => {
  const limit = store.settings?.diskLimitGb ?? 1
  if (diskFree.value < limit) return '磁盘告急, 已开始拒绝新录制'
  return diskLow.value ? '磁盘偏低, 接近阈值' : '磁盘充足'
})
const splitMin = computed(() => Math.round((store.settings?.splitSeconds ?? 900) / 60))

// ---- VOD 进度 ----
function vodPct(t: RecTask): number | null {
  if (!t.vodTotalSec || !t.vodDoneSec) return null
  return Math.min(100, Math.floor((100 * t.vodDoneSec) / t.vodTotalSec))
}
function vodTotalLabel(t: RecTask): string {
  if (!t.vodTotalSec) return ''
  return t.vodTotalSec < 3600 ? `~${Math.round(t.vodTotalSec / 60)} 分钟` : `~${fmtDurSec(t.vodTotalSec)}`
}

// ---- 历史: 筛选 + 日期分组 ----
type FilterKey = 'all' | 'live' | 'vod' | 'error'
const filterChip = ref<FilterKey>('all')
const chips: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '直播录制' },
  { key: 'vod', label: '回放下载' },
  { key: 'error', label: '出错' }
]

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dayLabel(ts: number): string {
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  const today = new Date()
  if (sameDay(d, today)) return `今天 · ${md}`
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (sameDay(d, y)) return `昨天 · ${md}`
  return md
}
const histGroups = computed(() => {
  const f = filterChip.value
  let rows = store.history
  if (f === 'live') rows = rows.filter((h) => !h.vod)
  else if (f === 'vod') rows = rows.filter((h) => h.vod)
  else if (f === 'error') rows = rows.filter((h) => h.status === 'error')
  // history 本就新→旧, 相邻同日期聚合即可
  const groups: { label: string; rows: RecHistoryItem[] }[] = []
  for (const h of rows) {
    const label = dayLabel(h.startedAt)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.rows.push(h)
    else groups.push({ label, rows: [h] })
  }
  return groups
})
/** 平均码率(Mbps) */
function avgMbps(h: RecHistoryItem): string {
  const sec = Math.max(1, Math.floor(((h.endedAt ?? h.startedAt) - h.startedAt) / 1000))
  return ((h.bytes * 8) / 1e6 / sec).toFixed(1)
}

const statusMeta: Record<string, { label: string; cls: string; dot: string }> = {
  recording: { label: '录制中', cls: 'text-red-500 bg-red-500/10', dot: 'bg-red-500 animate-breathe' },
  remuxing: { label: '转码中', cls: 'text-amber-500 bg-amber-500/10', dot: 'bg-amber-500' },
  done: { label: '已完成', cls: 'text-emerald-600 bg-emerald-500/10', dot: 'bg-emerald-500' },
  stopped: { label: '已停止', cls: 'text-ink3 bg-gray-400/10', dot: 'bg-ink3' },
  error: { label: '出错', cls: 'text-red-500 bg-red-500/10', dot: 'bg-red-500' }
}

async function stop(userId: string) {
  await api.recStop(userId)
  message.success('已停止')
}
async function openFolder(dir: string) {
  await api.recOpenFolder(dir)
}
async function clearHistory() {
  await api.recClearHistory()
  await store.refreshHistory()
  message.success('历史已清空')
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
      <!-- ① 页头 + 概览条 -->
      <div class="flex items-end gap-4 pt-5">
        <div class="shrink-0">
          <h1 class="text-[21px] font-extrabold text-ink1 tracking-tight">录制</h1>
          <div class="text-[12px] text-ink3 mt-0.5">ffmpeg 内核 · TS 分段无损收集 · 收尾自动 remux / 合并 MP4</div>
        </div>
        <div class="ml-auto flex items-stretch bg-white border border-line rounded-2xl shadow-card overflow-hidden divide-x divide-line/70">
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3 flex items-center gap-1.5">
              <span class="w-[7px] h-[7px] rounded-full bg-red-500" :class="active.length ? 'animate-breathe' : ''"></span>进行中
            </div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums" :class="active.length ? 'text-red-500' : 'text-ink1'">
              {{ active.length }}<span class="text-[11px] font-medium text-ink3 ml-1">路</span>
            </div>
          </div>
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3">本次已录</div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums text-ink1">{{ tick && fmtBytes(activeBytes) }}</div>
          </div>
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3">磁盘可用</div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums" :class="diskLow ? 'text-red-500' : 'text-ink1'">
              {{ diskFree.toFixed(1) }}<span class="text-[11px] font-medium text-ink3 ml-1">GB</span>
            </div>
          </div>
          <div class="px-5 py-2 min-w-[100px]">
            <div class="text-[11px] text-ink3">历史任务</div>
            <div class="text-[19px] font-extrabold leading-tight tabular-nums text-ink1">{{ store.history.length }}<span class="text-[11px] font-medium text-ink3 ml-1">条</span></div>
          </div>
        </div>
      </div>

      <!-- ② 进行中 · 大卡片 -->
      <div class="flex items-center gap-2 mt-6 mb-3 px-0.5">
        <h2 class="text-[14.5px] font-extrabold text-ink1 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500" :class="active.length ? 'animate-breathe' : ''"></span>进行中
          <span class="text-[11.5px] font-medium text-ink3">{{ active.length }} 个任务</span>
        </h2>
        <span class="ml-auto text-[11.5px] text-ink3">指标每 2 秒刷新 · 码率为实时差分</span>
      </div>

      <div v-if="active.length" class="space-y-3.5">
        <div
          v-for="t in active"
          :key="t.id"
          class="relative bg-white border border-line rounded-2xl shadow-card hover:shadow-card-hover transition-all duration-200 px-5 pt-[18px] pb-4 overflow-hidden animate-pop"
        >
          <div class="flex items-center gap-4">
            <!-- 直播间封面 + 呼吸点(无封面时回退昵称首字) -->
            <div class="relative shrink-0">
              <img
                v-if="t.thumbUrl"
                :src="t.thumbUrl"
                class="block w-14 h-14 rounded-2xl object-cover"
                referrerpolicy="no-referrer"
              />
              <div
                v-else
                class="w-14 h-14 rounded-2xl grid place-items-center text-[21px] font-bold"
                :class="t.vod ? 'bg-[#f0a020]/10 text-[#d98a08]' : 'bg-live/10 text-live'"
              >
                {{ t.nick.slice(0, 1) }}
              </div>
              <span
                class="absolute -right-[3px] -bottom-[3px] w-3.5 h-3.5 rounded-full ring-[2.5px] ring-white animate-breathe"
                :class="t.vod ? 'bg-[#f0a020]' : 'bg-red-500'"
              ></span>
            </div>
            <!-- 信息列 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-[16px] font-extrabold text-ink1 truncate">{{ t.nick }}</span>
                <n-tag v-if="t.vod" size="tiny" :bordered="false" type="warning">回放</n-tag>
                <n-tag v-else size="tiny" :bordered="false" type="error">直播</n-tag>
                <n-tag v-if="t.auto" size="tiny" :bordered="false" type="info">自动</n-tag>
              </div>
              <div class="text-[12.5px] text-ink2 truncate mt-1" :title="t.title">{{ t.title || '—' }}</div>
              <div class="text-[11px] text-ink3 truncate mt-0.5 font-mono">{{ fname(t.dirPath) }}/{{ fname(t.currentFile) || '…' }}</div>
            </div>
            <!-- 指标簇 -->
            <div class="text-right shrink-0 tabular-nums">
              <div class="text-[22px] font-extrabold leading-none" :class="t.vod ? 'text-[#d98a08]' : 'text-red-500'">
                {{ t.vod && t.vodDoneSec ? fmtDurSec(t.vodDoneSec) : tick && fmtDur(t.startedAt, null) }}
              </div>
              <div class="text-[10.5px] text-ink3 mt-1">{{ t.vod ? '已下载时长' : '已录时长' }}</div>
            </div>
            <div class="text-right shrink-0 tabular-nums">
              <div class="text-[22px] font-extrabold leading-none text-ink1">{{ tick && fmtBytes(t.bytes) }}</div>
              <div class="text-[10.5px] text-ink3 mt-1">已写入 · {{ t.vod ? '单文件' : `${t.files.length} 段` }}</div>
            </div>
            <div class="text-right shrink-0 tabular-nums min-w-[76px]">
              <div class="text-[22px] font-extrabold leading-none text-ink1">
                {{ tick && fmtRate(t) }}<span class="text-[11px] font-medium text-ink3 ml-0.5">{{ t.vod ? 'MB/s' : 'Mbps' }}</span>
              </div>
              <div class="text-[10.5px] text-ink3 mt-1">{{ t.vod ? '下载速度' : '实时码率' }}</div>
            </div>
            <!-- 操作 -->
            <div class="flex flex-col gap-1.5 shrink-0 ml-2">
              <n-button v-if="t.vod" size="small" type="error" secondary round class="!w-[88px]" @click="stop(t.userId)">■ 取消下载</n-button>
              <n-button v-else size="small" type="error" round class="!w-[88px]" @click="stop(t.userId)">■ 停止</n-button>
              <n-button size="small" tertiary round class="!w-[88px]" @click="openFolder(t.dirPath)">目录</n-button>
            </div>
          </div>
          <!-- 底部进度带 -->
          <div class="flex items-center gap-3.5 mt-3.5 pl-[72px]">
            <div class="flex-1 h-1.5 rounded bg-gray-100 overflow-hidden relative">
              <span
                v-if="!t.vod || vodPct(t) === null"
                class="absolute top-0 bottom-0 w-[40%] rounded bg-gradient-to-r from-transparent to-transparent bar-slide"
                :class="t.vod ? 'via-[#f0a020]' : 'via-live'"
              ></span>
              <span v-else class="absolute left-0 top-0 bottom-0 rounded bg-[#f0a020]" :style="{ width: vodPct(t) + '%' }"></span>
            </div>
            <div class="text-[11px] text-ink3 shrink-0 tabular-nums">
              <template v-if="t.vod">
                <b v-if="vodPct(t) !== null" class="text-ink2 font-semibold">{{ vodPct(t) }}%</b>
                <span v-if="vodPct(t) !== null"> · </span>已下载 {{ fmtDurSec(t.vodDoneSec || 0) }}<template v-if="vodTotalLabel(t)"> / 估算全长 {{ vodTotalLabel(t) }}</template>
              </template>
              <template v-else>
                分段 {{ splitMin }} 分钟/段 · <b class="font-semibold" :class="diskLow ? 'text-red-500' : 'text-ink2'">{{ diskCaption }}</b> · 收集中
              </template>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="rounded-2xl border border-dashed border-line py-10 grid place-items-center bg-white/40">
        <div class="text-center">
          <div class="text-3xl mb-2">🎬</div>
          <p class="text-[13px] text-ink3">暂无进行中的录制</p>
          <p class="text-[11.5px] text-ink3/70 mt-1">到直播大厅点 ⏺ 开始录制, 或在已关注里开启"开播自动录制"</p>
        </div>
      </div>

      <!-- ③ 历史记录 -->
      <div class="flex items-center gap-2 mt-7 mb-3 px-0.5">
        <h2 class="text-[14.5px] font-extrabold text-ink1">
          历史记录
          <span class="text-[11.5px] font-medium text-ink3 ml-1">{{ store.history.length }} 条 · 上限 500</span>
        </h2>
        <div class="ml-auto flex items-center gap-2">
          <button
            v-for="c in chips"
            :key="c.key"
            class="px-3 py-1 rounded-full text-[12px] transition-colors"
            :class="filterChip === c.key ? 'bg-live/10 text-live font-semibold' : 'text-ink2 hover:text-ink1'"
            @click="filterChip = c.key"
          >{{ c.label }}</button>
          <n-popconfirm @positive-click="clearHistory" v-if="store.history.length">
            <template #trigger>
              <n-button size="tiny" tertiary round>清空</n-button>
            </template>
            确定清空全部历史记录? (不会删除文件)
          </n-popconfirm>
        </div>
      </div>

      <div v-if="histGroups.length" class="bg-white border border-line rounded-2xl shadow-card overflow-hidden">
        <template v-for="g in histGroups" :key="g.label">
          <div class="px-5 pt-3 pb-1.5 text-[11.5px] font-bold text-ink3 border-t border-line/60 first:border-t-0 bg-gray-50/50">{{ g.label }}</div>
          <div
            v-for="h in g.rows"
            :key="h.id"
            class="flex items-center gap-3.5 px-5 py-2.5 border-t border-line/60 hover:bg-gray-50/70 transition-colors"
          >
            <span class="w-2 h-2 rounded-full shrink-0" :class="statusMeta[h.status]?.dot"></span>
            <div class="flex-1 min-w-0">
              <div class="text-[13.5px] font-semibold text-ink1 truncate" :title="h.title">
                {{ h.title || '—' }}
                <n-tag v-if="h.vod" size="tiny" :bordered="false" type="warning" class="ml-1">回放</n-tag>
                <n-tag v-if="isSingleFile(h)" size="tiny" :bordered="false" type="error" class="ml-1">单文件</n-tag>
              </div>
              <div v-if="h.status === 'error' && h.error" class="text-[11.5px] text-red-500 truncate mt-0.5" :title="h.error">
                出错: {{ h.error }} · {{ fmtClock(h.startedAt) }} 开始
              </div>
              <div v-else class="text-[11.5px] text-ink3 truncate mt-0.5">
                {{ h.nick }} · @{{ h.userId }} · {{ fmtClock(h.startedAt) }} 开始<span v-if="h.status === 'stopped'"> · 手动停止</span><span v-else-if="h.status === 'done'"> · 正常收播</span>
              </div>
            </div>
            <div class="w-[72px] text-right shrink-0 tabular-nums">
              <div class="text-[13px] font-bold text-ink1">{{ fmtDur(h.startedAt, h.endedAt) }}</div>
              <div class="text-[10.5px] text-ink3">时长</div>
            </div>
            <div class="w-[92px] text-right shrink-0 tabular-nums">
              <div class="text-[13px] font-bold text-ink1">{{ fmtBytes(h.bytes) }}</div>
              <div class="text-[10.5px] text-ink3">{{ avgMbps(h) }} Mbps</div>
            </div>
            <div class="w-[56px] text-right shrink-0 tabular-nums">
              <div class="text-[13px] font-bold text-ink1">{{ h.files?.length || 0 }} 个</div>
              <div class="text-[10.5px] text-ink3">{{ isSingleFile(h) || h.vod ? '文件' : '分段' }}</div>
            </div>
            <div class="w-[62px] text-center shrink-0">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold" :class="statusMeta[h.status]?.cls">
                {{ statusMeta[h.status]?.label }}
              </span>
            </div>
            <div class="w-[92px] shrink-0 flex justify-end gap-0.5">
              <n-tooltip v-if="playable(h)" trigger="hover" :delay="300"><template #trigger>
                <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:bg-gray-100 hover:text-live transition-colors" @click="play(h)">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
                </button>
              </template>应用内播放</n-tooltip>
              <n-tooltip v-if="mergeable(h)" trigger="hover" :delay="300"><template #trigger>
                <button
                  class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:bg-gray-100 hover:text-ink1 transition-colors"
                  :class="mergingId === h.id ? 'opacity-40 pointer-events-none' : ''"
                  @click="merge(h)"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg>
                </button>
              </template>合并分段为单文件</n-tooltip>
              <n-tooltip trigger="hover" :delay="300"><template #trigger>
                <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:bg-gray-100 hover:text-ink1 transition-colors" @click="openFolder(h.dirPath)" v-if="h.dirPath">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                </button>
              </template>打开目录</n-tooltip>
            </div>
          </div>
        </template>
      </div>
      <div v-else class="rounded-2xl border border-dashed border-line py-8 grid place-items-center bg-white/40">
        <n-empty :description="filterChip === 'all' ? '暂无历史记录' : '没有匹配的历史记录'" size="small" class="text-ink3" />
      </div>
    </div>

    <!-- 应用内回看弹窗 -->
    <LocalPlayerModal v-model:show="showPlayer" :task="playTask" />
  </div>
</template>
