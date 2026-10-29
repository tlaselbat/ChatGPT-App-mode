/*
  ChatGPT App Mode JS Overrides
  Do not store passwords, tokens, secrets, or conversation data here.
*/

(() => {
  const markerClass = "faux-chatgpt-app-mode";
  const pinButtonId = "chatgpt-app-mode-pin-toggle";
  const controlUrl = "http://127.0.0.1:17863/topmost";
  const sessionUrl = "http://127.0.0.1:17863/session";
  const cleanTitle = "ChatGPT";
  let lastReportedUrl = "";
  let lastReportedTitle = "";
  let sessionPending = false;
  let sessionRetryAt = 0;
  let retryDelay = 3000;
  let windowHandle = "";
  let windowProcessId = 0;
  let pinPending = false;
  let pinRevision = 0;
  let activityPending = false;
  let activityRetryAt = 0;

  function markBody() {
    if (document.body && !document.body.classList.contains(markerClass)) {
      document.body.classList.add(markerClass);
    }
  }

  async function reportScrollActivity(event) {
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

  function setTitle() {
    if (document.title !== cleanTitle) {
      document.title = cleanTitle;
    }
  }

  function init() {
    markBody();
    reportCurrentSession();
    setTitle();
    ensurePinButton();
  }

  function getCurrentChatId() {
    const match = window.location.pathname.match(/\/c\/([A-Za-z0-9-]+)/);
    return match ? match[1] : "";
  }

  function isRestorableChatGptPage() {
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

  function cleanChatTitle(text) {
    if (!text) {
      return "";
    }

    return text
      .replace(/\s+/g, " ")
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .trim();
  }

  function getCurrentChatTitle() {
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

  async function postJson(url, body) {
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

  async function callTopMostControl(action) {
    // Bind only while this document is focused. Each background window keeps
    // its own validated HWND/PID instead of adopting another foreground window.
    const binding = action === "status" && document.hasFocus() ? "" : windowHandle;
    const result = await postJson(controlUrl,
      `action=${encodeURIComponent(action)}&handle=${encodeURIComponent(binding)}&processId=${windowProcessId}`);
    windowHandle = result.handle || "";
    windowProcessId = result.processId || 0;
    return result;
  }

  function setPinState(button, enabled) {
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "Always on top is on" : "Always on top is off";
    button.title += " (Alt+Shift+P)";
    button.classList.remove("is-unavailable");
    button.removeAttribute("data-unavailable");
  }

  function showPinError(button, error) {
    button.classList.add("is-unavailable");
    button.dataset.unavailable = "true";
    const focusError = error.status === 409;
    button.title = focusError
      ? "Activate this App Mode window, then click the pin again"
      : "Cannot reach App Mode control. Allow local-network access for ChatGPT if prompted, or restart the control server from Settings";
  }

  async function togglePin(button) {
    if (pinPending) return;
    pinPending = true;
    ++pinRevision;
    button.disabled = true;
    try {
      // Recover the current HWND/PID and native state on every user click.
      // Explicit on/off avoids a second toggle if a response is delayed/lost.
      const current = await callTopMostControl("status");
      const result = await callTopMostControl(current.enabled ? "off" : "on");
      setPinState(document.getElementById(pinButtonId) || button, Boolean(result.enabled));
    } catch (error) {
      showPinError(document.getElementById(pinButtonId) || button, error);
    } finally {
      pinPending = false;
      button.disabled = false;
      const currentButton = document.getElementById(pinButtonId);
      if (currentButton) currentButton.disabled = false;
    }
  }

  async function refreshPinState(button) {
    if (pinPending || (!document.hasFocus() && !windowHandle)) return;
    const revision = ++pinRevision;
    try {
      const result = await callTopMostControl("status");
      if (revision !== pinRevision) return;
      setPinState(button, Boolean(result.enabled));
    } catch (error) {
      if (revision !== pinRevision) return;
      showPinError(button, error);
    }
  }

  function findVisiblePageElement(selector) {
    return [...document.querySelectorAll(selector)].find(element => {
      if (element.closest('aside, nav, [role="dialog"], [aria-hidden="true"], [inert]')) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse";
    });
  }

  function ensurePinButton() {
    if (!document.body) return;
    // ChatGPT selectors are best-effort. A dedicated flow toolbar is used if
    // the site removes or renames its header; never float over conversation text.
    // Client navigation can keep previous pages mounted but hidden. Never
    // attach to their headers or leave a fallback inside their main element.
    const header = findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
    const existing = document.getElementById(pinButtonId);
    if (existing) {
      const toolbar = existing.parentElement;
      if (header && toolbar.parentElement !== header) {
        header.appendChild(toolbar);
        document.getElementById("chatgpt-app-mode-toolbar-fallback")?.remove();
      }
      if (!header) mountFallback(toolbar);
      return;
    }

    const toolbar = document.createElement("span");
    toolbar.className = "chatgpt-app-mode-toolbar";

    const button = document.createElement("button");
    button.id = pinButtonId;
    button.type = "button";
    button.className = "chatgpt-app-mode-pin-button";
    button.setAttribute("aria-label", "Toggle always on top");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-keyshortcuts", "Alt+Shift+P");
    button.title = "Always on top is off";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8.2 3.5h7.6l-1.05 6.35 3.85 4.05v1.95H13.1L12 22l-1.1-6.15H5.4V13.9l3.85-4.05L8.2 3.5Z" />
      </svg>
    `;

    toolbar.appendChild(button);
    if (header) header.appendChild(toolbar);
    else mountFallback(toolbar);
    refreshPinState(button);
  }

  function mountFallback(toolbar) {
    const fallback = document.getElementById("chatgpt-app-mode-toolbar-fallback") || document.createElement("div");
    fallback.id = "chatgpt-app-mode-toolbar-fallback";
    if (!fallback.hasAttribute("role")) {
      fallback.setAttribute("role", "toolbar");
      fallback.setAttribute("aria-label", "App Mode controls");
    }
    if (toolbar.parentElement !== fallback) fallback.appendChild(toolbar);
    // The app shell may fill and clip the viewport. Keep the fallback inside
    // its main flow rather than prepending an off-screen sibling to that shell.
    const host = findVisiblePageElement('main, [role="main"]') || document.body;
    if (fallback.parentElement !== host) host.prepend(fallback);
  }

  async function reportCurrentSession() {
    if (!isRestorableChatGptPage()) {
      return;
    }

    if (sessionPending || Date.now() < sessionRetryAt || !document.hasFocus()) return;
    // Persist only an approved route, never query/hash values.
    const currentUrl = window.location.origin + window.location.pathname;
    const currentTitle = getCurrentChatTitle();

    if (currentUrl === lastReportedUrl && currentTitle === lastReportedTitle) {
      return;
    }

    sessionPending = true;
    try {
      const result = await postJson(sessionUrl, `url=${encodeURIComponent(currentUrl)}&title=${encodeURIComponent(currentTitle)}`);
      if (!result.saved) throw new Error("Session not saved");
      lastReportedUrl = currentUrl;
      lastReportedTitle = currentTitle;
      retryDelay = 3000;
      sessionRetryAt = 0;
    } catch {
      sessionRetryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30000);
    } finally {
      sessionPending = false;
    }
  }

  // Delegate in the capture phase: React may clone/replace the header nodes,
  // discarding per-button listeners, or handle bubbled header clicks itself.
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(`#${pinButtonId}`) : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    togglePin(button);
  }, true);

  // Delegation survives ChatGPT navigation and replaced scroll containers.
  document.addEventListener("wheel", reportScrollActivity, { passive: true, capture: true });

  init();

  const observer = new MutationObserver(() => {
    markBody();
    ensurePinButton();
    reportCurrentSession();
    setTitle();
  });

  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "inert", "data-app-shell-responsive-sidebar", "data-app-shell-sidebar-open"],
    subtree: true
  });

  const titleElement = document.querySelector("title");
  if (titleElement) {
    new MutationObserver(setTitle).observe(titleElement, {
      childList: true
    });
  }

  window.setInterval(reportCurrentSession, 3000);
  window.setInterval(() => {
    setTitle();
    ensurePinButton();
  }, 1000);
  window.setInterval(() => {
    const button = document.getElementById(pinButtonId);
    if (button && document.hasFocus()) refreshPinState(button);
  }, 5000);
  window.addEventListener("focus", () => {
    sessionRetryAt = 0;
    reportCurrentSession();
    const button = document.getElementById(pinButtonId);
    if (button) refreshPinState(button);
  });
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyP" && !event.repeat) {
      event.preventDefault();
      document.getElementById(pinButtonId)?.click();
    }
  });
  window.addEventListener("popstate", init);
  window.addEventListener("hashchange", init);
})();
