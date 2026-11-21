import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MetricRingBuffer,
  computeSeriesStats,
  buildSparklinePaths,
  clampPosition,
  resolveStorageScopeKey,
  FloatingChartWidget,
  MONOCHROME_TOKENS
} from "../src/floating-widget.js";
import { isMonochromeHex, runBrandAndThemeAudit } from "../scripts/lint-brand.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

function createMockEnvironment(initialUrl = "https://app.example.org/dashboard") {
  const store = new Map();
  const storage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    }
  };

  class MockElement {
    constructor(tagName) {
      this.tagName = String(tagName || "DIV").toUpperCase();
      this.id = "";
      this.className = "";
      this.style = { display: "block", left: "0px", top: "0px", position: "fixed" };
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.shadowRoot = null;
      this.value = "";
      this._textContent = "";
      this._innerHTML = "";
      this._listeners = new Map();
      this._idIndex = new Map();
      this._attrButtons = [];
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach((c) => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach((c) => this.classList._set.delete(c)),
        toggle: (c, force) => {
          const next = typeof force === "boolean" ? force : !this.classList._set.has(c);
          if (next) this.classList._set.add(c);
          else this.classList._set.delete(c);
          return next;
        },
        contains: (c) => this.classList._set.has(c)
      };
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(val) {
      this._textContent = String(val ?? "");
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(html) {
      this._innerHTML = String(html ?? "");
      this._idIndex.clear();
      this._attrButtons = [];

      const idRegex = /<([a-zA-Z0-9]+)\b[^>]*?\bid="([^"]+)"[^>]*>/g;
      let match;
      while ((match = idRegex.exec(this._innerHTML)) !== null) {
        const child = new MockElement(match[1]);
        child.id = match[2];
        child.parentNode = this;
        this._idIndex.set(child.id, child);
      }

      const dataAttrRegex = /<button\b([^>]*)>/g;
      let btnMatch;
      while ((btnMatch = dataAttrRegex.exec(this._innerHTML)) !== null) {
        const attrs = btnMatch[1];
        const btn = new MockElement("button");
        btn.parentNode = this;
        const pairs = attrs.matchAll(/(data-[a-z-]+)="([^"]+)"/g);
        for (const p of pairs) {
          btn.setAttribute(p[1], p[2]);
        }
        if (/\bis-active\b/.test(attrs)) {
          btn.classList.add("is-active");
        }
        this._attrButtons.push(btn);
      }
    }

    setAttribute(name, val) {
      const str = String(val);
      this.attributes.set(name, str);
      if (name === "id") this.id = str;
    }

    getAttribute(name) {
      if (name === "id" && this.id) return this.id;
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    appendChild(child) {
      if (child.parentNode && typeof child.parentNode.removeChild === "function") {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }

    attachShadow({ mode }) {
      const sr = new MockElement("shadow-root");
      sr.mode = mode;
      sr.host = this;
      this.shadowRoot = sr;
      return sr;
    }

    getElementById(targetId) {
      if (this.id === targetId) return this;
      if (this._idIndex.has(targetId)) return this._idIndex.get(targetId);
      for (const ch of this.children) {
        const found = ch.getElementById(targetId);
        if (found) return found;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      const attrMatch = selector.match(/^\[([a-z-]+)\]$/);
      const targetAttr = attrMatch ? attrMatch[1] : null;
      if (targetAttr) {
        for (const b of this._attrButtons) {
          if (b.getAttribute(targetAttr) !== null) results.push(b);
        }
        for (const ch of this.children) {
          results.push(...ch.querySelectorAll(selector));
        }
      }
      return results;
    }

    getBoundingClientRect() {
      const isMin = this.getAttribute("data-minimized") === "true";
      return {
        left: parseInt(this.style.left, 10) || 0,
        top: parseInt(this.style.top, 10) || 0,
        width: isMin ? 170 : 340,
        height: isMin ? 42 : 380
      };
    }

    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    }

    dispatchEvent(type, payload = {}) {
      const handlers = this._listeners.get(type);
      if (!handlers) return;
      const ev = Object.assign(
        {
          type,
          target: this,
          preventDefault() {},
          stopPropagation() {}
        },
        payload
      );
      for (const fn of handlers) fn(ev);
    }

    closest(sel) {
      if (sel.includes(this.tagName.toLowerCase())) return this;
      return null;
    }
  }

  const parsed = new URL(initialUrl);
  const locationObj = {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    hash: parsed.hash
  };

  const winListeners = new Map();
  const body = new MockElement("body");
  const head = new MockElement("head");
  const docElement = new MockElement("html");
  docElement.appendChild(head);
  docElement.appendChild(body);

  const doc = {
    head,
    body,
    documentElement: docElement,
    createElement(tag) {
      return new MockElement(tag);
    },
    getElementById(id) {
      return docElement.getElementById(id);
    },
    getElementsByTagName() {
      return new Array(245);
    }
  };

  const historyObj = {
    pushState(_state, _title, nextUrl) {
      const next = new URL(nextUrl, locationObj.href);
      locationObj.href = next.href;
      locationObj.hostname = next.hostname;
      locationObj.pathname = next.pathname;
      locationObj.hash = next.hash;
    },
    replaceState(_state, _title, nextUrl) {
      const next = new URL(nextUrl, locationObj.href);
      locationObj.href = next.href;
      locationObj.hostname = next.hostname;
      locationObj.pathname = next.pathname;
      locationObj.hash = next.hash;
    }
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    location: locationObj,
    history: historyObj,
    document: doc,
    localStorage: storage,
    navigator: {
      clipboard: {
        lastCopied: null,
        async writeText(txt) {
          this.lastCopied = txt;
        }
      }
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchWindowEvent(type, ev = {}) {
      const set = winListeners.get(type);
      if (!set) return;
      for (const fn of set) fn(Object.assign({ preventDefault() {} }, ev));
    }
  };

  return { win, doc, storage, store };
}

test("MetricRingBuffer enforces fixed capacity and computes rolling stats accurately", () => {
  const buf = new MetricRingBuffer(5);
  [10, 20, 30, 40, 50, 60].forEach((v, idx) => buf.push(v, 1000 + idx));

  assert.equal(buf.length, 5);
  assert.deepEqual(buf.values(), [20, 30, 40, 50, 60]);
  assert.equal(buf.last(), 60);

  const series = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
  const stats = computeSeriesStats(series);
  assert.equal(stats.count, 20);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 200);
  assert.equal(stats.avg, 105);
  assert.equal(stats.p95, 190);
  assert.equal(stats.last, 200);
  assert.equal(stats.delta, 10);
});

