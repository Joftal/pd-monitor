<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NTag, useMessage, NPopconfirm } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const message = useMessage()
const dataDir = ref('')

onMounted(async () => {
  dataDir.value = await api.appDataDir()
})

const loginId = ref('')
const password = ref('')
const loading = ref(false)
const winLoading = ref(false)
const cookieInput = ref('')
const importLoading = ref(false)

const status = computed(() => {
  const a = store.account
  if (a?.realLogin) {
    return {
      mode: 'ok' as const,
      title: '已登录',
      desc: a.isAdult ? '账号权限完整, 含成人认证, 全部内容可用' : '已登录, 但账号未完成 pandalive 成人认证, 19+ 内容仍不可用',
      badge: a.isAdult ? '成人认证 ✓' : null
    }
  }
  if (a?.loggedIn) {
    return {
      mode: 'warn' as const,
      title: '会话未认证',
      desc: '之前的登录未通过官方校验, 请重新登录'
    }
  }
  return {
    mode: 'none' as const,
    title: '未登录',
    desc: '登录后可解锁成人房 / 粉丝团等权限内容, 大厅显示 19+ 房间'
  }
})

async function loginByPassword() {
  if (!loginId.value.trim() || !password.value) {
    message.warning('请输入账号和密码')
    return
  }
  loading.value = true
  try {
    const r = await api.authLoginPassword(loginId.value.trim(), password.value)
    if (r.ok) {
      message.success('登录成功, Cookie 已加密保存')
      password.value = ''
      store.account = await api.authState()
    } else {
      message.error(r.message)
    }
  } catch (e) {
    message.error('登录请求失败: ' + String((e as Error).message || e).replace(/^.*Error: /, ''))
  } finally {
    loading.value = false
  }
}

async function loginByWindow() {
  winLoading.value = true
  try {
    const r = await api.authOpenWindow()
    r.ok ? message.success(r.message) : message.info(r.message)
    store.account = await api.authState()
  } finally {
    winLoading.value = false
  }
}

async function importCookies() {
  if (!cookieInput.value.trim()) {
    message.warning('请先粘贴 Cookie 字符串')
    return
  }
  importLoading.value = true
  try {
    const r = await api.authImportCookies(cookieInput.value.trim())
    r.ok ? message.success(r.message) : message.error(r.message)
    if (r.ok) cookieInput.value = ''
    store.account = await api.authState()
  } catch (e) {
    message.error('导入失败: ' + String((e as Error).message || e).replace(/^.*Error: /, ''))
  } finally {
    importLoading.value = false
  }
}

