import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'explore', component: () => import('@/views/ExploreView.vue'), meta: { title: '直播大厅' } },
    { path: '/monitor', name: 'monitor', component: () => import('@/views/MonitorView.vue'), meta: { title: '已关注' } },
    { path: '/player/:userId', name: 'player', component: () => import('@/views/PlayerView.vue'), meta: { title: '观看直播' } },
    { path: '/recordings', name: 'recordings', component: () => import('@/views/RecordingsView.vue'), meta: { title: '录制' } },
    { path: '/library', name: 'library', component: () => import('@/views/LibraryView.vue'), meta: { title: '视频库' } },
    { path: '/account', name: 'account', component: () => import('@/views/AccountView.vue'), meta: { title: '账号' } },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } }
  ]
})
