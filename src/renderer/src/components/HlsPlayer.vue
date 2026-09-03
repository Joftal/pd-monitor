<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import Hls from 'hls.js'

const props = defineProps<{ src: string; autoplay?: boolean }>()
const emit = defineEmits<{
  (e: 'fatal'): void
  (e: 'url-dead'): void
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null

function destroy(): void {
  hls?.destroy()
  hls = null
}

function load(src: string): void {
  destroy()
  const video = videoEl.value
  if (!video || !src) return
  if (Hls.isSupported()) {
    hls = new Hls({
      lowLatencyMode: true,
      backBufferLength: 30,
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 4
    })
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => undefined)
    })
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // 403/404 = 播放令牌失效, 上抛让上层换源; 其余网络错误本层重试
        const code = data.response?.code
        if (code === 403 || code === 404 || data.details === 'manifestLoadError') {
          emit('url-dead')
        } else {
          hls?.startLoad()
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls?.recoverMediaError()
      } else {
        emit('url-dead')
      }
    })
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src
    video.play().catch(() => undefined)
  } else {
    emit('fatal')
  }
}

watch(
  () => props.src,
  (v) => {
    if (v) load(v)
  }
)

onMounted(() => {
  if (props.src) load(props.src)
})

onUnmounted(destroy)
</script>

<template>
  <video ref="videoEl" class="w-full h-full bg-black" :autoplay="autoplay" controls playsinline></video>
</template>
