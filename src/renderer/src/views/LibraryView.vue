<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { NEmpty, useMessage } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import CinemaOverlay from '@/components/CinemaOverlay.vue'
import { useI18n } from 'vue-i18n'
import { fmtBytes, fmtDur, isMergedTask, mergeableTask } from '@/utils/media'
import type { RecHistoryItem } from '@shared/types'

const { t, locale } = useI18n()
const store = useAppStore()
const message = useMessage()

const diskFree = ref(0)
onMounted(async () => {
  // 进页先刷新历史: 主进程 ensureThumb 的对账(外部删段/恢复)可能已改 db, 立即反映到卡片
  await store.refreshHistory()
  diskFree.value = await api.recDiskFree()
})

// ---- 九宫格缩略图: 主进程生成并持久化(data/thumbs), 命中直返 + 就绪推送点亮 ----
// requested 置模块级: 重进视频库不再整轮重发 IPC(主进程缓存仍会命中, 但省往返)
const requested = new Set<string>()
const thumbMap = reactive<Record<string, string>>({})
async function ensureThumb(id: string): Promise<void> {
  if (requested.has(id) || thumbMap[id]) return
  requested.add(id)
  try {
    const r = await api.recThumb(id)
    if (r.ok && r.url) thumbMap[id] = r.url
  } catch { /* 缩略图失败用占位底, 不打扰使用 */ }
}
const offRecThumb = api.onRecThumb((p) => {
  thumbMap[p.id] = p.url
})
onUnmounted(offRecThumb)


// ---- 统计 ----
const totalCount = computed(() => store.history.length)
const totalDurSec = computed(() =>
  store.history.reduce((s, h) => s + Math.max(0, Math.floor(((h.endedAt ?? h.startedAt) - h.startedAt) / 1000)), 0)
)
const totalBytes = computed(() => store.history.reduce((s, h) => s + (h.bytes || 0), 0))

// ---- 筛选 + 搜索 + 日期分组 ----
type FilterKey = 'all' | 'live' | 'vod' | 'merged' | 'error'
const filterChip = ref<FilterKey>('all')
const keyword = ref('')
const chips = computed(() => [
  { key: 'all' as const, label: t('rec.fAll') },
  { key: 'live' as const, label: t('rec.fLive') },
  { key: 'vod' as const, label: t('rec.fVod') },
  { key: 'merged' as const, label: t('library.fMerged') },
  { key: 'error' as const, label: t('rec.fErr') }
])

const isMerged = isMergedTask

