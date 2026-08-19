import { DEVICE_PROFILES } from './devices.js';
import { injectPreviewBridge } from './bridge.js';
import { NETWORK_PRESETS, runNetworkValidation } from './network-validator.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $('#fileInput'), reload: $('#reloadButton'), dropZone: $('#dropZone'), stage: $('#previewStage'),
  compareMode: $('#compareModeButton'), networkMode: $('#networkModeButton'), networkPanel: $('#networkValidationPanel'),
  networkSelect: $('#networkSelect'), networkPresetNote: $('#networkPresetNote'), runNetwork: $('#runNetworkValidationButton'),
  networkSummary: $('#networkSummary'), networkResults: $('#networkResults'),
  device: $('#deviceSelect'), previewDpr: $('#previewDprButton'), deviceDpr: $('#deviceDprButton'),
  hostPlatform: $('#hostPlatformButton'), iosPlatform: $('#iosPlatformButton'), androidPlatform: $('#androidPlatformButton'),
  clearFocus: $('#clearFocusButton'), mute: $('#muteButton'), cta: $('#ctaButton'),
  appStoreField: $('#appStoreField'), appStoreUrl: $('#appStoreUrl'), appStoreMark: $('#appStoreMark'), appStoreActual: $('#appStoreActual'),
  googlePlayField: $('#googlePlayField'), googlePlayUrl: $('#googlePlayUrl'), googlePlayMark: $('#googlePlayMark'), googlePlayActual: $('#googlePlayActual'),
  ctaStatus: $('#ctaStatus'), sourceInfo: $('#sourceInfo'), sourceName: $('#sourceName'), sourceSize: $('#sourceSize'),
  profileInfo: $('#profileInfo'), bridgeStatus: $('#bridgeStatus'), template: $('#deviceTemplate'),
};

function makeCaptureBucket() { return { call: new Set(), attempt: new Set() }; }

const state = {
  sourceHtml: '', fileName: '', fileSize: 0,
  selectedProfileId: 'iphone-13', dprMode: 'preview', platformMode: 'host', mode: 'compare',
  muted: false, audioMasterId: null, focusedId: null,
  sessions: new Map(),
  ctaCaptures: { appStore: makeCaptureBucket(), googlePlay: makeCaptureBucket(), other: makeCaptureBucket() },
  ctaEvents: [], networkEvents: [], ctaTestTimer: 0,
};

for (const profile of DEVICE_PROFILES) {
  const option = document.createElement('option');
  option.value = profile.id;
  const glyph = profile.kind === 'tablet' ? '▰' : profile.kind === 'foldable' ? '◫' : '▯';
  option.textContent = `${glyph} ${profile.name} — ${profile.views.length} views`;
  elements.device.append(option);
}
elements.device.value = state.selectedProfileId;

for (const preset of NETWORK_PRESETS) {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = preset.name;
  elements.networkSelect.append(option);
}

function currentProfile() { return DEVICE_PROFILES.find((profile) => profile.id === state.selectedProfileId) || DEVICE_PROFILES[0]; }
function currentPreset() { return NETWORK_PRESETS.find((preset) => preset.id === elements.networkSelect.value) || NETWORK_PRESETS[0]; }
function slotId(view, index = 0) { return view.slot || view.id || `runtime-${index}`; }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function previewBaseUrl() { try { return new URL('./', window.location.href).href; } catch (_) { return window.location.href; } }
function effectiveView(view) { return { ...view, dpr: state.dprMode === 'device' ? view.dpr : 1 }; }
function postFrame(frame, message) { frame.contentWindow?.postMessage({ source: 'cgb-preview-host', ...message }, '*'); }
function setActive(buttons, active) { buttons.forEach((button) => button.classList.toggle('active', button === active)); }
function platformLabel() { return state.platformMode === 'ios' ? 'iOS emulation' : state.platformMode === 'android' ? 'Android emulation' : 'Host platform'; }

function updatePresetNote() { elements.networkPresetNote.textContent = currentPreset().note; }

