const TESTERS = [
  { id: 'off', label: 'Off' },
  { id: 'applovin', label: 'AppLovin' },
  { id: 'unity', label: 'Unity' },
  { id: 'liftoff', label: 'Liftoff' },
];

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

// These are QA-safe zones rather than a promise that every SDK version renders
// exactly the same chrome. Liftoff's corner values follow its published guidance;
// AppLovin/Unity reserve conservative host-UI strips around their SDK-owned chrome.
const NETWORK_SAFE_AREAS = {
  off: {
    portrait: ZERO_INSETS,
    landscape: ZERO_INSETS,
  },
  applovin: {
    portrait: { top: 54, right: 0, bottom: 36, left: 0 },
    landscape: { top: 50, right: 0, bottom: 28, left: 0 },
  },
  unity: {
    portrait: { top: 54, right: 0, bottom: 36, left: 0 },
    landscape: { top: 50, right: 0, bottom: 28, left: 0 },
  },
  liftoff: {
    portrait: { top: 50, right: 0, bottom: 25, left: 0 },
    landscape: { top: 50, right: 0, bottom: 25, left: 0 },
  },
};

const state = {
  tester: 'off',
  showBounds: false,
};

const frameSafeState = new WeakMap();
const frameNudgeState = new WeakMap();

function buildControls() {
  const controls = document.querySelector('.controls');
  if (!controls || document.querySelector('#testerOverlayControls')) return;

  const group = document.createElement('div');
  group.id = 'testerOverlayControls';
  group.className = 'control-group tester-control-group';
  group.innerHTML = `
    <span class="control-label">Tester overlay</span>
    <div class="tester-control-row">
      <div class="segmented tester-segmented" role="group" aria-label="Tester overlay">
        ${TESTERS.map((tester) => `<button type="button" data-tester-mode="${tester.id}"${tester.id === 'off' ? ' class="active"' : ''}>${tester.label}</button>`).join('')}
      </div>
      <button id="testerBoundsButton" type="button" class="button tester-bounds-button" aria-pressed="false" title="Show SDK-owned UI, exclusion zones and the SafeArea passed to the playable">Bounds</button>
    </div>
  `;

  const spacer = controls.querySelector('.spacer');
  controls.insertBefore(group, spacer || null);

  group.querySelectorAll('[data-tester-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.tester = button.dataset.testerMode || 'off';
      group.querySelectorAll('[data-tester-mode]').forEach((entry) => entry.classList.toggle('active', entry === button));
      applyAll();
    });
  });

  const boundsButton = group.querySelector('#testerBoundsButton');
  boundsButton.addEventListener('click', () => {
    state.showBounds = !state.showBounds;
    boundsButton.classList.toggle('active', state.showBounds);
    boundsButton.setAttribute('aria-pressed', String(state.showBounds));
    applyAll();
  });
}

