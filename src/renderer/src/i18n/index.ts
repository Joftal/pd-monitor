import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

// ============ 渲染层 i18n(vue-i18n) ============
// locale 事实源 = store.settings.locale(App.vue watch 同步)
// 新页面直接 $t / t() 取词; 新增语言 = 新增一个 locales/xx.ts 并在本文件注册
// ===================================================

export type AppLocale = 'zh-CN' | 'en-US'

export const i18n = createI18n({
  legacy: false, // Composition 模式
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

/** 切换语言(由 App.vue 监听 settings.locale 调用; template/组件无须感知) */
export function setLocale(l: AppLocale): void {
  ;(i18n.global.locale as unknown as { value: AppLocale }).value = l
}
