<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput, useMessage, NPopconfirm } from 'naive-ui'
import { api } from '@/api'
import { useAppStore } from '@/stores/app'
import SpinIcon from '@/components/SpinIcon.vue'
import PlatFilter from '@/components/PlatFilter.vue'
import { DEFAULT_PLATFORM, isPlatform, type Platform } from '@shared/types'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const store = useAppStore()
const message = useMessage()
const route = useRoute()
const dataDir = ref('')

/** 两套登录态互不影响: 本页按平台分段展示, 顶栏头像带 plat 查询直接定位到对应一方 */
const plat = ref<Platform>(isPlatform(route.query.plat) ? (route.query.plat as Platform) : DEFAULT_PLATFORM)

// 已经在本页时点顶栏头像只改 query(路由复用组件, 不会重跑 setup): 不跟着切段就等于点了没反应
watch(
  () => route.query.plat,
  (v) => {
    if (isPlatform(v)) plat.value = v as Platform
  }
)

onMounted(async () => {
  dataDir.value = await api.appDataDir()
})

const winLoading = ref(false)
const cookieInput = ref('')
const importLoading = ref(false)
const credUser = ref('')
const credPass = ref('')
const credLoading = ref(false)

const isSoop = computed(() => plat.value === 'soop')
/** 当前平台的登录态(潘达看 sessKey + login_info, SOOP 看会话罐 + LOGIN_ID) */
const acc = computed(() => {
  const a = store.accounts
  if (!a) return null
  return isSoop.value
    ? { realLogin: a.soop.realLogin, held: a.soop.hasCookies, netFail: a.soop.netFail, adult: false, idx: null as number | null, id: a.soop.loginId }
    : { realLogin: a.pandalive.realLogin, held: a.pandalive.loggedIn, netFail: a.pandalive.netFail, adult: a.pandalive.isAdult, idx: a.pandalive.userIdx, id: '' }
})

const status = computed(() => {
  const a = acc.value
  if (a?.realLogin) {
    return {
      mode: 'ok' as const,
      title: t('account.stOk'),
      dot: 'bg-emerald-500 animate-breathe',
      tile: 'bg-live/10 text-live',
      desc: isSoop.value ? t('account.soopDescOk', { id: a.id }) : a.adult ? t('account.descOkAdult') : t('account.descOkNoAdult'),
      badge: !isSoop.value && a.adult ? t('account.badgeAdult') : null
    }
  }
  if (a?.held) {
    return {
      mode: 'warn' as const,
      title: t('account.stWarn'),
      dot: 'bg-amber-500 animate-breathe',
      tile: 'bg-amber-500/10 text-amber-600',
      desc: a.netFail ? t('account.netFailTip') : isSoop.value ? t('account.soopDescWarn') : t('account.descWarn'),
      badge: null
    }
  }
  return {
    mode: 'none' as const,
    title: t('account.stNone'),
    dot: 'bg-ink3',
    tile: 'bg-fill text-ink3',
    desc: isSoop.value ? t('account.soopDescNone') : t('account.descNone'),
    badge: null
  }
})

async function refresh(): Promise<void> {
  store.accounts = await api.authState()
}

/** 分段按钮上的状态点: 绿=官方校验通过, 琥珀=本地存着会话但没过官方校验, 灰=从没登录过 */
function platDot(p: Platform): string {
  const a = store.accounts
  if (!a) return 'bg-ink3'
  const s = p === 'soop' ? { live: a.soop.realLogin, held: a.soop.hasCookies } : { live: a.pandalive.realLogin, held: a.pandalive.loggedIn }
  return s.live ? 'bg-emerald-500' : s.held ? 'bg-amber-500' : 'bg-ink3'
}

/** 分段右侧状态点: 绿=官方校验通过, 琥珀=有 Cookie 未过校验, 灰=未登录 */
const platDots = computed(() => ({ pandalive: platDot('pandalive'), soop: platDot('soop') }))
const platSegOptions: Platform[] = ['pandalive', 'soop']

async function loginByWindow() {
  winLoading.value = true
  try {
    const r = await api.authOpenWindow(plat.value)
    r.ok ? message.success(r.message) : message.info(r.message)
    await refresh()
  } catch (e) {
    message.error(String((e as Error).message || e))
  } finally {
    winLoading.value = false
  }
}

async function importCookies() {
  if (!cookieInput.value.trim()) {
    message.warning(t('account.mCEmpty'))
    return
  }
  importLoading.value = true
  try {
    const r = await api.authImportCookies(cookieInput.value.trim(), plat.value)
    r.ok ? message.success(r.message) : message.error(r.message)
    if (r.ok) cookieInput.value = ''
    await refresh()
  } catch (e) {
    message.error(t('account.failImport') + String((e as Error).message || e))
  } finally {
    importLoading.value = false
  }
}

