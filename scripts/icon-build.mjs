// 从主图标 resources/icon.ico 派生: resources/icon.png(512) + resources/icon.icns(128/256/512)
// 手工解析 ICO(BMP/DIB 帧 + PNG 帧均可) → RGBA → 双线性重采样 → PNG/.icns 编码
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { deflateSync, inflateSync } from 'zlib'

const SRC = 'resources/icon.ico'

// ---------- ICO 解析 ----------
function parseIco(buf) {
  const count = buf.readUInt16LE(4)
  const frames = []
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const w = buf[o] || 256
    const h = buf[o + 1] || 256
    const size = buf.readUInt32LE(o + 8)
    const off = buf.readUInt32LE(o + 12)
    frames.push({ w, h, data: buf.slice(off, off + size) })
  }
  return frames.sort((a, b) => a.w - b.w)
}

// ---------- DIB(BI_RGB, 24/32bpp, 自底向上) → RGBA ----------
function decodeDib(data, w, h) {
  const biSize = data.readUInt32LE(0)
  const bpp = data.readUInt16LE(12)
  const px = data.slice(biSize)
  const rgba = new Uint8Array(w * h * 4)
  const rowBytes = Math.ceil((w * bpp) / 32) * 4
  const maskBytes = Math.ceil(w / 32) * 4
  const maskOff = biSize + rowBytes * h
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y // 自底向上
    for (let x = 0; x < w; x++) {
      const si = srcY * rowBytes + Math.floor((x * bpp) / 8)
      const di = (y * w + x) * 4
      rgba[di] = px[si + 2] // R
      rgba[di + 1] = px[si + 1] // G
      rgba[di + 2] = px[si] // B
      if (bpp === 32) {
        rgba[di + 3] = px[si + 3]
      } else {
        // 24bpp: 查 AND 掩码位
        const mo = maskOff + srcY * maskBytes
        const bit = (data[mo + (x >> 3)] >> (7 - (x & 7))) & 1
        rgba[di + 3] = bit ? 0 : 255
      }
    }
  }
  return rgba
}

function frameToRgba(frame) {
  if (frame.data[0] === 0x89 && frame.data[1] === 0x50) return decodePng(frame.data) // PNG 帧(本项目旧 ico 即此格式)
  return decodeDib(frame.data, frame.w, frame.h)
}

// ---------- 最小 PNG 解码(8bit RGB/RGBA 非交错; filter 0-4) ----------
function decodePng(buf) {
  let pos = 8
  let w = 0, h = 0, colorType = 6
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.slice(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9] }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const cpp = colorType === 2 ? 3 : 4 // 2=RGB, 6=RGBA
  const stride = w * cpp
  const rgba = new Uint8Array(w * h * 4)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = new Uint8Array(stride)
    const left = cpp // 前像素字节距
    for (let x = 0; x < stride; x++) {
      const a = x >= left ? out[x - left] : 0
      const b = prev[x]
      const c = x >= left ? prev[x - left] : 0
      let v = row[x]
      if (f === 1) v = (v + a) & 255
      else if (f === 2) v = (v + b) & 255
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255 }
      out[x] = v
    }
    // 统一落 RGBA
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      rgba[di] = out[x * cpp]
      rgba[di + 1] = out[x * cpp + 1]
      rgba[di + 2] = out[x * cpp + 2]
      rgba[di + 3] = cpp === 4 ? out[x * cpp + 3] : 255
    }
    prev = out
  }
  return { data: rgba, w, h }
}

// ---------- PNG 编码 ----------
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

// ---------- 双线性重采样 ----------
function resizeBilinear(src, sw, sh, tw, th) {
  const out = new Uint8Array(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const sy = ((y + 0.5) / th) * sh - 0.5
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < tw; x++) {
      const sx = ((x + 0.5) / tw) * sw - 0.5
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c], p10 = src[(y0 * sw + x1) * 4 + c]
        const p01 = src[(y1 * sw + x0) * 4 + c], p11 = src[(y1 * sw + x1) * 4 + c]
        out[(y * tw + x) * 4 + c] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy)
      }
    }
  }
  return out
}

// ---------- ICNS ----------
function icnsEntry(fourcc, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length + 8)
  return Buffer.concat([Buffer.from(fourcc), len, data])
}

// ---------- ICO 重写(全 PNG 帧容器) ----------
function writeIco(pngs) {
  // pngs: [{size, buf}], 按尺寸升序
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let off = 6 + pngs.length * 16
  const entries = []
  const dataParts = []
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0; e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(off, 12)
    entries.push(e)
    dataParts.push(buf)
    off += buf.length
  }
  return Buffer.concat([header, ...entries, ...dataParts])
}