test("buildSparklinePaths handles empty, single-point, flat, and variable series", () => {
  const empty = buildSparklinePaths([], 300, 80, 5);
  assert.equal(empty.linePath, "");
  assert.equal(empty.areaPath, "");
  assert.equal(empty.points.length, 0);

  const single = buildSparklinePaths([42], 300, 80, 5);
  assert.match(single.linePath, /^M 5 40 L 295 40$/);
  assert.ok(single.areaPath.endsWith("Z"));
  assert.equal(single.lastPoint.x, 295);
  assert.equal(single.lastPoint.y, 40);

  const flat = buildSparklinePaths([25, 25, 25], 300, 80, 5);
  assert.equal(flat.points.length, 3);
  assert.ok(flat.points.every((pt) => pt.y === 40));

  const rising = buildSparklinePaths([10, 50, 90], 210, 110, 5);
  assert.deepEqual(
    rising.points.map((p) => ({ x: p.x, y: p.y })),
    [
      { x: 5, y: 105 },
      { x: 105, y: 55 },
      { x: 205, y: 5 }
    ]
  );
  assert.equal(rising.linePath, "M 5 105 L 105 55 L 205 5");
  assert.equal(rising.areaPath, "M 5 105 L 105 55 L 205 5 L 205 105 L 5 105 Z");
});

test("clampPosition keeps widget inside viewport margins across extremes", () => {
  const topLeftOverflow = clampPosition(-250, -90, 340, 380, 1280, 800, 10);
  assert.deepEqual(topLeftOverflow, { left: 10, top: 10 });

  const bottomRightOverflow = clampPosition(5000, 3000, 340, 380, 1280, 800, 10);
  assert.deepEqual(bottomRightOverflow, { left: 930, top: 410 });
});

