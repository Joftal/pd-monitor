<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import AnchorCard from '@/components/AnchorCard.vue'
import PlatFilter from '@/components/PlatFilter.vue'
import PlatTag from '@/components/PlatTag.vue'
import SpinIcon from '@/components/SpinIcon.vue'
import { useI18n } from 'vue-i18n'
import { roomKey, parseRoomInput, type Platform } from '@shared/types'
const { t } = useI18n()
import { NButton, NInput, NModal, NPagination, useMessage, NEmpty, NSwitch } from 'naive-ui'

const store = useAppStore()
const message = useMessage()
const router = useRouter()

const showAdd = ref(false)
const addInput = ref('')
const addLoading = ref(false)
const keyword = ref('')
const activeTab = ref<'live' | 'offline'>('live')
// 添加弹窗的平台归属: auto=按域名识别, 其余为"只填 ID"的快捷路径
const addPlatform = ref<'auto' | Platform>('auto')
const addPlatformOptions: ('auto' | Platform)[] = ['auto', 'pandalive', 'soop']
// 统一墙的平台筛选(设计稿方案 A): 状态 tab 之下再切一层
const platFilter = ref<'all' | Platform>('all')

// ---- 分页(与大厅统一: 每页 20) ----
const PAGE_SIZE = 20
const livePage = ref(1)
const offPage = ref(1)
watch([keyword, platFilter, activeTab], () => {
  livePage.value = 1
  offPage.value = 1
})

function matchKw(a: { nick: string; userId: string }): boolean {
  const k = keyword.value.trim().toLowerCase()
  return !k || a.nick.toLowerCase().includes(k) || a.userId.toLowerCase().includes(k)
}

function matchPlat(a: { platform: Platform }): boolean {
  return platFilter.value === 'all' || a.platform === platFilter.value
}

// 在播排序: 开播时刻新→旧, 拿不到开播时刻的沉底, 同一时刻再按人数。
// 不能只按人数排: 人数只有 Panda 列表接口给, SOOP 侧无单频道人数接口(实测)恒为 0,
// 纯人数排序会把刚开播的 SOOP 房永久钉在墙尾, 用户不看平台筛选就以为没开播。
// startTime 是 "YYYY-MM-DD HH:MM:SS"(KST 钟面), 字典序即时间序, 直接反着比
const liveList = computed(() =>
  [...store.liveAnchors]
    .sort(
      (a, b) =>
        Number(!a.startTime) - Number(!b.startTime) ||
        String(b.startTime || '').localeCompare(String(a.startTime || '')) ||
        (b.viewerCount || 0) - (a.viewerCount || 0)
    )
    .filter((a) => matchKw(a) && matchPlat(a))
)

const offlineList = computed(() => [...store.offlineAnchors].sort((a, b) => (b.lastSeenAt || b.addedAt) - (a.lastSeenAt || a.addedAt)).filter((a) => matchKw(a) && matchPlat(a)))

// chip 计数随当前 tab + 关键词联动: 否则"SOOP 2"点进去是空墙
const platCounts = computed(() => {
  const base = (activeTab.value === 'live' ? store.liveAnchors : store.offlineAnchors).filter(matchKw)
  return {
    all: base.length,
    pandalive: base.filter((a) => a.platform === 'pandalive').length,
    soop: base.filter((a) => a.platform === 'soop').length
  }
})

// 弹窗内即时回显识别结果(纯本地解析, 不发请求): 用户粘错域名能在点关注前看出来
const addParsed = computed(() => parseRoomInput(addInput.value, addPlatform.value === 'auto' ? undefined : addPlatform.value))

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

// 空态文案按筛选层级归因: 有平台/关键词过滤时不能说"暂时没有主播在直播"
const liveEmpty = computed(() =>
  keyword.value.trim() ? t('monitor.emptyLiveKw') : platFilter.value !== 'all' ? t('monitor.emptyLivePlat') : t('monitor.emptyLive')
)
const offEmpty = computed(() =>
  keyword.value.trim() ? t('monitor.emptyOffKw') : platFilter.value !== 'all' ? t('monitor.emptyOffPlat') : t('monitor.emptyOff')
)

async function addAnchor() {
  if (!addInput.value.trim()) return
  addLoading.value = true
  try {
    const a = await api.anchorsAdd(addInput.value.trim(), addPlatform.value === 'auto' ? undefined : addPlatform.value)
    message.success(t('monitor.added', { nick: a.nick }))
    addInput.value = ''
    showAdd.value = false
    store.anchors = await api.anchorsList()
  } catch (e) {
    message.error((e as Error).message || t('monitor.addFail'))
  } finally {
    addLoading.value = false
  }
}

function openAdd(): void {
  addPlatform.value = 'auto'
  showAdd.value = true
}

