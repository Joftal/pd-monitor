# 全面代码审查报告（2026-09-03 · 已逐条核销）

**范围**：主进程 14 文件 · 渲染层 28+ 文件 · 契约/工程配置 10+ 文件。
**方法**：分区初审 → **每一条逐一代码核销**；以下清单仅保留确证为真的问题（原初审中 1 条"潜伏性非缺陷"已剔除、1 条描述收窄）。
**结论速览**：架构健康，但存在 **6 个高严重问题**（录制状态机 2 个真实竞态、CI 版本错位、定时器泄漏、英文数值错 10 倍、失效样式 token)，建议按本节优先级处理。

---

## 一、高严重度（建议立即修复）★全部已核销

### H1. 录制引擎：停滞/磁盘触发的收尾会与 ffmpeg exit 处理器**重复 finalize**
- **位置**:`src/main/services/recorder.ts` `checkStall():276,285` × `spawnFfmpeg exit 回调(226-247)` × `finalize()`
- **实锤**：错误路径调 `finalize('error')` → `killProc()` 写 'q' → ffmpeg 先注册在 spawnFfmpeg 的 `exit` 监听器被触发，此时 `stopping=false`（错误路径从不置位）、`status` 仍 `recording` → 进入 `handleUnexpectedExit` → **再做网络探针 + 二次 finalize** → 同一任务历史入库两条、toast 双发、状态甚至改判（error↔done)。`stop()` 因先置 `stopping=true` 不受影响
- **修法**:`finalize()` 入口置 `finalized=true` 守卫（早于一切 await);exit 回调同查

### H2. 录制引擎：`run()` 与 `stop()` 启动窗口竞态 → **孤儿 ffmpeg 无限写盘**
- **位置**:`recorder.ts run():144-168`
- **实锤**:`await api.getPlayCached()`（网络往返）期间 `stop()` 可完成全套收尾（proc 为 null 直通、入库、移除）;`run()` 随后无条件 `spawnFfmpeg()+setInterval` → 产生无人管理的录制进程持续写盘，`checkStall` 因 status≠recording 永久短路，用户再无入口停止
- **修法**:`getPlayCached` 与 `fetchPlaylistDurationSec` 之后、`spawnFfmpeg` 之前检查 `this.stopping || this.status !== 'recording'` 并直接返回

### H3. CI 发版：打包 job 检出 bump 前提交 → **产物版本号与 Release 错位**
- **位置**:`.github/workflows/release.yml` package job 的 `actions/checkout@v4`
- **实锤**:`checkout` 不传 `ref` = 检出触发时刻 SHA；版本提交是 bump job 运行中才推的 → 三平台产物文件名与 `app.getVersion()` 全是旧版本，却挂到新 tag 下，Asset Guide 中文件名对不上实物
- **修法**:checkout 加 `with: { ref: main }`（依赖 needs:bump,tip 即 bump 提交）

### H4. 大厅页：1 秒定时器注册在 setup 顶层，全文件**无任何清理钩子**
- **位置**:`src/renderer/src/views/ExploreView.vue:68-69`
- **实锤**：该文件无 onMounted/onUnmounted；无 keep-alive 切换即卸载组件而 interval 永活，反复进出累积 N 个每秒定时器并滞留卸载组件的闭包状态
- **修法**：移到 `onMounted` + `onUnmounted` 清理

### H5. 英文界面"万"折算错误：**数值错 10 倍**
- **位置**:`en-US.ts:common.myriad='0k'` + `AnchorCard.vue:31 / ExploreCard.vue:30 fmtNum`(/10000 两语言共用）
- **实锤**：英文 23456 → "2.30k"（实为 23k)
- **修法**：按 locale 分支 zh `/10000+'万'` / en `/1000+'k'`，并收敛 fmtNum 到 utils

