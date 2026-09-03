import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles.css'

// 主题防闪白: store 初始化前先用 localStorage 镜像恢复 .dark(App.vue 负责维护镜像)
try {
  if (localStorage.getItem('pl-theme') === 'dark') document.documentElement.classList.add('dark')
} catch {
  /* ignore */
}

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