async function removeAnchor(platform: Platform, userId: string) {
  await api.anchorsRemove(platform, userId)
  message.success(t('monitor.removed'))
}

async function setAuto(platform: Platform, userId: string, v: boolean) {
  await api.anchorsSetAuto(platform, userId, v)
  store.anchors = await api.anchorsList()
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- 页头 -->
    <div class="px-7 pt-5 pb-3 shrink-0">
      <div class="flex items-center gap-3">
        <h1 class="text-[20px] font-bold text-ink1 tracking-tight">{{ t('monitor.title') }}</h1>
        <span class="text-[13px] text-ink3 mt-0.5">{{ t('monitor.countInfo', { a: store.anchors.length, b: store.liveAnchors.length }) }}</span>
        <div class="flex-1"></div>
        <n-input v-model:value="keyword" size="small" :placeholder="t('monitor.searchPh')" clearable class="!w-44" />
        <n-button size="medium" type="primary" round @click="openAdd">{{ t('monitor.addBtn') }}</n-button>
      </div>

      <!-- 轮询异常提示(Panda 冷却/熔断, 或 SOOP 整轮全灭): 状态徽标只有一枚圆点, 这里给可读正文 -->
      <div
        v-if="store.watcher?.message"
        class="mt-2.5 flex items-center gap-1.5 text-[12px]"
        :class="store.watcher.circuitOpen ? 'text-red-500' : 'text-amber-600'"
      >
        <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <span class="truncate" :title="store.watcher.message">{{ store.watcher.message }}</span>
      </div>

      <!-- Tab 切换(与大厅排序同款的下划线 tab) -->
      <div class="flex items-center gap-4 mt-3.5">
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all flex items-center gap-1.5"
          :class="activeTab === 'live' ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="activeTab = 'live'"
        >
          <span class="w-2 h-2 rounded-full bg-live" :class="store.liveAnchors.length ? 'animate-breathe' : ''"></span>
          {{ t('monitor.liveTab') }}
          <span class="text-[11px]" :class="activeTab === 'live' ? 'text-live/80' : 'text-ink3'">{{ liveList.length }}</span>
        </button>
        <button
          class="text-[13px] pb-0.5 border-b-2 transition-all flex items-center gap-1.5"
          :class="activeTab === 'offline' ? 'text-live font-semibold border-live' : 'text-ink2 border-transparent hover:text-ink1'"
          @click="activeTab = 'offline'"
        >
          <span class="w-2 h-2 rounded-full bg-ink3"></span>
          {{ t('monitor.offTab') }}
          <span class="text-[11px]" :class="activeTab === 'offline' ? 'text-live/80' : 'text-ink3'">{{ offlineList.length }}</span>
        </button>
      </div>

      <!-- 平台筛选 chip(统一墙下再切一层): 计数随当前 tab + 关键词联动, 否则点进去是空墙 -->
      <div class="flex items-center gap-2 mt-3">
        <span class="text-[12px] text-ink3">{{ t('monitor.platformFilter') }}</span>
        <PlatFilter :model-value="platFilter" :counts="platCounts" @update:model-value="(v: string) => (platFilter = v as 'all' | Platform)" />
        <!-- 筛到单平台后卡片不再挂徽标(B2): 平台由这里说一次, 顺带告诉用户怎么退回混排 -->
        <span v-if="platFilter !== 'all'" class="text-[11.5px] text-ink3">{{ t('monitor.platScoped', { plat: platFilter === 'soop' ? 'SOOP' : 'PandaLive' }) }}</span>
      </div>
    </div>

    <!-- 内容区(大厅同款单一滚动流) -->
    <div class="flex-1 min-h-0 overflow-y-auto px-7 pb-4">
      <template v-if="store.anchors.length">
        <!-- 直播中 tab -->
        <template v-if="activeTab === 'live'">
          <div v-if="livePaged.length" class="grid gap-x-5 gap-y-6 pb-4" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); grid-auto-rows: min-content">
            <AnchorCard v-for="a in livePaged" :key="roomKey(a.platform, a.userId)" :anchor="a" :show-platform="platFilter === 'all'" @remove="removeAnchor" />
          </div>
          <div v-else class="h-full flex items-center justify-center">
            <n-empty :description="liveEmpty" class="text-ink3" />
          </div>
        </template>

        <!-- 离线 tab -->
        <template v-else>
          <div v-if="offPaged.length" class="grid gap-2.5 pb-4" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))">
            <div
              v-for="a in offPaged"
              :key="roomKey(a.platform, a.userId)"
              class="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-line shadow-card hover:shadow-card-hover transition-shadow"
            >
              <img v-if="a.userImg" :src="a.userImg" class="w-9 h-9 rounded-full object-cover grayscale-[0.4]" referrerpolicy="no-referrer" />
              <div v-else class="w-9 h-9 rounded-full bg-page grid place-items-center text-ink3">{{ a.nick.slice(0, 1) }}</div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-semibold text-ink1 truncate">{{ a.nick }}</div>
                <div class="text-[11px] text-ink3 truncate flex items-center gap-1.5">@{{ a.userId }}
                  <!-- 密集行里用 sm 浅底徽标: 深色块在白色卡面上比头像还重, 且与 @ID 抢读 -->
                  <PlatTag v-if="platFilter === 'all'" :platform="a.platform" size="sm" surface="onsurf" />
                </div>
              </div>
              <div class="flex items-center gap-1.5 text-[11px] text-ink3 shrink-0" :title="t('monitor.autoRecTitle')">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>
                <n-switch size="small" :value="a.autoRecord" @update:value="(v: boolean) => setAuto(a.platform, a.userId, v)" />
              </div>
              <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:text-red-500 hover:bg-red-50 transition-colors" @click="removeAnchor(a.platform, a.userId)" :title="t('card.unfollow')">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
          </div>
          <div v-else class="h-full flex items-center justify-center">
            <n-empty :description="offEmpty" class="text-ink3" />
          </div>
        </template>
      </template>

      <div v-else class="h-full flex items-center justify-center">
        <n-empty :description="t('monitor.emptyNone')" class="text-ink3">
          <template #icon>
            <svg class="w-14 h-14 text-ink3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0112 6.3 5.4 5.4 0 0121.3 12C19 16.4 12 21 12 21z"/>
            </svg>
          </template>
          <template #extra>
            <div class="flex gap-2 justify-center mt-2">
              <n-button size="small" type="primary" round @click="openAdd">{{ t('monitor.addBtn') }}</n-button>
              <n-button size="small" round secondary @click="router.push({ name: 'explore' })">{{ t('monitor.goExplore') }}</n-button>
            </div>
          </template>
        </n-empty>
      </div>
    </div>

    <!-- 单一底部分页栏(与大厅完全一致) -->
    <div v-if="store.anchors.length && activeList.length" class="shrink-0 bg-card border-t border-line px-7 py-3 flex items-center gap-3">
      <span class="text-[12px] text-ink3">
        {{ t('monitor.page', { label: activeTab === 'live' ? t('monitor.liveTab') : t('monitor.offTab'), n: activeList.length, size: PAGE_SIZE }) }}
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
    <n-modal v-model:show="showAdd" preset="card" :title="t('monitor.addModalTitle')" class="!w-[460px]" :bordered="false">
      <div class="space-y-3">
        <!-- 平台分段: 自动识别做默认(粘地址就够), 手选只服务"只填 ID"的快捷路径 -->
        <PlatFilter :values="addPlatformOptions" :model-value="addPlatform" @update:model-value="(v: string) => (addPlatform = v as 'auto' | Platform)" />
        <p class="text-[12.5px] text-ink2 leading-relaxed">
          <template v-if="addPlatform === 'soop'">
            {{ t('monitor.addExampleSoopLead') }}<br />
            <code class="text-live text-[12px]">https://play.sooplive.com/1004ysus/297384679</code>
            <br /><span class="text-ink3">{{ t('monitor.addSoopTip') }}</span>
          </template>
          <template v-else>
            {{ t('monitor.addExample1') }}<br />
            <code class="text-live text-[12px]">https://www.pandalive.co.kr/play/zenith6666</code> {{ t('common.or') }} <code class="text-live text-[12px]">zenith6666</code>
          </template>
        </p>
        <n-input
          v-model:value="addInput"
          :placeholder="t('monitor.addPh')"
          size="large"
          @keyup.enter="addAnchor"
          autofocus
        />
        <!-- 本地即时回显解析结果: 粘错域名在点关注前就能看见 -->
        <div v-if="addInput.trim()" class="text-[12px] flex items-center gap-1.5" :class="addParsed ? 'text-ink2' : 'text-red-500'">
          <template v-if="addParsed">
            {{ t('monitor.recognizedAs') }} <PlatTag :platform="addParsed.platform" size="sm" /> @{{ addParsed.userId }}
          </template>
          <template v-else>{{ t('monitor.recognizeFail') }}</template>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <n-button @click="showAdd = false">{{ t('monitor.cancel') }}</n-button>
          <n-button type="primary" :disabled="!addParsed || addLoading" @click="addAnchor" class="!w-[88px]">
            <span class="inline-flex items-center justify-center gap-1.5"><SpinIcon v-if="addLoading" />{{ t('monitor.confirmFollow') }}</span>
          </n-button>
        </div>
      </div>
    </n-modal>
  </div>
</template>
