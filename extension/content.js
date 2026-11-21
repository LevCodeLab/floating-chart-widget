(function () {
  "use strict";

  if (window.__FCW_CONTENT_LOADED__) return;
  window.__FCW_CONTENT_LOADED__ = true;

  const PREF_KEY = "fcw_ext_prefs_v1";

  function getDefaultPrefs() {
    return {
      enabled: false,
      source: "stream",
      cadence: "1s"
    };
  }

  function ensureInstance(prefs) {
    if (!window.FloatingChartWidget) return null;
    if (!window.FloatingWidget) {
      window.FloatingWidget = new window.FloatingChartWidget({
        initialSource: prefs?.source || "stream",
        initialCadence: prefs?.cadence || "1s",
        visible: true
      });
    }
    if (!window.FloatingWidget.mounted) {
      window.FloatingWidget.mount();
    }
    return window.FloatingWidget;
  }

  function applyPrefs(prefs) {
    if (prefs.enabled) {
      const widget = ensureInstance(prefs);
      if (widget) {
        if (prefs.source && widget.source !== prefs.source) {
          widget.setSource(prefs.source);
        }
        if (prefs.cadence && widget.cadence !== prefs.cadence) {
          widget.setCadence(prefs.cadence);
        }
        widget.show();
      }
    } else if (window.FloatingWidget && window.FloatingWidget.mounted) {
      window.FloatingWidget.hide();
    }
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([PREF_KEY], (res) => {
      const prefs = Object.assign(getDefaultPrefs(), res?.[PREF_KEY] || {});
      if (prefs.enabled) {
        applyPrefs(prefs);
      }
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string") return false;

      if (msg.type === "FCW_GET_STATE") {
        const w = window.FloatingWidget;
        sendResponse({
          ok: true,
          mounted: Boolean(w && w.mounted),
          visible: Boolean(w && w.mounted && w.visible),
          source: w ? w.source : "stream",
          cadence: w ? w.cadence : "1s",
          stats: w ? w.getStats() : null
        });
        return true;
      }

      if (msg.type === "FCW_TOGGLE") {
        const widget = ensureInstance(msg);
        if (!widget) {
          sendResponse({ ok: false, error: "Widget class unavailable" });
          return true;
        }
        const nextVisible = typeof msg.visible === "boolean"
          ? widget.toggleVisibility(msg.visible)
          : widget.toggleVisibility();
        sendResponse({
          ok: true,
          visible: nextVisible,
          source: widget.source,
          cadence: widget.cadence
        });
        return true;
      }

      if (msg.type === "FCW_SET_SOURCE") {
        const widget = ensureInstance(msg);
        if (widget && msg.source) {
          widget.setSource(msg.source);
          widget.show();
        }
        sendResponse({ ok: true, source: widget?.source || msg.source, visible: true });
        return true;
      }

      if (msg.type === "FCW_SET_CADENCE") {
        const widget = ensureInstance(msg);
        if (widget && msg.cadence) {
          widget.setCadence(msg.cadence);
          widget.show();
        }
        sendResponse({ ok: true, cadence: widget?.cadence || msg.cadence, visible: true });
        return true;
      }

      if (msg.type === "FCW_PUSH_SPIKE") {
        const widget = ensureInstance(msg);
        if (widget) {
          widget.show();
          const val = Number.isFinite(Number(msg.value)) ? Number(msg.value) : Math.round(45 + Math.random() * 75);
          widget.pushPoint(val);
          sendResponse({ ok: true, value: val, stats: widget.getStats() });
          return true;
        }
        sendResponse({ ok: false });
        return true;
      }

      if (msg.type === "FCW_RESET_POS") {
        const widget = ensureInstance(msg);
        if (widget) {
          widget.show();
          const pos = widget.resetPosition();
          sendResponse({ ok: true, pos });
          return true;
        }
        sendResponse({ ok: false });
        return true;
      }

      return false;
    });
  }
})();
