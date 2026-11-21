const WIDGET_VERSION = "1.0.0";

const MONOCHROME_TOKENS = Object.freeze({
  surfaceBg: "#0D0D10",
  cardBg: "#141418",
  hoverBg: "#1C1C22",
  border: "#26262E",
  borderStrong: "#383842",
  textPrimary: "#FFFFFF",
  textBody: "#E4E4E7",
  textMuted: "#A1A1AA",
  textSubtle: "#71717A",
  activeBg: "#FFFFFF",
  activeText: "#000000"
});

class MetricRingBuffer {
  constructor(capacity = 60) {
    const safeCap = Math.max(2, Math.floor(Number(capacity) || 60));
    this.capacity = safeCap;
    this._items = [];
  }

  push(value, timestamp = Date.now()) {
    const num = Number(value);
    if (!Number.isFinite(num)) return false;
    this._items.push({ value: num, ts: Number(timestamp) || Date.now() });
    if (this._items.length > this.capacity) {
      this._items.splice(0, this._items.length - this.capacity);
    }
    return true;
  }

  values() {
    return this._items.map((item) => item.value);
  }

  toArray() {
    return this._items.map((item) => ({ value: item.value, ts: item.ts }));
  }

  last() {
    return this._items.length > 0 ? this._items[this._items.length - 1].value : null;
  }

  get length() {
    return this._items.length;
  }

  clear() {
    this._items.length = 0;
  }
}

function roundMetric(num, decimals = 2) {
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function computeSeriesStats(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p95: 0, last: 0, delta: 0 };
  }
  const clean = values.map(Number).filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, p95: 0, last: 0, delta: 0 };
  }

  let sum = 0;
  let min = clean[0];
  let max = clean[0];
  for (let i = 0; i < clean.length; i += 1) {
    const v = clean[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const p95 = sorted[p95Index];
  const last = clean[clean.length - 1];
  const prev = clean.length > 1 ? clean[clean.length - 2] : last;

  return {
    count: clean.length,
    min: roundMetric(min),
    max: roundMetric(max),
    avg: roundMetric(sum / clean.length),
    p95: roundMetric(p95),
    last: roundMetric(last),
    delta: roundMetric(last - prev)
  };
}

function buildSparklinePaths(values, width = 304, height = 84, padding = 6) {
  const w = Math.max(24, Number(width) || 304);
  const h = Math.max(20, Number(height) || 84);
  const pad = Math.max(0, Math.min(Math.floor(Math.min(w, h) / 4), Number(padding) || 6));
  const clean = Array.isArray(values) ? values.map(Number).filter((v) => Number.isFinite(v)) : [];

  if (clean.length === 0) {
    const midY = roundMetric(h / 2, 2);
    return {
      linePath: "",
      areaPath: "",
      lastPoint: { x: w - pad, y: midY },
      points: []
    };
  }

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  if (clean.length === 1) {
    const midY = roundMetric(pad + innerH / 2, 2);
    const xStart = roundMetric(pad, 2);
    const xEnd = roundMetric(w - pad, 2);
    const bottomY = roundMetric(h - pad, 2);
    return {
      linePath: `M ${xStart} ${midY} L ${xEnd} ${midY}`,
      areaPath: `M ${xStart} ${midY} L ${xEnd} ${midY} L ${xEnd} ${bottomY} L ${xStart} ${bottomY} Z`,
      lastPoint: { x: xEnd, y: midY },
      points: [{ x: xEnd, y: midY, value: clean[0] }]
    };
  }

  let min = clean[0];
  let max = clean[0];
  for (let i = 1; i < clean.length; i += 1) {
    if (clean[i] < min) min = clean[i];
    if (clean[i] > max) max = clean[i];
  }
  const span = max - min;

  const points = clean.map((val, idx) => {
    const ratioX = idx / (clean.length - 1);
    const ratioY = span === 0 ? 0.5 : (val - min) / span;
    const x = roundMetric(pad + ratioX * innerW, 2);
    const y = roundMetric(pad + innerH - ratioY * innerH, 2);
    return { x, y, value: val };
  });

  const segments = points.map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x} ${pt.y}`);
  const linePath = segments.join(" ");
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const bottomY = roundMetric(h - pad, 2);
  const areaPath = `${linePath} L ${lastPt.x} ${bottomY} L ${firstPt.x} ${bottomY} Z`;

  return {
    linePath,
    areaPath,
    lastPoint: { x: lastPt.x, y: lastPt.y },
    points
  };
}

function clampPosition(left, top, cardWidth = 336, cardHeight = 360, viewportWidth = 1280, viewportHeight = 800, margin = 8) {
  const vw = Math.max(200, Number(viewportWidth) || 1280);
  const vh = Math.max(160, Number(viewportHeight) || 800);
  const cw = Math.max(80, Math.min(vw - margin * 2, Number(cardWidth) || 336));
  const ch = Math.max(48, Math.min(vh - margin * 2, Number(cardHeight) || 360));
  const m = Math.max(0, Number(margin) || 8);

  const maxLeft = Math.max(m, vw - cw - m);
  const maxTop = Math.max(m, vh - ch - m);

  const safeLeft = Number.isFinite(Number(left)) ? Number(left) : maxLeft;
  const safeTop = Number.isFinite(Number(top)) ? Number(top) : m + 16;

  return {
    left: Math.round(Math.min(maxLeft, Math.max(m, safeLeft))),
    top: Math.round(Math.min(maxTop, Math.max(m, safeTop)))
  };
}

function resolveStorageScopeKey(locationLike, scope = "route", prefix = "fcw_notes_v1") {
  const host = String(locationLike?.hostname || "local").toLowerCase() || "local";
  const pathname = String(locationLike?.pathname || "/");
  const hash = String(locationLike?.hash || "");
  if (scope === "global") {
    return `${prefix}:global`;
  }
  if (scope === "domain") {
    return `${prefix}:domain:${host}`;
  }
  return `${prefix}:route:${host}${pathname}${hash}`;
}

export {
  WIDGET_VERSION,
  MONOCHROME_TOKENS,
  MetricRingBuffer,
  roundMetric,
  computeSeriesStats,
  buildSparklinePaths,
  clampPosition,
  resolveStorageScopeKey
};