function setMode(mode) {
  state.mode = mode;
  setActive([elements.compareMode, elements.networkMode], mode === 'network' ? elements.networkMode : elements.compareMode);
  elements.networkPanel.classList.toggle('hidden', mode !== 'network');
  document.body.classList.toggle('network-mode', mode === 'network');
}

function updateProfileInfo() {
  const profile = currentProfile();
  if (!profile) return;
  const parts = [`${profile.views.length} live view${profile.views.length === 1 ? '' : 's'}`, platformLabel()];
  if (profile.note) parts.push(profile.note);
  elements.profileInfo.textContent = parts.join(' · ');
}

function updateCardMeta(session) {
  const view = session.view;
  session.name.textContent = view.label;
  const actualDpr = state.dprMode === 'device' ? view.dpr : 1;
  session.metrics.textContent = `${view.width}×${view.height} · DPR ${actualDpr}${state.dprMode === 'preview' && view.dpr !== 1 ? ` (device ${view.dpr})` : ''}`;
  session.card.dataset.viewId = view.id;
  session.card.dataset.slotId = session.id;
  session.card.dataset.orientation = view.orientation || '';
  session.frame.dataset.viewId = view.id;
  session.frame.dataset.slotId = session.id;
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

function createSession(view, runtimeSlot) {
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
  const session = { id: runtimeSlot, view, card, shell, frame, status, banner, name, metrics, focusButton, masterButton, ready: false, hasCgbBridge: false, error: null };

  focusButton.addEventListener('click', () => { state.focusedId = state.focusedId === session.id ? null : session.id; updateFocusLayout(); });
  masterButton.addEventListener('click', () => { state.audioMasterId = session.id; updateAudio(); updateBadges(); });
  applyViewport(session);
  session.status.textContent = 'Starting playable…';
  session.frame.addEventListener('load', () => { if (!session.ready && !session.error) session.status.textContent = 'Document loaded · waiting for bridge…'; updateAudio(); });
  session.frame.srcdoc = injectPreviewBridge(state.sourceHtml, effectiveView(view), { baseHref: previewBaseUrl(), platform: state.platformMode });
  return session;
}

function destroySession(session) { try { session.frame.src = 'about:blank'; } catch (_) {} session.card.remove(); }
function destroyAllSessions() {
  for (const session of state.sessions.values()) destroySession(session);
  state.sessions.clear(); state.audioMasterId = null; state.focusedId = null;
  elements.stage.classList.remove('focus-mode'); elements.clearFocus.classList.add('hidden');
}

function syncSessionsToProfile({ restart = false } = {}) {
  if (!state.sourceHtml) return;
  const profile = currentProfile();
  if (!profile) return;
  if (restart) destroyAllSessions();
  const desired = profile.views.map((view, index) => ({ view, slot: slotId(view, index) }));
  const desiredSlots = new Set(desired.map((entry) => entry.slot));

  for (const [runtimeSlot, session] of [...state.sessions]) {
    if (!desiredSlots.has(runtimeSlot)) { destroySession(session); state.sessions.delete(runtimeSlot); }
  }
  for (const entry of desired) {
    let session = state.sessions.get(entry.slot);
    if (!session) { session = createSession(entry.view, entry.slot); state.sessions.set(entry.slot, session); }
    else { session.view = entry.view; applyViewport(session); }
    elements.stage.append(session.card);
  }

  const ids = desired.map((entry) => entry.slot);
  if (!ids.includes(state.audioMasterId)) state.audioMasterId = ids[0] || null;
  if (!ids.includes(state.focusedId)) state.focusedId = null;
  elements.stage.dataset.viewCount = String(profile.views.length);
  elements.stage.dataset.deviceKind = profile.kind;
  updateProfileInfo(); updateBadges(); updateFocusLayout(); updateAudio(); updateGlobalBridgeStatus();
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
function updateBadges() { for (const session of state.sessions.values()) session.masterButton.classList.toggle('active', session.id === state.audioMasterId); }
function updateAudio() {
  for (const session of state.sessions.values()) postFrame(session.frame, { type: 'SET_MUTE', muted: state.muted, audible: session.id === state.audioMasterId });
  elements.mute.innerHTML = `${state.muted ? '🔇' : '🔊'} <span>${state.muted ? 'Muted' : 'Sound'}</span>`;
  elements.mute.classList.toggle('active', state.muted);
}
function updateGlobalBridgeStatus() {
  const sessions = [...state.sessions.values()];
  if (!sessions.length) return;
  const ready = sessions.filter((session) => session.ready).length;
  const bridged = sessions.filter((session) => session.hasCgbBridge).length;
  const errors = sessions.filter((session) => session.error).length;
  if (errors) { elements.bridgeStatus.textContent = `Preview errors: ${errors} · Ready: ${ready}/${sessions.length}`; elements.bridgeStatus.className = 'status warning'; }
  else if (ready === sessions.length) {
    elements.bridgeStatus.textContent = bridged ? `Ready ${ready}/${sessions.length} · CGB bridge ${bridged}/${sessions.length}` : `Ready ${ready}/${sessions.length} · CGB bridge not detected`;
    elements.bridgeStatus.className = `status ${bridged ? 'ok' : 'warning'}`;
  } else { elements.bridgeStatus.textContent = `Starting live views… ${ready}/${sessions.length}`; elements.bridgeStatus.className = 'status neutral'; }
}

function showCtaBanner(session) {
  if (!session) return;
  session.banner.classList.add('visible'); clearTimeout(session.banner.__hideTimer);
  session.banner.__hideTimer = setTimeout(() => session.banner.classList.remove('visible'), 2400);
}
function normalizeUrl(raw) {
  const value = String(raw || '').trim(); if (!value) return '';
  try { const parsed = new URL(value); parsed.hostname = parsed.hostname.toLowerCase(); return parsed.href; } catch (_) { return value; }
}
function classifyStoreUrl(raw) {
  const value = String(raw || '').trim(); if (!value) return 'other';
  try {
    const parsed = new URL(value); const protocol = parsed.protocol.toLowerCase(); const host = parsed.hostname.toLowerCase();
    if (protocol === 'itms-apps:' || protocol === 'itms:' || host === 'apps.apple.com' || host.endsWith('.apps.apple.com') || host === 'itunes.apple.com' || host.endsWith('.itunes.apple.com') || host === 'appsto.re') return 'appStore';
    if (protocol === 'market:' || host === 'play.google.com' || host.endsWith('.play.google.com')) return 'googlePlay';
  } catch (_) {}
  return 'other';
}
function effectiveCapturedUrls(store) { const bucket = state.ctaCaptures[store]; if (!bucket) return []; const preferred = bucket.attempt.size ? bucket.attempt : bucket.call; return [...preferred]; }
function captureCount() { return ['appStore', 'googlePlay', 'other'].reduce((sum, store) => { const bucket = state.ctaCaptures[store]; return sum + bucket.call.size + bucket.attempt.size; }, 0); }

function setFieldValidation(store, field, input, mark, actualLabel) {
  const expectedRaw = input.value.trim(); const captured = effectiveCapturedUrls(store);
  actualLabel.textContent = `Captured: ${captured.length ? captured.length === 1 ? captured[0] : `${captured[0]} (+${captured.length - 1} more)` : '—'}`;
  actualLabel.title = captured.join('\n');
  if (!expectedRaw) { field.dataset.state = 'neutral'; mark.textContent = '—'; return; }
  let expected; try { expected = new URL(expectedRaw); } catch (_) { field.dataset.state = 'invalid'; mark.textContent = '!'; return; }
  if (!captured.length) { field.dataset.state = 'neutral'; mark.textContent = '…'; return; }
  const expectedNormalized = normalizeUrl(expected.href);
  const matches = captured.every((url) => normalizeUrl(url) === expectedNormalized);
  field.dataset.state = matches ? 'match' : 'mismatch'; mark.textContent = matches ? '✓' : '✕';
}
function updateCtaValidation() {
  setFieldValidation('appStore', elements.appStoreField, elements.appStoreUrl, elements.appStoreMark, elements.appStoreActual);
  setFieldValidation('googlePlay', elements.googlePlayField, elements.googlePlayUrl, elements.googlePlayMark, elements.googlePlayActual);
  const appUrls = effectiveCapturedUrls('appStore'), playUrls = effectiveCapturedUrls('googlePlay'), otherUrls = effectiveCapturedUrls('other');
  const total = appUrls.length + playUrls.length + otherUrls.length;
  if (!total) { if (!elements.ctaStatus.classList.contains('testing')) elements.ctaStatus.textContent = 'No CTA captured yet.'; return; }
  elements.ctaStatus.classList.remove('testing');
  elements.ctaStatus.textContent = otherUrls.length ? `Captured ${total} unique CTA URL${total === 1 ? '' : 's'} · ${otherUrls.length} unrecognized.` : `Captured ${total} unique store URL${total === 1 ? '' : 's'}.`;
}
function resetTelemetry() {
  clearTimeout(state.ctaTestTimer);
  state.ctaCaptures = { appStore: makeCaptureBucket(), googlePlay: makeCaptureBucket(), other: makeCaptureBucket() };
  state.ctaEvents = []; state.networkEvents = [];
  elements.ctaStatus.classList.remove('testing'); elements.ctaStatus.textContent = 'No CTA captured yet.'; elements.ctaStatus.title = '';
  updateCtaValidation();
}
function recordCta(message, sourceType, session) {
  const cleanUrl = String(message.url || '').trim(); if (!cleanUrl) return;
  clearTimeout(state.ctaTestTimer);
  const store = classifyStoreUrl(cleanUrl); const bucket = state.ctaCaptures[store] || state.ctaCaptures.other;
  bucket[sourceType === 'call' ? 'call' : 'attempt'].add(cleanUrl);
  state.ctaEvents.push({ type: sourceType, url: cleanUrl, via: message.via || '', platform: message.platform || state.platformMode, userInitiated: Boolean(message.userInitiated), previewCommand: Boolean(message.previewCommand), slot: session.id });
  showCtaBanner(session); updateCtaValidation();
}
function testCtaDownload() {
  clearTimeout(state.ctaTestTimer); const before = captureCount();
  elements.ctaStatus.classList.add('testing'); elements.ctaStatus.textContent = `Calling cgb.download() in ${platformLabel()}…`;
  for (const session of state.sessions.values()) postFrame(session.frame, { type: 'COMMAND', command: 'download' });
  state.ctaTestTimer = setTimeout(() => {
    elements.ctaStatus.classList.remove('testing');
    if (captureCount() === before) elements.ctaStatus.textContent = `No new CTA URL captured in ${platformLabel()}.`; else updateCtaValidation();
  }, 700);
}

function renderNetworkValidation(report) {
  const { preset, checks, score } = report;
  elements.networkSummary.innerHTML = `<strong>${preset.name}</strong> · <span class="result-pass">${score.pass} passed</span> · <span class="result-warn">${score.warn} warnings</span> · <span class="result-fail">${score.fail} failed</span> · <span>${score.manual} manual</span>`;
  elements.networkResults.innerHTML = '';
  for (const check of checks) {
    const row = document.createElement('div');
    row.className = `network-result ${check.status}`;
    const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✕' : check.status === 'warn' ? '!' : '•';
    row.innerHTML = `<div class="network-result-icon">${icon}</div><div><div class="network-result-title">${check.label}<span>${check.group}</span></div><div class="network-result-detail"></div></div>`;
    row.querySelector('.network-result-detail').textContent = check.detail;
    elements.networkResults.append(row);
  }
}
function runValidation() {
  if (!state.sourceHtml) return;
  renderNetworkValidation(runNetworkValidation({
    presetId: elements.networkSelect.value,
    html: state.sourceHtml,
    fileSize: state.fileSize,
    sessions: [...state.sessions.values()],
    ctaEvents: state.ctaEvents,
    networkEvents: state.networkEvents,
  }));
}

function setPlatform(mode, activeButton) {
  if (state.platformMode === mode) return;
  state.platformMode = mode; setActive([elements.hostPlatform, elements.iosPlatform, elements.androidPlatform], activeButton); updateProfileInfo();
  if (!state.sourceHtml) return;
  clearTimeout(state.ctaTestTimer); elements.ctaStatus.classList.remove('testing');
  elements.ctaStatus.textContent = `Restarted runtimes for ${platformLabel()}. Previous CTA captures are preserved.`;
  syncSessionsToProfile({ restart: true });
}

async function loadFile(file) {
  if (!file) return;
  state.sourceHtml = await file.text(); state.fileName = file.name; state.fileSize = file.size;
  elements.dropZone.classList.remove('empty'); elements.sourceInfo.classList.remove('hidden');
  elements.sourceName.textContent = file.name; elements.sourceSize.textContent = formatBytes(file.size);
  elements.bridgeStatus.textContent = 'Bridge: waiting'; elements.bridgeStatus.className = 'status neutral';
  [elements.reload, elements.mute, elements.cta, elements.runNetwork].forEach((button) => button.disabled = false);
  resetTelemetry(); syncSessionsToProfile({ restart: true });
}

elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files?.[0]));
elements.reload.addEventListener('click', () => { resetTelemetry(); syncSessionsToProfile({ restart: true }); });
elements.compareMode.addEventListener('click', () => setMode('compare'));
elements.networkMode.addEventListener('click', () => setMode('network'));
elements.networkSelect.addEventListener('change', () => { updatePresetNote(); if (state.sourceHtml) runValidation(); });
elements.runNetwork.addEventListener('click', runValidation);
elements.device.addEventListener('change', () => { state.selectedProfileId = elements.device.value; syncSessionsToProfile(); });
elements.hostPlatform.addEventListener('click', () => setPlatform('host', elements.hostPlatform));
elements.iosPlatform.addEventListener('click', () => setPlatform('ios', elements.iosPlatform));
elements.androidPlatform.addEventListener('click', () => setPlatform('android', elements.androidPlatform));
elements.previewDpr.addEventListener('click', () => { state.dprMode = 'preview'; setActive([elements.previewDpr, elements.deviceDpr], elements.previewDpr); for (const session of state.sessions.values()) applyViewport(session); updateScales(); });
elements.deviceDpr.addEventListener('click', () => { state.dprMode = 'device'; setActive([elements.previewDpr, elements.deviceDpr], elements.deviceDpr); for (const session of state.sessions.values()) applyViewport(session); updateScales(); });
elements.clearFocus.addEventListener('click', () => { state.focusedId = null; updateFocusLayout(); });
elements.mute.addEventListener('click', () => { state.muted = !state.muted; updateAudio(); });
elements.cta.addEventListener('click', testCtaDownload);
elements.appStoreUrl.addEventListener('input', updateCtaValidation);
elements.googlePlayUrl.addEventListener('input', updateCtaValidation);

