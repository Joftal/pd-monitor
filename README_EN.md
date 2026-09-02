# PandaLive Monitor (pd-monitor)

[中文](./README.md) | English

> All-in-one Windows desktop app for monitoring / watching / recording pandalive.co.kr live streams

A Bilibili-inspired light-themed desktop client built with **Electron + Vue 3**. Aggregates every live channel on the platform — watch in one click, record in one click, monitor your favorite streamers around the clock.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-00a1d6)
![Electron](https://img.shields.io/badge/electron-v33-47848f)
![Vue](https://img.shields.io/badge/vue-3.x-42b883)

---

## ✨ Features

### 🏠 Live Hall
- Aggregates **all currently-live channels** platform-wide (20 per page, paginated)
- Sort by: top viewers / most likes / largest fan club / recently started / followed only / 19+ only
- Card info: thumbnail, title, tags (password / replay / fan-only / 19+), avatar, streamer ID, **viewers · likes · fan club size · on-air duration**
- One-click watch / follow / record / global search
- Status bar shows last-refresh and next-scheduled-refresh times

### ❤️ Following
- Two tabs — "Live" and "Offline" — each independently paginated (same pager style as the hall)
- Go-live notifications (system toast + sound), per-streamer "auto-record on live" toggle
- **Source pre-warm on go-live**: sources fetched in the background on live detection, so opening a room is instant (toggleable)
- Follow by pasting a room URL or typing a streamer ID; followed streamers light up instantly in the hall

### ▶️ Watching
- Built-in HLS player (hls.js), quality switch maps directly to IVS variants
- Password rooms supported; 19+ / fan-club rooms unlocked via your login session
- **Streams use long-lived variant URLs** (bypasses the 10-minute-expiring master playlist); a dead source shows a manual retry entry — never silently refetched in the background
- Current-source card: one-line truncated display + one-click copy + keeps the previously-failed URL visible

### ⏺ Recording
- Bundled ffmpeg, zero external dependencies; time-sliced TS segments → auto lossless remux to MP4
- Recording uses long-lived variant URLs straight through; abnormal ffmpeg exits or 60s of zero byte-growth are flagged with a notification — never silently re-sourced
- Task manager (live duration/size), history (capped at 500 entries), disk-space guard, graceful shutdown

### 🔐 Account
- Three login methods: ID+password / embedded official web login window (**event-driven, zero polling**) / **cookie import** (bulletproof fallback against anti-bot challenges)
- Sessions verified via the official `login_info` endpoint; fake logins are detected and rolled back; adult-verification status shown directly
- Cookies persisted with **Windows DPAPI encryption**, stored only in the app's local data directory

### 🛡️ Anti-rate-limit design
- List mode issues only 1–5 requests per round: pulls the site-wide list and **matches locally**, so request count is independent of how many streamers you follow
- Global rate-limit queue (interval + random jitter), risk signature detection, circuit breaker with exponential backoff and notification
- Rooms invisible to the public list (19+/hidden) get **bounded fallback rechecks** (urgent tier + rotating tier)
- **Stream fetching is 100% user-intent driven**: fetched only on entering a room or starting a recording, cached indefinitely, invalidated only by re-broadcast / recording error / account change / manual refresh
- Request-header injection equivalent to the Header Editor extension (stream domains automatically get Origin/Referer)

---

## 📦 Install

Download from [Releases](../../releases):

| File | Description |
|---|---|
| `PandaLive Monitor-Setup-x.x.x.exe` | NSIS installer (desktop shortcut included) |
| `PandaLive Monitor-Portable-x.x.x.exe` | Portable build — unzip and run; data stays with the app folder |

**App data location** (everything sits next to the executable — nothing on the system drive, move the whole folder anywhere):

| Directory | Contents |
|---|---|
| `data/` | `db.json` follows/settings/history + `vault.dat` encrypted cookies |
| `recording/` | Recordings (default location; overridable in settings) |

## 🚀 Quick start

1. **Account → Log in** (cookie import recommended — 3 steps, 30 seconds)
2. **Live Hall**: browse / search / sort, click any cover to watch
3. Tap the heart icon on any streamer → monitor them under **Following**
4. Hit ⏺ anytime to start recording (or enable "auto-record on live" in the follow card menu)

## 🛠️ Build from source

```bash
npm install            # install deps (if npm blocks postinstall scripts, run: node node_modules/{electron,esbuild,ffmpeg-static}/install.js one by one)
npm run dev            # dev mode (HMR)
npm run build          # bundle output (out/)
npm run pack           # package Windows installer + portable (release/)
npm run typecheck      # type-check both processes
npm run gen:icon       # regenerate the app icon (pure Node, no deps)
```

E2E regression scripts (drive the real app over CDP; credentials injected via env vars):

```bash
set PD_USER=your_account && set PD_PASS=your_password
node scripts/e2e-cdp.mjs        # full chain: login → follow → detect → watch → record → history
node scripts/e2e-rec-curve.mjs  # recording byte-growth curve
node scripts/e2e-rec.mjs        # direct recording endpoint verification
```

## 🔄 CI builds (GitHub Actions)

A **Build & Release (Windows)** manually-triggered workflow is included: `Actions → Build & Release (Windows) → Run workflow`, enter a version number, and it installs dependencies, type-checks, packages the NSIS installer + portable build, and publishes artifacts to **Releases** (tag: `v<version>`).

### Windows local packaging gotcha

- **winCodeSign extraction fails with "client does not have the required privilege"**: electron-builder needs symlink creation when unpacking `winCodeSign-2.6.0.7z` (mac signing only). Workaround — extract manually with 7zip excluding the two mac dylibs:
  ```
  7za x -y -bd "-x!darwin/10.12/lib/libcrypto.dylib" "-x!darwin/10.12/lib/libssl.dylib" ^
    -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" ^
    "%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/<any downloaded .7z>"
  ```
  or enable Windows Developer Mode and rerun the packaging step.

### Tech stack
Electron 33 · electron-vite · Vue 3 · TypeScript · Naive UI · Tailwind CSS · Pinia · hls.js · ffmpeg-static · electron-builder

### Code layout

```
src/
├─ main/                  # Main process
│  ├─ index.ts            #   entry: window/tray/stream-domain Origin header injection
│  ├─ ipc.ts              #   IPC registrations
│  └─ services/
│     ├─ pandalive.ts     #   API client: rate-limited queue + risk detection + Chromium/Node dual stacks + proxy + source cache
│     ├─ watcher.ts       #   polling engine: list mode + per-anchor mode + fallback recheck + circuit breaker
│     ├─ recorder.ts      #   recorder: ffmpeg process + stall detection + segments + remux
│     ├─ authWin.ts       #   web login window (event-driven, zero polling)
│     ├─ vault.ts         #   DPAPI-encrypted cookie vault
│     ├─ store.ts         #   JSON persistence (follows/settings/history)
│     └─ notify.ts        #   in-app toasts + system notifications
├─ preload/index.ts       # contextBridge (window.api)
├─ renderer/src/          # Vue3 (Hall / Following / Player / Recordings / Account / Settings)
└─ shared/types.ts        # shared contracts + IPC channel names
```

## ⚠️ Disclaimer

- This project is for personal study and research only; it has no affiliation with pandalive
- Recordings must comply with your local laws and the platform's terms — **do not use them commercially or redistribute them**
- The platform contains an adult section; make sure you meet the legal age in your jurisdiction

## 📄 License

[MIT](./LICENSE)