// ---------- 1) 四角近白背景 → 透明(洪泛; 阈值采样四角实际底色, 只从四角侵入, 不伤内部高光) ----------
function cornerFloodTransparent(rgba, size) {
  const w = size
  const h = size
  const cornerMin = [
    rgba[0], rgba[1], rgba[2],
    rgba[(w - 1) * 4], rgba[(w - 1) * 4 + 1], rgba[(w - 1) * 4 + 2],
    rgba[(h - 1) * w * 4], rgba[(h - 1) * w * 4 + 1], rgba[(h - 1) * w * 4 + 2],
    rgba[(h * w - 1) * 4 - 2], rgba[(h * w - 1) * 4 - 1], rgba[(h * w - 1) * 4]
  ]
  const base = Math.min(...cornerMin)
  const thr = Math.max(120, Math.min(240, base - 25))
  const isWhite = (x, y) => {
    const i = (y * w + x) * 4
    return rgba[i] >= thr && rgba[i + 1] >= thr && rgba[i + 2] >= thr
  }
  const seen = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const k = y * w + x
    if (seen[k] || !isWhite(x, y)) return
    seen[k] = 1
    stack.push(k)
  }
  push(0, 0); push(w - 1, 0); push(0, h - 1); push(w - 1, h - 1)
  while (stack.length) {
    const k = stack.pop()
    const x = k % w
    const y = (k - x) / w
    rgba[k * 4 + 3] = 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  return rgba
}

// ---------- 2) 内容包围盒(只认深/浓色, 白/浅灰 halo 不算内容) ----------
function contentBBox(rgba, size) {
  let x0 = size, y0 = size, x1 = -1, y1 = -1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      if (a > 8 && (mn < 200 || mx - mn > 40)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1]
}

// ---------- 3) 圆角矩形 SDF 蒙版(pad 外扩 2px + 1.5px 羽化) → 标准程序图标干净外轮廓 ----------
function roundedRectMask(rgba, size, pad = 2, feather = 1.5, radiusRatio = 0.2) {
  const bb = contentBBox(rgba, size)
  if (!bb) return rgba
  const x0 = bb[0] - pad, y0 = bb[1] - pad, x1 = bb[2] + pad, y1 = bb[3] + pad
  const w = x1 - x0, h = y1 - y0
  const r = Math.max(2, Math.round(Math.min(w, h) * radiusRatio))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 标准圆角矩形 SDF: 核心内负, 边缘正
      const qx = Math.max(x0 + r - x, 0, x - (x1 - r))
      const qy = Math.max(y0 + r - y, 0, y - (y1 - r))
      const d = Math.hypot(qx, qy) - r
      const i = (y * size + x) * 4
      const alpha = Math.max(0, Math.min(255, Math.round((0.5 - d / feather) * 255)))
      rgba[i + 3] = Math.min(rgba[i + 3], alpha)
    }
  }
  return rgba
}

// ---------- 主流程 ----------
if (!existsSync(SRC)) {
  console.error(`未找到 ${SRC} —— 请把设计好的 icon.ico 放到 resources/ 下`)
  process.exit(1)
}
const frames = parseIco(readFileSync(SRC))
console.log('源帧:', frames.map((f) => `${f.w}x${f.h}`).join(', '))
const rgbaBySize = new Map()
const rebuilt = []
for (const f of frames) {
  const dec = frameToRgba(f)
  const rgba = dec.data ?? dec
  cornerFloodTransparent(rgba, f.w)
  roundedRectMask(rgba, f.w)
  rgbaBySize.set(f.w, rgba)
  rebuilt.push({ size: f.w, buf: encodePng(rgba, f.w) })
}
// 主 ico 重写为 RGBA PNG 帧容器(背景挖空后的版本)
writeFileSync(SRC, writeIco(rebuilt))

const largest = frames[frames.length - 1].w
const get = (want) => {
  if (rgbaBySize.has(want)) return rgbaBySize.get(want)
  // 用最大帧重采样到目标尺寸
  const srcBig = rgbaBySize.get(largest)
  return resizeBilinear(srcBig, largest, largest, want, want)
}

writeFileSync('resources/icon.png', encodePng(get(512), 512))
const icnsBody = Buffer.concat([icnsEntry('ic07', encodePng(get(128), 128)), icnsEntry('ic08', encodePng(get(256), 256)), icnsEntry('ic09', encodePng(get(512), 512))])
const icnsHead = Buffer.alloc(8)
icnsHead.write('icns', 0)
icnsHead.writeUInt32BE(icnsBody.length + 8, 4)
writeFileSync('resources/icon.icns', Buffer.concat([icnsHead, icnsBody]))
console.log(`已派生: resources/icon.png (512) + resources/icon.icns (128/256/512, 源最大帧 ${largest})`)
