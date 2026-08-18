import { DEVICES } from './devices.js';
import { injectPreviewBridge } from './bridge.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $('#fileInput'), reload: $('#reloadButton'), dropZone: $('#dropZone'), stage: $('#previewStage'),
  singleMode: $('#singleModeButton'), gridMode: $('#gridModeButton'), device: $('#deviceSelect'),
  portrait: $('#portraitButton'), landscape: $('#landscapeButton'), sync: $('#syncInputToggle'),
  mute: $('#muteButton'), endcard: $('#endcardButton'), cta: $('#ctaButton'),
  sourceInfo: $('#sourceInfo'), sourceName: $('#sourceName'), sourceSize: $('#sourceSize'), bridgeStatus: $('#bridgeStatus'),
  template: $('#deviceTemplate'),
};

const state = {
  sourceHtml: '', fileName: '', fileSize: 0,
  view: 'single', orientation: 'portrait', selectedDeviceId: 'iphone-13',
  muted: false, syncInput: false, audioMasterId: null,
  frames: new Map(), urls: [],
};

for (const device of DEVICES) {
  const option = document.createElement('option');
  option.value = device.id;
  option.textContent = `${device.kind === 'tablet' ? '▰' : '▯'} ${device.name} — ${device.width}×${device.height}`;
  elements.device.append(option);
}
elements.device.value = state.selectedDeviceId;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function oriented(device) {
  if (state.orientation === 'portrait') return { ...device };
  return { ...device, width: device.height, height: device.width };
}

function setActive(buttons, active) {
  buttons.forEach((button) => button.classList.toggle('active', button === active));
}

function clearObjectUrls() {
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls = [];
}

function createPlayableUrl(device) {
  const injected = injectPreviewBridge(state.sourceHtml, device);
  const url = URL.createObjectURL(new Blob([injected], { type: 'text/html' }));
  state.urls.push(url);
  return url;
}

function scaleForGrid(device) {
  if (device.kind === 'tablet') {
    const targetWidth = Math.min(620, Math.max(300, (Math.min(window.innerWidth, 1680) - 90) / 2));
    return Math.min(.56, (targetWidth - 28) / device.width);
  }
  const columns = window.innerWidth > 1100 ? 4 : window.innerWidth > 680 ? 2 : 1;
  const targetWidth = Math.max(210, (Math.min(window.innerWidth, 1680) - 60 - 18 * (columns - 1)) / columns);
  return Math.min(.56, (targetWidth - 24) / device.width);
}

function render() {
  clearObjectUrls();
  state.frames.clear();
  elements.stage.innerHTML = '';
  if (!state.sourceHtml) return;

  const devices = state.view === 'single'
    ? DEVICES.filter((device) => device.id === state.selectedDeviceId)
    : DEVICES;

  elements.stage.className = `preview-stage ${state.view}-view`;
  if (!state.audioMasterId || !devices.some((device) => device.id === state.audioMasterId)) {
    state.audioMasterId = devices[0]?.id ?? null;
  }

  for (const rawDevice of devices) {
    const device = oriented(rawDevice);
    const fragment = elements.template.content.cloneNode(true);
    const card = fragment.querySelector('.device-card');
    const shell = fragment.querySelector('.device-shell');
    const frame = fragment.querySelector('.device-frame');
    const status = fragment.querySelector('.frame-status');
    const banner = fragment.querySelector('.cta-banner');
    const masterButton = fragment.querySelector('.audio-master-button');

    card.dataset.deviceId = rawDevice.id;
    card.dataset.kind = rawDevice.kind;
    fragment.querySelector('.device-name').textContent = rawDevice.name;
    fragment.querySelector('.device-metrics').textContent = `${device.width}×${device.height} · DPR ${rawDevice.dpr}`;

    const scale = state.view === 'single' ? 0.7 : scaleForGrid(device);
    shell.style.setProperty('--frame-w', `${device.width}px`);
    shell.style.setProperty('--frame-h', `${device.height}px`);
    shell.style.setProperty('--scale', String(scale));
    card.style.setProperty('--visual-width', `${device.width * scale + 20}px`);

    frame.dataset.deviceId = rawDevice.id;
    frame.src = createPlayableUrl(device);
    frame.addEventListener('load', () => {
      status.textContent = 'Starting playable…';
      updateFrameAudio();
    });
    masterButton.classList.toggle('active', rawDevice.id === state.audioMasterId);
    masterButton.addEventListener('click', () => {
      state.audioMasterId = rawDevice.id;
      updateFrameAudio();
      document.querySelectorAll('.audio-master-button').forEach((button) => button.classList.remove('active'));
      masterButton.classList.add('active');
    });

    elements.stage.append(fragment);
    state.frames.set(rawDevice.id, { frame, status, banner, device: rawDevice });
  }
  updateFrameAudio();
}

