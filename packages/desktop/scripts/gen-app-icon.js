/**
 * 生成应用图标 PNG（512x512），供 electron-builder 打包使用。
 * 复用产品 logo 绘制逻辑（橙底 + 白盾牌 + 眼睛微笑）。
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const ORANGE = [0xf5, 0x9e, 0x0b, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function inRoundRect(x, y, size, rx) {
  const s = size;
  const r = rx;
  const insideX = x >= 0 && x < s;
  if (insideX && y >= r && y < s - r) return true;
  if (insideX && y < r) {
    if (x >= r && x < s - r) return true;
    const cy = r, cxL = r, cxR = s - r;
    return (x - cxL) ** 2 + (y - cy) ** 2 <= r * r || (x - cxR) ** 2 + (y - cy) ** 2 <= r * r;
  }
  if (insideX && y >= s - r) {
    if (x >= r && x < s - r) return true;
    const cy = s - r, cxL = r, cxR = s - r;
    return (x - cxL) ** 2 + (y - cy) ** 2 <= r * r || (x - cxR) ** 2 + (y - cy) ** 2 <= r * r;
  }
  return false;
}

function inShield(x, y, size) {
  const X = (x + 0.5) / size * 32;
  const Y = (y + 0.5) / size * 32;
  if (Y < 7 || Y > 24) return false;
  if (Y <= 11) {
    const t = (Y - 7) / 4;
    return Math.abs(X - 16) <= t * 9;
  }
  return Math.abs(X - 16) <= 9;
}

function inCircle(x, y, cx, cy, r, size) {
  const X = (x + 0.5) / size * 32;
  const Y = (y + 0.5) / size * 32;
  return (X - cx) ** 2 + (Y - cy) ** 2 <= r * r;
}

function inSmile(x, y, size) {
  const X = (x + 0.5) / size * 32;
  const Y = (y + 0.5) / size * 32;
  const cx = 16, cy = 20.5, r = 4;
  const d = Math.sqrt((X - cx) ** 2 + (Y - cy) ** 2);
  return Math.abs(d - r) <= 0.8 && Y >= cy;
}

function pixelColor(x, y, size) {
  const rx = (7 / 32) * size;
  if (!inRoundRect(x, y, size, rx)) return TRANSPARENT;
  if (inShield(x, y, size)) {
    if (inCircle(x, y, 12.5, 14.5, 1.8, size) || inCircle(x, y, 19.5, 14.5, 1.8, size)) return ORANGE;
    if (inSmile(x, y, size)) return ORANGE;
    return WHITE;
  }
  return ORANGE;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = pixelColor(x, y, size);
      const idx = (y * size + x) * 4;
      buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2]; buf[idx + 3] = c[3];
    }
  }
  return buf;
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcBuf) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const outDir = path.join(__dirname, '..', 'resources');
fs.mkdirSync(outDir, { recursive: true });
const png = encodePNG(512, render(512));
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log(`generated resources/icon.png (${png.length} bytes)`);
