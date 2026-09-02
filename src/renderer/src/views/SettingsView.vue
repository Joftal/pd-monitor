<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSwitch, NRadioGroup, NRadioButton, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import type { Settings } from '@shared/types'

const store = useAppStore()
const message = useMessage()
const form = ref<Settings | null>(null)
const saving = ref(false)
const dataDir = ref('')

onMounted(async () => {
  dataDir.value = await api.appDataDir()
})

async function openDataDir() {
  await api.recOpenFolder(dataDir.value)
}

watch(
  () => store.settings,
  (s) => {
    if (s && !form.value) form.value = { ...s }
  },
  { immediate: true }
)

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && !Number.isNaN(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

async function pickDir() {
  const d = await api.settingsSelectDir()
  if (d && form.value) form.value.savePath = d
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
</script>

<template>
  <div class="h-full flex flex-col min-h-0" v-if="form">
    <div class="flex-1 min-h-0 overflow-y-auto p-7">
    <div class="max-w-[680px] mx-auto space-y-5">
      <h1 class="text-[22px] font-bold text-gray-900 tracking-tight">设置</h1>

      <!-- 监控 -->
      <section class="rounded-2xl bg-white border border-gray-200/70 shadow-card p-5 space-y-4">
        <h2 class="text-[14px] font-bold text-gray-800">监控</h2>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">检测模式</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">列表模式同时驱动直播大厅; 逐个模式兼容特殊场景</div>
          </div>
          <n-radio-group v-model:value="form.watchMode" size="small">
            <n-radio-button value="list">列表模式</n-radio-button>
            <n-radio-button value="per-anchor">逐个模式</n-radio-button>
          </n-radio-group>
        </div>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">轮询间隔(秒)</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">列表模式建议 ≥ 10 秒; 逐个模式请 ≥ 60 秒防风控</div>
          </div>
          <n-input-number v-model:value="form.pollIntervalSec" :min="5" :max="600" size="small" class="!w-28" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">单请求节流(毫秒)</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">每个网络请求之间的最小间隔, 带随机抖动</div>
          </div>
          <n-input-number v-model:value="form.requestGapMs" :min="300" :max="10000" :step="100" size="small" class="!w-28" />
        </div>
      </section>

      <!-- 录制 -->
      <section class="rounded-2xl bg-white border border-gray-200/70 shadow-card p-5 space-y-4">
        <h2 class="text-[14px] font-bold text-gray-800">录制</h2>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">保存目录</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5 truncate max-w-[320px]">{{ form.savePath || '(默认: 视频/PandaLive)' }}</div>
          </div>
          <n-button size="small" secondary round @click="pickDir">选择目录</n-button>
        </div>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">分段时长(秒)</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">按时间切分 TS 分段, 防止单文件过大 / 意外丢失</div>
          </div>
          <n-input-number v-model:value="form.splitSeconds" :min="60" :max="7200" :step="60" size="small" class="!w-28" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="text-[13px] text-gray-700">录完自动转 MP4(无损 remux)</div>
          <n-switch v-model:value="form.autoMp4" />
        </div>
        <div class="flex items-center justify-between gap-4" v-if="form.autoMp4">
          <div class="text-[13px] text-gray-700">转 MP4 后删除 TS 源文件</div>
          <n-switch v-model:value="form.deleteTs" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="text-[13px] text-gray-700">新增主播默认开启「开播自动录制」</div>
          <n-switch v-model:value="form.autoRecordDefault" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">磁盘剩余阈值(GB)</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">低于阈值时拒绝开始新录制</div>
          </div>
          <n-input-number v-model:value="form.diskLimitGb" :min="0.5" :max="100" :step="0.5" size="small" class="!w-28" />
        </div>
      </section>

      <!-- 网络 -->
      <section class="rounded-2xl bg-white border border-gray-200/70 shadow-card p-5 space-y-4">
        <h2 class="text-[14px] font-bold text-gray-800">网络</h2>
        <div class="flex items-center justify-between gap-4">
          <div>
            <div class="text-[13px] text-gray-700">代理地址(可选)</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5">如 http://127.0.0.1:7890 — 直连可用时留空</div>
          </div>
          <n-input v-model:value="form.proxyUrl" size="small" placeholder="http://127.0.0.1:7890" class="!w-56" clearable />
        </div>
      </section>

      <!-- 数据存储 -->
      <section class="rounded-2xl bg-white border border-gray-200/70 shadow-card p-5 space-y-4">
        <h2 class="text-[14px] font-bold text-gray-800">数据存储</h2>
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[13px] text-gray-700">应用数据目录</div>
            <div class="text-[11.5px] text-gray-400 mt-0.5 break-all">
              {{ dataDir || '…' }}
            </div>
            <div class="text-[11.5px] text-gray-400 mt-1">设置 / 关注列表 / 录制历史 / 登录 Cookie 均保存在程序所在目录, 随程序文件夹整体迁移</div>
          </div>
          <n-button size="small" secondary round @click="openDataDir">打开目录</n-button>
        </div>
      </section>

      <!-- 通知与行为 -->
      <section class="rounded-2xl bg-white border border-gray-200/70 shadow-card p-5 space-y-4">
        <h2 class="text-[14px] font-bold text-gray-800">通知与行为</h2>
        <div class="flex items-center justify-between gap-4">
          <div class="text-[13px] text-gray-700">系统通知(开播/录制事件)</div>
          <n-switch v-model:value="form.notifySystem" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="text-[13px] text-gray-700">开播提示音</div>
          <n-switch v-model:value="form.notifySound" />
        </div>
        <div class="flex items-center justify-between gap-4">
          <div class="text-[13px] text-gray-700">关闭窗口时最小化到托盘</div>
          <n-switch v-model:value="form.closeToTray" />
        </div>
      </section>

      <div class="flex justify-end pb-4">
        <n-button type="primary" round size="large" :loading="saving" @click="save" class="!w-[150px]">保存设置</n-button>
      </div>
    </div>
    </div>
  </div>
</template>
