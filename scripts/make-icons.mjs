/**
 * Generates self-contained app icons (`icons/icon.svg`, `icons/icon-192.png`, `icons/icon-512.png`)
 * using only Node built-in `zlib` and `fs` (no external image libraries required).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS_DIR = join(ROOT, 'icons');
mkdirSync(ICONS_DIR, { recursive: true });

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F766E"/>
      <stop offset="100%" stop-color="#0B3B3A"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
    <path d="M176 384V128h96a68 68 0 0 1 0 136h-96"/>
    <path d="M140 176h220"/>
    <path d="M140 218h220"/>
  </g>
</svg>
`;

writeFileSync(join(ICONS_DIR, 'icon.svg'), svgIcon, 'utf8');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.44;
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x += 1) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const inside = dx <= r && dy <= r;
      if (!inside) {
        raw[px] = 11; raw[px + 1] = 59; raw[px + 2] = 58; raw[px + 3] = 255;
      } else {
        // Subtle gradient teal background with central white Peso glyph bars
        const nx = (x - (cx - r)) / (2 * r);
        const ny = (y - (cy - r)) / (2 * r);
        const isStem = nx > 0.30 && nx < 0.38 && ny > 0.22 && ny < 0.78;
        const isTopLoop = ny > 0.22 && ny < 0.52 && nx >= 0.38 && nx < 0.68
          && (ny < 0.29 || ny > 0.45 || nx > 0.60);
        const isCross1 = ny > 0.31 && ny < 0.36 && nx > 0.22 && nx < 0.74;
        const isCross2 = ny > 0.40 && ny < 0.45 && nx > 0.22 && nx < 0.74;
        if (isStem || isTopLoop || isCross1 || isCross2) {
          raw[px] = 255; raw[px + 1] = 255; raw[px + 2] = 255; raw[px + 3] = 255;
        } else {
          raw[px] = 15; raw[px + 1] = 118; raw[px + 2] = 110; raw[px + 3] = 255;
        }
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(ICONS_DIR, 'icon-192.png'), buildPng(192));
writeFileSync(join(ICONS_DIR, 'icon-512.png'), buildPng(512));
console.log('Generated icons/icon.svg, icons/icon-192.png, icons/icon-512.png');
