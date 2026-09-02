<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NConfigProvider, NMessageProvider, NNotificationProvider, NDialogProvider } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import ToastBridge from '@/components/ToastBridge.vue'
import TopNav from '@/components/TopNav.vue'

const store = useAppStore()
const ready = ref(false)

const themeOverrides = {
  common: {
    primaryColor: '#fb7299',
    primaryColorHover: '#fc8bab',
    primaryColorPressed: '#f0567f',
    primaryColorSuppl: '#fb7299',
    successColor: '#2fad5f',
    errorColor: '#f25d8e',
    warningColor: '#f0a020',
    bodyColor: '#f1f2f3',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    inputColor: '#f1f2f3',
    borderColor: '#e3e5e7',
    textColorBase: '#18191c',
    borderRadius: '8px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif"
  },
  Card: { borderColor: '#e3e5e7' },
  Button: { textColorPrimary: '#fff', textColorHoverPrimary: '#fff' },
  Tag: { borderRadius: '4px' },
  Input: { borderRadius: '8px' },
  Pagination: { itemColorActive: 'rgba(251,114,153,.12)', itemTextColorActive: '#fb7299' }
}

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
  <n-config-provider :theme-overrides="themeOverrides" class="h-full">
    <n-message-provider>
      <n-notification-provider placement="bottom-right">
        <n-dialog-provider>
          <ToastBridge />
          <div class="h-full flex flex-col bg-page text-gray-900 select-none">
            <TopNav />
            <main class="flex-1 min-h-0 overflow-hidden relative">
              <router-view v-if="ready" v-slot="{ Component }">
                <transition name="fade" mode="out-in">
                  <component :is="Component" />
                </transition>
              </router-view>
              <div v-else class="h-full flex items-center justify-center text-gray-400 text-sm">加载中…</div>
            </main>
          </div>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>