function createOverlay(screenWrap) {
  if (screenWrap.querySelector(':scope > .tester-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'tester-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="tester-brand"></div>
    <div class="tester-privacy">i</div>
    <div class="tester-countdown"></div>
    <div class="tester-close">×</div>
    <div class="tester-persistent-cta">Install</div>
    <div class="tester-safe-rect"><span>SafeArea → HTML</span></div>
    <div class="tester-bound tester-bound-top"><span>Host UI</span></div>
    <div class="tester-bound tester-bound-close"><span>Close</span></div>
    <div class="tester-bound tester-bound-bottom"><span>Host UI</span></div>
    <div class="tester-bound tester-bound-top-left"><span>50×50</span></div>
    <div class="tester-bound tester-bound-bottom-left"></div>
    <div class="tester-bound tester-bound-bottom-right"></div>
    <div class="tester-sim-label">Tester UI simulation</div>
  `;
  screenWrap.append(overlay);
}

function orientationFor(screenWrap) {
  const shell = screenWrap.closest('.device-shell');
  return shell?.dataset.orientation === 'landscape' ? 'landscape' : 'portrait';
}

function deviceSafeArea(screenWrap, orientation) {
  const shell = screenWrap.closest('.device-shell');
  const cutout = shell?.dataset.cutout || 'none';

  if (cutout === 'notch') {
    return orientation === 'landscape'
      ? { top: 0, right: 47, bottom: 21, left: 47 }
      : { top: 47, right: 0, bottom: 34, left: 0 };
  }

  if (cutout === 'dynamic-island') {
    return orientation === 'landscape'
      ? { top: 0, right: 59, bottom: 21, left: 59 }
      : { top: 59, right: 0, bottom: 34, left: 0 };
  }

  return ZERO_INSETS;
}

function networkSafeArea(tester, orientation) {
  return NETWORK_SAFE_AREAS[tester]?.[orientation] || ZERO_INSETS;
}

function mergeInsets(...values) {
  return values.reduce((result, value) => ({
    top: Math.max(result.top, Number(value?.top) || 0),
    right: Math.max(result.right, Number(value?.right) || 0),
    bottom: Math.max(result.bottom, Number(value?.bottom) || 0),
    left: Math.max(result.left, Number(value?.left) || 0),
  }), { ...ZERO_INSETS });
}

function rewriteSafeAreaFunctions(value) {
  if (!value || !/safe-area-inset-/i.test(value)) return value;
  return value.replace(/\b(?:env|constant)\(\s*safe-area-inset-(top|right|bottom|left)(?:\s*,[^)]*)?\)/gi, (_match, side) => `var(--safe-area-inset-${String(side).toLowerCase()}, 0px)`);
}

function patchGenericSafeAreaCss(doc) {
  try {
    doc.querySelectorAll('style').forEach((style) => {
      const before = style.textContent || '';
      const after = rewriteSafeAreaFunctions(before);
      if (after !== before) style.textContent = after;
    });

    doc.querySelectorAll('[style]').forEach((element) => {
      const before = element.getAttribute('style') || '';
      if (!/safe-area-inset-/i.test(before)) return;
      const after = rewriteSafeAreaFunctions(before);
      if (after !== before) element.setAttribute('style', after);
    });
  } catch (_) {}
}

function installPreviewSafeAreaApi(win, safeArea) {
  const mraid = win?.mraid;
  if (!mraid) return;

  const getter = () => ({ ...safeArea });
  try { Object.defineProperty(getter, '__cgbPreviewSafeAreaGetter', { value: true }); } catch (_) {}

  try {
    const current = mraid.getSafeAreaInsets;
    if (typeof current !== 'function' || current.__cgbPreviewSafeAreaGetter) {
      mraid.getSafeAreaInsets = getter;
    }
  } catch (_) {}
}

function nudgeFrameViewport(frame) {
  if (!frame) return;

  const active = frameNudgeState.get(frame);
  if (active) {
    try { cancelAnimationFrame(active.raf); } catch (_) {}
    frame.style.width = active.originalWidth;
    frameNudgeState.delete(frame);
  }

  const originalWidth = frame.style.width;
  const width = Number.parseFloat(originalWidth);
  if (!Number.isFinite(width) || width <= 2) return;

  frame.style.width = `${width - 1}px`;
  const raf = requestAnimationFrame(() => {
    frame.style.width = originalWidth;
    frameNudgeState.delete(frame);
  });
  frameNudgeState.set(frame, { originalWidth, raf });
}

function refreshRuntimeSafeArea(frame, win, doc) {
  try {
    win.dispatchEvent(new win.CustomEvent('cgbpreviewsafeareachange', {
      detail: win.__CGB_PREVIEW_SAFE_AREA__,
    }));
  } catch (_) {}

  // Generic HTML integrations often update their layout directly from resize.
  try { win.dispatchEvent(new win.Event('resize')); } catch (_) {}

  // Cocos Creator 3.8.x reads --safe-* through its screen adapter, but its
  // SafeArea component refreshes from the engine's internal window-resize event.
  // Force one real viewport-size transition whenever SafeArea is applied,
  // including the first loaded document and an explicit Off (all zeroes).
  if (doc.getElementById('GameDiv')) nudgeFrameViewport(frame);
}

function applySafeAreaToFrame(frame, safeArea, tester) {
  if (!frame) return;

  let doc;
  let win;
  try {
    doc = frame.contentDocument;
    win = frame.contentWindow;
  } catch (_) {
    return;
  }
  if (!doc?.documentElement || !win) return;

  const signature = `${tester}:${safeArea.top}:${safeArea.right}:${safeArea.bottom}:${safeArea.left}`;
  const previous = frameSafeState.get(frame);
  if (previous?.doc === doc && previous.signature === signature) {
    installPreviewSafeAreaApi(win, safeArea);
    // Re-apply the runtime refresh even when the values did not change. This is
    // required for initial Off: the HTML document may have initialized Cocos
    // before our post-load zero SafeArea was observed by cc.SafeArea.
    refreshRuntimeSafeArea(frame, win, doc);
    return;
  }

  const root = doc.documentElement;
  const cssValues = {
    '--safe-top': safeArea.top,
    '--safe-right': safeArea.right,
    '--safe-bottom': safeArea.bottom,
    '--safe-left': safeArea.left,
    '--safe-area-inset-top': safeArea.top,
    '--safe-area-inset-right': safeArea.right,
    '--safe-area-inset-bottom': safeArea.bottom,
    '--safe-area-inset-left': safeArea.left,
    '--cgb-preview-safe-top': safeArea.top,
    '--cgb-preview-safe-right': safeArea.right,
    '--cgb-preview-safe-bottom': safeArea.bottom,
    '--cgb-preview-safe-left': safeArea.left,
  };

  Object.entries(cssValues).forEach(([name, value]) => root.style.setProperty(name, `${Math.max(0, Number(value) || 0)}px`));
  root.dataset.cgbPreviewTester = tester;

  patchGenericSafeAreaCss(doc);
  installPreviewSafeAreaApi(win, safeArea);

  const snapshot = Object.freeze({ ...safeArea, tester });
  try {
    Object.defineProperty(win, '__CGB_PREVIEW_SAFE_AREA__', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: snapshot,
    });
  } catch (_) {
    try { win.__CGB_PREVIEW_SAFE_AREA__ = snapshot; } catch (_) {}
  }

  frameSafeState.set(frame, { doc, signature });
  refreshRuntimeSafeArea(frame, win, doc);
}

function applyToScreen(screenWrap) {
  createOverlay(screenWrap);
  const overlay = screenWrap.querySelector(':scope > .tester-overlay');
  const frame = screenWrap.querySelector(':scope > .device-frame');
  const orientation = orientationFor(screenWrap);
  const testerEnabled = state.tester !== 'off';
  const safeArea = testerEnabled
    ? mergeInsets(
      deviceSafeArea(screenWrap, orientation),
      networkSafeArea(state.tester, orientation),
    )
    : ZERO_INSETS;

  overlay.dataset.tester = state.tester;
  overlay.dataset.orientation = orientation;
  overlay.classList.toggle('show-bounds', state.showBounds && testerEnabled);
  overlay.style.setProperty('--tester-safe-top', `${safeArea.top}px`);
  overlay.style.setProperty('--tester-safe-right', `${safeArea.right}px`);
  overlay.style.setProperty('--tester-safe-bottom', `${safeArea.bottom}px`);
  overlay.style.setProperty('--tester-safe-left', `${safeArea.left}px`);

  if (frame && !frame.dataset.testerSafeAreaLoadHook) {
    frame.dataset.testerSafeAreaLoadHook = '1';
    frame.addEventListener('load', () => setTimeout(() => applyToScreen(screenWrap), 0));
  }

  // Tester SafeArea is live: switching networks updates it in-place, and Off
  // explicitly restores all injected insets to zero without reloading the iframe.
  applySafeAreaToFrame(frame, safeArea, state.tester);
}

function applyAll() {
  document.querySelectorAll('.device-screen-wrap').forEach(applyToScreen);
}

function observePreviews() {
  const stage = document.querySelector('#previewStage');
  if (!stage) return;
  const observer = new MutationObserver(() => applyAll());
  observer.observe(stage, { childList: true, subtree: true });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'cgb-preview-frame') return;
  if (message.type !== 'BRIDGE_INSTALLED' && message.type !== 'READY' && message.type !== 'VIEWPORT_APPLIED') return;

  document.querySelectorAll('.device-frame').forEach((frame) => {
    if (frame.contentWindow !== event.source) return;
    const screenWrap = frame.closest('.device-screen-wrap');
    if (screenWrap) applyToScreen(screenWrap);
  });
});

buildControls();
observePreviews();
applyAll();
