(function () {
  "use strict";

  const PREF_KEY = "fcw_ext_prefs_v1";
  const badgeEl = document.getElementById("ext-state-badge");
  const msgEl = document.getElementById("popup-msg");
  const toggleBtn = document.getElementById("btn-toggle-widget");
  const pushBtn = document.getElementById("btn-push-spike");
  const resetBtn = document.getElementById("btn-reset-pos");
  const sourceBtns = Array.from(document.querySelectorAll("[data-source]"));
  const cadenceBtns = Array.from(document.querySelectorAll("[data-cadence]"));

  let currentPrefs = {
    enabled: false,
    source: "stream",
    cadence: "1s"
  };

  function setStatus(text) {
    if (msgEl) msgEl.textContent = text;
  }

  function updateButtonsUi(visible) {
    if (badgeEl) {
      badgeEl.textContent = visible ? "Active" : "Hidden";
    }
    if (toggleBtn) {
      toggleBtn.textContent = visible ? "Hide Widget on Tab" : "Show Widget on Tab";
    }
    sourceBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-source") === currentPrefs.source);
    });
    cadenceBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-cadence") === currentPrefs.cadence);
    });
  }

  function savePrefs() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [PREF_KEY]: currentPrefs });
    }
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function sendToActiveTab(payload) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus("No active tab");
      return null;
    }

    const sendOnce = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, payload, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(resp || null);
        });
      });

    let response = await sendOnce();
    if (!response && chrome.scripting && chrome.scripting.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["widget.js", "content.js"]
        });
        response = await sendOnce();
      } catch (_) {
        setStatus("Restricted browser tab");
        return null;
      }
    }
    return response;
  }

  async function initPopup() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([PREF_KEY], async (res) => {
        if (res && res[PREF_KEY]) {
          currentPrefs = Object.assign(currentPrefs, res[PREF_KEY]);
        }
        const tabState = await sendToActiveTab({ type: "FCW_GET_STATE" });
        if (tabState && tabState.ok) {
          currentPrefs.source = tabState.source || currentPrefs.source;
          currentPrefs.cadence = tabState.cadence || currentPrefs.cadence;
          updateButtonsUi(Boolean(tabState.visible));
        } else {
          updateButtonsUi(Boolean(currentPrefs.enabled));
        }
      });
    }
  }

  toggleBtn.addEventListener("click", async () => {
    const resp = await sendToActiveTab({
      type: "FCW_TOGGLE",
      source: currentPrefs.source,
      cadence: currentPrefs.cadence
    });
    if (resp && resp.ok) {
      currentPrefs.enabled = Boolean(resp.visible);
      savePrefs();
      updateButtonsUi(Boolean(resp.visible));
      setStatus(resp.visible ? "Widget mounted" : "Widget hidden");
    }
  });

  pushBtn.addEventListener("click", async () => {
    const resp = await sendToActiveTab({ type: "FCW_PUSH_SPIKE" });
    if (resp && resp.ok) {
      currentPrefs.enabled = true;
      savePrefs();
      updateButtonsUi(true);
      setStatus(`Pushed ${resp.value}`);
    }
  });

  resetBtn.addEventListener("click", async () => {
    const resp = await sendToActiveTab({ type: "FCW_RESET_POS" });
    if (resp && resp.ok) {
      currentPrefs.enabled = true;
      savePrefs();
      updateButtonsUi(true);
      setStatus("Coordinates reset");
    }
  });

  sourceBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const src = btn.getAttribute("data-source");
      currentPrefs.source = src;
      currentPrefs.enabled = true;
      savePrefs();
      const resp = await sendToActiveTab({ type: "FCW_SET_SOURCE", source: src });
      updateButtonsUi(true);
      if (resp && resp.ok) setStatus(`Source: ${src}`);
    });
  });

  cadenceBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cad = btn.getAttribute("data-cadence");
      currentPrefs.cadence = cad;
      currentPrefs.enabled = true;
      savePrefs();
      const resp = await sendToActiveTab({ type: "FCW_SET_CADENCE", cadence: cad });
      updateButtonsUi(true);
      if (resp && resp.ok) setStatus(`Tick: ${cad}`);
    });
  });

  initPopup();
})();
