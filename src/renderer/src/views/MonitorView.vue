<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import AnchorCard from '@/components/AnchorCard.vue'
import { NButton, NInput, NModal, NPagination, useMessage, NEmpty, NSwitch } from 'naive-ui'

const store = useAppStore()
const message = useMessage()
const router = useRouter()

const showAdd = ref(false)
const addInput = ref('')
const addLoading = ref(false)
const keyword = ref('')
const activeTab = ref<'live' | 'offline'>('live')

// ---- 分页(与大厅统一: 每页 20) ----
const PAGE_SIZE = 20
const livePage = ref(1)
const offPage = ref(1)
watch(keyword, () => {
  livePage.value = 1
  offPage.value = 1
})

const liveList = computed(() => {
  let list = [...store.liveAnchors].sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0))
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase()
    list = list.filter((a) => a.nick.toLowerCase().includes(k) || a.userId.toLowerCase().includes(k))
  }
  return list
})

const offlineList = computed(() => {
  let list = [...store.offlineAnchors].sort((a, b) => (b.lastSeenAt || b.addedAt) - (a.lastSeenAt || a.addedAt))
  if (keyword.value.trim()) {
    const k = keyword.value.trim().toLowerCase()
    list = list.filter((a) => a.nick.toLowerCase().includes(k) || a.userId.toLowerCase().includes(k))
  }
  return list
})

const livePageCount = computed(() => Math.max(1, Math.ceil(liveList.value.length / PAGE_SIZE)))
const offPageCount = computed(() => Math.max(1, Math.ceil(offlineList.value.length / PAGE_SIZE)))
const livePaged = computed(() => liveList.value.slice((livePage.value - 1) * PAGE_SIZE, livePage.value * PAGE_SIZE))
const offPaged = computed(() => offlineList.value.slice((offPage.value - 1) * PAGE_SIZE, offPage.value * PAGE_SIZE))
watch([livePageCount, offPageCount], () => {
  if (livePage.value > livePageCount.value) livePage.value = livePageCount.value
  if (offPage.value > offPageCount.value) offPage.value = offPageCount.value
})

// 开播时自动跳到直播中 tab
watch(
  () => store.liveAnchors.length,
  (n, o) => {
    if (n > o) activeTab.value = 'live'
  }
)

const activeList = computed(() => (activeTab.value === 'live' ? liveList.value : offlineList.value))

async function addAnchor() {
  if (!addInput.value.trim()) return
  addLoading.value = true
  try {
    const a = await api.anchorsAdd(addInput.value.trim())
    message.success(`已关注: ${a.nick}`)
    addInput.value = ''
    showAdd.value = false
    store.anchors = await api.anchorsList()
  } catch (e) {
    message.error((e as Error).message.replace(/^.*Error: /, '') || '添加失败')
  } finally {
    addLoading.value = false
  }
}

async function removeAnchor(userId: string) {
  await api.anchorsRemove(userId)
  message.success('已取消关注')
}

