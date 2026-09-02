<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useNotification } from 'naive-ui'
import { api } from '@/api'
import { useAppStore, playDing } from '@/stores/app'
import type { Toast } from '@shared/types'

const notification = useNotification()
const store = useAppStore()
let off: (() => void) | null = null

onMounted(() => {
  off = api.onToast((t: Toast) => {
    const typeMap = {
      live: 'success',
      offline: 'default',
      rec: 'info',
      error: 'error',
      info: 'default'
    } as const
    notification.create({
      title: t.title,
      content: t.body || undefined,
      type: typeMap[t.type] || 'default',
      duration: 4500,
      keepAliveOnHover: true
    })
    if (t.type === 'live' && store.settings?.notifySound) playDing()
  })
})

onUnmounted(() => off?.())
</script>

<template><div class="hidden"></div></template>
