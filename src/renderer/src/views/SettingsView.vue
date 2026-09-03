<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSwitch, NRadioGroup, NRadioButton, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import type { AppInfo, Settings, UpdateCheckResult } from '@shared/types'
import SpinIcon from '@/components/SpinIcon.vue'

const store = useAppStore()
const message = useMessage()
const form = ref<Settings | null>(null)
const saving = ref(false)
const dataDir = ref('')

// ---- 关于 / 检查更新 ----
const info = ref<AppInfo | null>(null)
const checking = ref(false)
const upd = ref<UpdateCheckResult | null>(null)

onMounted(async () => {
  dataDir.value = await api.appDataDir()
  info.value = await api.appInfo()
})

async function doCheckUpdate() {
  if (checking.value) return
  checking.value = true
  upd.value = null
  try {
    upd.value = await api.checkUpdate()
  } finally {
    checking.value = false
  }
}
function openRepo() {
  if (info.value) void api.openExternal(info.value.repo)
}
function openRelease() {
  if (upd.value?.url) void api.openExternal(upd.value.url)
}

const defaultRecPath = computed(() => {
  if (!dataDir.value) return '…'
  return dataDir.value.replace(/[/\\]data$/, '/recording')
})

watch(
  () => store.settings,
  (s) => {
    if (s && !form.value) form.value = { ...s }
  },
  { immediate: true }
)

// 未保存脏标记(form 与已持久化 settings 值不一致)
const dirty = computed(() => {
  if (!form.value || !store.settings) return false
  return JSON.stringify(form.value) !== JSON.stringify(store.settings)
})

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

async function pickDir() {
  const d = await api.settingsSelectDir()
  if (d && form.value) form.value.savePath = d
}

async function openDataDir() {
  await api.recOpenFolder(dataDir.value)
}

async function openLogsDir() {
  await api.openLogs()
}

async function save() {
  if (!form.value) return
  saving.value = true
  try {
    // 清洗: NInputNumber 清空为 null / 非法值时回退默认, 并夹紧到安全区间
    const clean: Settings = {
      ...form.value,
      proxyUrl: (form.value.proxyUrl || '').trim(),
      pollIntervalSec: clampNum(form.value.pollIntervalSec, 5, 600, 30),
      requestGapMs: clampNum(form.value.requestGapMs, 300, 10000, 1200),
      splitSeconds: clampNum(form.value.splitSeconds, 60, 7200, 900),
      diskLimitGb: clampNum(form.value.diskLimitGb, 0.5, 100, 1)
    }
    form.value = clean
    await store.patchSettings(clean)
    message.success('设置已保存')
  } finally {
    saving.value = false
  }
}

function resetForm() {
  if (store.settings) form.value = { ...store.settings }
}

/** 头像加载失败(离线等)时静默隐藏, 保留纯渐变横幅 */
function hideBrokenImg(e: Event): void {
  ;(e.target as HTMLImageElement).style.display = 'none'
}

// ---- 左侧锚点导航(手动 scrollspy) ----
const navs = [
  { key: 'monitor', label: '监控' },
  { key: 'record', label: '录制' },
  { key: 'network', label: '网络' },
  { key: 'notify', label: '通知与行为' },
  { key: 'storage', label: '数据与日志' },
  { key: 'about', label: '关于' }
] as const
type NavKey = (typeof navs)[number]['key']

const scrollRef = ref<HTMLElement | null>(null)
const activeNav = ref<NavKey>('monitor')

