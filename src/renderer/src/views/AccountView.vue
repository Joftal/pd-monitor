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
/** 当前平台的登录态(Panda 看 sessKey + login_info, SOOP 看会话罐 + LOGIN_ID) */
const acc = computed(() => {
  const a = store.accounts
  if (!a) return null
  return isSoop.value
    ? { realLogin: a.soop.realLogin, held: a.soop.hasCookies, netFail: a.soop.netFail, adult: false, idx: null as number | null, id: a.soop.loginId, verifyAt: a.soop.lastVerifyAt }
    : { realLogin: a.pandalive.realLogin, held: a.pandalive.loggedIn, netFail: a.pandalive.netFail, adult: a.pandalive.isAdult, idx: a.pandalive.userIdx, id: '', verifyAt: a.pandalive.lastVerifyAt }
})

const status = computed(() => {
  const a = acc.value
  // 态还没回来只能是「正在校验」: 冷启动不再等官方接口, 把 null 报成未登录会凭空吓人去重登
  if (!a) {
    return {
      mode: 'checking' as const,
      title: t('account.stChecking'),
      dot: 'bg-deco',
      tile: 'bg-fill text-deco',
      desc: t('account.checkingDesc'),
      badge: null
    }
  }
  if (a.realLogin) {
    return {
      mode: 'ok' as const,
      title: t('account.stOk'),
      dot: 'bg-ok animate-breathe',
      tile: 'bg-ok/10 text-okink',
      desc: isSoop.value ? t('account.soopDescOk', { id: a.id }) : a.adult ? t('account.descOkAdult') : t('account.descOkNoAdult'),
      badge: !isSoop.value && a.adult ? t('account.badgeAdult') : null
    }
  }
  if (a.held) {
    return {
      mode: 'warn' as const,
      title: t('account.stWarn'),
      dot: 'bg-warn animate-breathe',
      tile: 'bg-warnbg text-warnink',
      desc: a.netFail ? t('account.netFailTip') : isSoop.value ? t('account.soopDescWarn') : t('account.descWarn'),
      badge: null
    }
  }
  return {
    mode: 'none' as const,
    title: t('account.stNone'),
    dot: 'bg-deco',
    tile: 'bg-fill text-deco',
    desc: isSoop.value ? t('account.soopDescNone') : t('account.descNone'),
    badge: null
  }
})

async function refresh(): Promise<void> {
  store.accounts = await api.authState()
}

/** 分段按钮上的登录态: 色点 + 短标签双通道(设计稿 S9) —— 纯色点时「琥珀」会被读成「已登录」 */
function platState(p: Platform): { dot: string; text: string } {
  const a = store.accounts
  if (!a) return { dot: 'bg-deco', text: t('nav.checking') }
  const s = p === 'soop' ? { live: a.soop.realLogin, held: a.soop.hasCookies } : { live: a.pandalive.realLogin, held: a.pandalive.loggedIn }
  return s.live
    ? { dot: 'bg-ok', text: t('account.segOk') }
    : s.held
      ? { dot: 'bg-warn', text: t('account.segWarn') }
      : { dot: 'bg-deco', text: t('account.segNone') }
}

const platStates = computed(() => ({ pandalive: platState('pandalive'), soop: platState('soop') }))
const platSegOptions: Platform[] = ['pandalive', 'soop']

