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
  frames: new Map(),
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

function oriented(device, orientation) {
  if (orientation === 'portrait') return { ...device };
  return { ...device, width: device.height, height: device.width };
}

function frameKey(deviceId, orientation) {
  return `${deviceId}:${orientation}`;
}

function setActive(buttons, active) {
  buttons.forEach((button) => button.classList.toggle('active', button === active));
}

function previewBaseUrl() {
  try { return new URL('./', window.location.href).href; }
  catch (_) { return window.location.href; }
}

function createPlayableDocument(device) {
  return injectPreviewBridge(state.sourceHtml, device, { baseHref: previewBaseUrl() });
}

function scaleForGridPair(device) {
  const stageWidth = Math.min(Math.max(window.innerWidth - 40, 560), 1680);
  const columnWidth = (stageWidth - 28) / 2;
  const logicalMaxWidth = Math.max(device.width, device.height);
  const cap = device.kind === 'tablet' ? 0.48 : 0.56;
  return Math.max(0.18, Math.min(cap, (columnWidth - 34) / logicalMaxWidth));
}

function ensureAudioMaster(validKeys) {
  if (!validKeys.length) {
    state.audioMasterId = null;
    return;
  }
  if (!state.audioMasterId || !validKeys.includes(state.audioMasterId)) {
    state.audioMasterId = validKeys[0];
  }
}

function createDeviceCard(rawDevice, orientation, scale) {
  const device = oriented(rawDevice, orientation);
  const key = frameKey(rawDevice.id, orientation);
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector('.device-card');
  const shell = fragment.querySelector('.device-shell');
  const frame = fragment.querySelector('.device-frame');
  const status = fragment.querySelector('.frame-status');
  const banner = fragment.querySelector('.cta-banner');
  const masterButton = fragment.querySelector('.audio-master-button');

  card.dataset.deviceId = rawDevice.id;
  card.dataset.kind = rawDevice.kind;
  card.dataset.orientation = orientation;
  card.dataset.frameKey = key;
  fragment.querySelector('.device-name').textContent = rawDevice.name;
  fragment.querySelector('.device-metrics').textContent = `${device.width}×${device.height} · DPR ${rawDevice.dpr}`;

  shell.style.setProperty('--frame-w', `${device.width}px`);
  shell.style.setProperty('--frame-h', `${device.height}px`);
  shell.style.setProperty('--scale', String(scale));
  card.style.setProperty('--visual-width', `${device.width * scale + 20}px`);

  frame.dataset.frameKey = key;
  frame.srcdoc = createPlayableDocument(device);
  frame.addEventListener('load', () => {
    const entry = state.frames.get(key);
    if (entry && !entry.ready && !entry.error) status.textContent = 'Document loaded · waiting for bridge…';
    updateFrameAudio();
  });

  masterButton.classList.toggle('active', key === state.audioMasterId);
  masterButton.addEventListener('click', () => {
    state.audioMasterId = key;
    document.querySelectorAll('.audio-master-button').forEach((button) => button.classList.remove('active'));
    masterButton.classList.add('active');
    updateFrameAudio();
  });

  state.frames.set(key, {
    key, frame, status, banner, device: rawDevice, orientation,
    ready: false, hasCgbBridge: false, error: null,
  });
  return card;
}

function renderSingle() {
  const rawDevice = DEVICES.find((device) => device.id === state.selectedDeviceId) || DEVICES[0];
  if (!rawDevice) return;
  const key = frameKey(rawDevice.id, state.orientation);
  ensureAudioMaster([key]);
  elements.stage.append(createDeviceCard(rawDevice, state.orientation, 0.7));
}

function renderGrid() {
  const keys = DEVICES.flatMap((device) => [frameKey(device.id, 'portrait'), frameKey(device.id, 'landscape')]);
  ensureAudioMaster(keys);

  const headings = document.createElement('div');
  headings.className = 'grid-orientation-headings';
  headings.innerHTML = '<div>Portrait</div><div>Landscape</div>';
  elements.stage.append(headings);

  for (const rawDevice of DEVICES) {
    const scale = scaleForGridPair(rawDevice);
    const row = document.createElement('section');
    row.className = 'grid-pair-row';
    row.dataset.kind = rawDevice.kind;
    row.dataset.deviceId = rawDevice.id;

    const portraitCell = document.createElement('div');
    portraitCell.className = 'orientation-cell portrait-cell';
    portraitCell.append(createDeviceCard(rawDevice, 'portrait', scale));

    const landscapeCell = document.createElement('div');
    landscapeCell.className = 'orientation-cell landscape-cell';
    landscapeCell.append(createDeviceCard(rawDevice, 'landscape', scale));

    row.append(portraitCell, landscapeCell);
    elements.stage.append(row);
  }
}

