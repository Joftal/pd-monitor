import { defineStore } from 'pinia'
import type { AccountState, Anchor, DiscoveryItem, RecHistoryItem, RecTask, Settings, WatcherStatus } from '@shared/types'
import { api } from '@/api'

// ============ 提示音(WebAudio, 免资源文件) ============
let audioCtx: AudioContext | null = null
export function playDing(): void {
  try {
    audioCtx = audioCtx || new AudioContext()
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.setValueAtTime(1174.66, t + 0.12)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.55)
  } catch {
    /* ignore */
  }
}

interface State {
  anchors: Anchor[]
  discovery: DiscoveryItem[]
  recordings: RecTask[]
  history: RecHistoryItem[]
  settings: Settings | null
  watcher: WatcherStatus | null
  account: AccountState | null
  searchKeyword: string
  /** 已获取有效直播源的主播 userId 集(主进程播放源缓存的快照推送; 卡片绿框依据) */
  srcCache: string[]
}

export const useAppStore = defineStore('app', {
  state: (): State => ({
    anchors: [],
    discovery: [],
    recordings: [],
    history: [],
    settings: null,
    watcher: null,
    account: null,
    searchKeyword: '',
    srcCache: []
  }),
  getters: {
    liveAnchors: (s) => s.anchors.filter((a) => a.isLive),
    offlineAnchors: (s) => s.anchors.filter((a) => !a.isLive),
    activeRecs: (s) => s.recordings.filter((r) => r.status === 'recording' || r.status === 'remuxing'),
    isRecording: (s) => (userId: string) =>
      s.recordings.some((r) => r.userId === userId && (r.status === 'recording' || r.status === 'remuxing')),
    isFollowing: (s) => (userId: string) => s.anchors.some((a) => a.userId === userId),
    /** 该房间是否已持有有效直播源(点了就能播/录, 无需再拉) */
    isSrcReady: (s) => (userId: string) => s.srcCache.includes(userId)
  },
  actions: {
    async init() {
      const [anchors, recordings, settings, watcherStatus, account, history, discovery, srcCache] = await Promise.all([
        api.anchorsList(),
        api.recList(),
        api.settingsGet(),
        api.watcherStatus(),
        api.authState(),
        api.recHistory(),
        api.discoveryList(),
        api.liveSrcCache()
      ])
      this.anchors = anchors
      this.recordings = recordings
      this.settings = settings
      this.watcher = watcherStatus
      this.account = account
      this.history = history
      this.discovery = discovery
      this.srcCache = srcCache

      api.onAnchors((list) => (this.anchors = list))
      api.onDiscovery((list) => (this.discovery = list))
      api.onSrcCache((ids) => (this.srcCache = ids))
      // M6: 任务集/状态变化才全量重拉历史 —— 录制推送每 2s/任务, 盲目 refresh 会拖累整库
      let lastRecSig = ''
      api.onRecordings((list) => {
        this.recordings = list
        const sig = list.map((task) => task.id + ':' + task.status).join('|')
        if (sig !== lastRecSig) {
          lastRecSig = sig
          void this.refreshHistory()
        }
      })
      api.onWatcher((w) => (this.watcher = w))
      api.onAccount((a) => (this.account = a))
    },
    async refreshHistory() {
      this.history = await api.recHistory()
    },
    async patchSettings(patch: Partial<Settings>) {
      this.settings = await api.settingsSet(patch)
    },
    async follow(userId: string) {
      await api.anchorsAdd(userId)
    },
    async unfollow(userId: string) {
      await api.anchorsRemove(userId)
    }
  }
})
