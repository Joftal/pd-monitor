# PandaLive Monitor (pd-monitor)

> pandalive.co.kr 直播监控 / 观看 / 录制 一体化 Windows 桌面应用

基于 **Electron + Vue 3** 的 B 站风亮色桌面客户端。聚合平台全部在播直播间，一键观看、一键录制、长期监控心仪主播。

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-00a1d6)
![Electron](https://img.shields.io/badge/electron-v33-47848f)
![Vue](https://img.shields.io/badge/vue-3.x-42b883)

---

## ✨ 功能特性

### 🏠 直播大厅
- 聚合平台**全量在播直播间**（每页 20 个，分页浏览）
- 多维排序：人气最高 / 点赞最多 / 粉丝团最多 / 最新开播 / 只看已关注 / 仅看 19+
- 卡片信息：封面、标题、标签（密码/回放/粉丝团/19+）、头像、主播ID、**观众数 · 点赞数 · 粉丝团数 · 直播时长**
- 一键进入播放 / 一键关注 / 一键录制

### ❤️ 已关注
- 关注列表分"直播中 / 离线"两个 Tab，各自独立分页
- 开播提醒（系统通知 + 提示音）、开播自动录制（按主播独立开关）
- 粘贴直播间链接或输入主播 ID 即可关注

### ▶️ 观看
- 内置 HLS 播放器（hls.js），清晰度切换
- 密码房密码输入、19+/粉丝团权限房（凭登录态解锁）
- 播放地址 ~10 分钟自动静默续期，长时间观看不断流

### ⏺ 录制
- 内置 ffmpeg，零外部依赖；TS 分段录制（时长可配）→ 录制完成自动无损 remux 为 MP4
- 流媒体 token **每 4 分钟自动续期**，支持超长时录制
- 任务管理（实时时长/大小/日志）、历史记录（上限 500 条）
- 磁盘剩余阈值保护、退出自动优雅停止

### 🔐 账号
- 三种登录方式：账号密码 / 内置官网登录窗 / **Cookie 导入**（防自动登录拦截时的终极方案）
- Cookie 经 **Windows DPAPI 加密** 持久化，仅保存在本机数据目录
- 登录后自动解锁认证内容（含 19+ 房间大厅展示）

### 🛡️ 防风控设计
- 列表模式每轮仅 1~5 个请求：拉全站列表**本地匹配**，请求量与关注数无关
- 全局限速队列（间隔 + 随机抖动）、风控特征识别、熔断指数退避并通知
- 对平台列表不可见的房间（19+/隐藏）使用**限量兜底复查**（紧急档 + 轮换档）

---

## 📦 安装使用

到 [Releases](../../releases) 下载：

| 文件 | 说明 |
|---|---|
| `PandaLive Monitor-Setup-x.x.x.exe` | NSIS 安装包（创建桌面快捷方式） |
| `PandaLive Monitor-Portable-x.x.x.exe` | 便携版，解压即用，数据随程序目录走 |

**应用数据位置**：程序所在目录下 `data/`（`db.json` 关注/设置/历史 + `vault.dat` 加密 Cookie），不写系统盘，随文件夹整体迁移。

## 🚀 快速上手

1. **账号 → 登录**（推荐 Cookie 导入，三步 30 秒）
2. **直播大厅**：浏览 / 搜索 / 排序，点封面直接看直播
3. 心形按钮关注喜欢的主播 → **已关注** 页持续监控
4. ⏺ 按钮随时开录（或在关注卡里开"开播自动录制"）

## 🛠️ 构建开发

```bash
npm install      # 安装依赖(若 npm 拦截 postinstall: node node_modules/{electron,esbuild,ffmpeg-static}/install.js 逐个执行)
npm run dev      # 开发模式(HMR)
npm run build    # 产物构建(out/)
npm run pack     # 打包 Windows 安装包 + 便携版(release/)
npm run typecheck
npm run gen:icon # 重新生成应用图标(纯 Node 生成, 无依赖)
```

E2E 回归脚本（CDP 驱动真实应用，账号密码经环境变量注入）:

```bash
set PD_USER=你的账号 && set PD_PASS=你的密码
node scripts/e2e-cdp.mjs        # 全链路: 登录→关注→检测→播放→录制→历史
node scripts/e2e-rec-curve.mjs  # 录制增长曲线
node scripts/e2e-rec.mjs        # 录制端点直连验证
```

### 技术栈
Electron 33 · electron-vite · Vue 3 · TypeScript · Naive UI · Tailwind CSS · Pinia · hls.js · ffmpeg-static · electron-builder

### 代码结构

```
src/
├─ main/                  # 主进程
│  ├─ index.ts            #   入口: 窗口/托盘/流域名 Origin 头注入
│  ├─ ipc.ts              #   IPC 注册
│  └─ services/
│     ├─ pandalive.ts     #   API 客户端: 限速队列 + 风控识别 + Chromium/Node 双请求栈 + 代理
│     ├─ watcher.ts       #   轮询引擎: 列表模式 + 逐个模式 + 兜底复查 + 熔断退避
│     ├─ recorder.ts      #   录制引擎: ffmpeg 进程 + URL 定时续期 + 分段 + remux
│     ├─ authWin.ts       #   网页登录窗(事件驱动, 零轮询)
│     ├─ vault.ts         #   DPAPI 加密 Cookie 保险箱
│     ├─ store.ts         #   JSON 持久化(关注/设置/历史)
│     └─ notify.ts        #   应用内气泡 + 系统通知
├─ preload/index.ts       # contextBridge(window.api)
├─ renderer/src/          # Vue3(大厅/已关注/播放/录制/账号/设置)
└─ shared/types.ts        # 双端数据契约 + IPC 通道
```

## ⚠️ 免责声明

- 本项目仅供个人学习研究使用，与 pandalive 官方无任何关联
- 录制内容请遵守当地法律法规与原平台条款，**勿用于任何商业用途或二次分发**
- 平台含成人内容分区，请确保你已年满当地法定年龄

## 📄 License

[MIT](./LICENSE)
