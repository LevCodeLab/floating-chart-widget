import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateExtensionIcons } from "./generate-icons.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_FILE = path.join(ROOT_DIR, "src", "floating-widget.js");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const EXT_DIR = path.join(ROOT_DIR, "extension");

function createIifeBundle(esmSource, { autoMountDefault = true } = {}) {
  const withoutExports = esmSource.replace(/\nexport\s*\{[\s\S]*?\};\s*$/m, "\n");

  const bootFooter = autoMountDefault
    ? `
  globalScope.FloatingChartWidget = FloatingChartWidget;
  globalScope.FloatingChartWidgetUtils = {
    WIDGET_VERSION,
    MONOCHROME_TOKENS,
    SOURCE_META,
    MetricRingBuffer,
    roundMetric,
    computeSeriesStats,
    buildSparklinePaths,
    clampPosition,
    resolveStorageScopeKey,
    formatRouteLabel
  };

  const currentScript = typeof document !== "undefined" ? document.currentScript : null;
  const manualAttr = currentScript && currentScript.hasAttribute("data-manual-mount");
  if (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    !window.__FCW_MANUAL_MOUNT__ &&
    !manualAttr
  ) {
    const boot = () => {
      if (!window.FloatingWidget) {
        FloatingChartWidget.autoMount();
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
`
    : `
  globalScope.FloatingChartWidget = FloatingChartWidget;
  globalScope.FloatingChartWidgetUtils = {
    WIDGET_VERSION,
    MONOCHROME_TOKENS,
    SOURCE_META,
    MetricRingBuffer,
    roundMetric,
    computeSeriesStats,
    buildSparklinePaths,
    clampPosition,
    resolveStorageScopeKey,
    formatRouteLabel
  };
`;

  return `(function (globalScope) {\n  "use strict";\n\n${withoutExports}\n${bootFooter}})(typeof globalThis !== "undefined" ? globalThis : window);\n`;
}

export function buildAll() {
  const esmSource = fs.readFileSync(SRC_FILE, "utf8");
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.mkdirSync(EXT_DIR, { recursive: true });

  const distBundle = createIifeBundle(esmSource, { autoMountDefault: true });
  const extBundle = createIifeBundle(esmSource, { autoMountDefault: false });

  fs.writeFileSync(path.join(DIST_DIR, "floating-widget.js"), distBundle, "utf8");
  fs.writeFileSync(path.join(EXT_DIR, "widget.js"), extBundle, "utf8");

  generateExtensionIcons();

  return {
    distBytes: Buffer.byteLength(distBundle, "utf8"),
    extBytes: Buffer.byteLength(extBundle, "utf8")
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildAll();
  console.log(`Built dist/floating-widget.js (${result.distBytes} B) and extension/widget.js (${result.extBytes} B)`);
}
