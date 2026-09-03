<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NConfigProvider, NMessageProvider, NNotificationProvider, NDialogProvider, darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import ToastBridge from '@/components/ToastBridge.vue'
import TopNav from '@/components/TopNav.vue'

const store = useAppStore()
const ready = ref(false)

const BRAND = {
  primaryColor: '#fb7299',
  primaryColorHover: '#fc8bab',
  primaryColorPressed: '#f0567f',
  primaryColorSuppl: '#fb7299',
  successColor: '#2fad5f',
  errorColor: '#f25d8e',
  warningColor: '#f0a020',
  borderRadius: '8px',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif"
}

const LIGHT_OVERRIDES = {
  common: {
    ...BRAND,
    bodyColor: '#f1f2f3',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    inputColor: '#f1f2f3',
    borderColor: '#e3e5e7',
    textColorBase: '#18191c'
  },
  Card: { borderColor: '#e3e5e7' },
  Button: { textColorPrimary: '#fff', textColorHoverPrimary: '#fff' },
  Tag: { borderRadius: '4px' },
  Input: { borderRadius: '8px' },
  Pagination: { itemColorActive: 'rgba(251,114,153,.12)', itemTextColorActive: '#fb7299' }
}

const DARK_OVERRIDES = {
  common: {
    ...BRAND,
    bodyColor: '#181818',
    cardColor: '#1f1f1f',
    modalColor: '#252526',
    popoverColor: '#252526',
    inputColor: '#313131',
    borderColor: '#3c3c3c',
    textColorBase: '#cccccc'
  },
  Card: { borderColor: '#2b303c' },
  Button: { textColorPrimary: '#fff', textColorHoverPrimary: '#fff' },
  Tag: { borderRadius: '4px' },
  Input: { borderRadius: '8px' },
  Pagination: { itemColorActive: 'rgba(251,114,153,.18)', itemTextColorActive: '#fc8bab' }
}

const isDark = computed(() => store.settings?.theme === 'dark')
const themeOverrides = computed(() => (isDark.value ? DARK_OVERRIDES : LIGHT_OVERRIDES))

// 主题落地: <html> 加 .dark 类(tailwind class 策略) + localStorage 镜像(main.ts 启动防闪白读取)
watch(
  isDark,
  (v) => {
    document.documentElement.classList.toggle('dark', v)
    try {
      localStorage.setItem('pl-theme', v ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    await store.init()
  } catch (e) {
    console.error(e)
  } finally {
    ready.value = true
  }
})
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : null" :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN" class="h-full">
    <n-message-provider>
      <n-notification-provider placement="bottom-right">
        <n-dialog-provider>
          <ToastBridge />
          <div class="h-full flex flex-col bg-page text-ink1 select-none">
            <TopNav />
            <main class="flex-1 min-h-0 overflow-hidden relative">
              <router-view v-if="ready" v-slot="{ Component }">
                <transition name="fade" mode="out-in">
                  <component :is="Component" />
                </transition>
              </router-view>
              <div v-else class="h-full flex items-center justify-center text-ink3 text-sm">加载中…</div>
            </main>
          </div>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>
