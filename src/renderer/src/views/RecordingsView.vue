<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { NButton, NEmpty, NTag, useMessage, NPopconfirm } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const message = useMessage()

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
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const statusMeta: Record<string, { label: string; type: 'success' | 'info' | 'warning' | 'error' | 'default' }> = {
  recording: { label: '录制中', type: 'error' },
  remuxing: { label: '转码中', type: 'warning' },
  done: { label: '已完成', type: 'success' },
  stopped: { label: '已停止', type: 'default' },
  error: { label: '出错', type: 'error' }
}

const active = computed(() => store.activeRecs)
const history = computed(() => store.history)

const tick = ref(0)
onMounted(() => setInterval(() => tick.value++, 1000))

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
    <div class="px-7 pt-6 pb-4 shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-[22px] font-bold text-gray-900 tracking-tight">录制管理</h1>
        <span class="text-[13px] text-gray-400 mt-1">{{ active.length }} 个进行中 · {{ history.length }} 条历史</span>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-7 space-y-6">
      <!-- 进行中 -->
      <section>
        <h2 class="text-[13px] font-semibold text-gray-500 mb-3">进行中</h2>
        <div v-if="active.length" class="space-y-3">
          <div
            v-for="t in active"
            :key="t.id"
            class="rounded-2xl bg-white border border-red-200 shadow-card p-4 flex items-center gap-4 animate-pop"
          >
            <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-breathe shrink-0"></span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-[14px] font-bold text-gray-900">{{ t.nick }}</span>
                <n-tag size="tiny" :bordered="false" :type="statusMeta[t.status]?.type">{{ statusMeta[t.status]?.label }}</n-tag>
                <n-tag v-if="t.auto" size="tiny" :bordered="false" type="info">自动</n-tag>
              </div>
              <div class="text-[12px] text-gray-500 truncate mt-1">{{ t.title || '—' }}</div>
              <div class="text-[11.5px] text-gray-400 truncate mt-0.5">{{ t.dirPath }}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-[15px] font-bold text-gray-900 tabular-nums">{{ tick && fmtDur(t.startedAt, null) }}</div>
              <div class="text-[12px] text-gray-500 tabular-nums">{{ fmtBytes(t.bytes) }} · {{ t.files.length }} 段</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <n-button size="small" secondary round @click="openFolder(t.dirPath)">目录</n-button>
              <n-button size="small" type="error" round @click="stop(t.userId)">停止</n-button>
            </div>
          </div>
        </div>
        <div v-else class="rounded-2xl border border-dashed border-gray-300 py-8 grid place-items-center text-[12.5px] text-gray-400 bg-white/50">
          暂无进行中的录制
        </div>
      </section>

      <!-- 历史 -->
      <section>
        <div class="flex items-center mb-3">
          <h2 class="text-[13px] font-semibold text-gray-500">历史记录</h2>
          <div class="flex-1"></div>
          <n-popconfirm @positive-click="clearHistory" v-if="history.length">
            <template #trigger>
              <n-button size="tiny" tertiary round>清空历史</n-button>
            </template>
            确定清空全部历史记录? (不会删除文件)
          </n-popconfirm>
        </div>
        <div v-if="history.length" class="rounded-2xl bg-white border border-gray-200/70 shadow-card overflow-hidden">
          <table class="w-full text-[12.5px]">
            <thead>
              <tr class="text-gray-400 text-left bg-gray-50/80 border-b border-gray-100">
                <th class="px-4 py-2.5 font-medium">主播</th>
                <th class="px-4 py-2.5 font-medium">标题</th>
                <th class="px-4 py-2.5 font-medium">开始</th>
                <th class="px-4 py-2.5 font-medium">时长</th>
                <th class="px-4 py-2.5 font-medium">大小</th>
                <th class="px-4 py-2.5 font-medium">状态</th>
                <th class="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in history" :key="h.id" class="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                <td class="px-4 py-2.5 text-gray-800 font-medium">{{ h.nick }}</td>
                <td class="px-4 py-2.5 text-gray-500 max-w-[220px] truncate" :title="h.title">{{ h.title || '—' }}</td>
                <td class="px-4 py-2.5 text-gray-500">{{ fmtTime(h.startedAt) }}</td>
                <td class="px-4 py-2.5 text-gray-600 tabular-nums">{{ fmtDur(h.startedAt, h.endedAt) }}</td>
                <td class="px-4 py-2.5 text-gray-600">{{ fmtBytes(h.bytes) }}</td>
                <td class="px-4 py-2.5"><n-tag size="tiny" :bordered="false" :type="statusMeta[h.status]?.type">{{ statusMeta[h.status]?.label }}</n-tag></td>
                <td class="px-4 py-2.5">
                  <n-button size="tiny" tertiary round @click="openFolder(h.dirPath)" v-if="h.dirPath">打开</n-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="rounded-2xl border border-dashed border-gray-300 py-8 grid place-items-center bg-white/50">
          <n-empty description="暂无历史记录" size="small" class="text-gray-400" />
        </div>
      </section>
    </div>
  </div>
</template>
