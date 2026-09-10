const TESTERS = [
  { id: 'off', label: 'Off' },
  { id: 'applovin', label: 'AppLovin' },
  { id: 'unity', label: 'Unity' },
  { id: 'liftoff', label: 'Liftoff' },
];

const state = {
  tester: 'off',
  showBounds: false,
};

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
      <button id="testerBoundsButton" type="button" class="button tester-bounds-button" aria-pressed="false" title="Show simulated tester-owned UI and unsafe interaction bounds">Bounds</button>
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
    <div class="tester-bound tester-bound-top"><span>Container UI</span></div>
    <div class="tester-bound tester-bound-close"><span>Close zone</span></div>
    <div class="tester-bound tester-bound-bottom"><span>Host / CTA zone</span></div>
    <div class="tester-sim-label">Tester UI simulation</div>
  `;
  screenWrap.append(overlay);
}

function applyToScreen(screenWrap) {
  createOverlay(screenWrap);
  const overlay = screenWrap.querySelector(':scope > .tester-overlay');
  overlay.dataset.tester = state.tester;
  overlay.classList.toggle('show-bounds', state.showBounds && state.tester !== 'off');
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

buildControls();
observePreviews();
applyAll();
