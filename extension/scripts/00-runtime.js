/* Shared App Mode page state and compatibility vocabulary. */
(() => {
  const c = window.__APP_MODE_CONTEXT__ || (window.__APP_MODE_CONTEXT__ = {});
  if (c.installed || c.initialized) { c.reinjection = true; return; }
  Object.assign(c, {
    initialized: true, installed: false, reinjection: false,
    markerClass: 'faux-chatgpt-app-mode', pinButtonId: 'chatgpt-app-mode-pin-toggle',
    controlUrl: 'http://127.0.0.1:17863/topmost', sessionUrl: 'http://127.0.0.1:17863/session', cleanTitle: 'ChatGPT',
    compactSidebarEnabled: window.__APP_MODE_COMPACT_SIDEBAR__ !== false,
    lastReportedUrl: '', lastReportedTitle: '', sessionPending: false, sessionRetryAt: 0, retryDelay: 3000,
    windowHandle: '', windowProcessId: 0, pinPending: false, pinRevision: 0, activityPending: false, activityRetryAt: 0,
    relocatedShare: null, shareMenuTrigger: null, navigationAdapter: null, navigationController: null,
    homeLayoutController: null, observer: null, titleObserver: null, titleElement: null
  });
  window.__APP_MODE_OVERRIDE_RUNTIME__ = c;
  c.setCompatibility = (feature, state) => {
    if (!['pending', 'ready', 'degraded', 'unsupported', 'disabled'].includes(state)) return;
    const attribute = 'data-app-mode-' + feature + '-status';
    if (document.body?.getAttribute(attribute) !== state) document.body?.setAttribute(attribute, state);
  };
})();
