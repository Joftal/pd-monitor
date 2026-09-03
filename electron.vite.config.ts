import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    // vue-i18n esm-bundler 需显式注入 feature flags, 否则 resolveMessageFormat 按未编译词条走会抛 I18nError(白屏)
    define: {
      __VUE_I18N_FULL_INSTALL__: 'true',
      __VUE_I18N_LEGACY_API__: 'false',
      __INTLIFY_JIT_COMPILATION__: 'true',
      __INTLIFY_DROP_MESSAGE_COMPILER__: 'false'
    },
    plugins: [
      vue(),
      // 构建期预编译 i18n 词条为函数 —— 规避 vue-i18n 运行时 new Function 编译被 CSP(script-src 'self') 拦截导致的白屏
      vueI18n({ include: [resolve('src/renderer/src/i18n/locales/**')] })
    ],
    build: { outDir: 'out/renderer' }
  }
})
