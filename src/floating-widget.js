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

const SOURCE_META = Object.freeze({
  stream: { label: "Stream", unit: "ms", seedBase: 32 },
  fps: { label: "FPS", unit: "fps", seedBase: 60 },
  heap: { label: "JS Heap", unit: "MB", seedBase: 28 },
  dom: { label: "DOM", unit: "nodes", seedBase: 420 },
  latency: { label: "Net", unit: "ms", seedBase: 45 },
  custom: { label: "Custom", unit: "pts", seedBase: 50 }
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

function buildSparklinePaths(values, width = 308, height = 84, padding = 6) {
  const w = Math.max(24, Number(width) || 308);
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

function clampPosition(left, top, cardWidth = 340, cardHeight = 380, viewportWidth = 1280, viewportHeight = 800, margin = 10) {
  const vw = Math.max(200, Number(viewportWidth) || 1280);
  const vh = Math.max(160, Number(viewportHeight) || 800);
  const cw = Math.max(80, Math.min(vw - margin * 2, Number(cardWidth) || 340));
  const ch = Math.max(44, Math.min(vh - margin * 2, Number(cardHeight) || 380));
  const m = Math.max(0, Number(margin) || 10);

  const maxLeft = Math.max(m, vw - cw - m);
  const maxTop = Math.max(m, vh - ch - m);

  const safeLeft = Number.isFinite(Number(left)) ? Number(left) : maxLeft;
  const safeTop = Number.isFinite(Number(top)) ? Number(top) : m + 14;

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

function formatRouteLabel(locationLike, scope = "route") {
  const host = String(locationLike?.hostname || "local").toLowerCase() || "local";
  const pathname = String(locationLike?.pathname || "/");
  const hash = String(locationLike?.hash || "");
  if (scope === "global") return "global scratchpad";
  if (scope === "domain") return host;
  const full = `${host}${pathname}${hash}`;
  return full.length > 28 ? `${full.slice(0, 26)}..` : full;
}

const SHADOW_STYLESHEET = `
  :host {
    all: initial;
    position: fixed;
    top: 24px;
    left: 24px;
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    color: #FFFFFF;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
    box-sizing: border-box;
    user-select: none;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  .fcw-card {
    width: 340px;
    background: #141418;
    border: 1px solid #26262E;
    border-radius: 16px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);
    color: #FFFFFF;
  }

  .fcw-card.is-pip {
    width: 100%;
    border-radius: 12px;
    box-shadow: none;
  }

  .fcw-minimized {
    display: none;
    align-items: center;
    gap: 8px;
    background: #141418;
    border: 1px solid #26262E;
    border-radius: 999px;
    padding: 6px 10px 6px 12px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
    cursor: grab;
    color: #FFFFFF;
  }

  .fcw-minimized:active {
    cursor: grabbing;
  }

  :host([data-minimized="true"]) .fcw-card {
    display: none;
  }

  :host([data-minimized="true"]) .fcw-minimized {
    display: inline-flex;
  }

  .fcw-min-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #FFFFFF;
    flex-shrink: 0;
  }

  .fcw-min-val {
    font-size: 12px;
    font-weight: 700;
    color: #FFFFFF;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .fcw-min-svg {
    width: 54px;
    height: 18px;
    display: block;
    overflow: visible;
  }

  .fcw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    background: #0D0D10;
    border: 1px solid #26262E;
    border-radius: 11px;
    padding: 7px 9px;
    cursor: grab;
  }

  .fcw-header:active {
    cursor: grabbing;
  }

  .fcw-brand {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .fcw-grip {
    display: inline-grid;
    grid-template-columns: repeat(2, 3px);
    gap: 2px;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .fcw-grip span {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: #A1A1AA;
    display: block;
  }

  .fcw-title-wrap {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .fcw-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fcw-subtitle {
    font-size: 9.5px;
    font-weight: 500;
    color: #A1A1AA;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fcw-hdr-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .fcw-btn,
  .fcw-icon-btn,
  .fcw-tab {
    appearance: none;
    -webkit-appearance: none;
    background: #141418;
    border: 1px solid #26262E;
    color: #E4E4E7;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    border-radius: 7px;
    padding: 5px 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
  }

  .fcw-btn:hover,
  .fcw-icon-btn:hover,
  .fcw-tab:hover {
    background: #1C1C22;
    border-color: #383842;
    color: #FFFFFF;
  }

  .fcw-btn:active,
  .fcw-icon-btn:active,
  .fcw-tab:active {
    transform: scale(0.96);
  }

  .fcw-btn.is-active,
  .fcw-icon-btn.is-active,
  .fcw-tab.is-active,
  .fcw-btn.is-primary {
    background: #FFFFFF;
    border-color: #FFFFFF;
    color: #000000;
    font-weight: 700;
  }

  .fcw-btn.is-primary:hover,
  .fcw-tab.is-active:hover {
    background: #E4E4E7;
    border-color: #E4E4E7;
    color: #000000;
  }

  .fcw-icon-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 7px;
  }

  .fcw-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .fcw-source-tabs,
  .fcw-cadence-tabs {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: nowrap;
  }

  .fcw-tab {
    padding: 4px 6px;
    font-size: 9.5px;
    border-radius: 6px;
  }

  .fcw-chart-panel {
    background: #0D0D10;
    border: 1px solid #26262E;
    border-radius: 11px;
    padding: 8px 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .fcw-hero-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .fcw-hero-left {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  .fcw-hero-val {
    font-size: 22px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .fcw-hero-unit {
    font-size: 10.5px;
    font-weight: 600;
    color: #A1A1AA;
  }

  .fcw-hero-delta {
    font-size: 10px;
    font-weight: 600;
    color: #A1A1AA;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }

  .fcw-svg-wrap {
    width: 100%;
    height: 84px;
    position: relative;
  }

  .fcw-svg {
    width: 100%;
    height: 84px;
    display: block;
    overflow: visible;
  }

  .fcw-stats-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid #26262E;
  }

  .fcw-stat-cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fcw-stat-lbl {
    font-size: 8.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #71717A;
  }

  .fcw-stat-num {
    font-size: 10.5px;
    font-weight: 700;
    color: #E4E4E7;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .fcw-notes-panel {
    background: #0D0D10;
    border: 1px solid #26262E;
    border-radius: 11px;
    padding: 7px 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .fcw-notes-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .fcw-notes-route {
    font-size: 9.5px;
    font-weight: 600;
    color: #A1A1AA;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 175px;
  }

  .fcw-scope-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .fcw-textarea {
    width: 100%;
    min-height: 56px;
    max-height: 120px;
    resize: vertical;
    background: #141418;
    border: 1px solid #26262E;
    border-radius: 7px;
    padding: 6px 8px;
    color: #FFFFFF;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    line-height: 1.4;
    outline: none;
    user-select: text;
  }

  .fcw-textarea::placeholder {
    color: #71717A;
  }

  .fcw-textarea:focus {
    border-color: #FFFFFF;
  }

  .fcw-actions-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
  }

  .fcw-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2px;
    font-size: 9.5px;
    color: #A1A1AA;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .fcw-toast {
    color: #FFFFFF;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 210px;
  }
`;

class FloatingChartWidget {
  constructor(options = {}) {
    this.win = options.windowRef || (typeof globalThis !== "undefined" ? globalThis.window : undefined);
    this.doc = options.documentRef || (typeof globalThis !== "undefined" ? globalThis.document : undefined);
    this.storage = options.storageRef !== undefined
      ? options.storageRef
      : (typeof globalThis !== "undefined" ? globalThis.localStorage : undefined);

    this.storagePrefix = String(options.storagePrefix || "fcw_v1");
    this.hostId = String(options.hostId || "floating-chart-widget-host");
    this.title = String(options.title || "Floating Widget");
    this.buffer = new MetricRingBuffer(options.capacity || 60);

    const savedSource = this._readStorage(`${this.storagePrefix}:source`, "");
    const savedCadence = this._readStorage(`${this.storagePrefix}:cadence`, "");
    const savedScope = this._readStorage(`${this.storagePrefix}:scope`, "");
    const savedMin = this._readStorage(`${this.storagePrefix}:minimized`, "0");

    this.source = SOURCE_META[options.initialSource] ? options.initialSource : (SOURCE_META[savedSource] ? savedSource : "stream");
    this.cadence = ["1s", "5s", "pause"].includes(options.initialCadence)
      ? options.initialCadence
      : (["1s", "5s", "pause"].includes(savedCadence) ? savedCadence : "1s");
    this.noteScope = ["route", "domain", "global"].includes(options.noteScope)
      ? options.noteScope
      : (["route", "domain", "global"].includes(savedScope) ? savedScope : "route");
    this.customUnit = options.unit || null;
    this.minimized = options.minimized !== undefined ? Boolean(options.minimized) : savedMin === "1";
    this.visible = options.visible !== undefined ? Boolean(options.visible) : true;
    this.customActions = Array.isArray(options.actions) ? options.actions : null;

    this.hostEl = null;
    this.shadowRoot = null;
    this.pipWindow = null;
    this.mounted = false;

    this._sampleTimer = null;
    this._toastTimer = null;
    this._rafId = null;
    this._fpsFrames = 0;
    this._fpsLastTs = 0;
    this._currentFps = 60;
    this._streamValue = SOURCE_META[this.source]?.seedBase || 32;
    this._dragging = false;
    this._dragPointerId = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._dragMoved = false;
    this._lastHref = "";
    this._origPushState = null;
    this._origReplaceState = null;
    this._titleObserver = null;
    this._boundKeydown = null;
    this._boundResize = null;
    this._boundPopstate = null;

    if (Array.isArray(options.seedSeries) && options.seedSeries.length > 0) {
      options.seedSeries.forEach((v) => this.buffer.push(v));
    } else if (options.seedDefault !== false) {
      this._seedInitialSeries();
    }
  }

  _readStorage(key, fallback = "") {
    try {
      if (!this.storage || typeof this.storage.getItem !== "function") return fallback;
      const val = this.storage.getItem(key);
      return val !== null && val !== undefined ? val : fallback;
    } catch (_) {
      return fallback;
    }
  }

  _writeStorage(key, value) {
    try {
      if (!this.storage || typeof this.storage.setItem !== "function") return;
      this.storage.setItem(key, String(value));
    } catch (_) {}
  }

  _seedInitialSeries() {
    const base = SOURCE_META[this.source]?.seedBase || 32;
    const wave = [-4, -2, 1, 3, 0, -3, 2, 5, 1, -1, 4, 7, 2, 0, -2, 3, 6, 4];
    const now = Date.now();
    for (let i = 0; i < wave.length; i += 1) {
      this.buffer.push(roundMetric(Math.max(1, base + wave[i])), now - (wave.length - i) * 1000);
    }
    this._streamValue = this.buffer.last() || base;
  }

  getUnit() {
    if (this.customUnit) return this.customUnit;
    return SOURCE_META[this.source]?.unit || "";
  }

  getStats() {
    return computeSeriesStats(this.buffer.values());
  }

  getNoteKey() {
    const loc = this.win?.location || { hostname: "local", pathname: "/", hash: "" };
    return resolveStorageScopeKey(loc, this.noteScope, `${this.storagePrefix}:notes`);
  }

  getNote() {
    return this._readStorage(this.getNoteKey(), "");
  }

  setNote(text) {
    const clean = String(text ?? "");
    this._writeStorage(this.getNoteKey(), clean);
    if (this.shadowRoot) {
      const ta = this.shadowRoot.getElementById("fcw-note-input");
      if (ta && ta.value !== clean) {
        ta.value = clean;
      }
    }
    return clean;
  }

  mount(container = null) {
    if (!this.doc) return this;
    if (this.mounted && this.hostEl) {
      this.show();
      return this;
    }

    const existing = this.doc.getElementById ? this.doc.getElementById(this.hostId) : null;
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const host = this.doc.createElement("div");
    host.id = this.hostId;
    if (this.minimized) {
      host.setAttribute("data-minimized", "true");
    }
    if (!this.visible) {
      host.style.display = "none";
    }

    const shadow = host.attachShadow({ mode: "open" });
    this.hostEl = host;
    this.shadowRoot = shadow;

    const styleEl = this.doc.createElement("style");
    styleEl.textContent = SHADOW_STYLESHEET;
    shadow.appendChild(styleEl);

    const wrapper = this.doc.createElement("div");
    wrapper.id = "fcw-root";
    wrapper.innerHTML = this._buildTemplateHtml();
    shadow.appendChild(wrapper);

    const targetParent = container || this.doc.body || this.doc.documentElement;
    if (targetParent && typeof targetParent.appendChild === "function") {
      targetParent.appendChild(host);
    }

    this._restorePosition();
    this._bindShadowEvents();
    this._bindHostObservers();
    this._startFpsTracker();
    this._syncTimerCadence();
    this._renderAll();

    this.mounted = true;
    return this;
  }

  unmount() {
    this._stopSampleTimer();
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    if (this._rafId && this.win && typeof this.win.cancelAnimationFrame === "function") {
      this.win.cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.pipWindow && !this.pipWindow.closed) {
      try {
        this.pipWindow.close();
      } catch (_) {}
      this.pipWindow = null;
    }
    this._teardownHostObservers();
    if (this.hostEl && this.hostEl.parentNode) {
      this.hostEl.parentNode.removeChild(this.hostEl);
    }
    this.hostEl = null;
    this.shadowRoot = null;
    this.mounted = false;
  }

  _buildTemplateHtml() {
    const sources = [
      { id: "stream", label: "Stream" },
      { id: "fps", label: "FPS" },
      { id: "heap", label: "Heap" },
      { id: "dom", label: "DOM" },
      { id: "latency", label: "Net" }
    ];
    const cadences = ["1s", "5s", "pause"];
    const scopes = [
      { id: "route", label: "Route" },
      { id: "domain", label: "Domain" },
      { id: "global", label: "Global" }
    ];

    const actionButtonsHtml = this.customActions
      ? this.customActions
          .map(
            (act, idx) =>
              `<button type="button" class="fcw-btn ${idx === 0 ? "is-primary" : ""}" data-custom-idx="${idx}">${this._escapeHtml(act.label || "Action")}</button>`
          )
          .join("")
      : `
        <button type="button" class="fcw-btn is-primary" data-action="add-point">+ Point</button>
        <button type="button" class="fcw-btn" data-action="copy-json">Copy JSON</button>
        <button type="button" class="fcw-btn" data-action="snapshot">Snapshot</button>
        <button type="button" class="fcw-btn" data-action="clear">Clear</button>
        <button type="button" class="fcw-btn" data-action="minimize">Minimize</button>
        <button type="button" class="fcw-btn" data-action="detach-pip">Detach PiP</button>
      `;

    return `
      <div class="fcw-minimized" id="fcw-min-pill" title="Drag to move or click Expand">
        <span class="fcw-min-dot"></span>
        <span class="fcw-min-val" id="fcw-min-val">0 ms</span>
        <svg class="fcw-min-svg" viewBox="0 0 54 18" preserveAspectRatio="none" aria-hidden="true">
          <path id="fcw-min-line" d="" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <button type="button" class="fcw-btn is-primary" data-action="expand" style="padding:3px 7px;font-size:9.5px">Expand</button>
      </div>

      <section class="fcw-card" id="fcw-card" role="region" aria-label="${this._escapeHtml(this.title)}">
        <header class="fcw-header" id="fcw-drag-handle">
          <div class="fcw-brand">
            <div class="fcw-grip" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="fcw-title-wrap">
              <span class="fcw-title">${this._escapeHtml(this.title)}</span>
              <span class="fcw-subtitle" id="fcw-route-sub">local/</span>
            </div>
          </div>
          <div class="fcw-hdr-actions">
            <button type="button" class="fcw-icon-btn" data-action="minimize" title="Minimize widget" aria-label="Minimize">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M3 8h10"></path>
              </svg>
            </button>
            <button type="button" class="fcw-icon-btn" data-action="detach-pip" title="Detach Picture-in-Picture window" aria-label="Detach PiP">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 11L11 5"></path>
                <path d="M6 5h5v5"></path>
              </svg>
            </button>
            <button type="button" class="fcw-icon-btn" data-action="hide" title="Hide widget (Alt+Shift+W)" aria-label="Hide">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M4 4l8 8M12 4l-8 8"></path>
              </svg>
            </button>
          </div>
        </header>

        <div class="fcw-toolbar">
          <div class="fcw-source-tabs" role="tablist" aria-label="Metric source">
            ${sources
              .map(
                (s) =>
                  `<button type="button" class="fcw-tab ${this.source === s.id ? "is-active" : ""}" data-source="${s.id}">${s.label}</button>`
              )
              .join("")}
          </div>
          <div class="fcw-cadence-tabs" role="group" aria-label="Sampling cadence">
            ${cadences
              .map(
                (c) =>
                  `<button type="button" class="fcw-tab ${this.cadence === c ? "is-active" : ""}" data-cadence="${c}">${c}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="fcw-chart-panel">
          <div class="fcw-hero-row">
            <div class="fcw-hero-left">
              <span class="fcw-hero-val" id="fcw-hero-val">0</span>
              <span class="fcw-hero-unit" id="fcw-hero-unit">ms</span>
            </div>
            <span class="fcw-hero-delta" id="fcw-hero-delta">n=0</span>
          </div>

          <div class="fcw-svg-wrap">
            <svg class="fcw-svg" id="fcw-spark-svg" viewBox="0 0 308 84" preserveAspectRatio="none" role="img" aria-label="Live metric sparkline">
              <defs>
                <linearGradient id="fcw-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"></stop>
                  <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.0"></stop>
                </linearGradient>
              </defs>
              <line x1="6" y1="22" x2="302" y2="22" stroke="#26262E" stroke-width="1" stroke-dasharray="2 3"></line>
              <line x1="6" y1="42" x2="302" y2="42" stroke="#26262E" stroke-width="1" stroke-dasharray="2 3"></line>
              <line x1="6" y1="62" x2="302" y2="62" stroke="#26262E" stroke-width="1" stroke-dasharray="2 3"></line>
              <path id="fcw-spark-area" d="" fill="url(#fcw-area-grad)"></path>
              <path id="fcw-spark-line" d="" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
              <circle id="fcw-spark-dot" cx="302" cy="42" r="3" fill="#FFFFFF" stroke="#0D0D10" stroke-width="1.5"></circle>
            </svg>
          </div>

          <div class="fcw-stats-bar">
            <div class="fcw-stat-cell">
              <span class="fcw-stat-lbl">Min</span>
              <span class="fcw-stat-num" id="fcw-stat-min">0</span>
            </div>
            <div class="fcw-stat-cell">
              <span class="fcw-stat-lbl">Avg</span>
              <span class="fcw-stat-num" id="fcw-stat-avg">0</span>
            </div>
            <div class="fcw-stat-cell">
              <span class="fcw-stat-lbl">Max</span>
              <span class="fcw-stat-num" id="fcw-stat-max">0</span>
            </div>
            <div class="fcw-stat-cell">
              <span class="fcw-stat-lbl">P95</span>
              <span class="fcw-stat-num" id="fcw-stat-p95">0</span>
            </div>
          </div>
        </div>

        <div class="fcw-notes-panel">
          <div class="fcw-notes-hdr">
            <span class="fcw-notes-route" id="fcw-notes-key-label">route notes</span>
            <div class="fcw-scope-group">
              ${scopes
                .map(
                  (sc) =>
                    `<button type="button" class="fcw-tab ${this.noteScope === sc.id ? "is-active" : ""}" data-scope="${sc.id}">${sc.label}</button>`
                )
                .join("")}
            </div>
          </div>
          <textarea
            id="fcw-note-input"
            class="fcw-textarea"
            rows="2"
            placeholder="Quick scratchpad for this route (auto-saved locally)..."
          ></textarea>
        </div>

        <div class="fcw-actions-grid">
          ${actionButtonsHtml}
        </div>

        <footer class="fcw-footer">
          <span class="fcw-toast" id="fcw-status-text">Ready</span>
          <span>Alt+Shift+W</span>
        </footer>
      </section>
    `;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _restorePosition() {
    if (!this.hostEl) return;
    const vw = Number(this.win?.innerWidth) || 1280;
    const vh = Number(this.win?.innerHeight) || 800;
    const rawSaved = this._readStorage(`${this.storagePrefix}:pos`, "");
    let desiredLeft = vw - 364;
    let desiredTop = 24;

    if (rawSaved) {
      try {
        const parsed = JSON.parse(rawSaved);
        if (Number.isFinite(Number(parsed.left)) && Number.isFinite(Number(parsed.top))) {
          desiredLeft = Number(parsed.left);
          desiredTop = Number(parsed.top);
        }
      } catch (_) {}
    }

    const clamped = clampPosition(desiredLeft, desiredTop, 340, this.minimized ? 44 : 390, vw, vh, 10);
    this.hostEl.style.left = `${clamped.left}px`;
    this.hostEl.style.top = `${clamped.top}px`;
  }

  setPosition(left, top) {
    if (!this.hostEl) return { left: 0, top: 0 };
    const vw = Number(this.win?.innerWidth) || 1280;
    const vh = Number(this.win?.innerHeight) || 800;
    const rect = typeof this.hostEl.getBoundingClientRect === "function"
      ? this.hostEl.getBoundingClientRect()
      : { width: 340, height: 380 };
    const w = rect.width > 40 ? rect.width : (this.minimized ? 170 : 340);
    const h = rect.height > 24 ? rect.height : (this.minimized ? 40 : 380);
    const clamped = clampPosition(left, top, w, h, vw, vh, 8);
    this.hostEl.style.left = `${clamped.left}px`;
    this.hostEl.style.top = `${clamped.top}px`;
    this._writeStorage(`${this.storagePrefix}:pos`, JSON.stringify(clamped));
    return clamped;
  }

  resetPosition() {
    const vw = Number(this.win?.innerWidth) || 1280;
    const vh = Number(this.win?.innerHeight) || 800;
    const pos = this.setPosition(vw - 360, 24);
    this._showStatus(`Position reset (${pos.left}, ${pos.top})`);
    return pos;
  }

  _bindShadowEvents() {
    if (!this.shadowRoot) return;
    const rootWrapper = this.shadowRoot.getElementById("fcw-root");
    if (!rootWrapper) return;

    rootWrapper.addEventListener("click", (ev) => {
      if (this._dragMoved) {
        this._dragMoved = false;
        return;
      }
      const target = ev.target;
      if (!target || typeof target.closest !== "function") return;

      const sourceBtn = target.closest("[data-source]");
      if (sourceBtn) {
        this.setSource(sourceBtn.getAttribute("data-source"));
        return;
      }

      const cadenceBtn = target.closest("[data-cadence]");
      if (cadenceBtn) {
        this.setCadence(cadenceBtn.getAttribute("data-cadence"));
        return;
      }

      const scopeBtn = target.closest("[data-scope]");
      if (scopeBtn) {
        this.setNoteScope(scopeBtn.getAttribute("data-scope"));
        return;
      }

      const customBtn = target.closest("[data-custom-idx]");
      if (customBtn && this.customActions) {
        const idx = Number(customBtn.getAttribute("data-custom-idx"));
        const cfg = this.customActions[idx];
        if (cfg && typeof cfg.onClick === "function") {
          cfg.onClick(this);
        }
        return;
      }

      const actBtn = target.closest("[data-action]");
      if (!actBtn) return;
      const action = actBtn.getAttribute("data-action");
      this._handleQuickAction(action);
    });

    const noteInput = this.shadowRoot.getElementById("fcw-note-input");
    if (noteInput) {
      noteInput.addEventListener("input", () => {
        this._writeStorage(this.getNoteKey(), noteInput.value);
        this._showStatus("Saved to localStorage");
      });
      noteInput.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
      });
    }

    const bindDragSurface = (surfaceEl) => {
      if (!surfaceEl) return;
      surfaceEl.addEventListener("pointerdown", (ev) => {
        if (this.pipWindow) return;
        const t = ev.target;
        if (t && typeof t.closest === "function" && t.closest("button, textarea, input")) {
          return;
        }
        this._dragging = true;
        this._dragMoved = false;
        this._dragPointerId = ev.pointerId;
        const rect = typeof this.hostEl.getBoundingClientRect === "function"
          ? this.hostEl.getBoundingClientRect()
          : { left: parseInt(this.hostEl.style.left, 10) || 24, top: parseInt(this.hostEl.style.top, 10) || 24 };
        this._dragOffsetX = (Number(ev.clientX) || 0) - rect.left;
        this._dragOffsetY = (Number(ev.clientY) || 0) - rect.top;
        if (typeof surfaceEl.setPointerCapture === "function" && ev.pointerId !== undefined) {
          try {
            surfaceEl.setPointerCapture(ev.pointerId);
          } catch (_) {}
        }
      });

      surfaceEl.addEventListener("pointermove", (ev) => {
        if (!this._dragging) return;
        if (this._dragPointerId !== null && ev.pointerId !== undefined && ev.pointerId !== this._dragPointerId) return;
        const nextLeft = (Number(ev.clientX) || 0) - this._dragOffsetX;
        const nextTop = (Number(ev.clientY) || 0) - this._dragOffsetY;
        this._dragMoved = true;
        this.setPosition(nextLeft, nextTop);
      });

      const endDrag = (ev) => {
        if (!this._dragging) return;
        this._dragging = false;
        if (typeof surfaceEl.releasePointerCapture === "function" && ev?.pointerId !== undefined) {
          try {
            surfaceEl.releasePointerCapture(ev.pointerId);
          } catch (_) {}
        }
        this._dragPointerId = null;
      };

      surfaceEl.addEventListener("pointerup", endDrag);
      surfaceEl.addEventListener("pointercancel", endDrag);
    };

    bindDragSurface(this.shadowRoot.getElementById("fcw-drag-handle"));
    bindDragSurface(this.shadowRoot.getElementById("fcw-min-pill"));
  }

  _bindHostObservers() {
    if (!this.win) return;

    this._boundKeydown = (ev) => {
      if (ev.altKey && ev.shiftKey && (ev.code === "KeyW" || String(ev.key || "").toLowerCase() === "w")) {
        ev.preventDefault();
        this.toggleVisibility();
      }
    };

    this._boundResize = () => {
      if (!this.hostEl || this.pipWindow) return;
      const curLeft = parseInt(this.hostEl.style.left, 10) || 24;
      const curTop = parseInt(this.hostEl.style.top, 10) || 24;
      this.setPosition(curLeft, curTop);
    };

    this._lastHref = String(this.win.location?.href || "");
    const handleSpaRouteCheck = () => {
      const nextHref = String(this.win.location?.href || "");
      if (nextHref !== this._lastHref) {
        this._lastHref = nextHref;
        this._renderRouteAndNotes();
        this._showStatus("Route synced");
      }
    };

    this._boundPopstate = handleSpaRouteCheck;

    if (typeof this.win.addEventListener === "function") {
      this.win.addEventListener("keydown", this._boundKeydown);
      this.win.addEventListener("resize", this._boundResize);
      this.win.addEventListener("popstate", this._boundPopstate);
      this.win.addEventListener("hashchange", this._boundPopstate);
    }

    const hist = this.win.history;
    if (hist && typeof hist.pushState === "function" && typeof hist.replaceState === "function") {
      this._origPushState = hist.pushState;
      this._origReplaceState = hist.replaceState;
      const origPush = this._origPushState;
      const origReplace = this._origReplaceState;

      hist.pushState = function (...args) {
        const result = origPush.apply(this, args);
        handleSpaRouteCheck();
        return result;
      };
      hist.replaceState = function (...args) {
        const result = origReplace.apply(this, args);
        handleSpaRouteCheck();
        return result;
      };
    }

    const ObserverCtor = this.win.MutationObserver || (typeof MutationObserver !== "undefined" ? MutationObserver : null);
    if (ObserverCtor && this.doc) {
      const headEl = this.doc.head || this.doc.documentElement;
      if (headEl) {
        try {
          this._titleObserver = new ObserverCtor(() => {
            handleSpaRouteCheck();
          });
          this._titleObserver.observe(headEl, { subtree: true, childList: true, characterData: true });
        } catch (_) {
          this._titleObserver = null;
        }
      }
    }
  }

  _teardownHostObservers() {
    if (this.win && typeof this.win.removeEventListener === "function") {
      if (this._boundKeydown) this.win.removeEventListener("keydown", this._boundKeydown);
      if (this._boundResize) this.win.removeEventListener("resize", this._boundResize);
      if (this._boundPopstate) {
        this.win.removeEventListener("popstate", this._boundPopstate);
        this.win.removeEventListener("hashchange", this._boundPopstate);
      }
    }
    if (this.win?.history) {
      if (this._origPushState) this.win.history.pushState = this._origPushState;
      if (this._origReplaceState) this.win.history.replaceState = this._origReplaceState;
    }
    this._origPushState = null;
    this._origReplaceState = null;

    if (this._titleObserver && typeof this._titleObserver.disconnect === "function") {
      this._titleObserver.disconnect();
      this._titleObserver = null;
    }
  }

  _startFpsTracker() {
    if (!this.win || typeof this.win.requestAnimationFrame !== "function") return;
    const step = (ts) => {
      this._fpsFrames += 1;
      if (!this._fpsLastTs) {
        this._fpsLastTs = ts;
      } else if (ts - this._fpsLastTs >= 500) {
        this._currentFps = Math.min(240, Math.max(1, Math.round((this._fpsFrames * 1000) / (ts - this._fpsLastTs))));
        this._fpsFrames = 0;
        this._fpsLastTs = ts;
      }
      this._rafId = this.win.requestAnimationFrame(step);
    };
    this._rafId = this.win.requestAnimationFrame(step);
  }

  _sampleCurrentSource() {
    if (this.source === "fps") {
      return this._currentFps || 60;
    }
    if (this.source === "heap") {
      const mem = this.win?.performance?.memory;
      if (mem && Number.isFinite(mem.usedJSHeapSize)) {
        return roundMetric(mem.usedJSHeapSize / (1024 * 1024), 1);
      }
      const jitter = (Math.random() - 0.48) * 1.4;
      this._streamValue = Math.max(8, roundMetric((this._streamValue || 28) + jitter, 1));
      return this._streamValue;
    }
    if (this.source === "dom") {
      if (this.doc && typeof this.doc.getElementsByTagName === "function") {
        const list = this.doc.getElementsByTagName("*");
        if (list && Number.isFinite(list.length) && list.length > 0) {
          return list.length;
        }
      }
      return 320;
    }
    if (this.source === "latency") {
      const perf = this.win?.performance;
      if (perf && typeof perf.getEntriesByType === "function") {
        const resources = perf.getEntriesByType("resource");
        if (Array.isArray(resources) && resources.length > 0) {
          const recent = resources[resources.length - 1];
          if (recent && Number.isFinite(recent.duration) && recent.duration > 0) {
            return roundMetric(recent.duration, 1);
          }
        }
      }
      const wave = (Math.random() - 0.47) * 9;
      this._streamValue = Math.max(6, Math.min(260, roundMetric((this._streamValue || 42) + wave, 1)));
      return this._streamValue;
    }

    const drift = (Math.random() - 0.48) * 7.5;
    const spike = Math.random() > 0.9 ? 14 : 0;
    const base = SOURCE_META[this.source]?.seedBase || 32;
    const next = (this._streamValue || base) * 0.88 + base * 0.12 + drift + spike;
    this._streamValue = Math.max(4, roundMetric(next, 1));
    return this._streamValue;
  }

  _stopSampleTimer() {
    if (this._sampleTimer) {
      clearInterval(this._sampleTimer);
      this._sampleTimer = null;
    }
  }

  _syncTimerCadence() {
    this._stopSampleTimer();
    if (this.cadence === "pause" || this.source === "custom") return;
    const ms = this.cadence === "5s" ? 5000 : 1000;
    const timerHost = this.pipWindow && !this.pipWindow.closed ? this.pipWindow : globalThis;
    const setInt = typeof timerHost.setInterval === "function" ? timerHost.setInterval.bind(timerHost) : setInterval;
    this._sampleTimer = setInt(() => {
      const sample = this._sampleCurrentSource();
      this.pushPoint(sample);
    }, ms);
  }

  pushPoint(value, timestamp = Date.now()) {
    const ok = this.buffer.push(value, timestamp);
    if (!ok) return false;
    this._streamValue = Number(value);
    this._renderChartAndStats();
    return true;
  }

  setSeries(values = []) {
    this.buffer.clear();
    if (Array.isArray(values)) {
      values.forEach((v) => this.buffer.push(v));
    }
    this._renderChartAndStats();
  }

  clearSeries() {
    this.buffer.clear();
    this._renderChartAndStats();
    this._showStatus("Chart cleared");
  }

  setSource(source) {
    if (!SOURCE_META[source]) return;
    this.source = source;
    this._writeStorage(`${this.storagePrefix}:source`, source);
    this.buffer.clear();
    this._streamValue = SOURCE_META[source].seedBase;
    if (source !== "custom") {
      this.pushPoint(this._sampleCurrentSource());
    }
    this._syncTimerCadence();
    this._renderToolbarStates();
    this._renderChartAndStats();
    this._showStatus(`Source: ${SOURCE_META[source].label}`);
  }

  setCadence(cadence) {
    if (!["1s", "5s", "pause"].includes(cadence)) return;
    this.cadence = cadence;
    this._writeStorage(`${this.storagePrefix}:cadence`, cadence);
    this._syncTimerCadence();
    this._renderToolbarStates();
    this._showStatus(cadence === "pause" ? "Stream paused" : `Tick rate: ${cadence}`);
  }

  setNoteScope(scope) {
    if (!["route", "domain", "global"].includes(scope)) return;
    this.noteScope = scope;
    this._writeStorage(`${this.storagePrefix}:scope`, scope);
    this._renderToolbarStates();
    this._renderRouteAndNotes();
    this._showStatus(`Notes scope: ${scope}`);
  }

  toggleMinimize(forceState) {
    this.minimized = typeof forceState === "boolean" ? forceState : !this.minimized;
    this._writeStorage(`${this.storagePrefix}:minimized`, this.minimized ? "1" : "0");
    if (this.hostEl) {
      if (this.minimized) {
        this.hostEl.setAttribute("data-minimized", "true");
      } else {
        this.hostEl.removeAttribute("data-minimized");
      }
      if (!this.pipWindow) {
        const curLeft = parseInt(this.hostEl.style.left, 10) || 24;
        const curTop = parseInt(this.hostEl.style.top, 10) || 24;
        this.setPosition(curLeft, curTop);
      }
    }
    return this.minimized;
  }

  show() {
    this.visible = true;
    if (this.hostEl) this.hostEl.style.display = "block";
  }

  hide() {
    this.visible = false;
    if (this.hostEl) this.hostEl.style.display = "none";
  }

  toggleVisibility(forceVisible) {
    const next = typeof forceVisible === "boolean" ? forceVisible : !this.visible;
    if (next) this.show();
    else this.hide();
    return this.visible;
  }

  exportSnapshotJson() {
    const loc = this.win?.location || { hostname: "local", pathname: "/", hash: "" };
    return {
      version: WIDGET_VERSION,
      exportedAt: new Date().toISOString(),
      route: `${loc.hostname || "local"}${loc.pathname || "/"}${loc.hash || ""}`,
      source: this.source,
      unit: this.getUnit(),
      cadence: this.cadence,
      stats: this.getStats(),
      series: this.buffer.toArray(),
      noteScope: this.noteScope,
      notes: this.getNote()
    };
  }

  async _handleQuickAction(action) {
    if (action === "add-point") {
      const sample = this.source === "custom"
        ? roundMetric(20 + Math.random() * 80, 1)
        : this._sampleCurrentSource();
      this.pushPoint(sample);
      this._showStatus(`Added ${sample} ${this.getUnit()}`);
      return;
    }
    if (action === "copy-json") {
      const jsonStr = JSON.stringify(this.exportSnapshotJson(), null, 2);
      try {
        if (this.win?.navigator?.clipboard?.writeText) {
          await this.win.navigator.clipboard.writeText(jsonStr);
          this._showStatus("JSON copied to clipboard");
        } else {
          this._showStatus(`Snapshot ready (${this.buffer.length} pts)`);
        }
      } catch (_) {
        this._showStatus("Clipboard blocked by page");
      }
      return;
    }
    if (action === "snapshot") {
      const payload = JSON.stringify(this.exportSnapshotJson(), null, 2);
      try {
        if (this.doc && typeof Blob !== "undefined" && this.win?.URL?.createObjectURL) {
          const blob = new Blob([payload], { type: "application/json" });
          const url = this.win.URL.createObjectURL(blob);
          const link = this.doc.createElement("a");
          link.href = url;
          link.download = `widget-snapshot-${Date.now()}.json`;
          link.click();
          setTimeout(() => this.win.URL.revokeObjectURL(url), 1000);
          this._showStatus("Snapshot downloaded");
          return;
        }
      } catch (_) {}
      this._showStatus("Snapshot generated");
      return;
    }
    if (action === "clear") {
      this.clearSeries();
      return;
    }
    if (action === "minimize") {
      this.toggleMinimize(true);
      return;
    }
    if (action === "expand") {
      this.toggleMinimize(false);
      return;
    }
    if (action === "hide") {
      this.hide();
      return;
    }
    if (action === "detach-pip") {
      await this.detachPiP();
    }
  }

  async detachPiP() {
    if (!this.win || !this.hostEl) return false;
    if (this.pipWindow && !this.pipWindow.closed) {
      try {
        this.pipWindow.focus();
        return true;
      } catch (_) {}
    }

    if (!("documentPictureInPicture" in this.win) || !this.win.documentPictureInPicture) {
      this._showStatus("Document PiP requires Chromium");
      return false;
    }

    try {
      const pipWin = await this.win.documentPictureInPicture.requestWindow({
        width: 356,
        height: 416
      });
      this.pipWindow = pipWin;
      this.toggleMinimize(false);

      pipWin.document.title = this.title;
      pipWin.document.body.style.margin = "0";
      pipWin.document.body.style.padding = "8px";
      pipWin.document.body.style.background = "#0D0D10";

      const cardEl = this.shadowRoot?.getElementById("fcw-card");
      if (cardEl) cardEl.classList.add("is-pip");

      this.hostEl.style.position = "static";
      this.hostEl.style.width = "100%";
      pipWin.document.body.appendChild(this.hostEl);
      this._syncTimerCadence();

      pipWin.addEventListener("pagehide", () => {
        this.pipWindow = null;
        if (cardEl) cardEl.classList.remove("is-pip");
        if (this.doc?.body && this.hostEl) {
          this.hostEl.style.position = "fixed";
          this.hostEl.style.width = "auto";
          this.doc.body.appendChild(this.hostEl);
          this._restorePosition();
        }
        this._syncTimerCadence();
      });

      this._showStatus("Detached to PiP window");
      return true;
    } catch (_) {
      this._showStatus("PiP request declined");
      return false;
    }
  }

  _showStatus(msg) {
    if (!this.shadowRoot) return;
    const el = this.shadowRoot.getElementById("fcw-status-text");
    if (el) el.textContent = msg;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      if (this.shadowRoot) {
        const cur = this.shadowRoot.getElementById("fcw-status-text");
        if (cur) cur.textContent = `${SOURCE_META[this.source]?.label || "Custom"} (${this.cadence})`;
      }
    }, 2200);
  }

  _renderAll() {
    this._renderToolbarStates();
    this._renderRouteAndNotes();
    this._renderChartAndStats();
  }

  _renderToolbarStates() {
    if (!this.shadowRoot) return;
    const sourceBtns = this.shadowRoot.querySelectorAll("[data-source]");
    sourceBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-source") === this.source);
    });

    const cadenceBtns = this.shadowRoot.querySelectorAll("[data-cadence]");
    cadenceBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-cadence") === this.cadence);
    });

    const scopeBtns = this.shadowRoot.querySelectorAll("[data-scope]");
    scopeBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-scope") === this.noteScope);
    });
  }

  _renderRouteAndNotes() {
    if (!this.shadowRoot) return;
    const loc = this.win?.location || { hostname: "local", pathname: "/", hash: "" };
    const routeLabel = formatRouteLabel(loc, "route");
    const scopeLabel = formatRouteLabel(loc, this.noteScope);

    const subEl = this.shadowRoot.getElementById("fcw-route-sub");
    if (subEl) subEl.textContent = routeLabel;

    const noteKeyEl = this.shadowRoot.getElementById("fcw-notes-key-label");
    if (noteKeyEl) noteKeyEl.textContent = scopeLabel;

    const noteInput = this.shadowRoot.getElementById("fcw-note-input");
    if (noteInput) {
      const stored = this.getNote();
      if (noteInput.value !== stored) {
        noteInput.value = stored;
      }
    }
  }

  _renderChartAndStats() {
    if (!this.shadowRoot) return;
    const values = this.buffer.values();
    const stats = computeSeriesStats(values);
    const unit = this.getUnit();

    const heroVal = this.shadowRoot.getElementById("fcw-hero-val");
    if (heroVal) heroVal.textContent = stats.count > 0 ? String(stats.last) : "--";

    const heroUnit = this.shadowRoot.getElementById("fcw-hero-unit");
    if (heroUnit) heroUnit.textContent = unit;

    const heroDelta = this.shadowRoot.getElementById("fcw-hero-delta");
    if (heroDelta) {
      const sign = stats.delta > 0 ? "+" : "";
      heroDelta.textContent = stats.count > 0 ? `${sign}${stats.delta} ${unit} | n=${stats.count}` : "n=0";
    }

    const setCell = (id, val) => {
      const el = this.shadowRoot.getElementById(id);
      if (el) el.textContent = stats.count > 0 ? String(val) : "--";
    };
    setCell("fcw-stat-min", stats.min);
    setCell("fcw-stat-avg", stats.avg);
    setCell("fcw-stat-max", stats.max);
    setCell("fcw-stat-p95", stats.p95);

    const { linePath, areaPath, lastPoint } = buildSparklinePaths(values, 308, 84, 6);
    const lineEl = this.shadowRoot.getElementById("fcw-spark-line");
    const areaEl = this.shadowRoot.getElementById("fcw-spark-area");
    const dotEl = this.shadowRoot.getElementById("fcw-spark-dot");

    if (lineEl) lineEl.setAttribute("d", linePath);
    if (areaEl) areaEl.setAttribute("d", areaPath);
    if (dotEl) {
      dotEl.setAttribute("cx", String(lastPoint.x));
      dotEl.setAttribute("cy", String(lastPoint.y));
      dotEl.style.display = stats.count > 0 ? "block" : "none";
    }

    const minValEl = this.shadowRoot.getElementById("fcw-min-val");
    if (minValEl) {
      minValEl.textContent = stats.count > 0 ? `${stats.last} ${unit}`.trim() : `-- ${unit}`.trim();
    }
    const minLineEl = this.shadowRoot.getElementById("fcw-min-line");
    if (minLineEl) {
      const mini = buildSparklinePaths(values, 54, 18, 2);
      minLineEl.setAttribute("d", mini.linePath);
    }
  }

  static autoMount(options = {}) {
    if (typeof window === "undefined" || typeof document === "undefined") return null;
    if (window.FloatingWidget instanceof FloatingChartWidget) {
      window.FloatingWidget.mount();
      return window.FloatingWidget;
    }
    const instance = new FloatingChartWidget(options);
    instance.mount();
    window.FloatingWidget = instance;
    return instance;
  }
}

if (typeof window !== "undefined") {
  window.FloatingChartWidget = FloatingChartWidget;
}

export {
  WIDGET_VERSION,
  MONOCHROME_TOKENS,
  SOURCE_META,
  MetricRingBuffer,
  roundMetric,
  computeSeriesStats,
  buildSparklinePaths,
  clampPosition,
  resolveStorageScopeKey,
  formatRouteLabel,
  SHADOW_STYLESHEET,
  FloatingChartWidget
};
