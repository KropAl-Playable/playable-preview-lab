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
      if (/\/mraid\.js(?:[?#].*)?$/i.test(String(resourceUrl))) return;
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

  function trackAudioContext(name) {
    var Native = window[name];
    if (typeof Native !== 'function') return;
    function WrappedAudioContext() {
      var instance = Reflect.construct(Native, arguments, new.target || WrappedAudioContext);
      contexts.push(instance);
      if (globallyMuted || !frameAudible) Promise.resolve(instance.suspend && instance.suspend()).catch(function(){});
      return instance;
    }
    WrappedAudioContext.prototype = Native.prototype;
    try { Object.setPrototypeOf(WrappedAudioContext, Native); } catch (_) {}
    try { window[name] = WrappedAudioContext; } catch (_) {}
  }

  trackAudioContext('AudioContext');
  trackAudioContext('webkitAudioContext');

  function applyMute() {
    var shouldMute = globallyMuted || !frameAudible;
    document.querySelectorAll('audio,video').forEach(function(media){ media.muted = shouldMute; });
    contexts.forEach(function(ctx){
      try {
        if (shouldMute && ctx.state !== 'suspended') Promise.resolve(ctx.suspend()).catch(function(){});
        else if (!shouldMute && ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(function(){});
      } catch (_) {}
    });
  }

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

  function synthesizeInput(message) {
    var x = Math.max(0, Math.min(window.innerWidth - 1, message.x * window.innerWidth));
    var y = Math.max(0, Math.min(window.innerHeight - 1, message.y * window.innerHeight));
    var target = document.elementFromPoint(x, y) || document.querySelector('canvas') || document.body;
    var init = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      pointerId: message.pointerId || 1, pointerType: message.pointerType || 'mouse',
      button: message.button || 0, buttons: message.buttons || (message.eventType === 'pointerup' ? 0 : 1),
      pressure: message.eventType === 'pointerup' ? 0 : .5,
      isPrimary: true
    };
    var event;
    try { event = new PointerEvent(message.eventType, init); }
    catch (_) { event = new MouseEvent(message.eventType.replace('pointer','mouse'), init); }
    try { Object.defineProperty(event, '__cgbPreviewSynthetic', { value: true }); } catch (_) {}
    target.dispatchEvent(event);
  }

  window.addEventListener('message', function(event){
    var msg = event.data;
    if (!msg || msg.source !== 'cgb-preview-host') return;
    if (msg.type === 'SET_MUTE') { globallyMuted = !!msg.muted; frameAudible = !!msg.audible; applyMute(); }
    else if (msg.type === 'SET_VIEWPORT') applyViewport(msg.device);
    else if (msg.type === 'COMMAND') {
      var ok = callBridge(msg.command);
      post('COMMAND_RESULT', { command: msg.command, ok: ok });
    }
    else if (msg.type === 'SYNC_INPUT') synthesizeInput(msg);
  });

  ['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(type){
    window.addEventListener(type, function(event){
      if (event.__cgbPreviewSynthetic) return;
      if (!window.innerWidth || !window.innerHeight) return;
      post('INPUT', {
        eventType: type,
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight,
        pointerId: event.pointerId || 1,
        pointerType: event.pointerType || 'mouse',
        button: event.button || 0,
        buttons: event.buttons || 0
      });
    }, true);
  });

  window.addEventListener('load', function(){
    setTimeout(function(){
      applyMute();
      post('READY', { hasCgbBridge: !!(window.cgb || window.super_html), device: device });
    }, 0);
  });
  window.${BRIDGE_ID} = { applyMute: applyMute, callBridge: callBridge, applyViewport: applyViewport };
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
