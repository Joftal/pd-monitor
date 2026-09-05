<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import ExploreCard from '@/components/ExploreCard.vue'
import SpinIcon from '@/components/SpinIcon.vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { NButton, NEmpty, NPagination, useMessage } from 'naive-ui'

const store = useAppStore()
const message = useMessage()
const refreshing = ref(false)

// 排序/筛选/分页态托管在 store(exploreFilter): 视图切换/进出房间返回后保持
const filter = store.exploreFilter

const PAGE_SIZE = 20
const scrollRef = ref<HTMLElement | null>(null)

const sortChips = computed(() => [
  { key: 'viewers', label: t('explore.sortViewers') },
  { key: 'likes', label: t('explore.sortLikes') },
  { key: 'fans', label: t('explore.sortFans') },
  { key: 'recent', label: t('explore.sortRecent') }
] as const)

const keyword = computed(() => store.searchKeyword)

const sortVal = (x: { viewers: number; likes: number; fans: number; startTime: string }, k: string): number | string =>
  k === 'likes' ? x.likes : k === 'fans' ? x.fans : k === 'recent' ? x.startTime : x.viewers

const list = computed(() => {
  let items = [...store.discovery]
  if (filter.onlyFollowed) items = items.filter((x) => store.isFollowing(x.userId))
  if (filter.onlyAdult) items = items.filter((x) => x.isAdult)
  if (filter.onlyFan) items = items.filter((x) => x.type === 'fan')
  items.sort((a, b) => {
    const av = sortVal(a, filter.sortBy)
    const bv = sortVal(b, filter.sortBy)
    return typeof av === 'string' ? String(bv).localeCompare(String(av)) : Number(bv) - Number(av)
  })
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase()
    items = items.filter(
      (x) => x.nick.toLowerCase().includes(k) || x.userId.toLowerCase().includes(k) || x.title.toLowerCase().includes(k)
    )
  }
  return items
})

const pageCount = computed(() => Math.max(1, Math.ceil(list.value.length / PAGE_SIZE)))
const paged = computed(() => list.value.slice((filter.page - 1) * PAGE_SIZE, filter.page * PAGE_SIZE))

watch([keyword, () => filter.sortBy, () => filter.onlyFollowed, () => filter.onlyAdult, () => filter.onlyFan], () => {
  filter.page = 1
})
watch(
  pageCount,
  (n) => {
    if (filter.page > n) filter.page = n
  },
  // 持久化页码挂载即夹紧: 页码存活在 store, 离开期间列表可能收缩(下播/取关致 pageCount 缩水) ——
  // 页数不变时原 watch 不触发, 会卡在"空墙 + 页码 3/2"的死态
  { immediate: true }
)

function toPage(p: number) {
  filter.page = p
  scrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

// ---- 滚动位置保持(与筛选/页码同生命周期; 卡片高由 aspect-video 占位, nextTick 恢复即可) ----
function onListScroll(e: Event): void {
  filter.scrollTop = (e.target as HTMLElement).scrollTop
}

// ---- 刷新信息展示: 上次/预计下次更新时间 ----
const nowTick = ref(Date.now())
let nowTimer: number | null = null
onMounted(async () => {
  nowTimer = window.setInterval(() => (nowTick.value = Date.now()), 1000)
  await nextTick()
  if (scrollRef.value && filter.scrollTop > 0) scrollRef.value.scrollTop = filter.scrollTop
})
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})