for (const eventName of ['dragenter', 'dragover']) elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.remove('dragging'); });
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
    if (!session.ready && !session.error) session.status.textContent = `Preview bridge installed · ${platformLabel()} · starting Cocos…`;
  } else if (message.type === 'READY') {
    session.ready = true; session.hasCgbBridge = Boolean(message.hasCgbBridge); session.status.classList.add('ready'); updateGlobalBridgeStatus(); updateAudio();
  } else if (message.type === 'FRAME_ERROR' || message.type === 'FRAME_REJECTION') {
    session.error = message.message || 'Unknown preview error'; session.status.classList.remove('ready'); session.status.classList.add('error');
    const location = message.line ? ` · line ${message.line}${message.column ? `:${message.column}` : ''}` : '';
    session.status.textContent = `${session.error}${location}`; session.status.title = `${session.error}${message.file ? `\n${message.file}` : ''}${location}`; updateGlobalBridgeStatus();
  } else if (message.type === 'CTA_CALL') recordCta(message, 'call', session);
  else if (message.type === 'CTA_ATTEMPT') recordCta(message, 'attempt', session);
  else if (message.type === 'NETWORK_REQUEST') state.networkEvents.push({ kind: message.kind || 'request', url: message.url || '', platform: message.platform || state.platformMode, slot: session.id });
});

let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(updateScales, 80); });

setMode('compare'); updatePresetNote(); updateProfileInfo(); updateCtaValidation();