function render() {
  state.frames.clear();
  elements.stage.innerHTML = '';
  if (!state.sourceHtml) return;

  elements.stage.className = `preview-stage ${state.view}-view`;
  if (state.view === 'single') renderSingle();
  else renderGrid();
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

function updateGlobalBridgeStatus() {
  const entries = [...state.frames.values()];
  if (!entries.length) return;
  const ready = entries.filter((entry) => entry.ready).length;
  const bridged = entries.filter((entry) => entry.hasCgbBridge).length;
  const errors = entries.filter((entry) => entry.error).length;

  if (errors) {
    elements.bridgeStatus.textContent = `Preview errors: ${errors} · Ready: ${ready}/${entries.length}`;
    elements.bridgeStatus.className = 'status warning';
  } else if (ready === entries.length) {
    elements.bridgeStatus.textContent = bridged
      ? `Ready ${ready}/${entries.length} · CGB bridge ${bridged}/${entries.length}`
      : `Ready ${ready}/${entries.length} · CGB bridge not detected`;
    elements.bridgeStatus.className = `status ${bridged ? 'ok' : 'warning'}`;
  } else {
    elements.bridgeStatus.textContent = `Starting previews… ${ready}/${entries.length}`;
    elements.bridgeStatus.className = 'status neutral';
  }
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
  state.view = 'single';
  setActive([elements.singleMode, elements.gridMode], elements.singleMode);
  document.querySelectorAll('.grid-only').forEach((node) => node.classList.add('hidden'));
  document.querySelectorAll('.single-only').forEach((node) => node.classList.remove('hidden'));
  render();
});
elements.gridMode.addEventListener('click', () => {
  state.view = 'grid';
  setActive([elements.singleMode, elements.gridMode], elements.gridMode);
  document.querySelectorAll('.grid-only').forEach((node) => node.classList.remove('hidden'));
  document.querySelectorAll('.single-only').forEach((node) => node.classList.add('hidden'));
  render();
});
elements.portrait.addEventListener('click', () => {
  state.orientation = 'portrait';
  setActive([elements.portrait, elements.landscape], elements.portrait);
  render();
});
elements.landscape.addEventListener('click', () => {
  state.orientation = 'landscape';
  setActive([elements.portrait, elements.landscape], elements.landscape);
  render();
});
elements.sync.addEventListener('change', () => { state.syncInput = elements.sync.checked; });
elements.mute.addEventListener('click', () => { state.muted = !state.muted; updateFrameAudio(); });
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
  const sourceEntry = [...state.frames.entries()].find(([, entry]) => entry.frame.contentWindow === event.source);
  if (!sourceEntry) return;
  const [sourceId, entry] = sourceEntry;

  if (message.type === 'BRIDGE_INSTALLED') {
    if (!entry.ready && !entry.error) entry.status.textContent = 'Preview bridge installed · starting Cocos…';
  } else if (message.type === 'READY') {
    entry.ready = true;
    entry.hasCgbBridge = Boolean(message.hasCgbBridge);
    entry.status.classList.add('ready');
    updateGlobalBridgeStatus();
    updateFrameAudio();
  } else if (message.type === 'FRAME_ERROR' || message.type === 'FRAME_REJECTION') {
    entry.error = message.message || 'Unknown preview error';
    entry.status.classList.remove('ready');
    entry.status.classList.add('error');
    const location = message.line ? ` · line ${message.line}${message.column ? `:${message.column}` : ''}` : '';
    entry.status.textContent = `${entry.error}${location}`;
    entry.status.title = `${entry.error}${message.file ? `\n${message.file}` : ''}${location}`;
    updateGlobalBridgeStatus();
  } else if (message.type === 'INPUT' && state.view === 'grid' && state.syncInput) {
    for (const [id, target] of state.frames) {
      if (id === sourceId) continue;
      postFrame(target.frame, { type: 'SYNC_INPUT', ...message });
    }
  } else if (message.type === 'CTA_ATTEMPT') {
    showCtaBanners();
  }
});

window.addEventListener('resize', () => {
  if (state.view === 'grid' && state.sourceHtml) render();
});
