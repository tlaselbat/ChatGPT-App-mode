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

  function markBody() {
    if (document.body && !document.body.classList.contains(markerClass)) {
      document.body.classList.add(markerClass);
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

  async function callTopMostControl(action) {
    const response = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },
      body: `action=${encodeURIComponent(action)}`
    });

    if (!response.ok) {
      throw new Error(`Topmost control failed: ${response.status}`);
    }

    return response.json();
  }

  function setPinState(button, enabled) {
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "Always on top is on" : "Always on top is off";
  }

  async function refreshPinState(button) {
    try {
      const result = await callTopMostControl("status");
      setPinState(button, Boolean(result.enabled));
    } catch {
      button.classList.add("is-unavailable");
      button.title = "Start the tray launcher to use always on top";
    }
  }

  function ensurePinButton() {
    if (!document.body || document.getElementById(pinButtonId)) {
      return;
    }

    const button = document.createElement("button");
    button.id = pinButtonId;
    button.type = "button";
    button.className = "chatgpt-app-mode-pin-button";
    button.setAttribute("aria-label", "Toggle always on top");
    button.setAttribute("aria-pressed", "false");
    button.title = "Always on top is off";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8.2 3.5h7.6l-1.05 6.35 3.85 4.05v1.95H13.1L12 22l-1.1-6.15H5.4V13.9l3.85-4.05L8.2 3.5Z" />
      </svg>
    `;

    button.addEventListener("click", async () => {
      button.classList.remove("is-unavailable");
      button.disabled = true;

      try {
        const result = await callTopMostControl("toggle");
        setPinState(button, Boolean(result.enabled));
      } catch {
        button.classList.add("is-unavailable");
        button.title = "Start the tray launcher to use always on top";
      } finally {
        button.disabled = false;
      }
    });

    document.body.appendChild(button);
    refreshPinState(button);
  }

  async function reportCurrentSession() {
    if (!isRestorableChatGptPage()) {
      return;
    }

    const currentUrl = window.location.href;
    const currentTitle = getCurrentChatTitle();

    if (currentUrl === lastReportedUrl && currentTitle === lastReportedTitle) {
      return;
    }

    lastReportedUrl = currentUrl;
    lastReportedTitle = currentTitle;

    try {
      await fetch(sessionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8"
        },
        body: `url=${encodeURIComponent(currentUrl)}&title=${encodeURIComponent(currentTitle)}`
      });
    } catch {
    }
  }

  init();

  const observer = new MutationObserver(() => {
    markBody();
    ensurePinButton();
    reportCurrentSession();
    setTitle();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  const titleElement = document.querySelector("title");
  if (titleElement) {
    new MutationObserver(setTitle).observe(titleElement, {
      childList: true
    });
  }

  window.setInterval(reportCurrentSession, 3000);
  window.setInterval(setTitle, 1000);
  window.addEventListener("popstate", reportCurrentSession);
  window.addEventListener("hashchange", reportCurrentSession);
})();
