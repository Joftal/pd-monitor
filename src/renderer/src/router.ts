import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'explore', component: () => import('@/views/ExploreView.vue') },
    { path: '/monitor', name: 'monitor', component: () => import('@/views/MonitorView.vue') },
    { path: '/player/:userId', name: 'player', component: () => import('@/views/PlayerView.vue') },
    { path: '/recordings', name: 'recordings', component: () => import('@/views/RecordingsView.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue') },
    { path: '/account', name: 'account', component: () => import('@/views/AccountView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') }
  ]
})