async function logout() {
  await api.authLogout()
  store.account = await api.authState()
  message.success('已退出登录并清除 Cookie')
}
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <div class="flex-1 min-h-0 overflow-y-auto p-7">
      <div class="max-w-[720px] mx-auto space-y-5 pb-4">

        <!-- Hero 品牌区 -->
        <section
          class="relative rounded-2xl overflow-hidden p-7 text-white"
          style="background: linear-gradient(120deg, #fb7299 0%, #e256a0 55%, #8b5cf6 100%)"
        >
          <div class="absolute -right-10 -top-14 w-56 h-56 rounded-full bg-white/10"></div>
          <div class="absolute -right-2 bottom-[-70px] w-40 h-40 rounded-full bg-white/10"></div>
          <div class="relative flex items-start gap-5">
            <!-- 人像头像 -->
            <div
              class="w-[72px] h-[72px] rounded-full grid place-items-center shrink-0 ring-4 ring-white/25 mt-1"
              :class="store.account?.realLogin ? 'bg-white' : 'bg-white/25'"
            >
              <svg
                class="w-10 h-10"
                :class="store.account?.realLogin ? 'text-live' : 'text-white/90'"
                viewBox="0 0 24 24" fill="currentColor"
              >
                <path d="M12 12a4.4 4.4 0 100-8.8 4.4 4.4 0 000 8.8zM4.5 20.4c1-4.1 4.2-6.1 7.5-6.1s6.5 2 7.5 6.1a.9.9 0 01-.88 1.1H5.38a.9.9 0 01-.88-1.1z"/>
              </svg>
            </div>
            <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-[13px] opacity-90 tracking-wide">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
              PANDALIVE MONITOR
            </div>
            <h1 class="text-[26px] font-bold mt-2 tracking-tight">账号登录</h1>
            <p class="text-[13px] mt-1.5 opacity-90 leading-relaxed max-w-[420px]">
              登录后可使用成人房 / 粉丝团等权限内容, 大厅将展示 19+ 直播间; Cookie 仅加密保存在本机, 不会上传任何服务器
            </p>
            <div class="mt-4 flex items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-semibold"
                :class="status.mode === 'ok' ? 'bg-white text-live' : status.mode === 'warn' ? 'bg-white text-amber-500' : 'bg-black/20 text-white'"
              >
                <span class="w-1.5 h-1.5 rounded-full" :class="status.mode === 'ok' ? 'bg-live animate-breathe' : status.mode === 'warn' ? 'bg-amber-500' : 'bg-white/70'"></span>
                {{ status.title }}
              </span>
              <span v-if="status.badge" class="inline-flex items-center h-7 px-3 rounded-full text-[12px] font-semibold bg-black/20 text-white">
                {{ status.badge }}
              </span>
              <span v-if="store.account?.encrypted" class="inline-flex items-center h-7 px-3 rounded-full text-[12px] bg-black/20 text-white">
                🔒 加密存储
              </span>
            </div>
            </div>
          </div>
        </section>

        <!-- 状态提示条(已登录/未认证时) -->
        <section
          v-if="status.mode !== 'none'"
          class="rounded-2xl px-5 py-4 flex items-center gap-3 border"
          :class="status.mode === 'ok' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'"
        >
          <span class="text-xl">{{ status.mode === 'ok' ? '✅' : '⚠️' }}</span>
          <p class="text-[13px] flex-1" :class="status.mode === 'ok' ? 'text-emerald-700' : 'text-amber-700'">{{ status.desc }}</p>
          <n-popconfirm @positive-click="logout">
            <template #trigger>
              <n-button size="small" tertiary type="error" round>退出登录</n-button>
            </template>
            退出登录将删除本地保存的 Cookie, 确定?
          </n-popconfirm>
        </section>

        <!-- 登录方式卡 1: 账号密码 -->
        <section class="rounded-2xl bg-white border border-line shadow-card p-6 space-y-4 hover:shadow-card-hover transition-shadow">
          <div class="flex items-start gap-4">
            <div class="w-9 h-9 rounded-xl bg-live/10 text-live grid place-items-center font-bold text-[15px] shrink-0">1</div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h2 class="text-[15px] font-bold text-ink1">账号密码登录</h2>
                <n-tag size="small" type="error" :bordered="false">推荐</n-tag>
              </div>
              <p class="text-[12px] text-ink3 mt-1">最简单的方式, 密码仅用于换取 Cookie, 不会被保存</p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <n-input v-model:value="loginId" placeholder="PandaLive 账号 ID" size="large" />
            <n-input v-model:value="password" type="password" show-password-on="click" placeholder="密码" size="large" @keyup.enter="loginByPassword" />
          </div>
          <div class="flex items-center justify-between">
            <p class="text-[11.5px] text-ink3">若提示被防自动登录拦截, 请用方式 2 或 3</p>
            <n-button type="primary" round :loading="loading" @click="loginByPassword" class="!w-24">登录</n-button>
          </div>
        </section>

        <!-- 登录方式卡 2: 网页登录 -->
        <section class="rounded-2xl bg-white border border-line shadow-card p-6 space-y-3 hover:shadow-card-hover transition-shadow">
          <div class="flex items-start gap-4">
            <div class="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-500 grid place-items-center font-bold text-[15px] shrink-0">2</div>
            <div class="flex-1">
              <h2 class="text-[15px] font-bold text-ink1">网页登录</h2>
              <p class="text-[12px] text-ink3 mt-1 leading-relaxed">
                在应用内置窗口打开官方登录页, 由你亲自完成登录(支持验证码 / 二次验证), 成功后自动捕获 Cookie 并关闭窗口
              </p>
            </div>
          </div>
          <div class="flex justify-end">
            <n-button secondary type="info" round :loading="winLoading" @click="loginByWindow" class="!w-[132px]">打开登录窗口</n-button>
          </div>
        </section>

        <!-- 登录方式卡 3: Cookie 导入 -->
        <section class="rounded-2xl bg-white border border-line shadow-card p-6 space-y-3 hover:shadow-card-hover transition-shadow">
          <div class="flex items-start gap-4">
            <div class="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 grid place-items-center font-bold text-[15px] shrink-0">3</div>
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h2 class="text-[15px] font-bold text-ink1">Cookie 导入登录</h2>
                <n-tag size="small" type="success" :bordered="false">最稳定</n-tag>
              </div>
              <p class="text-[12px] text-ink3 mt-1">防自动登录拦截时的终极方案, 一次导入长期有效</p>
            </div>
          </div>
          <div class="rounded-xl bg-gray-50 border border-line/70 px-4 py-3">
            <ol class="text-[12px] text-ink2 leading-[1.9] list-decimal list-inside">
              <li>日常浏览器(Chrome/Edge)打开 <span class="text-live">pandalive.co.kr</span> 完成登录</li>
              <li>按 <code class="bg-white border border-line px-1.5 py-0.5 rounded text-[11px]">F12</code> → Console 控制台</li>
              <li>输入 <code class="bg-white border border-line px-1.5 py-0.5 rounded text-[11px]">document.cookie</code> 回车并复制整串结果</li>
              <li>粘贴到下方, 点击导入验证</li>
            </ol>
          </div>
          <n-input
            v-model:value="cookieInput"
            type="textarea"
            :rows="3"
            placeholder="sessKey=xxxx; 79b0c6d4…=xxxx; partner=pandatv; ..."
          />
          <div class="flex justify-end">
            <n-button secondary type="success" round :loading="importLoading" :disabled="!cookieInput.trim()" @click="importCookies" class="!w-[112px]">
              导入并验证
            </n-button>
          </div>
        </section>

        <!-- 底部数据说明 -->
        <p class="text-center text-[11.5px] text-ink3 pt-1">
          Cookie 与账号数据经 Windows DPAPI 加密, 仅保存于本机数据目录:
          <span class="break-all">{{ dataDir || '…' }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
