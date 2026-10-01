import { Anchor, AnchorTag, Platform } from '../../shared/types'
import { api, PlayResult } from './pandalive'
import { soopApi } from './soop'
import { store } from './store'

// ============ 跨平台取流入口 ============
// 录制/播放不认平台, 只认这套同语义契约:
//   getPlayCached = 命中有效缓存零请求, 未命中才拉源(在途去重)
//   fetchPlay     = 强制现拉(直播探针)
//   invalidatePlay= 显式作废该房间源包
// 新增平台只需再实现一个同契约客户端并在此登记。
// =======================================

export interface RoomSource {
  getPlayCached(id: string, password?: string, forceFresh?: boolean): Promise<PlayResult>
  fetchPlay(id: string, password?: string): Promise<PlayResult>
  invalidatePlay(id: string): void
}

export function sourceFor(platform: Platform): RoomSource {
  return platform === 'soop' ? soopApi : api
}

/** 取流结果里的主播元数据回写关注记录 —— 只对 SOOP 生效:
 *  SOOP 的开播时刻(BTIME 反推)和密码房标记只有 CHANNEL 接口给, 轮询侧只读播放页, 拿不到;
 *  Panda 这两个值每轮都由列表/bj 的平台原值维护, 再回写一份等于两套真值打架, 故不碰。
 *  仅在值确有变化时写(每次写都会触发落盘)。
 *  按字段合并而不是整包覆写: 这一路只观察得到 isPw/liveType —— 19+ 与粉丝团是列表的字段,
 *  拿一个"这一路没看到的字段"去写 false, 等于每次开播/取源都把真值擦一次(实机抓到过)。
 *  返回合并后的房态, 让渲染层拿到与库里同一份。 */
export function applyPlayMeta(platform: Platform, userId: string, r: PlayResult): AnchorTag | null {
  if (platform !== 'soop' || !r.ok) return null
  const a = store.listAnchors().find((x) => x.platform === platform && x.userId === userId)
  if (!a) return null
  const patch: Partial<Anchor> = {}
  if (r.startTime && r.startTime !== a.startTime) patch.startTime = r.startTime
  const m = (r.media || {}) as { isPw?: boolean; isAdult?: boolean; type?: string; liveType?: string }
  const prev = a.tags
  const tags: AnchorTag = {
    isAdult: typeof m.isAdult === 'boolean' ? m.isAdult : !!prev?.isAdult,
    isPw: typeof m.isPw === 'boolean' ? m.isPw : !!prev?.isPw,
    type: m.type ?? String(prev?.type || ''),
    liveType: m.liveType ?? String(prev?.liveType || 'live')
  }
  if (JSON.stringify(tags) !== JSON.stringify(prev)) patch.tags = tags
  if (Object.keys(patch).length) store.updateAnchor(platform, userId, patch)
  return tags
}
