<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import Hls from 'hls.js'

const props = defineProps<{ src: string; autoplay?: boolean }>()
const emit = defineEmits<{ (e: 'fatal', msg: string): void }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const levels = ref<{ height: number; bitrate: number; index: number }[]>([])
const currentLevel = ref(-1) // -1 = 自动
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
      levelLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 4
    })
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      levels.value = (hls?.levels || []).map((l, i) => ({ height: l.height, bitrate: l.bitrate, index: i }))
      video.play().catch(() => undefined)
    })
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls?.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError()
        } else {
          emit('fatal', data.details || '播放出错')
        }
      }
    })
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src
    video.play().catch(() => undefined)
  } else {
    emit('fatal', '当前环境不支持 HLS 播放')
  }
}

function setLevel(i: number): void {
  if (!hls) return
  currentLevel.value = i
  hls.currentLevel = i
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

defineExpose({ setLevel, levels, currentLevel })
</script>

<template>
  <video ref="videoEl" class="w-full h-full bg-black" :autoplay="autoplay" controls playsinline></video>
</template>
