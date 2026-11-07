// Every awaited stage is bound to the same trusted document generation.
async function injectPage({ current, load, css, scripts, header, navigation, reconcile = () => {}, diagnose = console.warn }) {
  for (const [code, action] of [
    ['INJECTION_LOAD_FAILED', load], ['INJECTION_CSS_FAILED', css],
    ['INJECTION_SCRIPTS_FAILED', scripts], ['INJECTION_HEADER_FAILED', header],
    ['INJECTION_NAVIGATION_FAILED', navigation],
    ['INJECTION_RECONCILE_FAILED', reconcile],
  ]) {
    if (!current()) return false;
    try { await action(); }
    catch { if (current()) diagnose(code); return false; }
  }
  return current();
}
module.exports = { injectPage };