### H6. `live-dark` token 不存在 → 渐变/hover 静默失效
- **位置**:`LibraryView.vue:324`(`to-live-dark/80`)、`CinemaOverlay.vue:255`(`hover:bg-live-dark`)
- **实锤**:tailwind.config 只有 `live` 与 `brand.dark`，无 `live-dark` → JIT 不生成该类
- **修法**：改 `brand-dark`

---

## 二、中严重度（建议尽快处理）★全部已核销

| # | 位置 | 问题（实锤摘要） | 修法 |
|---|---|---|---|
| M1 | index.ts:164-177 × recorder.ts:stop() | 退出保护漏 `remuxing`:finalize 途中退出截断 MP4(faststart 未写完） | quit 判定纳入 remuxing 并等收尾 |
| M2 | ipc.ts authImportCookies × pandalive.importCookies:476-482 | 导入过期 Cookie **连带注销**有效会话（先落盘后全清）；且内部+ipc 共发两次 login_info | 先试验证后落盘；消重 |
| M3 | pandalive.ts:212-221 | fetchText 对 403/404 也走 Node 兜底**重发一遍**，风控面 ×2 | 仅网络异常兜底，HTTP 错直抛 |
| M4 | authWin.ts:61-83 | `verifying` 锁存 + session.fetch 无超时 → 验证挂起后**登录窗探测永久失效**(debounce 重试被锁存短路）;Node 兜底虽有 20s 超时，主链路没有 | 校验加超时/锁存看门狗 |
| M5 | vault.ts:22-32 | cookie 文件**直写非原子**(db.json 有 tmp+rename)，崩溃截断丢登录态 | 同款 tmp+rename |
| M6 | recorder.ts:165(statTimer 2s→push) × stores/app.ts:79-82 | 有任务在录时渲染层**每 2 秒全量重拉历史** | 状态变化才推或渲染比对后刷新 |
| M7 | App.vue:64-81 | 主题 watch `immediate:true` 在 settings=null 时以 false 开跑，把 localStorage 覆写 light → **防闪白自我抵消**(locale watch 有 `if(v)` 守卫，主题没有） | 加空值守卫 |
| M8 | preload ↔ env.d.ts | 契约双写：`ApiBridge` 已导出但**无任何消费方**，40+ 签名三处人肉同步 | interface 移交 shared/types.ts,preload implements,env.d.ts 引用 |
| M9 | index.ts:71-73 | `sandbox:false` 过宽（preload 仅用 ipcRenderer+Buffer，沙箱 preload 自带 polyfill;contextIsolation 已在） | 改 `sandbox: true` |
| M10 | ipc.ts recOpenFolder | 仅判 truthy → 可 `shell.openPath` 任意路径（对照 openExternal 有白名单） | 限录制根/历史目录之下 |
| M11 | electron-builder.yml mac.artifactName | 覆盖 zip 默认 `-mac` 后缀 → 实物 `…-arm64.zip`，发布说明表写 `…-arm64-mac.zip`(404) | 二选一统一 |
| M12 | scripts/icon-build.mjs:26 | DIB `biBitCount` 应在 offset **14**，代码读 12(biPlanes=1) → 遇 BMP 帧 ico 解乱图（当前全 PNG 帧未暴露） | `readUInt16LE(14)` |
| M13 | scripts/icon-build.mjs:201 | 右下角色采 `-2/-1/+0` 错位且混入 alpha；底色透明时阈值被拉到 120，洪泛将侵入浅色边缘（当前产物恰逢四角纯白未触发，换源图标即错） | 只采 `+0/+1/+2` |
| M14 | AnchorCard.vue × ExploreCard.vue | 结构/样式/SVG 近乎逐行双胞胎 | 合并 LiveCard(props/slot 分异） |
| M15 | LibraryView.vue:120-126 | `watch(groups)` 对全部 rows 突发 N 个 IPC（非视口懒加载），重进页面整轮重发（主进程缓存兜底仍往返） | `requested` 迁 store 或 IntersectionObserver |

---

## 三、低严重度（清理项）★逐条已核销

**死代码 / 死状态**
- `recorder.ts openFolder()` 无人调用 · `thumbs.root` 属性 · `pandalive saveCookies` 应收窄 private（调用点全在类内） · playCache 元素 `at` 字段写了从不读 · `store.ready` 全局写入后无人读 · router `meta.title` 硬编码中文且全项目无消费 · HlsPlayer `defineExpose(setLevel/levels/currentLevel)` + PlayerView `playerRef`（声明后从未读取；清晰度走自身 variants) · styles.css `live-sweep/@keyframes sweep` 无使用方 · env.d.ts `recClearHistory/watcherStart/watcherStop` 无渲染调用方（recClearHistory 还是无 UI 入口的危险操作） · electron-builder.yml `win.artifactName` 被子级 nsis/portable 覆盖 · index.ts `void cfg` · `AccountState.nick/loginAt` 恒空

**逻辑小疵**
- `lastBytesAt===0` 首次恒真冗余 · watcher 冷却分支 `schedule+push` 被 finally 全覆盖（副作用：冷却期手动刷新把下一轮推迟满间隔） · `anchorsSetAuto` 附近 cfg 恒真判定 · RecordingsView `{{ tick && … }}`首秒渲染字面 "0" · 主进程 3 处 `spawn(ffmpeg)`(204/205/421）缺 `windowsHide:true`(Win 打包版弹黑窗；thumbs.runFf 已有）

**重复代码未收敛（应进 utils)**
- 时间格式化族 `fmtDur/fmtDurSec/fmtHms` · `fmtNum` × 2(Anchor/Explore) · `liveDuration` × 3(+Player) · `fname` 基名提取多份 · 错误串清洗 `replace(/^.*Error: /,'')` × 6 · "过滤现存 mp4/ts → 求和 bytes → updateHistory 对账"同款块 × 4(thumbs × recorder) · MonitorView keyword 过滤块逐字重复 × 2

**持久化 / 健壮性**
- `store.load()` 自旋 150ms 在 persist 恢复路径阻塞主事件循环 · `diskFreeGb` 失败返回 MAX_SAFE_INTEGER 无日志（磁盘保护静默失效） · release.yml 无 `concurrency` 防并发发版 + `inputs.version` 无正则校验 · locale `lastFailed` 尾随空格逼出 PlayerView `.trim()` 补丁 · `preload` vite 缺 `@shared` 别名（main/renderer 有） · tsconfig references 无 composite · tsconfig.node `module ESNext` 与产物 CJS 语义不符 · `postinstall install-app-deps` 对纯 JS 项目空跑

**杂项**：i18n.ts 注释错别字（单项→单向） · CinemaOverlay 用正则从 `playback.segs` 剥 `(n)`，对 locale 形态有隐含假设（加专用 key) · `rec.st*` 动态 key vs 状态映射表两制并存 · AccountView `loginByWindow/logout` 有 try+finally 但缺 catch（与其余函数不一致，仅 API 层异常时暴露） · HlsPlayer `emit('fatal','当前环境不支持 HLS 播放')` 全仓唯一未走 i18n 的用户可见文案（Electron 下不可达，但违例）

**已剔除（初审误报）**:
- ~~PlayerView 路由参数一次性快照潜伏风险~~ — 当前无 player→player 直达路径，非现存缺陷

---

## 四、总体评价

主进程分层清晰（API 客户端/轮询/录制/持久化各司其职），限速队列 + inflight 去重、风控熔断、源长效化、plocal 白名单、i18n 单向注入等是明确的对抗性设计；渲染层 typed window.api + 单 store 推送 + 双语镜像克制成熟。**主要短板三块**:① 录制状态机并发守卫缺失（H1/H2 同源：状态置位太晚，一个 finalizing 守卫 + run 内重入检查即可根治）;② 推送/回捞策略不统一（该推的推送了、渲染层仍重复回捞，该节流的 2s 推送又拖累历史全量刷新）;③ 复制未收敛（双生卡、3-6 份工具函数）与既有 utils 意图自相矛盾。