const filtered = computed(() => {
  let rows = store.history
  const f = filterChip.value
  if (f === 'live') rows = rows.filter((h) => !h.vod)
  else if (f === 'vod') rows = rows.filter((h) => h.vod)
  else if (f === 'error') rows = rows.filter((h) => h.status === 'error')
  else if (f === 'merged') rows = rows.filter(isMerged)
  const k = keyword.value.trim().toLowerCase()
  if (k) rows = rows.filter((h) => h.title.toLowerCase().includes(k) || h.nick.toLowerCase().includes(k) || h.userId.toLowerCase().includes(k))
  return rows
})

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dayLabel(ts: number): string {
  const d = new Date(ts)
  const md = t('rec.dayMd', { m: d.getMonth() + 1, d: d.getDate() })
  const today = new Date()
  if (sameDay(d, today)) return t('rec.dayToday', { md })
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (sameDay(d, y)) return t('rec.dayYest', { md })
  // 跨年: 带上年份, 避免不同年份的同名日期(如 2025/9/3 与 2026/9/3)显示成同一标签
  if (d.getFullYear() !== today.getFullYear()) return t('rec.dayYmd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return md
}
// ---- 分组方式: 按日期 / 按主播 ----
type GroupMode = 'date' | 'anchor'
const groupMode = ref<GroupMode>('date')
const groupModes = computed(() => [
  { key: 'date' as const, label: t('library.groupDate') },
  { key: 'anchor' as const, label: t('library.groupAnchor') }
])

const groups = computed(() => {
  // 统一按开始时间倒序; 分组 key 必须唯一(外层 v-for key 不能重复, 复用 key 会导致 DOM 补丁残留幻影卡)
  const sorted = [...filtered.value].sort((a, b) => b.startedAt - a.startedAt)
  const out: { label: string; key: string; short: string; rows: RecHistoryItem[] }[] = []
  if (groupMode.value === 'anchor') {
    const map = new Map<string, RecHistoryItem[]>()
    for (const h of sorted) {
      const k = h.userId || h.nick
      const arr = map.get(k)
      if (arr) arr.push(h)
      else map.set(k, [h])
    }
    for (const [k, rows] of map) out.push({ label: rows[0].nick, key: k, short: Array.from(rows[0].nick).slice(0, 4).join(''), rows })
    return out
  }
  for (const h of sorted) {
    const label = dayLabel(h.startedAt)
    const g = out[out.length - 1]
    if (g && g.label === label) g.rows.push(h)
    else out.push({ label, key: h.id, short: shortDay(h.startedAt), rows: [h] })
  }
  return out
})

// 可见分组变化时逐条确保缩略图(命中即回, 未命中主进程后台队列生成后推送)
watch(
  groups,
  () => {
    for (const g of groups.value) for (const h of g.rows) void ensureThumb(h.id)
  },
  { immediate: true }
)

// ---- 左侧索引条(快速跳转) ----
function shortDay(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (locale.value === 'zh-CN') {
    if (sameDay(d, today)) return '今'
    const y = new Date(today)
    y.setDate(y.getDate() - 1)
    if (sameDay(d, y)) return '昨'
  }
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  // 跨年索引短标带两位年份(tooltip 有完整标签), 与当年同月日区分
  return d.getFullYear() !== today.getFullYear() ? `${String(d.getFullYear()).slice(2)}/${md}` : md
}

const scrollEl = ref<HTMLElement | null>(null)
const activeGKey = ref('')
const displayActiveKey = computed(() => activeGKey.value || groups.value[0]?.key || '')

function jumpTo(key: string): void {
  const el = scrollEl.value?.querySelector(`[data-gkey="${CSS.escape(key)}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeGKey.value = key
}

const scTop = ref(0)
function toTop(): void {
  scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
  activeGKey.value = groups.value[0]?.key || ''
}

let spyTicking = false
function onIndexScroll(): void {
  if (spyTicking) return
  spyTicking = true
  requestAnimationFrame(() => {
    spyTicking = false
    const root = scrollEl.value
    if (!root) return
    scTop.value = root.scrollTop
    const top = root.getBoundingClientRect().top
    let cur = ''
    root.querySelectorAll('[data-gkey]').forEach((el) => {
      if (el.getBoundingClientRect().top - top <= 90) cur = el.getAttribute('data-gkey') || ''
    })
    if (cur) activeGKey.value = cur
  })
}

// ---- 展示 ----
// 状态文字徽章: 类型/文案/底色(不依赖颜色猜测, 直接文字外露)
const statusBadge: Record<string, { key: string; cls: string }> = {
  recording: { key: 'rec.stRecording', cls: 'bg-red-500/90' },
  remuxing: { key: 'rec.stRemuxing', cls: 'bg-amber-500/90' },
  done: { key: 'rec.stDone', cls: 'bg-emerald-600/90' },
  stopped: { key: 'rec.stStopped', cls: 'bg-black/55' },
  error: { key: 'rec.stError', cls: 'bg-red-600/90' }
}

// ---- 影院浮层 ----
// 任务以 id 引用, 条目变更(删段/合并/对账/删除)即时反映; 条目没了自动关浮层
const cinemaShow = ref(false)
const cinemaTaskId = ref('')
const cinemaTask = computed(() => store.history.find((h) => h.id === cinemaTaskId.value) || null)
const mergingId = ref('')

watch(cinemaTask, (v) => {
  if (cinemaShow.value && !v) cinemaShow.value = false
})

function openCinema(h: RecHistoryItem) {
  const mp4s = (h.files || []).filter((f) => f.toLowerCase().endsWith('.mp4'))
  if (!mp4s.length) {
    message.warning(t('playback.noMp4'))
    return
  }
  cinemaTaskId.value = h.id
  cinemaShow.value = true
}

async function onMerge(task: RecHistoryItem) {
  if (!mergeableTask(task)) {
    message.info(t('rec.mergeNone'))
    return
  }
  if (mergingId.value) return
  mergingId.value = task.id
  try {
    const r = await api.recMerge(task.id)
    if (r.ok) {
      message.success(t('rec.mergeDone'))
      await store.refreshHistory()
    } else {
      message.warning(r.error || t('rec.mergeFail'))
    }
  } finally {
    mergingId.value = ''
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto px-7 pb-6" @scroll="onIndexScroll">
      <!-- 页头 + 统计胶囊 -->
      <div class="flex items-end gap-3.5 pt-5">
        <div class="shrink-0">
          <h1 class="text-[21px] font-extrabold text-ink1 tracking-tight">{{ t('library.title') }}</h1>
        </div>
        <div class="ml-auto flex items-stretch bg-card rounded-xl shadow-card overflow-hidden divide-x divide-line/70">
          <div class="px-4 py-[7px]">
            <div class="text-[10.5px] text-ink3">{{ t('library.total') }}</div>
            <div class="text-[15px] font-bold leading-tight tabular-nums">{{ totalCount }}</div>
          </div>
          <div class="px-4 py-[7px]">
            <div class="text-[10.5px] text-ink3">{{ t('library.totalDur') }}</div>
            <div class="text-[15px] font-bold leading-tight tabular-nums">{{ Math.floor(totalDurSec / 3600) }}h</div>
          </div>
          <div class="px-4 py-[7px]">
            <div class="text-[10.5px] text-ink3">{{ t('library.totalSize') }}</div>
            <div class="text-[15px] font-bold leading-tight tabular-nums">{{ fmtBytes(totalBytes) }}</div>
          </div>
          <div class="px-4 py-[7px]">
            <div class="text-[10.5px] text-ink3">{{ t('rec.ovDisk') }}</div>
            <div class="text-[15px] font-bold leading-tight tabular-nums" :class="diskFree < (store.settings?.diskLimitGb ?? 1) * 2 ? 'text-red-500' : ''">
              {{ diskFree.toFixed(1) }}<span class="text-[11px] font-medium text-ink3 ml-0.5">GB</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 工具行: 筛选 + 搜索 -->
      <div class="flex items-center gap-2.5 mt-4 mb-3">
        <button
          v-for="c in chips"
          :key="c.key"
          class="px-3 py-1 rounded-full text-[12px] transition-colors"
          :class="filterChip === c.key ? 'bg-live/10 text-live font-semibold' : 'text-ink2 hover:text-ink1'"
          @click="filterChip = c.key"
        >{{ c.label }}</button>
        <div class="flex-1"></div>
        <!-- 分组方式切换 -->
        <div class="flex items-center bg-card border border-line rounded-full p-[3px] mr-1.5">
          <button
            v-for="m in groupModes"
            :key="m.key"
            class="px-2.5 py-[3px] rounded-full text-[12px] transition-colors"
            :class="groupMode === m.key ? 'bg-live/10 text-live font-semibold' : 'text-ink3 hover:text-ink1'"
            @click="groupMode = m.key"
          >{{ m.label }}</button>
        </div>
        <input
          v-model="keyword"
          type="text"
          :placeholder="t('library.searchPh')"
          class="w-[180px] h-[30px] px-3 rounded-lg bg-card border border-line text-[12px] text-ink1 placeholder:text-ink3 outline-none focus:border-live transition-colors"
        />
      </div>

      <!-- 海报卡墙 + 左侧索引条 -->
      <div v-if="groups.length" class="flex gap-4 items-start">
        <!-- 索引条: 点击跳转, 滚动跟随高亮 -->
        <aside class="sticky top-1 self-start w-[64px] shrink-0 max-h-[calc(100vh-190px)] -ml-1 flex flex-col">
          <!-- 一键回顶(固定, 不随索引列表滚动) -->
          <button
            class="w-full h-[24px] mb-1 rounded-md grid place-items-center shrink-0 transition-colors"
            :class="scTop > 30 ? 'bg-live/10 text-live hover:bg-live/15' : 'text-ink3/50 hover:text-ink1 hover:bg-fill'"
            :title="t('library.toTop')"
            :aria-label="t('library.toTop')"
            @click="toTop"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M18 15l-6-6-6 6"/></svg>
          </button>
          <div class="h-px bg-line/70 mx-2 mb-1.5 shrink-0"></div>
          <div class="flex-1 min-h-0 overflow-y-auto no-scrollbar py-0.5">
            <button
              v-for="g in groups"
              :key="g.key"
              class="w-full h-[24px] mb-1 rounded-md px-1 grid place-items-center text-[11px] truncate transition-colors"
              :class="displayActiveKey === g.key ? 'bg-live/10 text-live font-bold' : 'text-ink3 hover:text-ink1 hover:bg-fill'"
              :title="g.label"
              @click="jumpTo(g.key)"
            >{{ g.short }}</button>
          </div>
        </aside>
        <div class="flex-1 min-w-0">
          <template v-for="g in groups" :key="g.key">
            <div class="flex items-baseline gap-2 px-0.5 pt-3.5 pb-2 scroll-mt-2" :data-gkey="g.key">
              <span class="text-[11.5px] font-bold" :class="groupMode === 'anchor' ? 'text-ink1' : 'text-ink3'">{{ g.label }}</span>
              <span v-if="groupMode === 'anchor'" class="text-[11px] text-ink3 tabular-nums">{{ t('library.itemsN', { n: g.rows.length }) }}</span>
            </div>
            <div class="grid gap-x-4 gap-y-4 pb-1" style="grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); grid-auto-rows: min-content">
              <div v-for="h in g.rows" :key="h.id" class="group cursor-pointer transition-transform duration-150 hover:-translate-y-0.5" @click="openCinema(h)">
                <!-- 海报 -->
                <div class="relative aspect-video rounded-xl overflow-hidden shadow-card group-hover:shadow-card-hover transition-shadow bg-fill">
                  <img v-if="thumbMap[h.id]" :src="thumbMap[h.id]" class="w-full h-full object-cover" loading="lazy" referrerpolicy="no-referrer" />
                  <div v-else class="w-full h-full grid place-items-center text-[30px] font-extrabold text-white/85" :class="h.vod ? 'bg-gradient-to-br from-[#f0c8a0] to-[#d98a08]' : 'bg-gradient-to-br from-live/70 to-brand-dark/80'">
                    {{ Array.from(h.nick)[0] }}
                  </div>
                  <!-- 左上: 来源类型(直播/回放) -->
                  <span
                    class="absolute left-2 top-2 px-1.5 py-px rounded text-white text-[11px] font-bold"
                    :class="h.vod ? 'bg-[#f0a020]/95' : 'bg-live/95'"
                  >{{ h.vod ? t('account.tagRec') : t('rec.tagLive') }}</span>
                  <!-- 右上: 收尾状态文字 -->
                  <span
                    class="absolute right-2 top-2 px-1.5 py-px rounded text-white text-[11px] font-semibold"
                    :class="statusBadge[h.status]?.cls || 'bg-black/55'"
                  >{{ statusBadge[h.status] ? t(statusBadge[h.status].key) : h.status }}</span>
                  <span v-if="!h.vod" class="absolute left-2 bottom-2 px-1.5 py-px rounded bg-black/60 text-white text-[11px] font-semibold tabular-nums">{{ fmtDur(h.startedAt, h.endedAt) }}</span>
                  <!-- hover 播放罩 -->
                  <div class="absolute inset-0 grid place-items-center bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div class="w-12 h-12 rounded-full bg-live/95 grid place-items-center text-white text-[17px] scale-90 group-hover:scale-100 transition-transform">▶</div>
                  </div>
                </div>
                <div class="mt-2 text-[13px] font-semibold text-ink1 truncate" :title="h.title">{{ h.title || '—' }}</div>
                <div class="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-ink3">
                  <span class="truncate">{{ h.nick }}</span><span>·</span><span class="tabular-nums shrink-0">{{ fmtDur(h.startedAt, h.endedAt) }}</span><span>·</span><span class="tabular-nums shrink-0">{{ fmtBytes(h.bytes) }}</span>
                  <span v-if="h.status === 'error' && h.error" class="text-red-500 truncate">· {{ h.error.slice(0, 30) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="rounded-2xl border border-dashed border-line py-16 grid place-items-center bg-card/40 mt-4">
        <n-empty :description="keyword || filterChip !== 'all' ? t('library.emptyFilter') : t('library.empty')" size="small" class="text-ink3" />
      </div>
    </div>

    <!-- 影院浮层 -->
    <CinemaOverlay v-model:show="cinemaShow" :task="cinemaTask" @merge="onMerge" />
  </div>
</template>
