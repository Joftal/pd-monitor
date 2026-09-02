<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import { NTooltip } from 'naive-ui'

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const tabs = [
  { name: 'explore', label: '直播大厅' },
  { name: 'monitor', label: '已关注' },
  { name: 'recordings', label: '录制管理' }
]

function tabActive(name: string): boolean {
  if (route.name === name) return true
  if (name === 'explore' && route.name === 'player') return true
  return false
}

const watcherState = computed(() => {
  const w = store.watcher
  if (!w) return { cls: 'bg-ink3', text: '—', tip: '轮询状态未知' }
  if (w.circuitOpen) return { cls: 'bg-red-400', text: '风控冷却', tip: w.message }
  if (!w.running) return { cls: 'bg-ink3', text: '已暂停', tip: '轮询已停止' }
  const interval = store.settings?.pollIntervalSec ?? '?'
  const cost = w.roundMs < 1000 ? `${w.roundMs} 毫秒` : `${(w.roundMs / 1000).toFixed(1)} 秒`
  return {
    cls: 'bg-live',
    text: `${w.liveCount} 直播中`,
    tip: `每 ${interval} 秒向平台拉取一次数据 · 上次拉取耗时 ${cost}`
  }
})

const keyword = computed({
  get: () => store.searchKeyword,
  set: (v: string) => {
    store.searchKeyword = v
    if (v && route.name !== 'explore') router.push({ name: 'explore' })
  }
})
</script>

<template>
  <header class="drag-region h-[64px] shrink-0 flex items-center bg-white border-b border-line relative z-40 select-none px-5">
    <!-- logo -->
    <div class="flex items-center gap-2.5 shrink-0 cursor-pointer" @click="router.push({ name: 'explore' })">
      <div class="w-9 h-9 rounded-xl bg-live flex items-center justify-center shadow-glow-brand">
        <svg class="w-[18px] h-[18px] text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
      </div>
      <div class="leading-tight">
        <div class="text-[16px] font-bold text-ink1 tracking-wide">PandaLive</div>
        <div class="text-[10px] text-ink3 tracking-[0.2em] -mt-0.5 font-medium">MONITOR</div>
      </div>
    </div>

    <!-- 导航 tabs -->
    <nav class="no-drag flex items-stretch self-stretch ml-8 gap-1">
      <button
        v-for="t in tabs"
        :key="t.name"
        class="nav-tab px-4 text-[14px] font-medium transition-colors flex items-center"
        :class="tabActive(t.name) ? 'active text-ink1 font-semibold' : 'text-ink2 hover:text-ink1'"
        @click="router.push({ name: t.name })"
      >
        {{ t.label }}
        <span
          v-if="t.name === 'monitor' && store.liveAnchors.length"
          class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-live/15 text-live text-[11px] font-bold"
        >{{ store.liveAnchors.length }}</span>
        <span
          v-if="t.name === 'recordings' && store.activeRecs.length"
          class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500/10 text-red-500 text-[11px] font-bold"
        >{{ store.activeRecs.length }}</span>
      </button>
    </nav>

    <!-- 居中搜索(B站风) -->
    <div class="no-drag flex-1 flex justify-center px-6">
      <div class="relative w-full max-w-[420px] group">
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索主播 / 标题"
          class="w-full h-10 pl-4 pr-11 rounded-full bg-page text-[13px] text-ink1 placeholder:text-ink3 outline-none border-2 border-transparent focus:border-live/60 focus:bg-white transition-all"
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
          <div class="flex items-center gap-1.5 h-8 px-3 rounded-full bg-live/10 text-live text-[12px] font-semibold cursor-default">
            <span class="w-2 h-2 rounded-full" :class="[watcherState.cls, watcherState.cls === 'bg-live' ? 'animate-breathe' : '']"></span>
            <span>{{ watcherState.text }}</span>
          </div>
        </template>
        {{ watcherState.tip }}
      </n-tooltip>

      <button
        class="h-9 pl-1 pr-3 rounded-full flex items-center gap-2 hover:bg-page transition-colors"
        @click="router.push({ name: 'account' })"
        title="账号"
      >
        <span class="relative w-8 h-8 shrink-0">
          <!-- 头像圆: SVG 人像, 登录态渐变粉底, 未登录灰色 -->
          <span
            class="w-8 h-8 rounded-full grid place-items-center overflow-hidden ring-2"
            :class="store.account?.realLogin ? 'bg-gradient-to-br from-live to-fuchsia-400 ring-live/30' : store.account?.loggedIn ? 'bg-gradient-to-br from-amber-400 to-amber-500 ring-amber-300/40' : 'bg-gray-200 ring-gray-200'"
          >
            <svg
              class="w-[18px] h-[18px]"
              :class="store.account?.loggedIn ? 'text-white' : 'text-gray-400'"
              viewBox="0 0 24 24" fill="currentColor"
            >
              <path d="M12 12a4.4 4.4 0 100-8.8 4.4 4.4 0 000 8.8zM4.5 20.4c1-4.1 4.2-6.1 7.5-6.1s6.5 2 7.5 6.1a.9.9 0 01-.88 1.1H5.38a.9.9 0 01-.88-1.1z"/>
            </svg>
          </span>
          <!-- 状态点: 登录绿/未认证琥珀 -->
          <span
            v-if="store.account?.loggedIn"
            class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white"
            :class="store.account?.realLogin ? 'bg-emerald-500' : 'bg-amber-500'"
          ></span>
        </span>
        <span class="text-[13px]" :class="store.account?.realLogin ? 'text-ink1 font-medium' : 'text-ink3'">
          {{ store.account?.realLogin ? '已登录' : store.account?.loggedIn ? '未认证' : '登录' }}
        </span>
      </button>

      <button
        class="w-9 h-9 rounded-full grid place-items-center text-ink2 hover:bg-page hover:text-ink1 transition-colors"
        @click="router.push({ name: 'settings' })"
        title="设置"
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
