const { navigationHtml } = require('./navigation-fixture.cjs');

// All labels and route identifiers in this document are synthetic.
function visualHtml({ theme = 'light', expanded = false, kind = 'conversation', loading = false } = {}) {
  const dark = theme === 'dark';
  const content = kind === 'home'
    ? '<section class="welcome"><div><h1>What can we explore today?</h1></div><div><form><textarea aria-label="Message"> </textarea><button type="button">Send</button></form><p>Plan a project · Explore an idea</p></div></section>'
    : `<section class="thread"><h1>${kind === 'project' ? 'Synthetic project' : 'Visual verification'}</h1><article class="message user">Review the desktop layout.</article><article class="message">This synthetic workspace checks alignment, spacing, and native navigation.</article><form><textarea aria-label="Message" placeholder="Message ChatGPT"></textarea><button type="button">Send</button></form></section>`;
  return navigationHtml(true, expanded, true)
    .replace('projects:false', `projects:${kind === 'project'}`)
    .replace('<head>', `<head><meta charset="utf-8"><title>Synthetic visual fixture</title>`)
    .replace('</head>', `<style>
      :root{color-scheme:${theme};--main-surface-primary:${dark ? '#212121' : '#fff'};--main-surface-secondary:${dark ? '#303030' : '#f4f4f4'};--main-surface-tertiary:${dark ? '#414141' : '#e8e8e8'};--text-primary:${dark ? '#eee' : '#202020'};--text-secondary:${dark ? '#bbb' : '#555'};--border-light:${dark ? '#555' : '#ddd'}}
      body{font:14px Arial,sans-serif!important;color:var(--text-primary)!important;background:var(--main-surface-primary)}
      button,textarea{font:inherit}button{border:1px solid var(--border-light);border-radius:6px;padding:4px 10px;background:var(--main-surface-secondary)}
      aside{background:var(--main-surface-secondary)}header{gap:8px;padding:4px 12px;flex-shrink:0}main{display:flex;flex-direction:column;overflow:auto;background:var(--main-surface-primary)}
      .thread{width:min(680px,calc(100% - 32px));margin:36px auto}.thread h1{font-size:24px}.message{padding:20px 16px;margin:16px 0;line-height:1.6;border:1px solid var(--border-light);border-radius:14px}.user{background:var(--main-surface-secondary)}
      form{display:flex;align-items:center;gap:8px;border:1px solid var(--border-light);border-radius:16px;padding:12px;margin-top:28px}textarea{resize:none;min-width:0;flex:1;height:52px;border:0;background:transparent;color:inherit}.welcome{flex:1;min-height:0;width:min(680px,calc(100% - 32px));margin:auto}.welcome h1{font-size:28px}
      #synthetic-search{position:fixed;inset:100px 16px auto;margin:auto;max-width:560px;padding:24px;border:1px solid var(--border-light);border-radius:16px;background:var(--main-surface-primary);z-index:100}#synthetic-search input{width:100%;box-sizing:border-box;padding:12px}#synthetic-search::backdrop{background:#0006}
      ${loading ? 'body{background:#ff00ff!important}#section-shell{display:none}' : ''}
    </style></head>`)
    .replace('<h1>Synthetic workspace</h1>', content)
    .replace('</body>', `<dialog id="synthetic-search"><h2>Search synthetic conversations</h2><input aria-label="Search conversations" placeholder="Search"><p>Visual verification</p><button id="close-search">Close</button></dialog><script>
      document.documentElement.classList.toggle('dark',${dark});
      document.addEventListener('click',e=>{if(e.target.closest('button')?.getAttribute('aria-label')==='Search'){document.querySelector('#synthetic-search').showModal()}});
      document.querySelector('#close-search').onclick=()=>document.querySelector('#synthetic-search').close();
    </script></body>`);
}
module.exports = { visualHtml };
