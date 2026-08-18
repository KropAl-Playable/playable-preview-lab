import { DEVICE_PROFILES } from './devices.js';
import { injectPreviewBridge } from './bridge.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $('#fileInput'), reload: $('#reloadButton'), dropZone: $('#dropZone'), stage: $('#previewStage'),
  device: $('#deviceSelect'), previewDpr: $('#previewDprButton'), deviceDpr: $('#deviceDprButton'),
  sync: $('#syncInputToggle'), clearFocus: $('#clearFocusButton'), mute: $('#muteButton'),
  endcard: $('#endcardButton'), cta: $('#ctaButton'), sourceInfo: $('#sourceInfo'),
  sourceName: $('#sourceName'), sourceSize: $('#sourceSize'), profileInfo: $('#profileInfo'),
  bridgeStatus: $('#bridgeStatus'), template: $('#deviceTemplate'),
};

const state = {
  sourceHtml: '', fileName: '', fileSize: 0,
  selectedProfileId: 'iphone-13', dprMode: 'preview',
  muted: false, syncInput: true, audioMasterId: null, driverId: null, focusedId: null,
  sessions: new Map(),
};

for (const profile of DEVICE_PROFILES) {
  const option = document.createElement('option');
  option.value = profile.id;
  const glyph = profile.kind === 'tablet' ? '▰' : profile.kind === 'foldable' ? '◫' : '▯';
  option.textContent = `${glyph} ${profile.name} — ${profile.views.length} views`;
  elements.device.append(option);
}
elements.device.value = state.selectedProfileId;
elements.sync.checked = state.syncInput;

function currentProfile() {
  return DEVICE_PROFILES.find((profile) => profile.id === state.selectedProfileId) || DEVICE_PROFILES[0];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function previewBaseUrl() {
  try { return new URL('./', window.location.href).href; }
  catch (_) { return window.location.href; }
}

function effectiveView(view) {
  return { ...view, dpr: state.dprMode === 'device' ? view.dpr : 1 };
}

function postFrame(frame, message) {
  frame.contentWindow?.postMessage({ source: 'cgb-preview-host', ...message }, '*');
}

function setActive(buttons, active) {
  buttons.forEach((button) => button.classList.toggle('active', button === active));
}

function updateProfileInfo() {
  const profile = currentProfile();
  if (!profile) return;
  const parts = [`${profile.views.length} live view${profile.views.length === 1 ? '' : 's'}`];
  if (profile.note) parts.push(profile.note);
  elements.profileInfo.textContent = parts.join(' · ');
}

function updateCardMeta(session) {
  const view = session.view;
  session.name.textContent = view.label;
  const actualDpr = state.dprMode === 'device' ? view.dpr : 1;
  session.metrics.textContent = `${view.width}×${view.height} · DPR ${actualDpr}${state.dprMode === 'preview' && view.dpr !== 1 ? ` (device ${view.dpr})` : ''}`;
  session.card.dataset.viewId = view.id;
  session.card.dataset.orientation = view.orientation || '';
  session.frame.dataset.viewId = view.id;
}

function applyViewport(session) {
  const view = effectiveView(session.view);
  session.shell.style.setProperty('--frame-w', `${view.width}px`);
  session.shell.style.setProperty('--frame-h', `${view.height}px`);
  session.frame.style.width = `${view.width}px`;
  session.frame.style.height = `${view.height}px`;
  updateCardMeta(session);
  postFrame(session.frame, { type: 'SET_VIEWPORT', device: view });
}

function createSession(view) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector('.device-card');
  const shell = fragment.querySelector('.device-shell');
  const frame = fragment.querySelector('.device-frame');
  const status = fragment.querySelector('.frame-status');
  const banner = fragment.querySelector('.cta-banner');
  const name = fragment.querySelector('.device-name');
  const metrics = fragment.querySelector('.device-metrics');
  const focusButton = fragment.querySelector('.focus-button');
  const masterButton = fragment.querySelector('.audio-master-button');
  const driverBadge = fragment.querySelector('.driver-badge');

  const session = {
    id: view.id, view, card, shell, frame, status, banner, name, metrics,
    focusButton, masterButton, driverBadge,
    ready: false, hasCgbBridge: false, error: null,
  };

  focusButton.addEventListener('click', () => {
    state.focusedId = state.focusedId === session.id ? null : session.id;
    updateFocusLayout();
  });
  masterButton.addEventListener('click', () => {
    state.audioMasterId = session.id;
    updateAudio();
    updateBadges();
  });

  applyViewport(session);
  session.status.textContent = 'Starting playable…';
  session.frame.addEventListener('load', () => {
    if (!session.ready && !session.error) session.status.textContent = 'Document loaded · waiting for bridge…';
    updateAudio();
  });
  const initial = effectiveView(view);
  session.frame.srcdoc = injectPreviewBridge(state.sourceHtml, initial, { baseHref: previewBaseUrl() });
  return session;
}

