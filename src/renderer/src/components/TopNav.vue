<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import { NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const tabs = computed(() => [
  { name: 'explore', label: t('nav.explore') },
  { name: 'monitor', label: t('nav.monitor') },
  { name: 'recordings', label: t('nav.recordings') },
  { name: 'library', label: t('nav.library') }
])

function tabActive(name: string): boolean {
  if (route.name === name) return true
  if (name === 'explore' && route.name === 'player') return true
  return false
}

const watcherState = computed(() => {
  const w = store.watcher
  if (!w) return { cls: 'bg-ink3', text: '—', tip: t('nav.wUnknown'), tone: 'idle' }
  if (w.circuitOpen) return { cls: 'bg-red-400', text: t('nav.wCooling'), tip: w.message, tone: 'bad' }
  if (!w.running) return { cls: 'bg-ink3', text: t('nav.wStopped'), tip: t('nav.wStoppedTip'), tone: 'idle' }
  const interval = store.settings?.pollIntervalSec ?? '?'
  const cost = w.roundMs < 1000 ? `${w.roundMs} ${t('common.ms')}` : `${(w.roundMs / 1000).toFixed(1)} ${t('common.sec')}`
  const heartbeat = t('nav.wTip', { sec: interval, cost })
  // message 非空但没熔断 = 轮询在跑、某一侧已经瞎掉(SOOP 整轮全灭 / Panda 冷却): 绿点呼吸就是骗人
  if (w.message) return { cls: 'bg-amber-400', text: t('nav.wWarn'), tip: `${w.message} · ${heartbeat}`, tone: 'warn' }
  return { cls: 'bg-live', text: t('nav.liveN', { n: w.liveCount }), tip: heartbeat, tone: 'ok' }
})

const keyword = computed({
  get: () => store.searchKeyword,
  set: (v: string) => {
    store.searchKeyword = v
    if (v && route.name !== 'explore') router.push({ name: 'explore' })
  }
})

/** 两套登录态彼此独立: 一枚头像只代表一边, 点哪枚就在账号页打开哪一方
 *  状态文字直接摆在头像旁(B4): 合并口径的"已登录"会让人以为两边都稳, 而 tooltip 在截图与触屏里不存在 */
const avatars = computed(() => {
  const a = store.accounts
  const p = a?.pandalive
  const s = a?.soop
  return [
    {
      key: 'pandalive' as const,
      short: 'P',
      live: !!p?.realLogin,
      held: !!p?.loggedIn,
      stateText: p?.realLogin ? t('nav.loggedIn') : p?.loggedIn ? t('nav.unverified') : t('nav.notLoggedIn'),
      tip: !p
        ? t('nav.wUnknown')
        : p.realLogin
          ? p.isAdult
            ? t('account.descOkAdult')
            : t('account.descOkNoAdult')
          : p.netFail
            ? t('account.netFailTip')
            : p.loggedIn
              ? t('account.descWarn')
              : t('account.descNone')
    },
    {
      key: 'soop' as const,
      short: 'S',
      live: !!s?.realLogin,
      held: !!s?.hasCookies,
      stateText: s?.realLogin ? t('nav.loggedIn') : s?.hasCookies ? t('nav.unverified') : t('nav.notLoggedIn'),
      tip: !s
        ? t('nav.wUnknown')
        : s.realLogin
          ? t('account.soopDescOk', { id: s.loginId })
          : s.netFail
            ? t('account.netFailTip')
            : s.hasCookies
              ? t('account.soopDescWarn')
              : t('account.soopDescNone')
    }
  ]
})
</script>

<template>
  <header class="drag-region h-[64px] shrink-0 flex items-center bg-card border-b border-line relative z-40 select-none px-5">
    <!-- logo(纯文字标) -->
    <div class="flex items-center gap-2.5 shrink-0 cursor-pointer" @click="router.push({ name: 'explore' })">
      <div class="leading-tight">
        <div class="text-[16px] font-bold text-ink1 tracking-wide">PandaLive</div>
        <div class="text-[10px] text-ink3 tracking-[0.2em] -mt-0.5 font-medium">MONITOR</div>
      </div>
    </div>

    <!-- 导航 tabs -->
    <nav class="no-drag flex items-stretch self-stretch ml-8 gap-1">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        class="nav-tab px-4 text-[14px] font-medium transition-colors flex items-center"
        :class="tabActive(tab.name) ? 'active text-ink1 font-semibold' : 'text-ink2 hover:text-ink1'"
        @click="router.push({ name: tab.name })"
      >
        {{ tab.label }}
        <span
          v-if="tab.name === 'monitor' && store.liveAnchors.length"
          class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-live/15 text-live text-[11px] font-bold"
        >{{ store.liveAnchors.length }}</span>
        <span
          v-if="tab.name === 'recordings' && store.activeRecs.length"
          class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/10 text-red-500 text-[11px] font-bold"
        >{{ store.activeRecs.length }}</span>
      </button>
    </nav>

    <!-- 居中搜索 -->
    <div class="no-drag flex-1 flex justify-center px-6">
      <div class="relative w-full max-w-[420px] group">
        <input
          v-model="keyword"
          type="text"
          :placeholder="t('nav.searchPh')"
          class="w-full h-10 pl-4 pr-11 rounded-full bg-page text-[13px] text-ink1 placeholder:text-ink3 outline-none border-2 border-transparent focus:border-live/60 focus:bg-card transition-all"
          @keyup.enter="router.push({ name: 'explore' })"
        />
        <button
          class="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center text-ink3 hover:text-live hover:bg-live/10 transition-colors"
          @click="router.push({ name: 'explore' })"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 状态 / 账号 / 设置 / 窗口控制 -->
    <div class="no-drag flex items-center gap-1.5 shrink-0">
      <n-tooltip trigger="hover" placement="bottom">
        <template #trigger>
          <div
            class="flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold cursor-default"
            :class="watcherState.tone === 'bad' ? 'bg-red-500/10 text-red-600' : watcherState.tone === 'warn' ? 'bg-amber-500/10 text-amber-600' : 'bg-live/10 text-live'"
          >
            <span class="w-2 h-2 rounded-full" :class="[watcherState.cls, watcherState.cls === 'bg-live' ? 'animate-breathe' : '']"></span>
            <span>{{ watcherState.text }}</span>
          </div>
        </template>
        {{ watcherState.tip }}
      </n-tooltip>

      <!-- 双平台登录态: 两套会话互不影响, 各一枚头像 + 各自状态文字 -->
      <button
        class="h-9 pl-1 pr-2.5 rounded-full flex items-center gap-2 hover:bg-page transition-colors"
        @click="router.push({ name: 'account' })"
        :title="t('account.title')"
      >
        <template v-for="(av, i) in avatars" :key="av.key">
          <span v-if="i" class="w-px h-4 bg-line shrink-0"></span>
          <span class="flex items-center gap-1.5">
            <n-tooltip trigger="hover" placement="bottom">
              <template #trigger>
                <span
                  class="relative w-8 h-8 shrink-0 cursor-pointer"
                  @click.stop="router.push({ name: 'account', query: { plat: av.key } })"
                >
                  <span
                    class="w-8 h-8 rounded-full grid place-items-center ring-2 text-[12px] font-extrabold select-none"
                    :class="av.live ? (av.key === 'soop' ? 'bg-[#0f1115] text-[#e8ff3a] ring-live/30' : 'bg-gradient-to-br from-live to-fuchsia-400 text-white ring-live/30') : av.held ? 'bg-gradient-to-br from-amber-400 to-amber-500 text-white ring-amber-300/40' : 'bg-fill text-ink3 ring-fill'"
                  >{{ av.short }}</span>
                  <!-- 状态点: 已登录绿 / 有 Cookie 但未过官方校验琥珀 -->
                  <span
                    v-if="av.live || av.held"
                    class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-card"
                    :class="av.live ? 'bg-emerald-500' : 'bg-amber-500'"
                  ></span>
                </span>
              </template>
              {{ av.tip }}
            </n-tooltip>
            <span class="text-[11.5px] shrink-0" :class="av.live ? 'text-ink1 font-medium' : av.held ? 'text-amber-600' : 'text-ink3'">{{ av.stateText }}</span>
          </span>
        </template>
      </button>

      <button
        class="w-9 h-9 rounded-full grid place-items-center text-ink2 hover:bg-page hover:text-ink1 transition-colors"
        @click="router.push({ name: 'settings' })"
        :title="t('nav.settings')"
      >
        <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>

      <div class="w-px h-5 bg-line mx-1.5"></div>

      <div class="flex items-center">
        <button class="w-10 h-8 grid place-items-center text-ink3 hover:bg-page rounded-md transition-colors" @click="api.winControl('min')">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
        </button>
        <button class="w-10 h-8 grid place-items-center text-ink3 hover:bg-page rounded-md transition-colors" @click="api.winControl('max')">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
        </button>
        <button class="w-10 h-8 grid place-items-center text-ink3 hover:bg-red-500 hover:text-white rounded-md transition-colors" @click="api.winControl('close')">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>
  </header>
</template>