function fmtHms(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const updateInfo = computed(() => {
  void nowTick.value
  const w = store.watcher
  const sec = store.settings?.pollIntervalSec ?? 30
  if (w?.circuitOpen) return w.message
  if (!w?.lastRoundAt) return t('explore.autoRefresh', { sec })
  const next = w.lastRoundAt + sec * 1000
  const remain = Math.max(0, Math.ceil((next - Date.now()) / 1000))
  return t('explore.updateInfo', { last: fmtHms(w.lastRoundAt), next: fmtHms(next), remain })
})

async function refresh() {
  refreshing.value = true
  try {
    await api.anchorsRefresh()
    setTimeout(() => (refreshing.value = false), 2500)
  } catch (e) {
    refreshing.value = false
    message.error(String((e as Error).message || e))
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 页头(频道条风) -->
    <div class="px-7 pt-5 pb-3 shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-[20px] font-bold text-ink1 tracking-tight">{{ t('explore.title') }}</h1>
        <span class="inline-flex items-center gap-1.5 h-6 px-2.5 rounded bg-live/10 text-live text-[12px] font-semibold">
          <span class="w-1.5 h-1.5 rounded-full bg-live animate-breathe"></span>
          {{ t('explore.liveBadge', { n: store.watcher?.liveCount ?? store.discovery.length }) }}
        </span>
        <div class="flex-1"></div>
        <span class="text-[12px] text-ink3 shrink-0">{{ updateInfo }}</span>
        <n-button size="small" secondary type="primary" round :disabled="refreshing" @click="refresh" class="!w-[76px]">
          <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="refreshing" :size="12" />{{ t('explore.refresh') }}</span>
        </n-button>
      </div>

      <!-- 排序 + 筛选 chips -->
      <div class="flex items-center gap-x-4 gap-y-2 mt-3.5 flex-wrap">
        <button
          v-for="c in sortChips"
          :key="c.key"
          class="text-[13px] pb-0.5 border-b-2 transition-all shrink-0"
          :class="filter.sortBy === c.key
            ? 'text-live font-semibold border-live'
            : 'text-ink2 border-transparent hover:text-ink1'"
          @click="filter.sortBy = c.key"
        >
          {{ c.label }}
        </button>
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all shrink-0"
          :class="filter.onlyFollowed ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="filter.onlyFollowed = !filter.onlyFollowed"
        >
          {{ t('explore.onlyFollowed') }}
        </button>
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all shrink-0"
          :class="filter.onlyAdult ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="filter.onlyAdult = !filter.onlyAdult"
        >
          {{ t('explore.onlyAdult') }}
        </button>
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all shrink-0"
          :class="filter.onlyFan ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="filter.onlyFan = !filter.onlyFan"
        >
          {{ t('explore.onlyFan') }}
        </button>
        <div class="flex-1"></div>
        <span v-if="keyword" class="text-[12px] text-ink3 shrink-0">{{ t('explore.searchResult', { kw: keyword }) }}</span>
      </div>
    </div>

    <!-- 卡片墙 + 分页 -->
    <div ref="scrollRef" class="flex-1 min-h-0 overflow-y-auto px-7" @scroll.passive="onListScroll">
      <div v-if="paged.length" class="grid gap-x-5 gap-y-6 pb-3 pt-1" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); grid-auto-rows: min-content">
        <ExploreCard v-for="x in paged" :key="x.userId" :item="x" />
      </div>
      <div v-else class="h-full flex items-center justify-center">
        <n-empty
          :description="store.settings?.watchMode === 'per-anchor' ? t('explore.emptyPerAnchor') : t('explore.empty')"
          class="text-ink3"
        >
          <template #icon>
            <svg class="w-14 h-14 text-ink3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 5h18v12H3z M3 21h18 M7 9h6 M7 13h10" />
            </svg>
          </template>
        </n-empty>
      </div>
    </div>

    <!-- 分页条(有数据即常驻, 与已关注页统一) -->
    <div v-if="list.length" class="shrink-0 px-7 py-3 flex items-center gap-3 bg-card border-t border-line">
      <span class="text-[12px] text-ink3">{{ t('explore.pageInfo', { n: list.length, size: PAGE_SIZE }) }}</span>
      <div class="flex-1"></div>
      <n-pagination :page="filter.page" :page-count="pageCount" size="small" @update:page="toPage" />
    </div>
  </div>
</template>
