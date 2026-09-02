<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NEmpty, NTag, useMessage, NPopconfirm } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const message = useMessage()

const diskFree = ref(0)
const tick = ref(0)
let timer: number | null = null

onMounted(async () => {
  timer = window.setInterval(() => tick.value++, 1000)
  diskFree.value = await api.recDiskFree()
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  return Math.max(0, Math.round(n / 1024)) + ' KB'
}
function fmtDur(start: number, end: number | null): string {
  const sec = Math.floor(((end ?? Date.now()) - start) / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
function fmtClock(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function fileOf(dir: string, files: string[]): string {
  return files?.[0] || dir
}

const statusMeta: Record<string, { label: string; cls: string; dot: string }> = {
  recording: { label: '录制中', cls: 'text-red-500 bg-red-500/10', dot: 'bg-red-500 animate-breathe' },
  remuxing: { label: '转码中', cls: 'text-amber-500 bg-amber-500/10', dot: 'bg-amber-500' },
  done: { label: '已完成', cls: 'text-emerald-600 bg-emerald-500/10', dot: 'bg-emerald-500' },
  stopped: { label: '已停止', cls: 'text-ink3 bg-gray-400/10', dot: 'bg-ink3' },
  error: { label: '出错', cls: 'text-red-500 bg-red-500/10', dot: 'bg-red-500' }
}

const active = computed(() => store.activeRecs)
const history = computed(() => store.history)
const activeBytes = computed(() => active.value.reduce((s, t) => s + (t.bytes || 0), 0))

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
    <!-- 页头 -->
    <div class="px-7 pt-5 pb-4 shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-[20px] font-bold text-ink1 tracking-tight">录制管理</h1>
        <span class="text-[13px] text-ink3 mt-0.5">ffmpeg 内核 · TS 分段 · 自动转 MP4</span>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-6 space-y-5">
      <!-- 统计条 -->
      <div class="grid grid-cols-4 gap-4">
        <div class="rounded-2xl bg-white border border-line shadow-card px-5 py-4">
          <div class="text-[11.5px] text-ink3 font-medium">进行中</div>
          <div class="text-[24px] font-bold mt-1" :class="active.length ? 'text-red-500' : 'text-ink1'">{{ active.length }}<span class="text-[13px] font-normal text-ink3 ml-1">路</span></div>
        </div>
        <div class="rounded-2xl bg-white border border-line shadow-card px-5 py-4">
          <div class="text-[11.5px] text-ink3 font-medium">当前已录</div>
          <div class="text-[24px] font-bold mt-1 text-ink1 tabular-nums">{{ fmtBytes(activeBytes) }}</div>
        </div>
        <div class="rounded-2xl bg-white border border-line shadow-card px-5 py-4">
          <div class="text-[11.5px] text-ink3 font-medium">历史任务</div>
          <div class="text-[24px] font-bold mt-1 text-ink1 tabular-nums">{{ history.length }}<span class="text-[13px] font-normal text-ink3 ml-1">条</span></div>
        </div>
        <div class="rounded-2xl bg-white border border-line shadow-card px-5 py-4">
          <div class="text-[11.5px] text-ink3 font-medium">磁盘剩余</div>
          <div class="text-[24px] font-bold mt-1 tabular-nums" :class="diskFree < (store.settings?.diskLimitGb ?? 1) * 2 ? 'text-red-500' : 'text-ink1'">{{ diskFree.toFixed(1) }}<span class="text-[13px] font-normal text-ink3 ml-1">GB</span></div>
        </div>
      </div>

      <!-- 进行中 -->
      <section>
        <h2 class="text-[14px] font-bold text-ink1 mb-3 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-breathe"></span>进行中
        </h2>
        <div v-if="active.length" class="space-y-3">
          <div
            v-for="t in active"
            :key="t.id"
            class="rounded-2xl bg-white border border-line shadow-card px-5 py-4 flex items-center gap-5 animate-pop"
          >
            <!-- 状态灯 + 头像字母 -->
            <div class="relative shrink-0">
              <div class="w-11 h-11 rounded-xl bg-red-500/10 grid place-items-center text-red-500 text-[17px] font-bold">
                {{ t.nick.slice(0, 1) }}
              </div>
              <span class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white" :class="statusMeta[t.status]?.dot"></span>
            </div>

            <!-- 信息 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-[14.5px] font-bold text-ink1 truncate">{{ t.nick }}</span>
                <n-tag size="tiny" :bordered="false" :type="t.status === 'recording' ? 'error' : t.status === 'remuxing' ? 'warning' : 'default'">{{ statusMeta[t.status]?.label }}</n-tag>
                <n-tag v-if="t.auto" size="tiny" :bordered="false" type="info">自动</n-tag>
              </div>
              <div class="text-[12px] text-ink3 truncate mt-1">{{ t.title || '—' }}</div>
              <div class="text-[11px] text-ink3/80 truncate mt-0.5 font-mono">{{ t.dirPath }}</div>
            </div>

            <!-- 指标 -->
            <div class="text-right shrink-0 tabular-nums">
              <div class="text-[18px] font-bold text-ink1">{{ tick && fmtDur(t.startedAt, null) }}</div>
              <div class="text-[12px] text-ink3 mt-0.5">{{ fmtBytes(t.bytes) }} · {{ t.files.length }} 段</div>
            </div>

            <!-- 操作 -->
            <div class="flex flex-col gap-1.5 shrink-0">
              <n-button size="small" type="error" secondary round @click="stop(t.userId)" class="!w-[76px]">停止</n-button>
              <n-button size="small" tertiary round @click="openFolder(t.dirPath)" class="!w-[76px]">目录</n-button>
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
      </section>

      <!-- 历史记录 -->
      <section>
        <div class="flex items-center mb-3">
          <h2 class="text-[14px] font-bold text-ink1">历史记录</h2>
          <div class="flex-1"></div>
          <n-popconfirm @positive-click="clearHistory" v-if="history.length">
            <template #trigger>
              <n-button size="tiny" tertiary round>清空历史</n-button>
            </template>
            确定清空全部历史记录? (不会删除文件)
          </n-popconfirm>
        </div>
        <div v-if="history.length" class="rounded-2xl bg-white border border-line shadow-card overflow-hidden">
          <table class="w-full text-[12.5px]">
            <thead>
              <tr class="text-ink3 text-left bg-gray-50/80 border-b border-line/70">
                <th class="px-5 py-3 font-medium">主播</th>
                <th class="px-4 py-3 font-medium">标题</th>
                <th class="px-4 py-3 font-medium">开始</th>
                <th class="px-4 py-3 font-medium text-right">时长</th>
                <th class="px-4 py-3 font-medium text-right">大小</th>
                <th class="px-4 py-3 font-medium text-center">状态</th>
                <th class="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in history" :key="h.id" class="border-b border-line/50 last:border-0 hover:bg-gray-50/70 transition-colors">
                <td class="px-5 py-3">
                  <div class="text-ink1 font-semibold truncate max-w-[140px]">{{ h.nick }}</div>
                  <div class="text-[11px] text-ink3 truncate">@{{ h.userId }}</div>
                </td>
                <td class="px-4 py-3 text-ink2 max-w-[240px] truncate" :title="h.title">{{ h.title || '—' }}</td>
                <td class="px-4 py-3 text-ink3 tabular-nums">{{ fmtClock(h.startedAt) }}</td>
                <td class="px-4 py-3 text-ink1 text-right tabular-nums">{{ fmtDur(h.startedAt, h.endedAt) }}</td>
                <td class="px-4 py-3 text-ink1 text-right tabular-nums">{{ fmtBytes(h.bytes) }}</td>
                <td class="px-4 py-3 text-center">
                  <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11.5px] font-medium" :class="statusMeta[h.status]?.cls">
                    <span class="w-1.5 h-1.5 rounded-full" :class="statusMeta[h.status]?.dot"></span>
                    {{ statusMeta[h.status]?.label }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <n-button size="tiny" tertiary round @click="openFolder(fileOf(h.dirPath, h.files))" v-if="h.dirPath">打开</n-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="rounded-2xl border border-dashed border-line py-8 grid place-items-center bg-white/40">
          <n-empty description="暂无历史记录" size="small" class="text-ink3" />
        </div>
      </section>
    </div>
  </div>
</template>
