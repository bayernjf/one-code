/**
 * 生成托盘图标 PNG（纯 Node，无第三方依赖）
 *
 * 复刻产品 logo（源自 one-code-landing 的 favicon.svg）：
 * - 橙色圆角方块（#f59e0b，rx=7/32）
 * - 白色盾牌（顶部尖点 + 两侧竖直 + 底部平底，简化近似）
 * - 两只白色眼睛 + 白色微笑
 *
 * 输出 32x32 与 16x16 到 packages/desktop/resources/tray/
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const ORANGE = [0xf5, 0x9e, 0x0b, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

/** 圆角矩形（正确分解：中央矩形带 + 顶部/底部直边 + 四角圆弧） */
function inRoundRect(x, y, size, rx) {
  const s = size;
  const r = rx;
  const insideX = x >= 0 && x < s;

  // 中央矩形带（y 在 [r, s-r]）
  if (insideX && y >= r && y < s - r) {
    return true;
  }
  // 顶部区域（y < r）：中间直边 + 左右圆角
  if (insideX && y < r) {
    if (x >= r && x < s - r) return true; // 顶边直段
    const cy = r;
    const cxL = r, cxR = s - r;
    return (x - cxL) ** 2 + (y - cy) ** 2 <= r * r || (x - cxR) ** 2 + (y - cy) ** 2 <= r * r;
  }
  // 底部区域（y >= s-r）：中间直边 + 左右圆角
  if (insideX && y >= s - r) {
    if (x >= r && x < s - r) return true; // 底边直段
    const cy = s - r;
    const cxL = r, cxR = s - r;
    return (x - cxL) ** 2 + (y - cy) ** 2 <= r * r || (x - cxR) ** 2 + (y - cy) ** 2 <= r * r;
  }
  return false;
}

/**
 * 盾牌（简化多边形，归一化到 32 坐标系）：
 * 顶点 (16,7)，左右肩 (7,11)/(25,11)，两侧竖直向下到 (7,24)/(25,24)，
 * 底部平底连接 (7,24)-(25,24)。
 */
function inShield(x, y, size) {
  const X = (x + 0.5) / size * 32;
  const Y = (y + 0.5) / size * 32;

  if (Y < 7 || Y > 24) return false;

  // 顶部三角区（7~11）：宽从 0 到 18（半宽 9）
  if (Y <= 11) {
    const t = (Y - 7) / 4;
    const halfW = t * 9;
    return Math.abs(X - 16) <= halfW;
  }

  // 主体（11~24）：半宽 9
  return Math.abs(X - 16) <= 9;
}

function inCircle(x, y, cx, cy, r, size) {
  const X = (x + 0.5) / size * 32;
  const Y = (y + 0.5) / size * 32;
  return (X - cx) ** 2 + (Y - cy) ** 2 <= r * r;
}

/** 微笑：圆弧带（圆心 16,20.5 半径 4，下半弧，线宽约 1.5） */
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
    // 眼睛：橙色圆点（在白色盾牌上挖出橙色，复刻白色眼睛在淡色盾牌上的层次）
    if (inCircle(x, y, 12.5, 14.5, 1.8, size) || inCircle(x, y, 19.5, 14.5, 1.8, size)) {
      return ORANGE;
    }
    // 微笑：橙色弧线
    if (inSmile(x, y, size)) {
      return ORANGE;
    }
    // 盾牌主体：纯白（小尺寸下保证盾牌轮廓清晰）
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
      buf[idx] = c[0];
      buf[idx + 1] = c[1];
      buf[idx + 2] = c[2];
      buf[idx + 3] = c[3];
    }
  }
  return buf;
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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

const outDir = path.join(__dirname, '..', 'resources', 'tray');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32]) {
  const png = encodePNG(size, render(size));
  const file = path.join(outDir, size === 16 ? 'tray.png' : 'tray@2x.png');
  fs.writeFileSync(file, png);
  console.log(`generated ${file} (${png.length} bytes)`);
}
