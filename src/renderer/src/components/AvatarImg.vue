<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// 头像的唯一画法: 有地址且取到了才占槽位, 否则由调用方的兜底(首字母/剪影)顶上。
// 加载失败是预期内的一档 —— SOOP 的 logo 地址是频道 ID 的函数(官方播放页自己也带 onerror),
// 没传过头像的房就是 404; 把浏览器的破图画在圆位上, 比这个位置空着更难看。
defineOptions({ inheritAttrs: false })

const props = defineProps<{ src: string; lazy?: boolean }>()
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false)
)
const show = computed(() => !!props.src && !failed.value)
</script>

<template>
  <img v-if="show" v-bind="$attrs" :src="src" :loading="lazy ? 'lazy' : 'eager'" referrerpolicy="no-referrer" decoding="async" @error="failed = true" />
  <slot v-else />
</template>
