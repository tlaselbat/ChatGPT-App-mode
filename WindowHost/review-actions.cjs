const fs = require('node:fs');
const path = require('node:path');
async function run(win, request, sourceRoot, outputRoot) {
  if (request.action === 'reload') { win.webContents.reload(); return {status:'review-home-reloading'}; }
  if (request.action === 'sidebar') {
    const clicked=await win.webContents.executeJavaScript(`(() => {
      const button=[...document.querySelectorAll('[data-app-mode-header-control-branch="leading"] button')].find(el=>
        !el.closest('[aria-hidden="true"],[inert]')&&getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().width>0);
      if(!button) return false; button.click(); return true;
    })()`);
    return {status:clicked?'review-sidebar-toggled':'sidebar-control-unavailable'};
  }
  if (request.action === 'escape') {
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    return {status:'review-overlay-dismissed'};
  }
  if (request.action === 'size' && [390,448,489,690,1024,1280].includes(request.width)) {
    win.setBounds({ width:request.width,height:1000 }); return {status:'resized',width:request.width};
  }
  if (request.action === 'zoom' && [0.8,1,1.1,1.25].includes(request.factor)) {
    win.webContents.setZoomMode('isolated');
    win.webContents.setZoomFactor(request.factor); return {status:'zoom-set',factor:request.factor};
  }
  if (request.action === 'styles') {
    // A full ordinary reload removes earlier inserted rules and old observers.
    // This verifies the saved implementation rather than an additive CSS patch.
    win.webContents.reload();
    return {status:'review-source-reloading'};
  }
  if (request.action === 'capture') {
    await win.webContents.executeJavaScript(`(() => {
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode,parent=node.parentElement;
        if(!parent || parent.closest('svg,script,style')) continue;
        const box=parent.getBoundingClientRect();
        if(box.bottom>0 && box.top<64 && node.nodeValue.trim() && !/^(Chat|Work|Log in|Sign up)$/.test(node.nodeValue.trim())) parent.setAttribute('data-review-mask-text','');
      }
    })()`);
    const css = await win.webContents.insertCSS('[data-review-mask-text]{color:transparent!important;text-shadow:none!important}img,video,canvas{visibility:hidden!important}');
    try {
      const bounds = win.getContentBounds();
      const image = await win.webContents.capturePage({x:0,y:0,width:bounds.width,height:64});
      fs.writeFileSync(path.join(outputRoot,'header.png'),image.toPNG());
    } finally {
      await win.webContents.removeInsertedCSS(css);
      await win.webContents.executeJavaScript("document.querySelectorAll('[data-review-mask-text]').forEach(el=>el.removeAttribute('data-review-mask-text'))");
    }
    return {status:'header-captured',scope:'top-64px-only-with-private-text-masked'};
  }
  if (request.action !== 'measure') return {status:'unknown-review-command'};
  return win.webContents.executeJavaScript(`(() => {
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
module.exports={run};
