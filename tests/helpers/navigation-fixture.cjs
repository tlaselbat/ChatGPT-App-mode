// Shared synthetic navigation markup; extracted without changing existing behavior.
function navigationHtml(native = false, open = true, retained = false) {
  return `<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;font:13px system-ui;color:#243247}html{color-scheme:light dark}
    #section-shell{display:flex;height:100vh}main{flex:1;min-width:0}header{height:40px;display:flex;align-items:center}
    aside{flex:0 0 280px;width:280px;overflow:hidden}.sidebar-navigation{height:100%;display:flex;flex-direction:column;min-height:0}
    .h-toolbar{height:44px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
    .nav-scroll{min-height:0;flex:1;overflow-y:auto}.section-footer{height:56px;flex-shrink:0}
    .group\\/nav-list{display:flex;flex-direction:column}.group\\/nav-section-title{display:flex;align-items:center;min-height:36px;position:relative}
    .group\\/nav-section-title>div:first-child{min-width:0;flex:1}.group\\/section-toggle{width:100%;background:transparent;border:0;text-align:left;color:inherit}
    a{display:flex;align-items:center;min-height:34px;min-width:0;color:inherit;text-decoration:none}a>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    button{color:inherit;min-height:32px}section{margin:0}.native-scrim{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50}
    #browser-sidebar-popover{position:fixed;left:0;top:0;width:min(320px,calc(100vw - 52px));bottom:0;z-index:51;background:#e1e4ea}
    #drawer-close::before{content:'';position:absolute;inset:0}
    [role=menu]{position:fixed;bottom:50px;left:60px;z-index:80;background:Canvas;color:CanvasText;padding:12px}
    @media(prefers-color-scheme:dark){body{color:#d5deef}}
    </style></head><body><div id="section-shell" data-app-shell-responsive-sidebar data-app-shell-sidebar-open="${open}"><main><header><button aria-label="Open sidebar" id="section-opener">Sidebar</button><button id="chat-mode">Chat</button><button id="work-mode">Work</button></header><h1>Synthetic workspace</h1></main></div>
    <script>
    const native = ${JSON.stringify(native)};
    const state = {open:${JSON.stringify(open)}, sections:{pinned:false,projects:false,recents:true,collections:true},mode:'chat'};
    const labels = {pinned:'Pinned',projects:'Projects',recents:'Recents',collections:'Collections'};
    function section(key) {
      const label=labels[key], controlled=native||key==='collections';
      const heading=controlled?'<button type="button" class="group/section-toggle" aria-expanded="'+state.sections[key]+'" data-native-section="'+key+'">'+label+'</button>':label;
      const rows=Array.from({length:key==='recents'?45:3},(_,i)=>'<a href="'+(key==='projects'?'/g/g-synthetic/project':'/c/synthetic-'+key+'-'+i)+'"><span>'+label+' synthetic navigation entry '+i+' with a long title</span></a>').join('');
      return '<section class="group/nav-section" data-section="'+key+'"><div class="group/nav-section"><div class="group/nav-section-title"><div>'+heading+'</div></div><div '+(controlled&&!state.sections[key]?'hidden':'')+'>'+rows+'</div></div></section>';
    }
    function navigationMarkup(drawer) {
      return '<div class="sidebar-navigation"><div class="h-toolbar"><strong>ChatGPT</strong><button aria-label="Search">Search</button>'+(drawer?'<button aria-label="Close sidebar" id="drawer-close">Close</button>':'')+'</div><div class="group/nav-list"><a href="/" data-primary>New chat</a></div><div class="nav-scroll"><div class="group/nav-list"><a href="/scheduled" data-primary>Scheduled</a><a href="/library" data-primary>Library</a><button>Plugins</button><button>Explore</button></div>'+Object.keys(labels).map(section).join('')+'<section class="group/nav-section" data-section="unknown"><div><div class="group/nav-section-title"><a href="/library">Unknown native group</a></div><div><a href="/library">Unrecognized action</a></div></div></section></div><div class="section-footer"><button aria-label="User menu" aria-haspopup="menu" id="native-account">Synthetic account</button></div></div>';
    }
    function render() {
      document.querySelector('aside')?.remove();document.querySelector('#section-portal')?.remove();
      if(!state.open&&!${JSON.stringify(retained)})return;
      if(innerWidth>=700||!state.open){const aside=document.createElement('aside');aside.className='app-shell-left-panel';if(!state.open){aside.style.cssText='width:52px;flex-basis:52px';aside.inert=true;aside.setAttribute('aria-hidden','true')}aside.innerHTML='<div style="min-width:340px;width:340px;max-width:100%;height:100%">'+navigationMarkup(false)+'</div>';document.querySelector('#section-shell').prepend(aside)}
      else{const portal=document.createElement('div');portal.id='section-portal';portal.innerHTML='<div class="native-scrim codex-dialog-overlay" aria-hidden="true"></div><div id="browser-sidebar-popover" role="dialog" aria-modal="true">'+navigationMarkup(true)+'</div>';document.body.append(portal)}
    }
    function toggle(){state.open=!state.open;document.querySelector('#section-shell').setAttribute('data-app-shell-sidebar-open',String(state.open));render()}
    document.querySelector('#section-opener').onclick=toggle;
    document.querySelector('#work-mode').onclick=()=>{state.mode='work';render()};document.querySelector('#chat-mode').onclick=()=>{state.mode='chat';render()};
    function account(){if(document.querySelector('[role=menu]'))return;const menu=document.createElement('div');menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem">Settings</button><button role="menuitem">Subscription</button><button role="menuitem">Sign out</button>';document.body.append(menu);menu.querySelector('button').focus()}
    document.addEventListener('keydown',event=>{if(event.target.id==='native-account'&&event.key==='Enter')account();if(event.key==='Escape'){if(document.querySelector('[role=menu]')){document.querySelector('[role=menu]').remove();document.querySelector('#native-account')?.focus()}else if(innerWidth<700&&state.open)toggle()}});
    document.addEventListener('click',event=>{const target=event.target.closest('button,a,.native-scrim');if(!target)return;if(target.id==='drawer-close'||target.classList.contains('native-scrim'))toggle();if(target.id==='native-account')account();if(target.dataset.nativeSection){const key=target.dataset.nativeSection;state.sections[key]=!state.sections[key];target.setAttribute('aria-expanded',String(state.sections[key]));target.closest('section').firstElementChild.lastElementChild.hidden=!state.sections[key]}
      if(target.matches('a[href]')){event.preventDefault();history.pushState({},'',target.getAttribute('href'));document.querySelectorAll('[aria-current]').forEach(e=>e.removeAttribute('aria-current'));target.setAttribute('aria-current','page');window.syntheticNavigationCalls=(window.syntheticNavigationCalls||0)+1}
    });
    window.syntheticSidebarRender=render;window.addEventListener('resize',render);render();
    </script></body></html>`;
}
module.exports = { navigationHtml };
