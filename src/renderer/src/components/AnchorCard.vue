<script setup lang="ts">
import { computed } from 'vue'
import { NPopover, NSwitch } from 'naive-ui'
import type { Anchor } from '@shared/types'
import { useAppStore } from '@/stores/app'
import { api } from '@/api'
import { useI18n } from 'vue-i18n'
import LiveCard, { type LiveCardModel } from '@/components/LiveCard.vue'

const { t } = useI18n()

const props = defineProps<{ anchor: Anchor }>()
const emit = defineEmits<{ (e: 'remove', userId: string): void }>()
const store = useAppStore()

const model = computed<LiveCardModel>(() => {
  const a = props.anchor
  return {
    userId: a.userId,
    nick: a.nick,
    title: a.title || '',
    thumbUrl: a.thumbUrl || '',
    userImg: a.userImg || '',
    isLive: !!a.isLive,
    recording: store.isRecording(a.userId),
    srcReady: store.isSrcReady(a.userId),
    isAdult: a.tags?.isAdult,
    isPw: a.tags?.isPw,
    isRec: a.tags?.liveType === 'rec',
    isFan: a.tags?.type === 'fan',
    viewers: a.viewerCount || 0,
    likes: a.likes || 0,
    fans: a.fans || 0,
    startTime: a.startTime
  }
})

async function setAuto(v: boolean): Promise<void> {
  await api.anchorsSetAuto(props.anchor.userId, v)
  store.anchors = await api.anchorsList()
}
</script>

<template>
  <LiveCard :model="model">
    <template #meta>
      <n-popover trigger="click" placement="bottom-end" :show-arrow="false">
        <template #trigger>
          <button class="w-7 h-7 rounded-lg grid place-items-center text-ink3 hover:text-ink1 hover:bg-fill/70 transition-colors shrink-0" @click.stop>
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
          </button>
        </template>
        <div class="py-1 w-44">
          <div class="px-3 py-2 flex items-center justify-between text-[12.5px] text-ink1">
            <span>{{ t('monitor.autoRecTitle') }}</span>
            <n-switch size="small" :value="props.anchor.autoRecord" @update:value="setAuto" />
          </div>
          <div class="px-3 py-2 text-[12.5px] text-ink2 hover:bg-fillh cursor-pointer" @click="api.openExternal('https://www.pandalive.co.kr/play/' + model.userId)">
            {{ t('monitor.openInBrowser') }}
          </div>
          <div class="px-3 py-2 text-[12.5px] text-red-500 hover:bg-red-50 cursor-pointer" @click="emit('remove', model.userId)">
            {{ t('card.unfollow') }}
          </div>
        </div>
      </n-popover>
    </template>
  </LiveCard>
</template>
