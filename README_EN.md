# PandaLive Monitor

> All-in-one Windows desktop client for pandalive.co.kr: **live monitoring · watching · recording · replay**

[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-00a1d6)]()
[![Electron](https://img.shields.io/badge/electron-33-47848f)]()
[![Vue](https://img.shields.io/badge/vue-3-42b883)]()
[![Release](https://img.shields.io/github/v/release/Joftal/pd-monitor)](https://github.com/Joftal/pd-monitor/releases)

Built with **Electron + Vue 3**. Aggregates every live channel on the platform into a clean, Bilibili-style light UI — watch, record, and keep an eye on your favorite streamers; recordings can be replayed in-app and merged losslessly.

---

## ✨ Features

### 🏠 Live Hall
Site-wide live aggregation (paginated) · sort by viewers / likes / fan club / newest · search & 19+ filters · cards show viewers, likes, fans, air time

### ❤️ Follow & Monitor
Go-live notifications (system toast + sound) · per-streamer auto-record · **source pre-warm on go-live** (instant playback on entry) · follow by pasting a room URL or ID

### ▶️ Watching
Built-in HLS player (hls.js) · quality switch maps to IVS variants · **main/backup lines (hls2/hls3) one-click switching** · password / 19+ / fan-club rooms supported
Streams use **long-lived variant URLs** (bypasses the 10-minute master expiry); a dead source shows a manual retry entry — never silently refetched in the background

### ⏺ Recording
Bundled ffmpeg, zero external dependencies · TS segments → auto lossless remux to MP4 · optional **merge into a single file** (plus manual merge for history)
60s stall detection + disk threshold guard + graceful shutdown · **in-app playback** via a whitelisted `plocal://` protocol with multi-segment switching

### 📼 Replay (VOD)
`[Replay]` rooms play directly (seekable progress bar) · one-click single-file download · live progress with estimated total duration

### 🔐 Account
Three login methods: password / embedded official web login (event-driven, zero polling) / **cookie import** · sessions verified via official `login_info` — fake logins are rolled back · cookies persisted with **Windows DPAPI encryption** · adult-verification status shown

### 🛡️ Engineering
Global rate-limit queue with jitter · risk-signature detection + circuit breaker with exponential backoff · list mode matches locally (request count independent of follow count)
Stream fetching is 100% user-intent driven · runtime logs on disk (`data/logs/`, daily rotation) · in-app **update check**

---

## 📦 Install

Download from [Releases](https://github.com/Joftal/pd-monitor/releases):

| File | Description |
|---|---|
| `PandaLive Monitor-Setup-x.x.x.exe` | NSIS installer (desktop shortcut included) |
| `PandaLive Monitor-Portable-x.x.x.exe` | Portable build — unzip and run; data stays with the app folder |

**Data location** (everything sits next to the executable; move the whole folder anywhere):
`data/` (follows · settings · history · logs · encrypted cookies) + `recording/` (recordings; overridable in settings)

**Quick start**: Account → Log in (cookie import recommended) → browse/search in the hall → click a cover to watch, heart to follow, ⏺ to record.

---

## 🛠️ Build from source

```bash
npm install            # if npm blocks postinstall scripts: node node_modules/{electron,esbuild,ffmpeg-static}/install.js one by one
npm run dev            # dev mode (HMR)
npm run build          # bundle output (out/)
npm run pack           # Windows installer + portable (release/)
npm run typecheck      # type-check (main + renderer)
```

**Release**: run `Actions → Build & Release (Windows)` with a version number — it writes the version back into `package.json` (single source of truth), packages, and publishes to Releases (tag: `v<version>`); the in-app update check reads that tag.

**E2E regression** (CDP driving the real app, credentials via env vars): see `scripts/e2e-cdp.mjs`.

<details>
<summary><b>Code structure</b></summary>

```
src/
├─ main/                  # main process
│  ├─ index.ts            #   entry: window/tray/stream-domain Origin header injection
│  ├─ ipc.ts              #   IPC registration
│  └─ services/
│     ├─ pandalive.ts     #   API client: rate-limit queue + risk detection + dual stacks + proxy + source cache
│     ├─ watcher.ts       #   polling engine: list mode + per-anchor + fallback recheck + circuit breaker
│     ├─ recorder.ts      #   recorder: ffmpeg + stall detection + segments + remux + merge + VOD
│     ├─ authWin.ts       #   web login window (event-driven)
│     ├─ vault.ts         #   DPAPI-encrypted cookie vault
│     ├─ store.ts         #   JSON persistence (follows/settings/history)
│     ├─ notify.ts        #   in-app toasts + system notifications
│     ├─ logger.ts        #   runtime log files
│     └─ localMedia.ts    #   plocal:// local recording playback protocol
├─ preload/index.ts       # contextBridge (window.api)
├─ renderer/src/          # Vue 3 (hall/following/player/recordings/account/settings)
└─ shared/types.ts        # shared contracts + IPC channels
```
</details>

<details>
<summary><b>Windows packaging gotcha (winCodeSign privileges)</b></summary>

electron-builder needs to create symlinks when extracting `winCodeSign-2.6.0.7z` (mac-only signing tools); non-admin accounts fail with a privilege error. Extract manually with 7zip excluding the two mac dylibs into the cache, or enable Windows Developer Mode:

```
7za x -y -bd "-x!darwin/10.12/lib/libcrypto.dylib" "-x!darwin/10.12/lib/libssl.dylib" ^
  -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" ^
  "%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/<the downloaded .7z>"
```
</details>

---

## ⚠️ Disclaimer

For personal study and research only; not affiliated with pandalive in any way. Recorded content is subject to local laws and the platform's terms — **do not use for commercial purposes or redistribution**. The platform contains adult content; ensure you are of legal age in your jurisdiction.

## 📄 License

[MIT](./LICENSE) · Made by [Joftal](https://github.com/Joftal)
