/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  c.applyTopMostBinding = function applyTopMostBinding(result) {
    windowHandle = result.handle || "";
    windowProcessId = result.processId || 0;
  }

  c.setPinState = function setPinState(button, enabled) {
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "Always on top is on" : "Always on top is off";
    button.title += " (Alt+Shift+P)";
    button.classList.remove("is-unavailable");
    button.removeAttribute("data-unavailable");
  }

  c.showPinError = function showPinError(button, error) {
    button.classList.add("is-unavailable");
    button.dataset.unavailable = "true";
    const focusError = error.status === 409;
    button.title = focusError
      ? "Activate this App Mode window, then click the pin again"
      : "Cannot reach App Mode control. Allow local-network access for ChatGPT if prompted, or restart the control server from Settings";
  }

  c.togglePin = async function togglePin(button) {
    if (pinPending) return;
    pinPending = true;
    const revision = ++pinRevision;
    button.disabled = true;
    try {
      // Recover the current HWND/PID and native state on every user click.
      // Explicit on/off avoids a second toggle if a response is delayed/lost.
      const current = await callTopMostControl("status");
      if (revision !== pinRevision) return;
      applyTopMostBinding(current);
      const result = await callTopMostControl(current.enabled ? "off" : "on");
      if (revision !== pinRevision) return;
      applyTopMostBinding(result);
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

  c.refreshPinState = async function refreshPinState(button) {
    if (pinPending || (!document.hasFocus() && !windowHandle)) return;
    const revision = ++pinRevision;
    try {
      const result = await callTopMostControl("status");
      if (revision !== pinRevision) return;
      applyTopMostBinding(result);
      setPinState(button, Boolean(result.enabled));
    } catch (error) {
      if (revision !== pinRevision) return;
      showPinError(button, error);
    }
  }

  c.findVisiblePageElement = function findVisiblePageElement(selector) {
    return [...document.querySelectorAll(selector)].find(element => {
      if (element.closest('aside, nav, [role="dialog"], [aria-hidden="true"], [inert]')) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse";
    });
  }

  c.ensurePinButton = function ensurePinButton(resolvedHeader) {
    if (!document.body) return;
    // ChatGPT selectors are best-effort. A dedicated flow toolbar is used if
    // the site removes or renames its header; never float over conversation text.
    // Client navigation can keep previous pages mounted but hidden. Never
    // attach to their headers or leave a fallback inside their main element.
    const header = resolvedHeader === undefined ? findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]') : resolvedHeader;
    const existing = document.getElementById(pinButtonId);
    if (existing) {
      const toolbar = existing.parentElement;
      const heldHeader = toolbar.parentElement;
      const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!header && modal?.getBoundingClientRect().width > 0 && heldHeader?.matches('[data-app-mode-header-layout]') && heldHeader.closest('[aria-hidden="true"]') && heldHeader.getBoundingClientRect().width > 0 && getComputedStyle(heldHeader).visibility !== 'hidden') return;
      if (header && toolbar.parentElement !== header) {
        header.appendChild(toolbar);
        document.getElementById("chatgpt-app-mode-toolbar-fallback")?.remove();
      }
      if (!header) mountFallback(toolbar);
      setCompatibility('pin', 'ready');
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
    setCompatibility('pin', header || document.getElementById('chatgpt-app-mode-toolbar-fallback') ? 'ready' : 'unsupported');
    refreshPinState(button);
  }

  c.mountFallback = function mountFallback(toolbar) {
    const fallback = document.getElementById("chatgpt-app-mode-toolbar-fallback") || document.createElement("div");
    // Writing a filtered attribute unconditionally retriggers our own
    // MutationObserver forever; only assign when the value differs.
    if (fallback.id !== "chatgpt-app-mode-toolbar-fallback") fallback.id = "chatgpt-app-mode-toolbar-fallback";
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

  c.reportCurrentSession = async function reportCurrentSession() {
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


  }
})();
