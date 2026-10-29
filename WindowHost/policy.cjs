const path = require('node:path');

function isChatGptUrl(value) {
  try {
    const url = new URL(value);
    return ['https://chatgpt.com', 'https://chat.openai.com'].includes(url.origin) && !url.username && !url.password;
  } catch { return false; }
}

function isLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['auth.openai.com', 'auth0.openai.com', 'accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com'].includes(url.hostname);
  } catch { return false; }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function hostProfile(root) { return path.join(root, 'Browser', 'AppModeHostProfile'); }

function allowControlOriginInCsp(policy, controlOrigin) {
  return policy.split(/(,)/).map(part => part === ',' ? part : allowControlOriginInSerializedCsp(part, controlOrigin)).join('');
}

function allowControlOriginInSerializedCsp(policy, controlOrigin) {
  const directives = policy.split(';');
  const connectIndex = directives.findIndex(directive => /^\s*connect-src(?:\s|$)/i.test(directive));
  const defaultDirective = directives.find(directive => /^\s*default-src(?:\s|$)/i.test(directive));
  const sources = directive => directive.trim().split(/\s+/).slice(1);
  const replacement = values => ` connect-src ${values.join(' ')}`;
  if (connectIndex >= 0) {
    const values = sources(directives[connectIndex]);
    directives[connectIndex] = replacement([...new Set([...values.filter(value => value !== "'none'"), controlOrigin])]);
  } else if (defaultDirective) {
    const values = sources(defaultDirective);
    directives.push(replacement([...new Set([...values.filter(value => value !== "'none'"), controlOrigin])]));
  }
  return directives.join(';');
}

function singleFlight(task) {
  let inFlight = false;
  return async (...args) => {
    if (inFlight) return false;
    inFlight = true;
    try { await task(...args); return true; } finally { inFlight = false; }
  };
}

function canApplyDocumentResult({ response, contentsAlive, requestedGeneration, currentGeneration, trusted }) {
  return response === 1 && contentsAlive && requestedGeneration === currentGeneration && trusted;
}

function tryCreateWindow(create, args) {
  try { create(args); return true; } catch { return false; }
}

function isTrustedPermission(topUrl, details, origin) {
  const requester = details?.requestingUrl || details?.securityOrigin || origin;
  return isChatGptUrl(topUrl) && isChatGptUrl(requester) && details?.isMainFrame !== false &&
    (!details?.embeddingOrigin || isChatGptUrl(details.embeddingOrigin));
}

module.exports = {
  isChatGptUrl, isLoginUrl, isExternalUrl, hostProfile, isTrustedPermission,
  allowControlOriginInCsp, singleFlight, canApplyDocumentResult, tryCreateWindow,
};