function postFrame(frame, message) {
  frame.contentWindow?.postMessage({ source: 'cgb-preview-host', ...message }, '*');
}

function updateFrameAudio() {
  for (const [id, entry] of state.frames) {
    const audible = state.view === 'single' || id === state.audioMasterId;
    postFrame(entry.frame, { type: 'SET_MUTE', muted: state.muted, audible });
  }
  elements.mute.innerHTML = `${state.muted ? '🔇' : '🔊'} <span>${state.muted ? 'Muted' : 'Sound'}</span>`;
}

function showCtaBanners() {
  for (const entry of state.frames.values()) {
    entry.banner.classList.add('visible');
    clearTimeout(entry.banner.__hideTimer);
    entry.banner.__hideTimer = setTimeout(() => entry.banner.classList.remove('visible'), 2400);
  }
}

function sendCommand(command) {
  for (const entry of state.frames.values()) postFrame(entry.frame, { type: 'COMMAND', command });
  if (command === 'download') showCtaBanners();
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
  render();
}

elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files?.[0]));
elements.reload.addEventListener('click', render);
elements.device.addEventListener('change', () => { state.selectedDeviceId = elements.device.value; render(); });
elements.singleMode.addEventListener('click', () => {
  state.view = 'single'; setActive([elements.singleMode, elements.gridMode], elements.singleMode);
  document.querySelectorAll('.grid-only').forEach((node) => node.classList.add('hidden'));
  document.querySelectorAll('.single-only').forEach((node) => node.classList.remove('hidden'));
  render();
});
elements.gridMode.addEventListener('click', () => {
  state.view = 'grid'; setActive([elements.singleMode, elements.gridMode], elements.gridMode);
  document.querySelectorAll('.grid-only').forEach((node) => node.classList.remove('hidden'));
  document.querySelectorAll('.single-only').forEach((node) => node.classList.add('hidden'));
  render();
});
elements.portrait.addEventListener('click', () => { state.orientation = 'portrait'; setActive([elements.portrait, elements.landscape], elements.portrait); render(); });
elements.landscape.addEventListener('click', () => { state.orientation = 'landscape'; setActive([elements.portrait, elements.landscape], elements.landscape); render(); });
elements.sync.addEventListener('change', () => { state.syncInput = elements.sync.checked; });
elements.mute.addEventListener('click', () => { state.muted = !state.muted; updateFrameAudio(); });
elements.endcard.addEventListener('click', () => sendCommand('gameEnd'));
elements.cta.addEventListener('click', () => sendCommand('download'));

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.add('dragging'); });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.remove('dragging'); });
}
elements.dropZone.addEventListener('drop', (event) => {
  const file = [...(event.dataTransfer?.files ?? [])].find((entry) => entry.type === 'text/html' || entry.name.toLowerCase().endsWith('.html'));
  if (file) loadFile(file);
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.source !== 'cgb-preview-frame') return;
  const sourceEntry = [...state.frames.entries()].find(([, entry]) => entry.frame.contentWindow === event.source);
  if (!sourceEntry) return;
  const [sourceId, entry] = sourceEntry;

  if (message.type === 'READY') {
    entry.status.classList.add('ready');
    const anyBridge = [...state.frames.values()].some((item) => item.status.dataset.hasBridge === 'true') || message.hasCgbBridge;
    entry.status.dataset.hasBridge = String(Boolean(message.hasCgbBridge));
    elements.bridgeStatus.textContent = message.hasCgbBridge ? 'CGB bridge detected' : 'CGB bridge not detected';
    elements.bridgeStatus.className = `status ${message.hasCgbBridge ? 'ok' : 'warning'}`;
    if (anyBridge) elements.bridgeStatus.className = 'status ok';
    updateFrameAudio();
  }
  else if (message.type === 'INPUT' && state.view === 'grid' && state.syncInput) {
    for (const [id, target] of state.frames) {
      if (id === sourceId) continue;
      postFrame(target.frame, { type: 'SYNC_INPUT', ...message });
    }
  }
  else if (message.type === 'CTA_ATTEMPT') {
    showCtaBanners();
  }
});

window.addEventListener('resize', () => {
  if (state.view === 'grid' && state.sourceHtml) render();
});