test("FloatingChartWidget mounts inside Shadow DOM, clamps drag coordinates, and persists state", () => {
  const { win, doc, storage } = createMockEnvironment("https://metrics.example.org/overview");
  const widget = new FloatingChartWidget({
    windowRef: win,
    documentRef: doc,
    storageRef: storage,
    initialCadence: "pause",
    seedSeries: [12, 24, 36, 48]
  });

  widget.mount();
  assert.equal(widget.mounted, true);
  assert.ok(widget.hostEl);
  assert.ok(widget.shadowRoot);
  assert.equal(widget.shadowRoot.mode, "open");
  assert.equal(doc.getElementById("floating-chart-widget-host"), widget.hostEl);

  // Host CSS leak check: styles live strictly inside shadowRoot, not document.head
  assert.equal(doc.head.children.length, 0);
  assert.equal(widget.shadowRoot.children[0].tagName, "STYLE");

  // Push live point and verify SVG + stats update
  widget.pushPoint(96);
  const stats = widget.getStats();
  assert.equal(stats.count, 5);
  assert.equal(stats.max, 96);
  assert.equal(widget.shadowRoot.getElementById("fcw-hero-val").textContent, "96");
  assert.ok(widget.shadowRoot.getElementById("fcw-spark-line").getAttribute("d").startsWith("M "));

  // Simulate pointer drag out of bounds and verify clamping + localStorage save
  const handle = widget.shadowRoot.getElementById("fcw-drag-handle");
  handle.dispatchEvent("pointerdown", { clientX: 950, clientY: 30, pointerId: 1 });
  handle.dispatchEvent("pointermove", { clientX: 2500, clientY: -200, pointerId: 1 });
  handle.dispatchEvent("pointerup", { pointerId: 1 });

  assert.equal(widget.hostEl.style.left, "932px");
  assert.equal(widget.hostEl.style.top, "8px");
  const persistedPos = JSON.parse(storage.getItem("fcw_v1:pos"));
  assert.deepEqual(persistedPos, { left: 932, top: 8 });

  // Verify SPA pushState switches route scratchpad notes in 0ms
  widget.setNote("overview baseline ok");
  assert.equal(widget.getNote(), "overview baseline ok");

  win.history.pushState({}, "", "/incidents#spike-1");
  assert.equal(widget.getNote(), "");
  widget.setNote("investigating p95 spike");

  win.history.pushState({}, "", "/overview");
  assert.equal(widget.getNote(), "overview baseline ok");
  assert.equal(widget.shadowRoot.getElementById("fcw-note-input").value, "overview baseline ok");

  // Verify Alt+Shift+W toggles visibility
  assert.equal(widget.visible, true);
  win.dispatchWindowEvent("keydown", { altKey: true, shiftKey: true, code: "KeyW", key: "W" });
  assert.equal(widget.visible, false);
  assert.equal(widget.hostEl.style.display, "none");

  // Unmount restores original history methods and removes host node
  widget.unmount();
  assert.equal(widget.mounted, false);
  assert.equal(doc.getElementById("floating-chart-widget-host"), null);
});

test("resolveStorageScopeKey isolates route, domain, and global keys cleanly", () => {
  const loc = { hostname: "Sub.Example.org", pathname: "/logs", hash: "#tail" };
  assert.equal(resolveStorageScopeKey(loc, "route", "p"), "p:route:sub.example.org/logs#tail");
  assert.equal(resolveStorageScopeKey(loc, "domain", "p"), "p:domain:sub.example.org");
  assert.equal(resolveStorageScopeKey(loc, "global", "p"), "p:global");
});

test("Monochrome theme audit confirms zero non-monochrome colors in widget and extension", () => {
  for (const hex of Object.values(MONOCHROME_TOKENS)) {
    assert.equal(isMonochromeHex(hex), true, `Expected ${hex} to be pure monochrome`);
  }

  const filesToAudit = [
    path.join(ROOT_DIR, "src", "floating-widget.js"),
    path.join(ROOT_DIR, "extension", "popup.html"),
    path.join(ROOT_DIR, "extension", "popup.js"),
    path.join(ROOT_DIR, "extension", "content.js"),
    path.join(ROOT_DIR, "extension", "icons", "icon.svg")
  ];

  const bannedNamedColors = /\b(hotpink|crimson|tomato|limegreen|springgreen|dodgerblue|deepskyblue|blueviolet|gold|orange|orangered|magenta|cyan|yellow)\b/i;

  for (const filePath of filesToAudit) {
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(bannedNamedColors.test(content), false, `Disallowed named color in ${filePath}`);
    const hexes = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    for (const h of hexes) {
      if (h.length === 4 || h.length === 7 || h.length === 9) {
        assert.equal(isMonochromeHex(h), true, `Non-monochrome hex ${h} found in ${filePath}`);
      }
    }
  }

  const repoViolations = runBrandAndThemeAudit(ROOT_DIR);
  assert.deepEqual(repoViolations, []);
});
