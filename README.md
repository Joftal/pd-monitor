# PandaLive Monitor

> pandalive.co.kr 直播 **监控 / 观看 / 录制 / 回放** 一体化 Windows 桌面客户端

[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-00a1d6)]()
[![Electron](https://img.shields.io/badge/electron-33-47848f)]()
[![Vue](https://img.shields.io/badge/vue-3-42b883)]()
[![Release](https://img.shields.io/github/v/release/Joftal/pd-monitor)](https://github.com/Joftal/pd-monitor/releases)

基于 **Electron + Vue 3**，卡片式浅色界面。聚合全站在播直播间，一键观看、一键录制、长期监控心仪主播；录制产物由内置**视频库**统一管理：九宫格缩略图点播、分组索引浏览、无损合并与回收站级删除。

---

## ✨ 功能特性

### 🏠 直播大厅
全站在播聚合（分页浏览）· 人气 / 点赞 / 粉丝团 / 最新 多维排序 · 搜索与 19+ 筛选 · 卡片含观众、点赞、粉丝团、开播时长

### ❤️ 关注监控
开播提醒（系统通知 + 提示音） · 开播自动录制（按主播开关） · **开播预取直播源**（进房零等待） · 链接粘贴即关注

### ▶️ 观看
内置 HLS 播放器（hls.js） · 清晰度按 IVS 分档切换 · **主线 / 备用线路（hls2/hls3）一键切换** · 密码房 / 19+ / 粉丝团权限房支持
播放源采用**长效变体地址**（绕开 10 分钟过期 master），失效给手动重试入口，绝不后台私自重拉

### ⏺ 录制
内置 ffmpeg 零外部依赖 · TS 分段 → 自动无损 remux MP4 · 可选**收尾合并为单文件**
60s 停滞检测 + 磁盘阈值保护 + 退出优雅停止 · 进行中卡片实时码率（推送差分，零额外请求）

### 🗂️ 视频库
录制完成的本地视频库：海报卡墙 + **九宫格缩略图**（录完自动从视频均匀抽 9 帧合成，缓存至 `data/thumbs/`，文件变动自动重生成）
按日期 / 按主播分组 + 左侧索引条（点击跳转 · 跟随高亮 · 固定回顶） + 类型/状态文字角标 + 筛选搜索
**磨砂玻璃影院浮层**：大屏播放 + 信息面板 + 分段点切（失效段自动跳过）+ 合并单文件 + **删除（文件进系统回收站，可还原；支持单个分段删除）**
外部删除文件自动对账：删段剔除 · 恢复找回 · 重命名不动条目

### 📼 回放（VOD）
`[回放]` 房间可直接观看（进度条可拖） · 一键下载为单文件 · 下载进度与估算全长实时可见

### 🔐 账号
三种登录：账号密码 / 内置官网登录窗（事件驱动零轮询） / **Cookie 导入** · 官方 `login_info` 校验，假登录自动识别回滚 · Cookie 经 **Windows DPAPI 加密** 存储 · 成人认证状态直接显示

### 🛡️ 工程化设计
全局限速队列 + 随机抖动 · 风控特征识别 + 熔断指数退避 · 列表模式本地匹配（请求量与关注数无关）
源拉取 100% 用户意图驱动 · 运行日志落盘（`data/logs/`，按日切分） · 设置内置**检查更新**

---

## 📦 下载安装

到 [Releases](https://github.com/Joftal/pd-monitor/releases) 下载：

| 文件 | 说明 |
|---|---|
| `PandaLive Monitor-Setup-x.x.x.exe` | NSIS 安装包（创建桌面快捷方式） |
| `PandaLive Monitor-Portable-x.x.x.exe` | 便携版，解压即用，数据随程序目录走 |

**数据位置**（全部在程序目录下，不写系统盘，文件夹整体迁移即可）：
`data/`（关注 · 设置 · 历史 · 日志 · 加密 Cookie · 九宫格缩略图缓存） + `recording/`（录制产物，可在设置中更改）

**快速上手**：账号 → 登录（推荐 Cookie 导入） → 大厅浏览/搜索 → 点封面观看，心形关注，⏺ 录制。

---

## 🛠️ 构建开发

```bash
npm install            # 若 npm 拦截 postinstall: 逐个执行 node node_modules/{electron,esbuild,ffmpeg-static}/install.js
npm run dev            # 开发模式(HMR)
npm run build          # 产物构建(out/)
npm run pack           # 打包 Windows 安装包 + 便携版(release/)
npm run typecheck      # 双端类型检查
```

**发版**：`Actions → Build & Release (Windows)` 填版本号即可——自动把版本号写回 `package.json` 并提交（唯一版本源）、打包并推送 Releases（tag: `v<版本号>`），应用内「检查更新」即读取该 tag。


<details>
<summary><b>代码结构</b></summary>

```
src/
├─ main/                  # 主进程
│  ├─ index.ts            #   入口: 窗口/托盘/流域名 Origin 头注入
│  ├─ ipc.ts              #   IPC 注册
│  └─ services/
│     ├─ pandalive.ts     #   API 客户端: 限速队列 + 风控识别 + 双请求栈 + 代理 + 源缓存
│     ├─ watcher.ts       #   轮询引擎: 列表模式 + 逐个模式 + 兜底复查 + 熔断退避
│     ├─ recorder.ts      #   录制引擎: ffmpeg + 停滞检测 + 分段 + remux + 合并 + VOD + 删除(回收站)
│     ├─ thumbs.ts        #   九宫格缩略图: 采样拼图 + 签名缓存 + 文件集对账 + 孤儿清扫
│     ├─ authWin.ts       #   网页登录窗(事件驱动)
│     ├─ vault.ts         #   DPAPI 加密 Cookie 保险箱
│     ├─ store.ts         #   JSON 持久化(关注/设置/历史)
│     ├─ notify.ts        #   应用内气泡 + 系统通知
│     ├─ logger.ts        #   运行日志落盘
│     └─ localMedia.ts    #   plocal:// 本地媒体协议(视频 + 缩略图)
├─ preload/index.ts       # contextBridge(window.api)
├─ renderer/src/          # Vue3(大厅/已关注/播放/录制/视频库/账号/设置)
│  ├─ views/LibraryView.vue       # 视频库: 卡墙 + 分组 + 索引条 + 筛选搜索
│  └─ components/CinemaOverlay.vue # 磨砂影院浮层: 播放 + 合并 + 删除
└─ shared/types.ts        # 双端数据契约 + IPC 通道
```
</details>

<details>
<summary><b>Windows 本地打包排坑(winCodeSign 权限)</b></summary>

electron-builder 解压 `winCodeSign-2.6.0.7z` 需创建符号链接（仅 mac 签名用），非管理员账户会报"客户端没有所需的特权"。用 7zip 排除两个 mac dylib 手动解压到缓存，或开启 Windows 开发者模式后重跑：

```
7za x -y -bd "-x!darwin/10.12/lib/libcrypto.dylib" "-x!darwin/10.12/lib/libssl.dylib" ^
  -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" ^
  "%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/<已下载的任意 .7z>"
```
</details>

---

## ⚠️ 免责声明

本项目仅供个人学习研究使用，与 pandalive 官方无任何关联。录制内容请遵守当地法律法规与原平台条款，**勿用于任何商业用途或二次分发**。平台含成人内容分区，请确保你已年满当地法定年龄。

## 📄 License

[MIT](./LICENSE) · 制作 [Joftal](https://github.com/Joftal)