async function logout() {
  try {
    await api.authLogout(plat.value)
    await refresh()
    message.success(t('account.loggedOut'))
  } catch (e) {
    message.error(String((e as Error).message || e))
  }
}

/** SOOP 专有: 托管账密后, 取流撞 -6 由主进程后台重登一次; 账号传空串 = 解除托管 */
const managedUser = ref('')
const managed = computed(() => !!managedUser.value)
watch(
  () => store.accounts?.soop.credentialUser || '',
  (u) => {
    managedUser.value = u
    if (credUser.value !== u) credUser.value = u
  },
  { immediate: true }
)

async function saveCredentials() {
  if (!credUser.value.trim() || !credPass.value) {
    message.warning(t('account.mDEmpty'))
    return
  }
  credLoading.value = true
  try {
    const r = await api.authSaveSoopCredentials(credUser.value.trim(), credPass.value)
    r.ok ? message.success(r.message) : message.error(r.message)
    if (r.ok) credPass.value = ''
    await refresh()
  } catch (e) {
    message.error(String((e as Error).message || e))
  } finally {
    credLoading.value = false
  }
}

async function clearCredentials() {
  try {
    const r = await api.authSaveSoopCredentials('', '')
    message[r.ok ? 'success' : 'error'](r.message)
    credPass.value = ''
    await refresh()
  } catch (e) {
    message.error(String((e as Error).message || e))
  }
}
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto">
    <div class="max-w-[980px] mx-auto px-7 pt-5 pb-6">
      <!-- 页头 -->
      <div class="flex items-start">
        <div>
          <h1 class="text-[20px] font-extrabold text-ink1 tracking-tight">{{ t('account.title') }}</h1>
          <div class="text-[12px] text-ink3 mt-0.5">{{ t('account.sub') }}</div>
        </div>
        <!-- 平台分段: 两套会话彼此独立, 一次只看一方(与监控墙/录制/视频库同一 chip) -->
        <div class="ml-auto">
          <PlatFilter :values="platSegOptions" :model-value="plat" :dots="platDots" @update:model-value="(v: string) => (plat = v as Platform)" />
        </div>
      </div>

      <!-- ① 状态横幅(hero + 状态条二合一) -->
      <div class="mt-4 bg-card rounded-[14px] shadow-card px-[18px] py-4 flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-xl grid place-items-center shrink-0 transition-colors" :class="status.tile">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12a4.4 4.4 0 100-8.8 4.4 4.4 0 000 8.8zM4.5 20.4c1-4.1 4.2-6.1 7.5-6.1s6.5 2 7.5 6.1a.9.9 0 01-.88 1.1H5.38a.9.9 0 01-.88-1.1z"/>
          </svg>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full shrink-0" :class="status.dot"></span>
            <span class="text-[15px] font-bold text-ink1">{{ status.title }}</span>
            <span v-if="status.mode === 'ok' && acc?.idx" class="text-[12px] text-ink3">uid {{ acc.idx }}</span>
            <span v-else-if="status.mode === 'ok' && acc?.id" class="text-[12px] text-ink3">{{ acc.id }}</span>
          </div>
          <div class="text-[12px] text-ink3 mt-0.5">{{ status.desc }}</div>
        </div>
        <div class="ml-auto flex items-center gap-2 shrink-0">
          <span v-if="status.badge" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-emerald-600">{{ status.badge }}</span>
          <span v-if="!isSoop && store.accounts?.pandalive.encrypted" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#61666d]/10 text-ink2">{{ t('account.badgeEnc') }}</span>
          <n-popconfirm v-if="status.mode !== 'none'" @positive-click="logout">
            <template #trigger>
              <n-button size="small" tertiary type="error">{{ t('account.logout') }}</n-button>
            </template>
            {{ isSoop ? t('account.logoutConfirmSoop') : t('account.logoutConfirm') }}
          </n-popconfirm>
        </div>
      </div>

      <!-- ② 登录方式 -->
      <div class="flex items-baseline gap-2.5 px-1 mt-5 mb-2">
        <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">{{ t('account.methods') }}</h2>
        <span class="text-[11px] text-ink3 ml-auto">{{ t('account.methodsHint') }}</span>
      </div>

      <!-- 方式 A: 网页登录 -->
      <section class="bg-card rounded-[14px] shadow-card px-[18px] py-4 flex flex-col">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mB') }}</h3>
          <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-live/[0.12] text-brand-dark">{{ t('account.mARec') }}</span>
        </div>
        <p class="text-[12px] text-ink3 leading-relaxed mt-2">{{ t('account.mBDesc') }}</p>
        <div class="mt-2.5 space-y-1.5 flex-1">
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT1') }}
          </div>
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT2') }}
          </div>
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT3') }}
          </div>
        </div>
        <div class="flex items-center gap-2.5 mt-3.5">
          <span class="text-[11px] text-ink3">{{ isSoop ? t('account.mBHintSoop') : t('account.mBHint') }}</span>
          <n-button size="small" secondary type="primary" :disabled="winLoading" @click="loginByWindow" class="ml-auto !w-[112px]">
            <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="winLoading" :size="12" />{{ t('account.mBBtn') }}</span>
          </n-button>
        </div>
      </section>

      <!-- 方式 B: Cookie 导入 -->
      <section class="bg-card rounded-[14px] shadow-card px-[18px] py-4 mt-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path stroke-linecap="round" d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h4"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mC') }}</h3>
          <span class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-emerald-600">{{ t('account.mCStable') }}</span>
        </div>
        <div class="grid md:grid-cols-[46%_1fr] gap-4 mt-3">
          <ol class="space-y-2">
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">1</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS1a') }}<span class="text-live font-semibold">{{ isSoop ? 'sooplive.com' : 'pandalive.co.kr' }}</span>{{ t('account.mCS1b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">2</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS2a') }}<code class="bg-fill border border-line rounded px-1 text-[11px] font-mono text-brand-dark">F12</code>{{ t('account.mCS2b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">3</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS3a') }}<code class="bg-fill border border-line rounded px-1 text-[11px] font-mono text-brand-dark">document.cookie</code>{{ t('account.mCS3b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand-dark bg-live/[0.12] shrink-0 mt-px">4</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ isSoop ? t('account.mCS4Soop') : t('account.mCS4') }}</span>
            </li>
          </ol>
          <div class="flex flex-col">
            <n-input
              v-model:value="cookieInput"
              type="textarea"
              :rows="4"
              :placeholder="isSoop ? t('account.soopCookiePh') : 'sessKey=xxxx; 79b0c6d4…=xxxx; partner=pandatv; ...'"
            />
            <div class="flex items-center gap-2.5 mt-2.5">
              <span class="text-[11px] text-ink3">{{ isSoop ? t('account.soopImportHint') : t('account.mCHint') }}</span>
              <n-button size="small" type="primary" :disabled="!cookieInput.trim() || importLoading" @click="importCookies" class="ml-auto !w-[104px]">
                <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="importLoading" :size="12" />{{ t('account.mCBtn') }}</span>
              </n-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 方式 C: 账密自动重登(SOOP 专有, 与潘达"只留网页登录/Cookie"的取向刻意不同) -->
      <section v-if="isSoop" class="bg-card rounded-[14px] shadow-card px-[18px] py-4 mt-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-[9px] grid place-items-center text-ink2 bg-[#9499a0]/10 shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a4 4 0 10-3.9 4H7.5A3.5 3.5 0 004 14.5V17a3 3 0 003 3h9a3 3 0 003-3v-.5"/><path stroke-linecap="round" d="M17 7h.01"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mD') }}</h3>
          <span v-if="managed" class="h-[22px] inline-flex items-center px-[9px] rounded-[7px] text-[11px] font-semibold bg-[#2fad5f]/[0.12] text-emerald-600">{{ t('account.mDManaged', { id: managedUser }) }}</span>
        </div>
        <p class="text-[12px] text-ink3 leading-relaxed mt-2">{{ t('account.mDDesc') }}</p>
        <div class="flex items-center gap-2.5 mt-3">
          <n-input v-model:value="credUser" size="small" :placeholder="t('account.mDUser')" class="!w-[180px]" />
          <n-input v-model:value="credPass" size="small" type="password" :placeholder="t('account.mDPass')" class="flex-1" />
          <n-button size="small" secondary :disabled="credLoading || !credUser.trim() || !credPass" @click="saveCredentials" class="!w-[112px]">
            <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="credLoading" :size="12" />{{ t('account.mDBtn') }}</span>
          </n-button>
          <n-popconfirm v-if="managed" @positive-click="clearCredentials">
            <template #trigger>
              <n-button size="small" tertiary type="error">{{ t('account.mDClear') }}</n-button>
            </template>
            {{ t('account.mDClearConfirm') }}
          </n-popconfirm>
        </div>
        <p class="text-[11px] text-ink3/80 mt-2.5">{{ t('account.mDSecure') }}</p>
      </section>

      <p class="text-center text-[11px] text-ink3/80 mt-4 break-all">
        {{ t('account.doorNote', { dir: dataDir || '…' }) }}
      </p>
    </div>
  </div>
</template>
