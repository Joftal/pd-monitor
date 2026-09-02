// 纯色 node 生成应用图标: 512x512 圆角紫底 + 播放三角 + 信号波纹
// 同时输出 resources/icon.png 与 resources/icon.ico (PNG-in-ICO)
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'

const S = 512
const px = new Uint8Array(S * S * 4)

function roundedRectMask(x, y, x0, y0, w, h, r) {
  const cx = Math.max(x0, Math.min(x, x0 + w))
  const cy = Math.max(y0, Math.min(y, y0 + h))
  if (cx === x && cy === y) return true
  const dx = x - Math.max(x0 + r, Math.min(x, x0 + w - r))
  const dy = y - Math.max(y0 + r, Math.min(y, y0 + h - r))
  return dx * dx + dy * dy <= r * r
}

// 背景: 圆角方形, 紫渐变
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    if (!roundedRectMask(x, y, 0, 0, S, S, 96)) { px[i + 3] = 0; continue }
    const t = (x + y) / (2 * S)
    px[i] = Math.round(109 + (139 - 109) * t)      // R 6d28d9 -> 8b5cf6
    px[i + 1] = Math.round(40 + (92 - 40) * t)     // G
    px[i + 2] = Math.round(217 + (246 - 217) * t)  // B
    px[i + 3] = 255
  }
}

// 播放三角 (白色, 圆角微缩)
const tx0 = 190, ty0 = 150, tw = 170, th = 212
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4
    // 三角形: 顶点 (tx0,ty0) (tx0, ty0+th) (tx0+tw, ty0+th/2)
    if (x < tx0 || x > tx0 + tw) continue
    const rel = (x - tx0) / tw
    const half = (th / 2) * (1 - rel)
    const cy = ty0 + th / 2
    if (Math.abs(y - cy) <= half) {
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255
    }
  }
}

// 信号圆弧 (右上, 两圈白色半透明弧)
function arc(cx, cy, r, w, a0, a1, alpha) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx, dy = y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < r - w / 2 || d > r + w / 2) continue
      let a = Math.atan2(dy, dx)
      if (a < a0 || a > a1) continue
      const i = (y * S + x) * 4
      if (px[i + 3] < 255) continue
      px[i] = Math.round(px[i] * (1 - alpha) + 255 * alpha)
      px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + 255 * alpha)
      px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + 255 * alpha)
    }
  }
}
const bcx = 236, bcy = 256 + 96
arc(bcx, bcy, 130, 20, -Math.PI * 0.62, -Math.PI * 0.18, 0.85)
arc(bcx, bcy, 176, 18, -Math.PI * 0.62, -Math.PI * 0.18, 0.5)

// ---- PNG 编码 ----
function crc32(buf) {
  let c, table = crc32.t
  if (!table) {
    table = crc32.t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', png)

// ---- ICO (PNG 压缩帧, 256x256 缩放版由查看器处理, 提供 512 单帧) ----
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry[0] = 0; entry[1] = 0 // 256 尺寸写 0; 这里 png 是 512, 仍写 0 (=256+) 多数查看器可接受; electron-builder 用 rcedit 取帧
entry[2] = 0; entry[3] = 0
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12)
writeFileSync('resources/icon.ico', Buffer.concat([header, entry, png]))
console.log('icon.png / icon.ico generated:', png.length, 'bytes')
