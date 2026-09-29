<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { type Platform } from '@shared/types'

// 全应用唯一的"选平台"控件: 监控墙筛选 / 录制 / 视频库 / 账号页 / 关注弹窗共用同一形态
// (设计稿第②屏 P4: 一个控件一个长相)
type Opt = 'all' | 'auto' | Platform

const props = withDefaults(
  defineProps<{
    modelValue: string
    values?: Opt[]
    /** 传了就渲染计数, 与选项同位 */
    counts?: Record<string, number>
    /** 选项右侧状态点(账号页用它标登录态), 值为背景色 class */
    dots?: Record<string, string>
  }>(),
  { values: () => ['all', 'pandalive', 'soop'] }
)

const emit = defineEmits<{ (e: 'update:modelValue', v: Opt): void }>()
const { t } = useI18n()

function label(v: Opt): string {
  if (v === 'all') return t('monitor.platAll')
  if (v === 'auto') return t('monitor.platAuto')
  return v === 'soop' ? 'SOOP' : 'PandaLive'
}

/** 色点承担平台身份, 与 PlatTag 同源; 浅色底给一层描边环 —— #ffd400 压白卡几乎看不见(约 1.4:1) */
function platColor(v: Opt): string {
  return v === 'pandalive' ? 'var(--plat-panda)' : v === 'soop' ? 'var(--plat-soop-accent)' : 'transparent'
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      v-for="v in values"
      :key="v"
      class="pf"
      :class="modelValue === v ? 'is-on' : ''"
      @click="emit('update:modelValue', v)"
    >
      <i v-if="v === 'pandalive' || v === 'soop'" class="pf__dot" :style="{ background: platColor(v) }"></i>
      <span>{{ label(v) }}</span>
      <span v-if="counts" class="pf__n">{{ counts[v] ?? 0 }}</span>
      <i v-if="dots && dots[v]" class="pf__state" :class="dots[v]"></i>
    </button>
  </div>
</template>

<style scoped>
.pf {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgb(var(--c-line));
  background: rgb(var(--c-card));
  color: rgb(var(--c-ink2));
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.pf:hover {
  border-color: rgb(var(--c-ink3));
  color: rgb(var(--c-ink1));
}
/* 选中态只加粗+中性底, 不改成潘达粉: 选中 "SOOP" 时用潘达的身份色表达"当前项",
   等于用 A 平台的颜色代表 B 平台(设计稿第②屏的判定)。平台身份只由色点承担。 */
.pf.is-on {
  background: rgb(var(--c-fillh));
  border-color: rgb(var(--c-ink3));
  color: rgb(var(--c-ink1));
  font-weight: 700;
}
.pf__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  /* 描边环: #ffd400 压白卡只有 1.43:1, 用 --c-line(1.26:1) 等于没描; ink3 在浅底 3.06:1、深底 4.1:1, 两主题都勾得出边 */
  box-shadow: 0 0 0 1px rgb(var(--c-ink3));
}
.pf__n {
  font-size: 11px;
  opacity: 0.65;
}
.pf__state {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
</style>
