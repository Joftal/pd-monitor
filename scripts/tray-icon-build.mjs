// 生成 mac 菜单栏 template 图: resources/trayTemplate.png(18pt) + resources/trayTemplate@2x.png(36px)
// macOS 托盘图标规范 = template image: 纯黑 + alpha, 系统按菜单栏深浅自动反色。
// 不能拿 icon.png 直接 setTemplateImage: app 图标整面不透明, alpha 剪影就是一整个
// 实心圆角方块(菜单栏"纯白方块"的根因), 且 512→18 重采样糊成一团。
// 图形取品牌主形「圆环 + 中心圆点」(与 app 图标中心的红色录制键同构), 全代码绘制不依赖源图。
import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

// ---------- 最小 PNG 编码(RGBA 8bit, 非交错) ----------
function crc32(buf) {
  let c, table = crc32.t
  if (!table) {
    table = crc32.t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  }
  c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 绘制(圆环 + 中心圆点, SDF 抗锯齿) ----------
// 几何以 1x 画布(18pt)为基准, s = size/18 等比缩放:
//   圆环: 中线半径 6.2 + 半宽 0.8(线宽 1.6pt) → 外沿 7.0, 四周留 1pt 边距
//   圆点: 半径 3.1(与 app 图标"红点/表盘"比例同量级, 小尺寸下更易读)
const RING_MID = 6.2
const RING_HALF = 0.8
const DOT_R = 3.1

function draw(size) {
  const s = size / 18
  const feather = 0.75 * s // 羽化随倍率等比缩放, 1x/2x 观感一致
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x + 0.5 - 9 * s, y + 0.5 - 9 * s)
      // 有符号距离(d<0 在形内): 圆环与圆点取并集
      const d = Math.min(Math.abs(dist - RING_MID * s) - RING_HALF * s, dist - DOT_R * s)
      const i = (y * size + x) * 4
      rgba[i + 3] = Math.round(Math.max(0, Math.min(1, 0.5 - d / feather)) * 255)
      // RGB 恒 0(纯黑): template 只取 alpha 通道, 颜色由 macOS 按菜单栏深浅决定
    }
  }
  return rgba
}

for (const [file, size] of [
  ['resources/trayTemplate.png', 18],
  ['resources/trayTemplate@2x.png', 36]
]) {
  writeFileSync(file, encodePng(draw(size), size))
  console.log(`已生成: ${file} (${size}px)`)
}
