const BRIDGE_ID = '__CGB_PREVIEW_BRIDGE__';

export function buildInjectedBridge(initialDevice, platformMode = 'host') {
  const config = JSON.stringify({
    width: initialDevice.width,
    height: initialDevice.height,
    dpr: initialDevice.dpr,
    orientation: initialDevice.orientation || (initialDevice.width >= initialDevice.height ? 'landscape' : 'portrait'),
  });
  const platform = JSON.stringify(platformMode || 'host');
  return `
<script data-cgb-preview-bridge>
(function installCgbPreviewBridge(){
  if (window.${BRIDGE_ID}) return;
  var parentOrigin = '*';
  var device = ${config};
  var platformMode = ${platform};
  var contexts = [];
  var globallyMuted = false;
  var frameAudible = true;
  var muteEnforcer = 0;
  var mediaMuteState = typeof WeakMap === 'function' ? new WeakMap() : null;
  var cgbPatchTimer = 0;
  var lastUserGestureAt = 0;
  var previewCommandActive = false;

  function defineMetric(target, name, getter) {
    try { Object.defineProperty(target, name, { configurable: true, get: getter }); } catch (_) {}
  }

  function defineValue(target, name, value) {
    defineMetric(target, name, function(){ return value; });
  }

  function post(type, payload) {
    try { parent.postMessage(Object.assign({ source: 'cgb-preview-frame', type: type }, payload || {}), parentOrigin); } catch (_) {}
  }

  function installPlatformEmulation() {
    if (platformMode === 'ios') {
      var iosUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      defineValue(navigator, 'userAgent', iosUa);
      defineValue(navigator, 'appVersion', iosUa.replace(/^Mozilla\//, ''));
      defineValue(navigator, 'platform', 'iPhone');
      defineValue(navigator, 'vendor', 'Apple Computer, Inc.');
      defineValue(navigator, 'maxTouchPoints', 5);
      defineValue(navigator, 'userAgentData', undefined);
      try { defineValue(navigator, 'standalone', false); } catch (_) {}
    } else if (platformMode === 'android') {
      var androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      defineValue(navigator, 'userAgent', androidUa);
      defineValue(navigator, 'appVersion', androidUa.replace(/^Mozilla\//, ''));
      defineValue(navigator, 'platform', 'Linux armv8l');
      defineValue(navigator, 'vendor', 'Google Inc.');
      defineValue(navigator, 'maxTouchPoints', 5);
      var uaData = {
        brands: [
          { brand: 'Chromium', version: '120' },
          { brand: 'Google Chrome', version: '120' },
          { brand: 'Not_A Brand', version: '99' }
        ],
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: function(){
          return Promise.resolve({ architecture: 'arm', bitness: '64', model: 'Pixel 7', mobile: true, platform: 'Android', platformVersion: '14.0.0', uaFullVersion: '120.0.0.0' });
        },
        toJSON: function(){ return { brands: this.brands, mobile: true, platform: 'Android' }; }
      };
      defineValue(navigator, 'userAgentData', uaData);
    }
  }

  installPlatformEmulation();

  defineMetric(window, 'devicePixelRatio', function(){ return device.dpr; });
  defineMetric(window, 'orientation', function(){ return device.orientation === 'landscape' ? 90 : 0; });
  if (window.screen) {
    defineMetric(window.screen, 'width', function(){ return device.width; });
    defineMetric(window.screen, 'height', function(){ return device.height; });
    defineMetric(window.screen, 'availWidth', function(){ return device.width; });
    defineMetric(window.screen, 'availHeight', function(){ return device.height; });
    if (window.screen.orientation) {
      defineMetric(window.screen.orientation, 'type', function(){ return device.orientation + '-primary'; });
      defineMetric(window.screen.orientation, 'angle', function(){ return device.orientation === 'landscape' ? 90 : 0; });
    }
  }

  function reportNetwork(kind, value) {
    var url = '';
    try { url = typeof value === 'string' ? value : value && value.url ? String(value.url) : String(value || ''); } catch (_) {}
    if (!url) return;
    post('NETWORK_REQUEST', { kind: kind, url: url, platform: platformMode });
  }

  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    try {
      window.fetch = function(input){
        reportNetwork('fetch', input);
        return nativeFetch.apply(this, arguments);
      };
    } catch (_) {}
  }

  if (window.XMLHttpRequest && XMLHttpRequest.prototype && typeof XMLHttpRequest.prototype.open === 'function') {
    var nativeXhrOpen = XMLHttpRequest.prototype.open;
    try {
      XMLHttpRequest.prototype.open = function(method, url){
        reportNetwork('xhr', url);
        return nativeXhrOpen.apply(this, arguments);
      };
    } catch (_) {}
  }

  function applyViewport(next) {
    if (!next) return;
    var previousOrientation = device.orientation || (device.width >= device.height ? 'landscape' : 'portrait');
    var nextWidth = Number(next.width) || device.width;
    var nextHeight = Number(next.height) || device.height;
    var nextOrientation = next.orientation || (nextWidth >= nextHeight ? 'landscape' : 'portrait');
    var orientationChanged = nextOrientation !== previousOrientation;
    device = { width: nextWidth, height: nextHeight, dpr: Number(next.dpr) || 1, orientation: nextOrientation };
    requestAnimationFrame(function(){
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      if (orientationChanged) {
        try { window.dispatchEvent(new Event('orientationchange')); } catch (_) {}
      }
      post('VIEWPORT_APPLIED', { device: device, orientationChanged: orientationChanged });
    });
  }

  function navigationUrl(value) {
    var url = String(value || '').trim();
    return /^(?:https?:|market:|itms:|itms-apps:)/i.test(url) ? url : '';
  }

  function reportCta(type, url, via) {
    var clean = navigationUrl(url);
    if (!clean) return;
    post(type, {
      url: clean,
      via: via || '',
      platform: platformMode,
      userInitiated: Date.now() - lastUserGestureAt <= 1500,
      previewCommand: previewCommandActive
    });
  }

  try {
    window.open = function(url){
      reportCta('CTA_ATTEMPT', url, 'window.open');
      return null;
    };
  } catch (_) {}

  document.addEventListener('click', function(event){
    var target = event && event.target;
    if (!target) return;
    var anchor = null;
    try { anchor = target.closest ? target.closest('a[href]') : null; } catch (_) {}
    if (!anchor) return;
    var href = navigationUrl(anchor.href || anchor.getAttribute('href'));
    if (!href) return;
    event.preventDefault();
    try { event.stopImmediatePropagation(); } catch (_) {}
    reportCta('CTA_ATTEMPT', href, 'anchor');
  }, true);

  if (!window.mraid) {
    var mraidListeners = {};
    window.mraid = {
      open: function(url){ reportCta('CTA_ATTEMPT', url, 'mraid.open'); },
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
    post('FRAME_REJECTION', { message: reason && reason.message ? String(reason.message) : String(reason || 'Unhandled promise rejection') });
  });
  post('BRIDGE_INSTALLED', { device: device, platform: platformMode });

  function shouldMuteAudio() { return globallyMuted || !frameAudible; }
  function rememberContext(context) { if (context && contexts.indexOf(context) < 0) contexts.push(context); return context; }

  function patchAudioContext(name) {
    var Native = window[name];
    if (typeof Native !== 'function' || !Native.prototype) return;
    var nativeResume = typeof Native.prototype.resume === 'function' ? Native.prototype.resume : null;
    var nativeSuspend = typeof Native.prototype.suspend === 'function' ? Native.prototype.suspend : null;
    function WrappedAudioContext() {
      var instance = Reflect.construct(Native, arguments, new.target || WrappedAudioContext);
      rememberContext(instance);
      if (nativeResume) {
        try {
          instance.resume = function(){
            rememberContext(instance);
            if (shouldMuteAudio()) {
              try { if (nativeSuspend && instance.state !== 'suspended') nativeSuspend.call(instance); } catch (_) {}
              return Promise.resolve();
            }
            return nativeResume.apply(instance, arguments);
          };
        } catch (_) {}
      }
      if (shouldMuteAudio() && nativeSuspend) setTimeout(function(){ try { nativeSuspend.call(instance); } catch (_) {} }, 0);
      return instance;
    }
    WrappedAudioContext.prototype = Native.prototype;
    try { Object.setPrototypeOf(WrappedAudioContext, Native); } catch (_) {}
    try { window[name] = WrappedAudioContext; } catch (_) {}
  }

  patchAudioContext('AudioContext');
  patchAudioContext('webkitAudioContext');

  if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
    var nativePlay = HTMLMediaElement.prototype.play;
    if (typeof nativePlay === 'function' && !HTMLMediaElement.prototype.__cgbPreviewPlayPatched) {
      try {
        Object.defineProperty(HTMLMediaElement.prototype, '__cgbPreviewPlayPatched', { value: true, configurable: true });
        HTMLMediaElement.prototype.play = function(){
          if (shouldMuteAudio()) { try { this.muted = true; } catch (_) {} }
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
      } else media.muted = false;
    } catch (_) {}
  }

  function applyMute() {
    var shouldMute = shouldMuteAudio();
    try { document.querySelectorAll('audio,video').forEach(function(media){ applyMediaMute(media, shouldMute); }); } catch (_) {}
    contexts.slice().forEach(function(ctx){
      try {
        if (shouldMute) {
          if (ctx.state !== 'suspended' && typeof ctx.suspend === 'function') Promise.resolve(ctx.suspend()).catch(function(){});
        } else if (ctx.state === 'suspended' && typeof ctx.resume === 'function') Promise.resolve(ctx.resume()).catch(function(){});
      } catch (_) {}
    });
  }

  function updateMuteEnforcer() {
    var shouldMute = shouldMuteAudio();
    if (shouldMute && !muteEnforcer) muteEnforcer = setInterval(applyMute, 200);
    else if (!shouldMute && muteEnforcer) { clearInterval(muteEnforcer); muteEnforcer = 0; }
  }

  function setMutePolicy(muted, audible) {
    globallyMuted = !!muted;
    frameAudible = !!audible;
    applyMute();
    updateMuteEnforcer();
  }

  ['pointerdown','mousedown','touchstart','keydown'].forEach(function(type){
    window.addEventListener(type, function(){
      lastUserGestureAt = Date.now();
      if (shouldMuteAudio()) setTimeout(applyMute, 0);
    }, true);
  });

  function findUrlArgument(args) {
    for (var i = 0; i < args.length; i++) {
      var clean = navigationUrl(args[i]);
      if (clean) return clean;
    }
    return '';
  }

  function patchDownloadObject(target, label) {
    if (!target || typeof target.download !== 'function') return false;
    var current = target.download;
    if (current.__cgbPreviewDownloadWrapped) return true;
    var wrapped = function(){
      var url = findUrlArgument(arguments);
      if (url) reportCta('CTA_CALL', url, label + '.download argument');
      return current.apply(this, arguments);
    };
    try { Object.defineProperty(wrapped, '__cgbPreviewDownloadWrapped', { value: true }); } catch (_) { wrapped.__cgbPreviewDownloadWrapped = true; }
    try { target.download = wrapped; return target.download === wrapped; } catch (_) { return false; }
  }

  function patchCgbDownload() {
    var patched = false;
    patched = patchDownloadObject(window.cgb, 'cgb') || patched;
    if (window.super_html !== window.cgb) patched = patchDownloadObject(window.super_html, 'super_html') || patched;
    return patched;
  }

  function callDownload() {
    patchCgbDownload();
    var cgb = window.cgb || window.super_html;
    if (!cgb || typeof cgb.download !== 'function') return false;
    try {
      previewCommandActive = true;
      cgb.download();
      return true;
    } catch (error) {
      post('FRAME_ERROR', { message: 'CTA download failed: ' + String(error && error.message ? error.message : error) });
      return false;
    } finally {
      setTimeout(function(){ previewCommandActive = false; }, 0);
    }
  }

  cgbPatchTimer = setInterval(function(){
    if (patchCgbDownload()) { clearInterval(cgbPatchTimer); cgbPatchTimer = 0; }
  }, 200);

  window.addEventListener('message', function(event){
    var msg = event.data;
    if (!msg || msg.source !== 'cgb-preview-host') return;
    if (msg.type === 'SET_MUTE') setMutePolicy(msg.muted, msg.audible);
    else if (msg.type === 'SET_VIEWPORT') applyViewport(msg.device);
    else if (msg.type === 'COMMAND' && msg.command === 'download') {
      var ok = callDownload();
      post('COMMAND_RESULT', { command: 'download', ok: ok, platform: platformMode });
    }
  });

  window.addEventListener('load', function(){
    setTimeout(function(){
      patchCgbDownload();
      applyMute();
      updateMuteEnforcer();
      post('READY', { hasCgbBridge: !!(window.cgb || window.super_html), device: device, platform: platformMode });
    }, 0);
  });
  window.${BRIDGE_ID} = { applyMute: applyMute, setMutePolicy: setMutePolicy, callDownload: callDownload, patchCgbDownload: patchCgbDownload, applyViewport: applyViewport, platform: platformMode };
})();
</script>`;
}

export function injectPreviewBridge(html, device, options = {}) {
  const platformMode = typeof options.platform === 'string' ? options.platform : 'host';
  const bridge = buildInjectedBridge(device, platformMode);
  const baseHref = typeof options.baseHref === 'string' ? options.baseHref : '';
  const hasBase = /<base(?:\s[^>]*)?>/i.test(html);
  const safeBaseHref = baseHref
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const base = !hasBase && safeBaseHref ? `<base data-cgb-preview-base href="${safeBaseHref}">` : '';
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