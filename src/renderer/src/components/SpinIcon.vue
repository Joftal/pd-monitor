<script setup lang="ts">
// 通用加载转圈: 内联 svg + tailwind animate-spin, 放在 n-button 内容区(普通流)
// —— 全局不使用 naive :loading(绝对定位形态在不同版本表现不稳定)
withDefaults(defineProps<{ size?: number }>(), { size: 14 })
</script>

<template>
  <svg
    class="animate-spin shrink-0"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