async function setAuto(userId: string, v: boolean) {
  await api.anchorsSetAuto(userId, v)
  store.anchors = await api.anchorsList()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 页头 -->
    <div class="px-7 pt-5 pb-3 shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-[20px] font-bold text-ink1 tracking-tight">已关注</h1>
        <span class="text-[13px] text-ink3 mt-0.5">{{ store.anchors.length }} 位主播 · {{ store.liveAnchors.length }} 位直播中</span>
        <div class="flex-1"></div>
        <n-input v-model:value="keyword" size="small" placeholder="搜索关注的主播…" clearable class="!w-44" />
        <n-button size="medium" type="primary" round @click="showAdd = true">+ 关注主播</n-button>
      </div>

      <!-- Tab 切换(与大厅排序同款的下划线 tab) -->
      <div class="flex items-center gap-4 mt-3.5">
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all flex items-center gap-1.5"
          :class="activeTab === 'live' ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="activeTab = 'live'"
        >
          <span class="w-2 h-2 rounded-full bg-live" :class="store.liveAnchors.length ? 'animate-breathe' : ''"></span>
          直播中
          <span class="text-[11px]" :class="activeTab === 'live' ? 'text-live/80' : 'text-ink3'">{{ liveList.length }}</span>
        </button>
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all flex items-center gap-1.5"
          :class="activeTab === 'offline' ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="activeTab = 'offline'"
        >
          <span class="w-2 h-2 rounded-full bg-ink3"></span>
          离线
          <span class="text-[11px]" :class="activeTab === 'offline' ? 'text-live/80' : 'text-ink3'">{{ offlineList.length }}</span>
        </button>
      </div>
    </div>

    <!-- 内容区(大厅同款单一滚动流) -->
    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-4">
      <template v-if="store.anchors.length">
        <!-- 直播中 tab -->
        <template v-if="activeTab === 'live'">
          <div v-if="livePaged.length" class="grid gap-x-5 gap-y-6 pb-4" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); grid-auto-rows: min-content">
            <AnchorCard v-for="a in livePaged" :key="a.userId" :anchor="a" @remove="removeAnchor" />
          </div>
          <div v-else class="h-full flex items-center justify-center">
            <n-empty :description="keyword ? '没有匹配的直播中主播' : '暂时没有主播在直播'" class="text-ink3" />
          </div>
        </template>

        <!-- 离线 tab -->
        <template v-else>
          <div v-if="offPaged.length" class="grid gap-2.5 pb-4" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))">
            <div
              v-for="a in offPaged"
              :key="a.userId"
              class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-line shadow-card hover:shadow-card-hover transition-shadow"
            >
              <img v-if="a.userImg" :src="a.userImg" class="w-9 h-9 rounded-full object-cover grayscale-[0.4]" referrerpolicy="no-referrer" />
              <div v-else class="w-9 h-9 rounded-full bg-page grid place-items-center text-ink3">{{ a.nick.slice(0, 1) }}</div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-semibold text-ink1 truncate">{{ a.nick }}</div>
                <div class="text-[11px] text-ink3 truncate">@{{ a.userId }}</div>
              </div>
              <div class="flex items-center gap-1.5 text-[11px] text-ink3 shrink-0" title="开播自动录制">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>
                <n-switch size="small" :value="a.autoRecord" @update:value="(v: boolean) => setAuto(a.userId, v)" />
              </div>
              <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:text-red-500 hover:bg-red-50 transition-colors" @click="removeAnchor(a.userId)" title="取消关注">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
          </div>
          <div v-else class="h-full flex items-center justify-center">
            <n-empty :description="keyword ? '没有匹配的离线主播' : '关注的所有主播都在直播中'" class="text-ink3" />
          </div>
        </template>
      </template>

      <div v-else class="h-full flex items-center justify-center">
        <n-empty description="还没有关注任何主播" class="text-ink3">
          <template #icon>
            <svg class="w-14 h-14 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6.3 5.4 5.4 0 0121.3 12C19 16.4 12 21 12 21z"/>
            </svg>
          </template>
          <template #extra>
            <div class="flex gap-2 justify-center mt-2">
              <n-button size="small" type="primary" round @click="showAdd = true">关注主播</n-button>
              <n-button size="small" round secondary @click="router.push({ name: 'explore' })">去大厅看看</n-button>
            </div>
          </template>
        </n-empty>
      </div>
    </div>

    <!-- 单一底部分页栏(与大厅完全一致) -->
    <div v-if="store.anchors.length && activeList.length" class="shrink-0 bg-white border-t border-line px-7 py-3 flex items-center gap-3">
      <span class="text-[12px] text-ink3">
        {{ activeTab === 'live' ? '直播中' : '离线' }} {{ activeList.length }} 位 · 每页 {{ PAGE_SIZE }} 个
      </span>
      <div class="flex-1"></div>
      <n-pagination
        v-if="activeTab === 'live'"
        :page="livePage"
        :page-count="livePageCount"
        size="small"
        @update:page="(p: number) => (livePage = p)"
      />
      <n-pagination
        v-else
        :page="offPage"
        :page-count="offPageCount"
        size="small"
        @update:page="(p: number) => (offPage = p)"
      />
    </div>

    <!-- 关注主播弹窗 -->
    <n-modal v-model:show="showAdd" preset="card" title="关注主播" class="!w-[460px]" :bordered="false">
      <div class="space-y-3">
        <p class="text-[12.5px] text-ink2 leading-relaxed">
          输入主播 ID 或直接粘贴直播间链接, 例如:<br />
          <code class="text-live text-[12px]">https://www.pandalive.co.kr/play/zenith6666</code> 或 <code class="text-live text-[12px]">zenith6666</code>
        </p>
        <n-input
          v-model:value="addInput"
          placeholder="主播 ID / 直播间链接"
          size="large"
          @keyup.enter="addAnchor"
          autofocus
        />
        <div class="flex justify-end gap-2 pt-1">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button type="primary" :loading="addLoading" :disabled="!addInput.trim()" @click="addAnchor" class="!w-[88px]">关注</n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>
