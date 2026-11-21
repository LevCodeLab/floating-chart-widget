import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT_DIR, "extension", "icons");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type None
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - radius;
}

function renderMonochromeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const center = (size - 1) / 2;
  const pad = size * 0.04;
  const half = size / 2 - pad;
  const radius = size * 0.22;
  const borderWidth = Math.max(1, size * 0.045);

  const pts = [
    [0.20, 0.66],
    [0.37, 0.50],
    [0.52, 0.58],
    [0.68, 0.34],
    [0.80, 0.27]
  ].map(([nx, ny]) => [nx * (size - 1), ny * (size - 1)]);

  const strokeHalf = Math.max(0.75, size * 0.042);
  const dotRadius = Math.max(1.25, size * 0.072);
  const [dotX, dotY] = pts[pts.length - 1];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const sdf = roundedRectSdf(x, y, center, center, half, half, radius);
      if (sdf > 0.7) continue;

      const shapeAlpha = Math.max(0, Math.min(1, 0.7 - sdf));
      const borderBlend = Math.max(0, Math.min(1, 1 - Math.abs(sdf + borderWidth * 0.5) / (borderWidth * 0.7)));

      // Base card #141418 (20, 20, 24), border #26262E (38, 38, 46)
      let r = 20 + (38 - 20) * borderBlend;
      let g = 20 + (38 - 20) * borderBlend;
      let b = 24 + (46 - 24) * borderBlend;

      let minLineDist = Infinity;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const d = distToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        if (d < minLineDist) minLineDist = d;
      }

      const lineCov = Math.max(0, Math.min(1, strokeHalf + 0.55 - minLineDist));
      const dotDist = Math.hypot(x - dotX, y - dotY);
      const dotCov = Math.max(0, Math.min(1, dotRadius + 0.55 - dotDist));
      const fgCov = Math.max(lineCov, dotCov);

      // Foreground crisp white #FFFFFF
      r = Math.round(r * (1 - fgCov) + 255 * fgCov);
      g = Math.round(g * (1 - fgCov) + 255 * fgCov);
      b = Math.round(b * (1 - fgCov) + 255 * fgCov);

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(shapeAlpha * 255);
    }
  }

  return encodePngRgba(size, size, rgba);
}

export function generateExtensionIcons() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const sizes = [16, 32, 48, 128];
  for (const sz of sizes) {
    const png = renderMonochromeIcon(sz);
    fs.writeFileSync(path.join(ICONS_DIR, `icon-${sz}.png`), png);
  }

  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <rect x="6" y="6" width="116" height="116" rx="28" fill="#141418" stroke="#26262E" stroke-width="5"/>
  <line x1="24" y1="44" x2="104" y2="44" stroke="#26262E" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="24" y1="68" x2="104" y2="68" stroke="#26262E" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="24" y1="92" x2="104" y2="92" stroke="#26262E" stroke-width="2" stroke-dasharray="4 4"/>
  <polyline points="26,85 47,64 66,74 87,43 102,35" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="102" cy="35" r="7" fill="#FFFFFF"/>
</svg>
`;
  fs.writeFileSync(path.join(ICONS_DIR, "icon.svg"), iconSvg, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateExtensionIcons();
  console.log("Generated monochrome extension icons in extension/icons/");
}
