/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  c.markBody = function markBody() {
    if (document.body && !document.body.classList.contains(markerClass)) {
      document.body.classList.add(markerClass);
    }
  }

  c.reportScrollActivity = async function reportScrollActivity(event) {
    // Report only a transient activity pulse, never targets, text, coordinates, or wheel deltas.
    if (!event.isTrusted || !windowHandle || !windowProcessId || activityPending || performance.now() < activityRetryAt) return;
    const button = document.getElementById(pinButtonId);
    if (button?.getAttribute("aria-pressed") !== "true") return;
    activityPending = true;
    activityRetryAt = performance.now() + 250;
    try {
      await postJson(controlUrl, `action=activity&handle=${encodeURIComponent(windowHandle)}&processId=${windowProcessId}`);
    } catch {
      // No UI interruption or retry loop when the optional control server is offline.
      activityRetryAt = performance.now() + 3000;
    } finally {
      activityPending = false;
    }
  }

  c.setTitle = function setTitle() {
    if (document.title !== cleanTitle) {
      document.title = cleanTitle;
    }
  }

  c.init = function init() {
    markBody();
    reportCurrentSession();
    setTitle();
    ensurePinButton();
    ensureShareMenu();
    ensureCompactSidebar();
    ensureHomeLayout();
  }

  c.getCurrentChatId = function getCurrentChatId() {
    const match = window.location.pathname.match(/\/c\/([A-Za-z0-9-]+)/);
    return match ? match[1] : "";
  }

  c.isRestorableChatGptPage = function isRestorableChatGptPage() {
    const { hostname, pathname, protocol } = window.location;

    if (protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(hostname)) {
      return false;
    }

    return (
      pathname === "/" ||
      /^\/c\/[A-Za-z0-9-]+\/?$/.test(pathname) ||
      /^\/g\/[^/]+\/?$/.test(pathname) ||
      /^\/g\/[^/]+\/c\/[A-Za-z0-9-]+\/?$/.test(pathname)
    );
  }

  c.cleanChatTitle = function cleanChatTitle(text) {
    if (!text) {
      return "";
    }

    return text
      .replace(/\s+/g, " ")
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .trim();
  }

  c.getCurrentChatTitle = function getCurrentChatTitle() {
    const chatId = getCurrentChatId();
    if (!chatId) {
      return cleanChatTitle(document.title);
    }

    const selectors = [
      `a[aria-current="page"][href*="/c/${chatId}"]`,
      `a[href*="/c/${chatId}"]`,
      `[data-testid="history-item-${chatId}"]`,
      `nav a[href*="${chatId}"]`
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const title = cleanChatTitle(
        element?.getAttribute("aria-label") ||
        element?.getAttribute("title") ||
        element?.textContent
      );

      if (title && title !== "ChatGPT") {
        return title;
      }
    }

    return cleanChatTitle(document.title);
  }

  c.postJson = async function postJson(url, body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      signal: controller.signal,
      body
      });
      if (!response.ok) {
        const error = new Error("App Mode control unavailable");
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  c.callTopMostControl = async function callTopMostControl(action) {
    // Bind only while this document is focused. Each background window keeps
    // its own validated HWND/PID instead of adopting another foreground window.
    const binding = action === "status" && document.hasFocus() ? "" : windowHandle;
    const result = await postJson(controlUrl,
      `action=${encodeURIComponent(action)}&handle=${encodeURIComponent(binding)}&processId=${windowProcessId}`);
    return result;
  }


  }
})();