/** 「上次校验 MM-DD HH:mm」: 官方最后一次真实答复的时刻, 不是"页面最后刷新时刻" */
const lastVerifyText = computed(() => {
  const ms = acc.value?.verifyAt || 0
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

const recheckLoading = ref(false)

/** 立即向官方重发一次校验(绕过主进程结果缓存), 三态之一如实回显 */
async function recheck() {
  recheckLoading.value = true
  try {
    store.accounts = await api.authRecheck(plat.value)
    // netFail 时既不是"已登录"也不是"会话未认证" —— 请求本身没成, 报状态会把它读成服务端判死
    const outcome = acc.value?.netFail ? t('account.recheckNetFail') : status.value.title
    message.info(t('account.recheckResult', { state: outcome }))
  } catch (e) {
    message.error(String((e as Error).message || e))
  } finally {
    recheckLoading.value = false
  }
}

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
          <h1 class="page-h">{{ t('account.title') }}</h1>
          <div class="text-[12px] text-ink3 mt-0.5">{{ t('account.sub') }}</div>
        </div>
        <!-- 平台分段: 两套会话彼此独立, 一次只看一方(与监控墙/录制/视频库同一 chip) -->
        <div class="ml-auto">
          <PlatFilter :values="platSegOptions" :model-value="plat" :states="platStates" @update:model-value="(v: string) => (plat = v as Platform)" />
        </div>
      </div>

      <!-- 密钥降级: 页顶阻断式告警(设计稿 S9 ④)。原先埋在 SOOP 方式 C 的第三行小字里,
           而那句"凭据经系统安全存储加密"在降级态就是假话, 必须在看到假话之前先看到更正 -->
      <div v-if="store.settings && !store.settings.secretsEncrypted" class="mt-4 rounded-ctl border border-warn/45 bg-warnbg px-[14px] py-3 flex items-start gap-2.5">
        <svg class="w-[17px] h-[17px] text-warnink shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.6 2.9 20h18.2z"/><path stroke-linecap="round" d="M12 10v4.2M12 17.2h.01"/></svg>
        <div class="text-[12px] text-warnink leading-relaxed min-w-0">{{ t('account.vaultDown') }}</div>
      </div>

      <!-- ① 状态横幅(hero + 状态条 + 校验轨三合一; 校验轨单独一行, 窄窗口不把按钮挤掉) -->
      <div class="mt-4 bg-card rounded-card shadow-card px-[18px] py-4 flex flex-col gap-3">
        <div class="flex items-center gap-3.5">
          <div class="w-10 h-10 rounded-xl grid place-items-center shrink-0 transition-colors" :class="status.tile">
            <svg v-if="status.mode === 'warn'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.6 2.9 20h18.2z"/><path stroke-linecap="round" d="M12 10v4.2M12 17.2h.01"/></svg>
            <svg v-else-if="status.mode !== 'ok'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6.5 12h11"/></svg>
            <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
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
            <span v-if="status.badge" class="badge badge-md bg-ok/10 text-okink">{{ status.badge }}</span>
            <span v-if="!isSoop && store.accounts?.pandalive.encrypted" class="badge badge-md bg-fill text-ink2">{{ t('account.badgeEnc') }}</span>
            <!-- 退出只在「确实有会话」时给: 校验中或确实未登录时摆一枚红色退出按钮是空承诺 -->
            <n-popconfirm v-if="status.mode === 'ok' || status.mode === 'warn'" @positive-click="logout">
              <template #trigger>
                <n-button size="small" tertiary type="error">{{ t('account.logout') }}</n-button>
              </template>
              {{ isSoop ? t('account.logoutConfirmSoop') : t('account.logoutConfirm') }}
            </n-popconfirm>
          </div>
        </div>
        <!-- 校验轨: 「会话未认证」与「已登录」的差别全靠这行的时刻 + 复检按钮说清 -->
        <div v-if="status.mode !== 'none'" class="flex items-center gap-2">
          <span v-if="lastVerifyText" class="badge badge-md bg-fill text-ink2">{{ t('account.lastVerify', { time: lastVerifyText }) }}</span>
          <span v-else class="text-[11px] text-ink3">{{ t('account.neverVerified') }}</span>
          <n-button size="small" secondary :disabled="recheckLoading" @click="recheck" class="ml-auto !w-[104px]">
            <span class="inline-flex items-center justify-center gap-1"><SpinIcon v-if="recheckLoading" :size="12" />{{ t('account.recheck') }}</span>
          </n-button>
        </div>
      </div>

      <!-- ② 登录方式 -->
      <div class="flex items-baseline gap-2.5 px-1 mt-5 mb-2">
        <h2 class="text-[13.5px] font-bold text-ink1 tracking-wide">{{ t('account.methods') }}</h2>
        <span class="text-[11px] text-ink3 ml-auto">{{ t('account.methodsHint') }}</span>
      </div>

      <!-- 方式 A: 网页登录 -->
      <section class="bg-card rounded-card shadow-card px-[18px] py-4 flex flex-col">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-ctl grid place-items-center text-ink2 bg-fill shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mB') }}</h3>
          <span class="badge badge-md bg-brand/[0.10] text-brand">{{ t('account.mARec') }}</span>
        </div>
        <p class="text-[12px] text-ink3 leading-relaxed mt-2">{{ t('account.mBDesc') }}</p>
        <div class="mt-2.5 space-y-1.5 flex-1">
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-okink shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT1') }}
          </div>
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-okink shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT2') }}
          </div>
          <div class="flex items-center gap-1.5 text-[11.5px] text-ink2">
            <svg class="w-3 h-3 text-okink shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>{{ t('account.mBT3') }}
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
      <section class="bg-card rounded-card shadow-card px-[18px] py-4 mt-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-ctl grid place-items-center text-ink2 bg-fill shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path stroke-linecap="round" d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h4"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mC') }}</h3>
          <span class="badge badge-md bg-ok/10 text-okink">{{ t('account.mCStable') }}</span>
        </div>
        <div class="grid md:grid-cols-[46%_1fr] gap-4 mt-3">
          <ol class="space-y-2">
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand bg-brand/[0.10] shrink-0 mt-px">1</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS1a') }}<span class="text-brand font-semibold">{{ isSoop ? 'sooplive.com' : 'pandalive.co.kr' }}</span>{{ t('account.mCS1b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand bg-brand/[0.10] shrink-0 mt-px">2</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS2a') }}<code class="bg-fill border border-line rounded px-1 text-[11px] font-mono text-brand">F12</code>{{ t('account.mCS2b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand bg-brand/[0.10] shrink-0 mt-px">3</span>
              <span class="text-[12px] text-ink2 leading-relaxed">{{ t('account.mCS3a') }}<code class="bg-fill border border-line rounded px-1 text-[11px] font-mono text-brand">document.cookie</code>{{ t('account.mCS3b') }}</span>
            </li>
            <li class="flex gap-2.5 items-start">
              <span class="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold text-brand bg-brand/[0.10] shrink-0 mt-px">4</span>
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

      <!-- 方式 C: 账密自动重登(SOOP 专有, 与 Panda"只留网页登录/Cookie"的取向刻意不同) -->
      <section v-if="isSoop" class="bg-card rounded-card shadow-card px-[18px] py-4 mt-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-[30px] h-[30px] rounded-ctl grid place-items-center text-ink2 bg-fill shrink-0">
            <svg class="w-[15px] h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a4 4 0 10-3.9 4H7.5A3.5 3.5 0 004 14.5V17a3 3 0 003 3h9a3 3 0 003-3v-.5"/><path stroke-linecap="round" d="M17 7h.01"/></svg>
          </span>
          <h3 class="text-[14px] font-bold text-ink1">{{ t('account.mD') }}</h3>
          <span v-if="managed" class="badge badge-md bg-ok/10 text-okink">{{ t('account.mDManaged', { id: managedUser }) }}</span>
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
