const BRIDGE_ID = '__CGB_PREVIEW_BRIDGE__';

export function buildInjectedBridge(initialDevice) {
  const config = JSON.stringify({ width: initialDevice.width, height: initialDevice.height, dpr: initialDevice.dpr });
  return `
<script data-cgb-preview-bridge>
(function installCgbPreviewBridge(){
  if (window.${BRIDGE_ID}) return;
  var parentOrigin = '*';
  var device = ${config};
  var contexts = [];
  var globallyMuted = false;
  var frameAudible = true;
  var muteEnforcer = 0;
  var mediaMuteState = typeof WeakMap === 'function' ? new WeakMap() : null;

  function defineMetric(target, name, getter) {
    try { Object.defineProperty(target, name, { configurable: true, get: getter }); } catch (_) {}
  }
  defineMetric(window, 'devicePixelRatio', function(){ return device.dpr; });
  if (window.screen) {
    defineMetric(window.screen, 'width', function(){ return device.width; });
    defineMetric(window.screen, 'height', function(){ return device.height; });
    defineMetric(window.screen, 'availWidth', function(){ return device.width; });
    defineMetric(window.screen, 'availHeight', function(){ return device.height; });
  }

  function post(type, payload) {
    try { parent.postMessage(Object.assign({ source: 'cgb-preview-frame', type: type }, payload || {}), parentOrigin); } catch (_) {}
  }

  function applyViewport(next) {
    if (!next) return;
    device = {
      width: Number(next.width) || device.width,
      height: Number(next.height) || device.height,
      dpr: Number(next.dpr) || 1
    };
    requestAnimationFrame(function(){
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      try { window.dispatchEvent(new Event('orientationchange')); } catch (_) {}
      post('VIEWPORT_APPLIED', { device: device });
    });
  }

  // AppLovin supplies mraid.js in the real ad container. GitHub Pages does not,
  // so provide a minimal preview implementation before the playable bootstrap.
  if (!window.mraid) {
    var mraidListeners = {};
    window.mraid = {
      open: function(url){ post('CTA_ATTEMPT', { url: String(url || '') }); },
      getState: function(){ return 'default'; },
      getVersion: function(){ return '3.0-preview'; },
      isViewable: function(){ return true; },
      addEventListener: function(name, callback){
        if (typeof callback !== 'function') return;
        (mraidListeners[name] || (mraidListeners[name] = [])).push(callback);
        if (name === 'ready') setTimeout(function(){ callback(); }, 0);
        if (name === 'viewableChange') setTimeout(function(){ callback(true); }, 0);
      },
      removeEventListener: function(name, callback){
        var list = mraidListeners[name] || [];
        mraidListeners[name] = list.filter(function(item){ return item !== callback; });
      }
    };
  }

  window.addEventListener('error', function(event) {
    var target = event && event.target;
    if (target && target !== window) {
      var resourceUrl = target.src || target.href || '';
      if (/\\/mraid\\.js(?:[?#].*)?$/i.test(String(resourceUrl))) return;
      post('FRAME_ERROR', { message: 'Resource failed to load: ' + String(resourceUrl || target.tagName || 'unknown resource') });
      return;
    }
    post('FRAME_ERROR', {
      message: event && event.message ? String(event.message) : 'Unknown frame error',
      file: event && event.filename ? String(event.filename) : '',
      line: event && event.lineno ? event.lineno : 0,
      column: event && event.colno ? event.colno : 0
    });
  }, true);
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event && event.reason;
    post('FRAME_REJECTION', {
      message: reason && reason.message ? String(reason.message) : String(reason || 'Unhandled promise rejection')
    });
  });
  post('BRIDGE_INSTALLED', { device: device });

  function shouldMuteAudio() {
    return globallyMuted || !frameAudible;
  }

  function rememberContext(context) {
    if (context && contexts.indexOf(context) < 0) contexts.push(context);
    return context;
  }

  function patchAudioContext(name) {
    var Native = window[name];
    if (typeof Native !== 'function' || !Native.prototype) return;

    var proto = Native.prototype;
    var nativeResume = typeof proto.resume === 'function' ? proto.resume : null;
    var nativeSuspend = typeof proto.suspend === 'function' ? proto.suspend : null;

    // Cocos/WebAudio commonly resumes its context again after every user gesture.
    // Block that resume while the Preview Lab says this frame must stay muted.
    if (nativeResume && !proto.__cgbPreviewResumePatched) {
      try {
        Object.defineProperty(proto, '__cgbPreviewResumePatched', { value: true, configurable: true });
        proto.resume = function(){
          rememberContext(this);
          if (shouldMuteAudio()) {
            try {
              if (nativeSuspend && this.state !== 'suspended') nativeSuspend.call(this);
            } catch (_) {}
            return Promise.resolve();
          }
          return nativeResume.apply(this, arguments);
        };
      } catch (_) {}
    }

    function WrappedAudioContext() {
      var instance = Reflect.construct(Native, arguments, new.target || WrappedAudioContext);
      rememberContext(instance);
      if (shouldMuteAudio() && nativeSuspend) {
        setTimeout(function(){
          try { nativeSuspend.call(instance); } catch (_) {}
        }, 0);
      }
      return instance;
    }
    WrappedAudioContext.prototype = Native.prototype;
    try { Object.setPrototypeOf(WrappedAudioContext, Native); } catch (_) {}
    try { window[name] = WrappedAudioContext; } catch (_) {}
  }

  patchAudioContext('AudioContext');
  patchAudioContext('webkitAudioContext');

  // Media-element based audio is less common in Cocos, but some playable wrappers
  // or third-party code may use it. Force the current preview policy before play().
  if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
    var nativePlay = HTMLMediaElement.prototype.play;
    if (typeof nativePlay === 'function' && !HTMLMediaElement.prototype.__cgbPreviewPlayPatched) {
      try {
        Object.defineProperty(HTMLMediaElement.prototype, '__cgbPreviewPlayPatched', { value: true, configurable: true });
        HTMLMediaElement.prototype.play = function(){
          if (shouldMuteAudio()) {
            try { this.muted = true; } catch (_) {}
          }
          return nativePlay.apply(this, arguments);
        };
      } catch (_) {}
    }
  }

  function applyMediaMute(media, muted) {
    try {
      if (muted) {
        if (mediaMuteState && !mediaMuteState.has(media)) mediaMuteState.set(media, !!media.muted);
        media.muted = true;
      } else if (mediaMuteState && mediaMuteState.has(media)) {
        media.muted = !!mediaMuteState.get(media);
        mediaMuteState.delete(media);
      } else {
        media.muted = false;
      }
    } catch (_) {}
  }

  function applyMute() {
    var shouldMute = shouldMuteAudio();
    try {
      document.querySelectorAll('audio,video').forEach(function(media){ applyMediaMute(media, shouldMute); });
    } catch (_) {}

    contexts.slice().forEach(function(ctx){
      try {
        if (shouldMute) {
          if (ctx.state !== 'suspended' && typeof ctx.suspend === 'function') Promise.resolve(ctx.suspend()).catch(function(){});
        } else if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          Promise.resolve(ctx.resume()).catch(function(){});
        }
      } catch (_) {}
    });
  }

  function updateMuteEnforcer() {
    var shouldMute = shouldMuteAudio();
    if (shouldMute && !muteEnforcer) {
      // Defensive fallback for runtimes that create/resume audio outside the normal
      // wrapped path. This runs only while a frame is intentionally muted.
      muteEnforcer = setInterval(applyMute, 200);
    } else if (!shouldMute && muteEnforcer) {
      clearInterval(muteEnforcer);
      muteEnforcer = 0;
    }
  }

  function setMutePolicy(muted, audible) {
    globallyMuted = !!muted;
    frameAudible = !!audible;
    applyMute();
    updateMuteEnforcer();
  }

  // User activation is exactly when Cocos tends to resume WebAudio. Re-apply the
  // policy after the current event dispatch so Global Mute cannot be undone by it.
  ['pointerdown','mousedown','touchstart','keydown'].forEach(function(type){
    window.addEventListener(type, function(){
      if (!shouldMuteAudio()) return;
      setTimeout(applyMute, 0);
    }, true);
  });

  function callBridge(method) {
    var cgb = window.cgb || window.super_html;
    if (cgb) {
      if (method === 'gameEnd') {
        if (typeof cgb.gameEnd === 'function') { cgb.gameEnd(); return true; }
        if (typeof cgb.game_end === 'function') { cgb.game_end(); return true; }
      }
      if (method === 'download' && typeof cgb.download === 'function') {
        var oldOpen = window.open;
        var oldMraidOpen = window.mraid && window.mraid.open;
        window.open = function(url){ post('CTA_ATTEMPT', { url: String(url || '') }); return null; };
        if (window.mraid && typeof window.mraid.open === 'function') {
          window.mraid.open = function(url){ post('CTA_ATTEMPT', { url: String(url || '') }); };
        }
        try { cgb.download(); }
        finally {
          window.open = oldOpen;
          if (window.mraid && oldMraidOpen) window.mraid.open = oldMraidOpen;
        }
        return true;
      }
    }
    if (method === 'gameEnd' && typeof window.gameEnd === 'function') { window.gameEnd(); return true; }
    return false;
  }

  window.addEventListener('message', function(event){
    var msg = event.data;
    if (!msg || msg.source !== 'cgb-preview-host') return;
    if (msg.type === 'SET_MUTE') setMutePolicy(msg.muted, msg.audible);
    else if (msg.type === 'SET_VIEWPORT') applyViewport(msg.device);
    else if (msg.type === 'COMMAND') {
      var ok = callBridge(msg.command);
      post('COMMAND_RESULT', { command: msg.command, ok: ok });
    }
  });

  window.addEventListener('load', function(){
    setTimeout(function(){
      applyMute();
      updateMuteEnforcer();
      post('READY', { hasCgbBridge: !!(window.cgb || window.super_html), device: device });
    }, 0);
  });
  window.${BRIDGE_ID} = {
    applyMute: applyMute,
    setMutePolicy: setMutePolicy,
    callBridge: callBridge,
    applyViewport: applyViewport
  };
})();
</script>`;
}

export function injectPreviewBridge(html, device, options = {}) {
  const bridge = buildInjectedBridge(device);
  const baseHref = typeof options.baseHref === 'string' ? options.baseHref : '';
  const hasBase = /<base(?:\s[^>]*)?>/i.test(html);
  const safeBaseHref = baseHref
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const base = !hasBase && safeBaseHref
    ? `<base data-cgb-preview-base href="${safeBaseHref}">`
    : '';
  const injection = base + bridge;

  const headMatch = html.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch && headMatch.index != null) {
    const insertAt = headMatch.index + headMatch[0].length;
    return html.slice(0, insertAt) + injection + html.slice(insertAt);
  }
  const htmlMatch = html.match(/<html(?:\s[^>]*)?>/i);
  if (htmlMatch && htmlMatch.index != null) {
    const insertAt = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, insertAt) + '<head>' + injection + '</head>' + html.slice(insertAt);
  }
  return '<head>' + injection + '</head>' + html;
}