function scrollToSec(key: NavKey): void {
  activeNav.value = key
  scrollRef.value
    ?.querySelector(`[data-sec="${key}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onScroll(): void {
  const box = scrollRef.value
  if (!box) return
  const boxTop = box.getBoundingClientRect().top
  let cur: NavKey = 'monitor'
  for (const n of navs) {
    const el = box.querySelector(`[data-sec="${n.key}"]`)
    if (el && el.getBoundingClientRect().top - boxTop <= 96) cur = n.key
  }
  activeNav.value = cur
}

// 开关磁贴公共样式(label+desc 左, NSwitch 右; 无边框, 浅填充)
const tileCls =
  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer transition-colors bg-gray-50/70 hover:bg-gray-100/80'
</script>

<template>
  <div class="h-full flex flex-col" v-if="form">
    <!-- 页头 -->
    <div class="px-7 pt-5 pb-4 shrink-0 flex items-center gap-3">
      <div>
        <h1 class="text-[20px] font-extrabold text-ink1 tracking-tight">设置</h1>
        <div class="text-[12px] text-ink3 mt-0.5">修改在「保存设置」后生效; 轮询相关变更保存后立即重拉一轮</div>
      </div>
      <span
        v-if="dirty"
        class="ml-auto shrink-0 h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#f0a020]/[0.14] text-[#b97a08] animate-pop"
      >有未保存的更改</span>
    </div>

    <!-- 主体: 左导航 + 右滚动区 -->
    <div class="flex-1 min-h-0 flex px-7 gap-[22px] pb-4">
      <nav class="w-[200px] shrink-0 pt-0.5">
        <button
          v-for="n in navs"
          :key="n.key"
          class="flex items-center gap-2.5 w-full px-3 py-2 rounded-[9px] text-[13px] transition-colors text-left"
          :class="activeNav === n.key
            ? 'bg-white text-ink1 font-semibold shadow-card'
            : 'text-ink2 hover:text-ink1 hover:bg-black/[0.03]'"
          @click="scrollToSec(n.key)"
        >
          <svg v-if="n.key === 'monitor'" class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2.2"/><path stroke-linecap="round" d="M12 6.5a5.5 5.5 0 015.5 5.5M12 2.8a9.2 9.2 0 019.2 9.2"/></svg>
          <svg v-else-if="n.key === 'record'" class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></svg>
          <svg v-else-if="n.key === 'network'" class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>
          <svg v-else-if="n.key === 'notify'" class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1"/></svg>
          <svg v-else-if="n.key === 'storage'" class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path stroke-linecap="round" d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>
          <svg v-else class="w-4 h-4 shrink-0" :class="activeNav === n.key ? 'text-live' : 'text-ink3'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 16v-5m0-3.5h.01"/></svg>
          {{ n.label }}
        </button>
        <div class="mt-3.5 px-3 text-[11px] text-ink3 tabular-nums">PandaLive Monitor v{{ info?.version || '…' }}</div>
      </nav>

      <!-- 内容滚动区 -->
      <div ref="scrollRef" class="flex-1 min-w-0 overflow-y-auto pb-1" @scroll="onScroll">
        <!-- 监控 -->
        <section data-sec="monitor" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">监控</h2>
            <span class="text-[11px] text-ink3 ml-auto">开播检测方式与请求节流</span>
          </div>
          <div class="bg-white rounded-[14px] shadow-card overflow-hidden">
            <div class="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div class="text-[13px] font-medium text-ink1">检测模式</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">列表模式同时驱动直播大厅; 逐个模式兼容特殊场景</div>
              </div>
              <n-radio-group v-model:value="form.watchMode" size="small">
                <n-radio-button value="list">列表模式</n-radio-button>
                <n-radio-button value="per-anchor">逐个模式</n-radio-button>
              </n-radio-group>
            </div>
            <div class="flex items-center justify-between gap-4 px-4 py-3 border-t border-line/40">
              <div>
                <div class="text-[13px] font-medium text-ink1">轮询间隔(秒)</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">列表模式建议 ≥ 10 秒; 逐个模式请 ≥ 60 秒防风控</div>
              </div>
              <n-input-number v-model:value="form.pollIntervalSec" :min="5" :max="600" size="small" class="!w-28" />
            </div>
            <div class="flex items-center justify-between gap-4 px-4 py-3 border-t border-line/40">
              <div>
                <div class="text-[13px] font-medium text-ink1">单请求节流(毫秒)</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">每个网络请求之间的最小间隔, 带随机抖动</div>
              </div>
              <n-input-number v-model:value="form.requestGapMs" :min="300" :max="10000" :step="100" size="small" class="!w-28" />
            </div>
          </div>
        </section>

        <!-- 录制 -->
        <section data-sec="record" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">录制</h2>
            <span class="text-[11px] text-ink3 ml-auto">保存位置 / 输出处理 / 自动化</span>
          </div>
          <div class="bg-white rounded-[14px] shadow-card overflow-hidden">
            <div class="flex items-center justify-between gap-4 px-4 py-3">
              <div class="min-w-0">
                <div class="text-[13px] font-medium text-ink1">保存目录</div>
                <div class="text-[11px] text-ink3 mt-0.5 truncate font-mono">{{ form.savePath || defaultRecPath }}</div>
              </div>
              <n-button size="small" secondary @click="pickDir">选择目录</n-button>
            </div>
            <div class="flex items-center justify-between gap-4 px-4 py-3 border-t border-line/40">
              <div>
                <div class="text-[13px] font-medium text-ink1">分段时长(秒)</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">按时间切分 TS 分段, 防止单文件过大 / 意外丢失</div>
              </div>
              <n-input-number v-model:value="form.splitSeconds" :min="60" :max="7200" :step="60" size="small" class="!w-28" />
            </div>
            <div class="flex items-center justify-between gap-4 px-4 py-3 border-t border-line/40">
              <div>
                <div class="text-[13px] font-medium text-ink1">磁盘剩余阈值(GB)</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">低于阈值时拒绝开始新录制</div>
              </div>
              <n-input-number v-model:value="form.diskLimitGb" :min="0.5" :max="100" :step="0.5" size="small" class="!w-28" />
            </div>

            <div class="px-4 pt-3.5 pb-1 text-[11px] font-bold text-ink3 tracking-wide border-t border-line/40">输出处理</div>
            <div class="grid grid-cols-2 gap-2.5 px-4 py-3">
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">录完自动转 MP4</div>
                  <div class="text-[10.5px] text-ink3">无损 remux</div>
                </div>
                <n-switch size="small" v-model:value="form.autoMp4" />
              </div>
              <div :class="tileCls" v-if="form.autoMp4">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">转后删除 TS 源</div>
                  <div class="text-[10.5px] text-ink3">仅保留 MP4</div>
                </div>
                <n-switch size="small" v-model:value="form.deleteTs" />
              </div>
              <div :class="tileCls" v-if="form.autoMp4">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">合并分段为单文件</div>
                  <div class="text-[10.5px] text-ink3">收尾无损合并</div>
                </div>
                <n-switch size="small" v-model:value="form.mergeMp4" />
              </div>
              <div :class="tileCls" v-if="form.autoMp4 && form.mergeMp4">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">合并后删除分段</div>
                  <div class="text-[10.5px] text-ink3">失败永远保留</div>
                </div>
                <n-switch size="small" v-model:value="form.mergeDeleteSegments" />
              </div>
            </div>

            <div class="px-4 pt-3.5 pb-1 text-[11px] font-bold text-ink3 tracking-wide border-t border-line/40">自动化</div>
            <div class="grid grid-cols-2 gap-2.5 px-4 py-3">
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">开播预取直播源</div>
                  <div class="text-[10.5px] text-ink3">点进房间零等待</div>
                </div>
                <n-switch size="small" v-model:value="form.prefetchStream" />
              </div>
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">新增默认自动录制</div>
                  <div class="text-[10.5px] text-ink3">对新关注主播生效</div>
                </div>
                <n-switch size="small" v-model:value="form.autoRecordDefault" />
              </div>
            </div>
          </div>
        </section>

        <!-- 网络 -->
        <section data-sec="network" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">网络</h2>
            <span class="text-[11px] text-ink3 ml-auto">代理同时作用于 API 与 ffmpeg 拉流</span>
          </div>
          <div class="bg-white rounded-[14px] shadow-card overflow-hidden">
            <div class="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div class="text-[13px] font-medium text-ink1">代理地址(可选)</div>
                <div class="text-[11.5px] text-ink3 mt-0.5">如 http://127.0.0.1:7890 — 直连可用时留空</div>
              </div>
              <n-input v-model:value="form.proxyUrl" size="small" placeholder="http://127.0.0.1:7890" class="!w-56" clearable />
            </div>
          </div>
        </section>

        <!-- 通知与行为 -->
        <section data-sec="notify" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">通知与行为</h2>
          </div>
          <div class="bg-white rounded-[14px] shadow-card overflow-hidden">
            <div class="grid grid-cols-3 gap-2.5 px-4 py-3">
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">系统通知</div>
                  <div class="text-[10.5px] text-ink3">开播 / 录制事件</div>
                </div>
                <n-switch size="small" v-model:value="form.notifySystem" />
              </div>
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">开播提示音</div>
                  <div class="text-[10.5px] text-ink3">WebAudio 合成</div>
                </div>
                <n-switch size="small" v-model:value="form.notifySound" />
              </div>
              <div :class="tileCls">
                <div class="min-w-0 flex-1">
                  <div class="text-[12.5px] font-semibold text-ink1 leading-snug">关窗最小化托盘</div>
                  <div class="text-[10.5px] text-ink3">后台持续监控</div>
                </div>
                <n-switch size="small" v-model:value="form.closeToTray" />
              </div>
            </div>
          </div>
        </section>

        <!-- 数据与日志 -->
        <section data-sec="storage" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">数据与日志</h2>
            <span class="text-[11px] text-ink3 ml-auto">随程序目录整体迁移, 不写系统盘</span>
          </div>
          <div class="bg-white rounded-[14px] shadow-card overflow-hidden">
            <div class="grid grid-cols-2 gap-2.5 px-4 py-3.5">
              <div class="rounded-xl bg-gray-50/70 px-3.5 py-3 min-w-0">
                <div class="text-[12.5px] font-semibold text-ink1">应用数据目录</div>
                <div class="text-[11px] text-ink3 mt-1 truncate font-mono" :title="dataDir">{{ dataDir || '…' }}</div>
                <div class="text-[10.5px] text-ink3 mt-0.5">设置 / 关注 / 录制历史 / 加密 Cookie</div>
                <n-button size="tiny" secondary class="mt-2.5" @click="openDataDir">打开目录</n-button>
              </div>
              <div class="rounded-xl bg-gray-50/70 px-3.5 py-3 min-w-0">
                <div class="text-[12.5px] font-semibold text-ink1">运行日志</div>
                <div class="text-[11px] text-ink3 mt-1 truncate font-mono">…\data\logs\app-YYYYMMDD.log</div>
                <div class="text-[10.5px] text-ink3 mt-0.5">按日切分 · 保留 14 天 · 反馈问题请附当日日志</div>
                <n-button size="tiny" secondary class="mt-2.5" @click="openLogsDir">打开日志目录</n-button>
              </div>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section data-sec="about" class="mb-5">
          <div class="flex items-baseline gap-2.5 px-1 pb-2">
            <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">关于</h2>
          </div>
          <div class="rounded-[14px] shadow-card overflow-hidden bg-white">
            <!-- 品牌横幅(头像灰度背景) -->
            <div class="relative overflow-hidden text-white" style="background: linear-gradient(115deg, #f0567f 0%, #fb7299 55%, #ffa4bc 100%)">
              <img
                src="https://github.com/Joftal.png"
                alt=""
                class="absolute -right-4 -top-7 w-[152px] h-[152px] rounded-full opacity-20 grayscale -rotate-6 pointer-events-none select-none"
                @error="hideBrokenImg"
              />
              <div class="relative z-10 px-5 py-[18px]">
                <div class="flex items-center gap-2">
                  <span class="text-[16px] font-extrabold tracking-wide">PandaLive Monitor</span>
                  <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-white/20 text-white tabular-nums">v{{ info?.version || '…' }}</span>
                </div>
                <div class="text-[11.5px] text-white/85 mt-1">直播监控 · 观看 · 录制 一体化桌面应用</div>
              </div>
            </div>
            <!-- 元信息 -->
            <div class="grid grid-cols-2">
              <div class="px-4 py-3">
                <div class="text-[10.5px] text-ink3">制作</div>
                <div class="text-[12.5px] font-semibold text-ink1 mt-0.5">{{ info?.author || 'Joftal' }}</div>
              </div>
              <div class="px-4 py-3">
                <div class="text-[10.5px] text-ink3">仓库</div>
                <div class="text-[12.5px] font-medium text-ink1 mt-0.5 font-mono truncate">Joftal/pd-monitor</div>
              </div>
            </div>
            <!-- 操作 -->
            <div class="flex items-center gap-2 px-4 py-3 flex-wrap">
              <button
                class="inline-flex items-center gap-1.5 px-4 py-[7px] rounded-lg bg-[#24292f] hover:bg-[#0d1117] text-white text-[12.5px] font-semibold transition-all active:scale-[0.97]"
                @click="openRepo"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.14c-3.2.69-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.13v3.16c0 .31.21.67.8.55A11.51 11.51 0 0023.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
                GitHub 主页
              </button>
              <n-button size="small" type="primary" :disabled="checking" @click="doCheckUpdate">
                <span class="inline-flex items-center justify-center gap-1.5"><SpinIcon v-if="checking" :size="12" />检查更新</span>
              </n-button>
              <template v-if="upd">
                <span v-if="!upd.ok" class="text-[11.5px] text-red-500">{{ upd.error || '检查失败' }}</span>
                <template v-else-if="upd.hasUpdate">
                  <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#f0a020]/[0.14] text-[#b97a08] tabular-nums">发现新版本 v{{ upd.latest }}</span>
                  <n-button size="tiny" type="primary" @click="openRelease">前往下载</n-button>
                </template>
                <span v-else class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-[#1e8a48]">已是最新版本</span>
              </template>
            </div>
            <p class="px-4 pb-3.5 text-[10.5px] text-ink3/80 leading-relaxed">
              本项目仅供个人学习研究使用, 与 pandalive 官方无任何关联; 录制内容请遵守当地法律法规与原平台条款, 勿用于任何商业用途或二次分发。
            </p>
          </div>
        </section>

        <!-- 悬浮吸底操作条(sticky 于内容滚动区底部) -->
        <div class="sticky bottom-0 pt-2" style="background: linear-gradient(rgba(241,242,243,0), rgba(241,242,243,.96) 35%)">
          <div class="flex items-center gap-2.5 bg-white/90 rounded-xl px-3.5 py-[9px] shadow-[0_4px_16px_rgba(0,0,0,.06)] backdrop-blur">
            <span class="text-[11.5px]" :class="dirty ? 'text-[#b97a08]' : 'text-ink3'">{{ dirty ? '修改尚未保存' : '全部更改已保存' }}</span>
            <div class="flex-1"></div>
            <n-button secondary :disabled="!dirty" @click="resetForm">放弃更改</n-button>
            <n-button type="primary" :disabled="!dirty || saving" @click="save" class="!w-[128px]">
              <span class="inline-flex items-center justify-center gap-1.5"><SpinIcon v-if="saving" />保存设置</span>
            </n-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
