<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, useMessage, NPopconfirm } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import SpinIcon from '@/components/SpinIcon.vue'

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
      dot: 'bg-emerald-500 animate-breathe',
      tile: 'bg-live/10 text-live',
      desc: a.isAdult ? '账号权限完整, 含成人认证, 全部内容可用' : '已登录, 但账号未完成 pandalive 成人认证, 19+ 内容仍不可用',
      badge: a.isAdult ? '成人认证 ✓' : null
    }
  }
  if (a?.loggedIn) {
    return {
      mode: 'warn' as const,
      title: '会话未认证',
      dot: 'bg-amber-500 animate-breathe',
      tile: 'bg-amber-500/10 text-amber-600',
      desc: '之前的登录未通过官方校验, 请重新登录',
      badge: null
    }
  }
  return {
    mode: 'none' as const,
    title: '未登录',
    dot: 'bg-ink3',
    tile: 'bg-gray-100 text-ink3',
    desc: '登录后可解锁成人房 / 粉丝团等权限内容, 大厅显示 19+ 房间',
    badge: null
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
  <div class="h-full min-h-0 overflow-y-auto">
    <div class="max-w-[980px] mx-auto px-7 pt-5 pb-6">
      <!-- 页头 -->
      <div>
        <h1 class="text-[20px] font-extrabold text-ink1 tracking-tight">账号</h1>
        <div class="text-[12px] text-ink3 mt-0.5">登录后可解锁成人房 / 粉丝团权限内容 · Cookie 经 Windows DPAPI 加密, 仅存本机</div>
      </div>

      <!-- ① 状态横幅(hero + 状态条二合一) -->
      <div class="mt-4 bg-white rounded-[14px] shadow-card px-[18px] py-4 flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-xl grid place-items-center shrink-0 transition-colors" :class="status.tile">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12a4.4 4.4 0 100-8.8 4.4 4.4 0 000 8.8zM4.5 20.4c1-4.1 4.2-6.1 7.5-6.1s6.5 2 7.5 6.1a.9.9 0 01-.88 1.1H5.38a.9.9 0 01-.88-1.1z"/>
          </svg>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full shrink-0" :class="status.dot"></span>
            <span class="text-[15px] font-bold text-ink1">{{ status.title }}</span>
            <span v-if="status.mode === 'ok' && store.account?.userIdx" class="text-[12px] text-ink3">uid {{ store.account.userIdx }}</span>
          </div>
          <div class="text-[12px] text-ink3 mt-0.5">{{ status.desc }}</div>
        </div>
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <span v-if="status.badge" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-[#1e8a48]">{{ status.badge }}</span>
          <span v-if="store.account?.encrypted" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#61666d]/10 text-ink2">🔒 加密存储</span>
          <n-popconfirm v-if="status.mode !== 'none'" @positive-click="logout">
            <template #trigger>
              <n-button size="small" tertiary type="error">退出登录</n-button>
            </template>
            退出登录将删除本地保存的 Cookie, 确定?
          </n-popconfirm>
        </div>
      </div>

      <!-- ② 登录方式 -->
      <div class="flex items-baseline gap-2.5 px-1 mt-5 mb-2">
        <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">登录方式</h2>
        <span class="text-[11px] text-ink3 ml-auto">任一方式成功即完成会话建立; 被风控拦截时往下换一种</span>
      </div>

      <div class="grid lg:grid-cols-2 gap-3.5">
        <!-- 方式 A: 账号密码 -->
        <section class="bg-white rounded-[14px] shadow-card px-[18px] py-4 flex flex-col">
          <div class="flex items-center gap-2.5">
            <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
              <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="15" r="4"/><path stroke-linecap="round" stroke-linejoin="round" d="M10.85 12.15L19 4m-4 3l2.5 2.5M14 5.5L16.5 8"/></svg>
            </span>
            <h3 class="text-[14px] font-bold text-ink1">账号密码登录</h3>
            <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-live/[0.12] text-brand-dark">推荐</span>
          </div>
          <p class="text-[12px] text-ink3 leading-relaxed mt-2">最简单的方式; 密码仅用于换取 Cookie, 不会被保存</p>
          <div class="grid grid-cols-2 gap-2.5 mt-3">
            <n-input v-model:value="loginId" placeholder="PandaLive 账号 ID" />
            <n-input v-model:value="password" type="password" show-password-on="click" placeholder="密码" @keyup.enter="loginByPassword" />
          </div>
          <div class="flex items-center gap-2.5 mt-3.5">
            <span class="text-[11px] text-ink3">被防自动登录拦截时, 改用右侧两种方式</span>
            <n-button size="small" type="primary" :disabled="loading" @click="loginByPassword" class="ml-auto !w-[88px]">
              <span class="inline-flex items-center justify-center gap-1.5"><SpinIcon v-if="loading" :size="12" />登录</span>
            </n-button>
          </div>
        </section>

        <!-- 方式 B: 网页登录 -->
        <section class="bg-white rounded-[14px] shadow-card px-[18px] py-4 flex flex-col">
          <div class="flex items-center gap-2.5">
            <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
              <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>
            </span>
            <h3 class="text-[14px] font-bold text-ink1">网页登录</h3>
          </div>
          <p class="text-[12px] text-ink3 leading-relaxed mt-2">在应用内置窗口打开官方登录页, 由你亲自完成登录</p>
          <div class="mt-2.5 space-y-1.5 flex-1">
            <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
              <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>支持验证码 / 二次验证
            </div>
            <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
              <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>成功后自动捕获 Cookie 关窗
            </div>
            <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
              <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>事件驱动, 零轮询
            </div>
          </div>
          <div class="flex items-center gap-2.5 mt-3.5">
            <span class="text-[11px] text-ink3">适合需要人机验证的场景</span>
            <n-button size="small" secondary type="primary" :disabled="winLoading" @click="loginByWindow" class="ml-auto !w-[112px]">
              <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="winLoading" :size="12" />打开登录窗口</span>
            </n-button>
          </div>
        </section>
      </div>

      <!-- 方式 C: Cookie 导入 -->
      <section class="bg-white rounded-[14px] shadow-card px-[18px] py-4 mt-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path stroke-linecap="round" d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h4"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">Cookie 导入登录</h3>
          <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-[#1e8a48]">最稳定</span>
        </div>
        <div class="grid md:grid-cols-[46%_1fr] gap-4 mt-3">
          <ol class="space-y-2">
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">1</span>
              <span class="text-[12px] text-ink2 leading-relaxed">日常浏览器(Chrome/Edge)打开 <span class="text-live font-semibold">pandalive.co.kr</span> 并完成登录</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">2</span>
              <span class="text-[12px] text-ink2 leading-relaxed">按 <code class="bg-gray-50 border border-line rounded px-1 text-[11px] font-mono text-brand-dark">F12</code> 打开开发者工具 → Console 控制台</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">3</span>
              <span class="text-[12px] text-ink2 leading-relaxed">输入 <code class="bg-gray-50 border border-line rounded px-1 text-[11px] font-mono text-brand-dark">document.cookie</code> 回车, 复制整串结果</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">4</span>
              <span class="text-[12px] text-ink2 leading-relaxed">粘贴到右侧, 点击「导入并验证」</span>
            </li>
          </ol>
          <div class="flex flex-col">
            <n-input
              v-model:value="cookieInput"
              type="textarea"
              :rows="4"
              placeholder="sessKey=xxxx; 79b0c6d4…=xxxx; partner=pandatv; ..."
            />
            <div class="flex items-center gap-2.5 mt-2.5">
              <span class="text-[11px] text-ink3">防自动登录拦截时的终极方案, 一次导入长期有效</span>
              <n-button size="small" type="primary" :disabled="!cookieInput.trim() || importLoading" @click="importCookies" class="ml-auto !w-[104px]">
                <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="importLoading" :size="12" />导入并验证</span>
              </n-button>
            </div>
          </div>
        </div>
      </section>

      <p class="text-center text-[11px] text-ink3/80 mt-4 break-all">
        Cookie 与账号数据经 Windows DPAPI 加密, 仅保存于本机数据目录: {{ dataDir || '…' }}
      </p>
    </div>
  </div>
</template>
