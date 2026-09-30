<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { roomKey, type Platform } from '@shared/types'

// ============ 在播坞(设计稿 L.2 / 方案 A 的成立前提) ============
// 分段切视图牺牲了「一屏看全」, 靠这条 sticky 带把「我关注的人有没有开播」补回来:
// 切去逛发现或做离线管理时, 关注在播仍可见可点。0 位时整条收起不占位(最常见状态)。
// 只在「非在播视图」出现(㉖): 站在在播关注视图时, 坞与下方卡片墙是同一批房间的两份呈现,
// 头像条在那一屏只是把三层带堆成四层 —— 补的是「看不见」, 不是「已经看见第二遍」。
// ==================================================================

const props = defineProps<{ platform: Platform }>()
const store = useAppStore()
const router = useRouter()
const { t } = useI18n()

/** 展开态: 超过 7 位默认折叠为 +N, 点击展开为两行 */
const expanded = ref(false)
const LIMIT = 7

/** 只列「关注且在播」, 不含发现段房间; 顺序 = 开播时刻新→旧(与在播视图同一口径) */
const items = computed(() =>
  store.liveAnchors
    .filter((a) => a.platform === props.platform)
    .slice()
    .sort(
      (a, b) =>
        Number(!a.startTime) - Number(!b.startTime) ||
        String(b.startTime || '').localeCompare(String(a.startTime || '')) ||
        (b.viewerCount || 0) - (a.viewerCount || 0)
    )
)

const shown = computed(() => (expanded.value || items.value.length <= LIMIT ? items.value : items.value.slice(0, LIMIT)))
const hiddenCount = computed(() => Math.max(0, items.value.length - shown.value.length))

function open(a: { platform: Platform; userId: string }): void {
  router.push({ name: 'player', params: { plat: a.platform, userId: a.userId } })
}

/** 本轮新开播: 头像左侧 2px 品牌色竖条(取代旧的"开播自动跳视图", 不劫持当前阅读) */
function isNew(a: { platform: Platform; userId: string }): boolean {
  return store.newLive.includes(roomKey(a.platform, a.userId))
}
</script>

<template>
  <!-- 0 位关注在播 → 整条收起不占位 -->
  <div v-if="items.length" class="livedock sticky top-0 z-20 flex items-center gap-3 min-h-[44px] py-1.5 px-4 rounded-ctl bg-card/95 backdrop-blur border border-line shadow-card">
    <div class="flex items-center gap-1.5 shrink-0 text-[12px] font-semibold text-ink2">
      <span class="w-2 h-2 rounded-full bg-live animate-breathe"></span>
      <span>{{ t('dock.title') }}</span>
      <span class="text-liveink font-bold tabular-nums">{{ items.length }}</span>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
      <button
        v-for="a in shown"
        :key="roomKey(a.platform, a.userId)"
        class="relative flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-fill hover:bg-fillh border transition-colors"
        :class="isNew(a) ? 'border-brand/40' : 'border-line'"
        @click="open(a)"
      >
        <span v-if="isNew(a)" class="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-brand"></span>
        <img v-if="a.userImg" :src="a.userImg" class="w-[18px] h-[18px] rounded-full object-cover shrink-0 ml-1" referrerpolicy="no-referrer" />
        <span v-else class="w-[18px] h-[18px] rounded-full bg-card grid place-items-center text-[9px] font-bold text-deco shrink-0 ml-1">{{ a.nick.slice(0, 1) }}</span>
        <span class="text-[12px] text-ink1 font-medium max-w-[120px] truncate">{{ a.nick }}</span>
        <svg v-if="a.tags?.isPw" class="w-3 h-3 text-ink2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>
        <span v-if="store.isRecording(a.platform, a.userId)" class="w-1.5 h-1.5 rounded-full bg-live animate-breathe shrink-0" :title="t('dock.recording')"></span>
      </button>

      <button v-if="hiddenCount" class="h-7 px-2.5 rounded-full bg-fill hover:bg-fillh border border-line text-[11.5px] font-semibold text-ink2 transition-colors" @click="expanded = true">
        +{{ hiddenCount }}
      </button>
      <button v-else-if="expanded && items.length > LIMIT" class="h-7 px-2.5 rounded-full text-[11.5px] font-medium text-ink3 hover:text-ink1 transition-colors" @click="expanded = false">
        {{ t('dock.collapse') }}
      </button>
    </div>

    <!-- 坞只在非在播视图出现, 这一枚跳转永远是"去别处", 不再是自我指向 -->
    <button class="shrink-0 text-[12px] font-medium text-brand hover:text-brand-hi transition-colors" @click="router.push({ name: 'live', params: { plat: platform }, query: { view: 'live' } })">
      {{ t('dock.gotoAll', { n: items.length }) }} ›
    </button>
  </div>
</template>
