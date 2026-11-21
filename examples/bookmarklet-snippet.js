/**
 * Console / Bookmarklet quick loader for FloatingChartWidget.
 *
 * Paste into DevTools Console on any page (when serving dist/ locally on port 3000),
 * or adapt SCRIPT_URL to your own static host.
 */
(function () {
  var SCRIPT_URL = "http://localhost:3000/dist/floating-widget.js";

  if (window.FloatingWidget && typeof window.FloatingWidget.toggleVisibility === "function") {
    window.FloatingWidget.toggleVisibility();
    return;
  }

  var script = document.createElement("script");
  script.src = SCRIPT_URL;
  script.onload = function () {
    if (window.FloatingChartWidget && !window.FloatingWidget) {
      window.FloatingChartWidget.autoMount({
        title: "Bookmarklet Chart",
        initialSource: "fps",
        initialCadence: "1s"
      });
    }
  };
  script.onerror = function () {
    console.warn("[FloatingChartWidget] Could not load bundle from " + SCRIPT_URL);
  };
  document.head.appendChild(script);
})();