function destroySession(session) {
  try { session.frame.src = 'about:blank'; } catch (_) {}
  session.card.remove();
}

function destroyAllSessions() {
  for (const session of state.sessions.values()) destroySession(session);
  state.sessions.clear();
  state.audioMasterId = null;
  state.driverId = null;
  state.focusedId = null;
  elements.stage.classList.remove('focus-mode');
  elements.clearFocus.classList.add('hidden');
}

function syncSessionsToProfile({ restart = false } = {}) {
  if (!state.sourceHtml) return;
  const profile = currentProfile();
  if (!profile) return;
  if (restart) destroyAllSessions();

  const desiredIds = new Set(profile.views.map((view) => view.id));
  for (const [id, session] of [...state.sessions]) {
    if (!desiredIds.has(id)) {
      destroySession(session);
      state.sessions.delete(id);
    }
  }

  for (const view of profile.views) {
    let session = state.sessions.get(view.id);
    if (!session) {
      session = createSession(view);
      state.sessions.set(view.id, session);
    } else {
      session.view = view;
      applyViewport(session);
    }
    elements.stage.append(session.card);
  }

  const ids = profile.views.map((view) => view.id);
  if (!ids.includes(state.driverId)) state.driverId = ids[0] || null;
  if (!ids.includes(state.audioMasterId)) state.audioMasterId = ids[0] || null;
  if (!ids.includes(state.focusedId)) state.focusedId = null;

  elements.stage.dataset.viewCount = String(profile.views.length);
  elements.stage.dataset.deviceKind = profile.kind;
  updateProfileInfo();
  updateBadges();
  updateFocusLayout();
  updateAudio();
  updateGlobalBridgeStatus();
}

function compareScale() {
  const profile = currentProfile();
  if (!profile) return 0.4;
  const stageWidth = Math.min(elements.stage.clientWidth || window.innerWidth - 40, 1680);
  const cellWidth = Math.max(180, (stageWidth - 28) / 2);
  let scale = Infinity;
  for (const view of profile.views) scale = Math.min(scale, (cellWidth - 34) / view.width);
  const cap = profile.kind === 'tablet' || profile.kind === 'foldable' ? 0.56 : 0.64;
  return Math.max(0.14, Math.min(cap, scale));
}

function focusedScale(session) {
  const stageWidth = Math.min(elements.stage.clientWidth || window.innerWidth - 40, 1680);
  const availableHeight = Math.max(300, window.innerHeight - 235);
  return Math.max(0.18, Math.min(0.9, (stageWidth - 60) / session.view.width, availableHeight / session.view.height));
}

function updateScales() {
  const common = compareScale();
  for (const session of state.sessions.values()) {
    const scale = state.focusedId === session.id ? focusedScale(session) : common;
    session.shell.style.setProperty('--scale', String(scale));
    session.card.style.setProperty('--visual-width', `${session.view.width * scale + 20}px`);
  }
}

function updateFocusLayout() {
  elements.stage.classList.toggle('focus-mode', Boolean(state.focusedId));
  elements.clearFocus.classList.toggle('hidden', !state.focusedId);
  for (const session of state.sessions.values()) {
    const focused = state.focusedId === session.id;
    session.card.classList.toggle('focused', focused);
    session.focusButton.textContent = focused ? 'Focused' : 'Focus';
  }
  updateScales();
}

function updateBadges() {
  for (const session of state.sessions.values()) {
    session.driverBadge.classList.toggle('visible', session.id === state.driverId);
    session.masterButton.classList.toggle('active', session.id === state.audioMasterId);
  }
}

function updateAudio() {
  for (const session of state.sessions.values()) {
    postFrame(session.frame, {
      type: 'SET_MUTE',
      muted: state.muted,
      audible: session.id === state.audioMasterId,
    });
  }
  elements.mute.innerHTML = `${state.muted ? '🔇' : '🔊'} <span>${state.muted ? 'Muted' : 'Sound'}</span>`;
}

function updateGlobalBridgeStatus() {
  const sessions = [...state.sessions.values()];
  if (!sessions.length) return;
  const ready = sessions.filter((session) => session.ready).length;
  const bridged = sessions.filter((session) => session.hasCgbBridge).length;
  const errors = sessions.filter((session) => session.error).length;
  if (errors) {
    elements.bridgeStatus.textContent = `Preview errors: ${errors} · Ready: ${ready}/${sessions.length}`;
    elements.bridgeStatus.className = 'status warning';
  } else if (ready === sessions.length) {
    elements.bridgeStatus.textContent = bridged
      ? `Ready ${ready}/${sessions.length} · CGB bridge ${bridged}/${sessions.length}`
      : `Ready ${ready}/${sessions.length} · CGB bridge not detected`;
    elements.bridgeStatus.className = `status ${bridged ? 'ok' : 'warning'}`;
  } else {
    elements.bridgeStatus.textContent = `Starting live views… ${ready}/${sessions.length}`;
    elements.bridgeStatus.className = 'status neutral';
  }
}

