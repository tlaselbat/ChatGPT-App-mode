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

function isTrustedPermission(topUrl, details, origin) {
  const requester = details?.requestingUrl || details?.securityOrigin || origin;
  return isChatGptUrl(topUrl) && isChatGptUrl(requester) && details?.isMainFrame !== false &&
    (!details?.embeddingOrigin || isChatGptUrl(details.embeddingOrigin));
}

module.exports = { isChatGptUrl, isLoginUrl, isExternalUrl, hostProfile, isTrustedPermission };
