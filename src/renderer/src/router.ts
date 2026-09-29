import { createRouter, createWebHashHistory } from 'vue-router'
import { DEFAULT_PLATFORM } from '@shared/types'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'explore', component: () => import('@/views/ExploreView.vue') },
    { path: '/monitor', name: 'monitor', component: () => import('@/views/MonitorView.vue') },
    { path: '/player/:platform/:userId', name: 'player', component: () => import('@/views/PlayerView.vue') },
    // 单平台时代的深链(#/player/<userId>)不带平台段, 匹配不到两段式路由会停在空白页; 补一条兼容路径
    { path: '/player/:userId', redirect: (to) => ({ name: 'player', params: { platform: DEFAULT_PLATFORM, userId: to.params.userId } }) },
    { path: '/recordings', name: 'recordings', component: () => import('@/views/RecordingsView.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue') },
    { path: '/account', name: 'account', component: () => import('@/views/AccountView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') }
  ]
})