function showCtaBanners() {
  for (const session of state.sessions.values()) {
    session.banner.classList.add('visible');
    clearTimeout(session.banner.__hideTimer);
    session.banner.__hideTimer = setTimeout(() => session.banner.classList.remove('visible'), 2400);
  }
}

function sendCommand(command) {
  for (const session of state.sessions.values()) postFrame(session.frame, { type: 'COMMAND', command });
  if (command === 'download') showCtaBanners();
}

function setDriver(id) {
  if (!state.sessions.has(id) || state.driverId === id) return;
  state.driverId = id;
  updateBadges();
}

async function loadFile(file) {
  if (!file) return;
  state.sourceHtml = await file.text();
  state.fileName = file.name;
  state.fileSize = file.size;
  elements.dropZone.classList.remove('empty');
  elements.sourceInfo.classList.remove('hidden');
  elements.sourceName.textContent = file.name;
  elements.sourceSize.textContent = formatBytes(file.size);
  elements.bridgeStatus.textContent = 'Bridge: waiting';
  elements.bridgeStatus.className = 'status neutral';
  [elements.reload, elements.mute, elements.endcard, elements.cta].forEach((button) => button.disabled = false);
  syncSessionsToProfile({ restart: true });
}

elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files?.[0]));
elements.reload.addEventListener('click', () => syncSessionsToProfile({ restart: true }));
elements.device.addEventListener('change', () => {
  state.selectedProfileId = elements.device.value;
  syncSessionsToProfile();
});
elements.previewDpr.addEventListener('click', () => {
  state.dprMode = 'preview';
  setActive([elements.previewDpr, elements.deviceDpr], elements.previewDpr);
  for (const session of state.sessions.values()) applyViewport(session);
  updateScales();
});
elements.deviceDpr.addEventListener('click', () => {
  state.dprMode = 'device';
  setActive([elements.previewDpr, elements.deviceDpr], elements.deviceDpr);
  for (const session of state.sessions.values()) applyViewport(session);
  updateScales();
});
elements.sync.addEventListener('change', () => { state.syncInput = elements.sync.checked; });
elements.clearFocus.addEventListener('click', () => { state.focusedId = null; updateFocusLayout(); });
elements.mute.addEventListener('click', () => { state.muted = !state.muted; updateAudio(); });
elements.endcard.addEventListener('click', () => sendCommand('gameEnd'));
elements.cta.addEventListener('click', () => sendCommand('download'));

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
}
elements.dropZone.addEventListener('drop', (event) => {
  const file = [...(event.dataTransfer?.files ?? [])].find((entry) => entry.type === 'text/html' || entry.name.toLowerCase().endsWith('.html'));
  if (file) loadFile(file);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'cgb-preview-frame') return;
  const session = [...state.sessions.values()].find((entry) => entry.frame.contentWindow === event.source);
  if (!session) return;

  if (message.type === 'BRIDGE_INSTALLED') {
    if (!session.ready && !session.error) session.status.textContent = 'Preview bridge installed · starting Cocos…';
  } else if (message.type === 'READY') {
    session.ready = true;
    session.hasCgbBridge = Boolean(message.hasCgbBridge);
    session.status.classList.add('ready');
    updateGlobalBridgeStatus();
    updateAudio();
  } else if (message.type === 'FRAME_ERROR' || message.type === 'FRAME_REJECTION') {
    session.error = message.message || 'Unknown preview error';
    session.status.classList.remove('ready');
    session.status.classList.add('error');
    const location = message.line ? ` · line ${message.line}${message.column ? `:${message.column}` : ''}` : '';
    session.status.textContent = `${session.error}${location}`;
    session.status.title = `${session.error}${message.file ? `\n${message.file}` : ''}${location}`;
    updateGlobalBridgeStatus();
  } else if (message.type === 'INPUT') {
    if (message.eventType === 'pointerdown') setDriver(session.id);
    if (!state.syncInput || session.id !== state.driverId) return;
    for (const target of state.sessions.values()) {
      if (target.id === session.id) continue;
      postFrame(target.frame, { type: 'SYNC_INPUT', ...message });
    }
  } else if (message.type === 'CTA_ATTEMPT') {
    showCtaBanners();
  }
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateScales, 80);
});

updateProfileInfo();
