const fs = require('node:fs');
const path = require('node:path');

function isTrustedReviewOrigin(currentUrl) {
  try {
    const url = new URL(currentUrl);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' &&
      !url.port && !url.username && !url.password;
  } catch { return false; }
}

function captureMaskHeight(zoomFactor) {
  // capturePage's 64 DIP clip reaches farther into CSS pixels below 100% zoom.
  // Mask a conservative CSS-height region before it is rasterized.
  return Math.max(64, 64 / (Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1));
}

async function run(win, request, sourceRoot, outputRoot) {
  // The remote page runs in its own WebContentsView below the app title bar.
  const chat = win.contentView?.children?.find(child => child.webContents?.getURL().startsWith('https://chatgpt.com'))?.webContents || win.webContents;
  if (request.action === 'reload') { chat.reload(); return {status:'review-home-reloading'}; }
  if (request.action === 'sidebar') {
    const clicked=await chat.executeJavaScript(`(() => {
      const button=[...document.querySelectorAll('[data-app-mode-header-control-branch="leading"] button')].find(el=>
        !el.closest('[aria-hidden="true"],[inert]')&&getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().width>0);
      if(!button) return false; button.click(); return true;
    })()`);
    return {status:clicked?'review-sidebar-toggled':'sidebar-control-unavailable'};
  }
  // A click that starts SPA navigation can leave the eval unsettled; cap it
  // so the review loop never wedges on a single command.
  const settle=p=>Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
  if (request.action === 'open-conversation') {
    if (!isTrustedReviewOrigin(chat.getURL())) return {status:'review-navigation-origin-rejected'};
    // Follow the first plain /c/<id> link already rendered on the page so the
    // reviewer can measure the conversation header. The target is never read.
    const opened=await settle(chat.executeJavaScript(`(() => {
      const link=[...document.querySelectorAll('a[href]')].find(el=>{
        let url; try { url=new URL(el.href); } catch { return false; }
        const r=el.getBoundingClientRect();
        return url.origin==='https://chatgpt.com'&&/^\/c\/[^/]+$/.test(url.pathname)&&r.width>0&&r.height>0&&!el.closest('[aria-hidden="true"],[inert]');
      });
      if(link) { link.click(); return 'opened'; }
      // The list only renders while the sidebar is open. Press the leftmost
      // top-band control once; the caller repeats this action to retry.
      const toggle=[...document.querySelectorAll('button')].find(el=>{
        const r=el.getBoundingClientRect();
        return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=64&&r.left<=96&&!el.closest('[aria-hidden="true"],[inert]');
      });
      if(!toggle) return 'unavailable'; toggle.click(); return 'sidebar-opening';
    })()`));
    return {status:{opened:'review-conversation-opening','sidebar-opening':'review-sidebar-opening'}[opened]||'conversation-link-unavailable'};
  }
  if (request.action === 'home') {
    if (!isTrustedReviewOrigin(chat.getURL())) return {status:'review-navigation-origin-rejected'};
    const opened=await settle(chat.executeJavaScript(`(() => {
      const link=[...document.querySelectorAll('a[href]')].find(el=>{
        let url; try { url=new URL(el.href); } catch { return false; }
        const r=el.getBoundingClientRect();
        return url.origin==='https://chatgpt.com'&&/^\/c\//.test(url.pathname)===false&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=64&&r.left<=96&&!el.closest('[aria-hidden="true"],[inert]');
      });
      if(!link) return false; link.click(); return true;
    })()`));
    return {status:opened?'review-home-opening':'home-link-unavailable'};
  }
  if (request.action === 'escape') {
    chat.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    chat.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    return {status:'review-overlay-dismissed'};
  }
  if (request.action === 'size' && [390,448,489,690,1024,1280].includes(request.width)) {
    win.setBounds({ width:request.width,height:1000 }); return {status:'resized',width:request.width};
  }
  if (request.action === 'zoom' && [0.8,1,1.1,1.25].includes(request.factor)) {
    chat.setZoomMode('isolated');
    chat.setZoomFactor(request.factor); return {status:'zoom-set',factor:request.factor};
  }
  if (request.action === 'styles') {
    // A full ordinary reload removes earlier inserted rules and old observers.
    // This verifies the saved implementation rather than an additive CSS patch.
    chat.reload();
    return {status:'review-source-reloading'};
  }
  if (request.action === 'capture') {
    const maskHeight = captureMaskHeight(chat.getZoomFactor());
    await chat.executeJavaScript(`(() => {
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode,parent=node.parentElement;
        if(!parent || parent.closest('svg,script,style')) continue;
        const box=parent.getBoundingClientRect();
        if(box.bottom>0 && box.top<${maskHeight} && node.nodeValue.trim() && !/^(Chat|Work|Log in|Sign up)$/.test(node.nodeValue.trim())) parent.setAttribute('data-review-mask-text','');
      }
    })()`);
    // The screenshot is a diagnostic artifact. Hide every image-derived or SVG
    // glyph in its clip because text may be baked into those visuals.
    const css = await chat.insertCSS('[data-review-mask-text]{color:transparent!important;text-shadow:none!important}svg,svg *{fill:transparent!important;stroke:transparent!important;color:transparent!important}img,video,canvas{visibility:hidden!important}*{background-image:none!important}', { cssOrigin: 'user' });
    try {
      // Let the renderer commit the masking rule before reading compositor
      // pixels. This also keeps offscreen review capture from sampling a
      // pre-injection frame.
      await chat.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const bounds = win.getContentBounds();
      const image = await chat.capturePage({x:0,y:0,width:bounds.width,height:64});
      fs.writeFileSync(path.join(outputRoot,'header.png'),image.toPNG());
    } finally {
      await chat.removeInsertedCSS(css);
      await chat.executeJavaScript("document.querySelectorAll('[data-review-mask-text]').forEach(el=>el.removeAttribute('data-review-mask-text'))");
    }
    return {status:'header-captured',scope:'top-64px-only-with-private-text-masked'};
  }
  if (request.action !== 'measure') return {status:'unknown-review-command'};
  return chat.executeJavaScript(`(() => {
    const describe=element=>{
      const r=element.getBoundingClientRect(),s=getComputedStyle(element);
      return {kind:element.tagName.toLowerCase(),managedPath:element.hasAttribute('data-app-mode-header-icon-path'),widthImportant:element.style.getPropertyPriority('width')==='important',contain:s.contain,box:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
        style:Object.fromEntries(['display','position','width','minWidth','maxWidth','height','flex','gap','padding','margin','transform','translate','overflow'].map(key=>[key,s[key]]))};
    };
    const controls=[...document.querySelectorAll('button,[role="tab"],[role="radio"],[role="button"],a')].filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=80&&s.visibility!=='hidden'&&!el.closest('[aria-hidden="true"],[inert]');
    });
    const header=document.querySelector('.chatgpt-app-mode-toolbar')?.parentElement;
    return {status:'top-controls-measured',viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},
      header:header?describe(header):null,
      sidebarStatePresent:Boolean(document.querySelector('[data-app-shell-sidebar-open]')),
      sidebarOpen:document.querySelector('[data-app-shell-sidebar-open]')?.getAttribute('data-app-shell-sidebar-open')==='true',
      overlay:navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
      normalizedGroups:document.querySelectorAll('[data-app-mode-header-tabs]').length,
      switchChildren:[...document.querySelectorAll('[data-app-mode-header-tabs] > *')].map(el=>({button:el.matches('button'),hidden:el.getAttribute('aria-hidden')==='true',pointerEvents:getComputedStyle(el).pointerEvents,selected:el.getAttribute('aria-selected'),pressed:el.getAttribute('aria-pressed'),...describe(el)})),
      headerChildren:header?[...header.children].map(el=>({...describe(el),controls:controls.map((control,index)=>el.contains(control)?index:null).filter(index=>index!==null)})):[],
      leadingChildren:[...document.querySelectorAll('[data-app-mode-header-control-branch="leading"] > *')].map(el=>({controls:el.querySelectorAll('button,a').length,hidden:el.getAttribute('aria-hidden')==='true',visibility:getComputedStyle(el).visibility,...describe(el)})),
      modeSpacers:[...document.querySelectorAll('[data-app-mode-header-tab-path]:not([data-app-mode-header-tabs]) > :not([data-app-mode-header-tab-path])')].map(el=>({interactive:el.querySelectorAll('button,a,[role="button"]').length,hasText:Boolean(el.textContent.trim()),hidden:el.getAttribute('aria-hidden')==='true',...describe(el)})),
      controls:controls.map((el,index)=>{
        const ancestors=[];
        for(let node=el.parentElement;node&&node!==header&&node!==document.body&&ancestors.length<12;node=node.parentElement) ancestors.push(describe(node));
        return {index,pin:el.id==='chatgpt-app-mode-pin-toggle',inAssumedHeader:Boolean(el.closest('[data-app-mode-header-layout]')),...describe(el),ancestors};
      })};
  })()`);
}
module.exports={run,isTrustedReviewOrigin,captureMaskHeight};
