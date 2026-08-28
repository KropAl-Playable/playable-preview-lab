export const NETWORK_PRESETS = [
  { id: 'generic', name: 'Generic Preflight', note: 'Engine/runtime sanity checks without a network-specific submission contract.' },
  { id: 'applovin', name: 'AppLovin', note: 'Partial public-doc preflight: HTML/MRAID runtime checks. Not a replacement for AppLovin moderation.' },
  { id: 'unity', name: 'Unity Ads', note: 'Published playable requirements: single inline HTML, under 5 MB, MRAID 3.0, both orientations, no required network requests, user-initiated store CTA through mraid.open().' },
  { id: 'google-app', name: 'Google App Campaigns', note: 'Published HTML5/Playable upload checks. ZIP-only constraints are reported separately because Preview Lab currently loads a single HTML file.' },
];

function result(id, label, status, detail, group = 'Static') { return { id, label, status, detail, group }; }

function extractAssetReferences(html) {
  const references = [];
  const attr = /<(?:script|img|audio|video|source|link|iframe)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attr.exec(html))) references.push(match[1]);
  const cssUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((match = cssUrl.exec(html))) references.push(match[1]);
  return [...new Set(references.map((value) => String(value).trim()).filter(Boolean))];
}

function isEmbeddedReference(value) { return /^(?:data:|blob:|about:|javascript:|#)/i.test(value); }
function isAbsoluteNetworkReference(value) { return /^(?:https?:)?\/\//i.test(value); }

function runtimeExternalEvents(events) {
  return (events || []).filter((event) => {
    const raw = String(event.url || '').trim();
    if (!raw || isEmbeddedReference(raw)) return false;
    try {
      const url = new URL(raw, window.location.href);
      if (!/^https?:$/.test(url.protocol)) return false;
      return url.origin !== window.location.origin;
    } catch (_) {
      return false;
    }
  });
}

function allowedGoogleExternal(value) {
  try {
    const url = new URL(value, window.location.href);
    const host = url.hostname.toLowerCase();
    return host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com' || host === 'ajax.googleapis.com' || host.endsWith('.gstatic.com');
  } catch (_) { return false; }
}

function hasOrientationMeta(html) {
  const orientation = html.match(/<meta\b[^>]*name\s*=\s*["']ad\.orientation["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']ad\.orientation["'][^>]*>/i);
  if (orientation) return { kind: 'orientation', value: orientation[1].toLowerCase() };
  const size = html.match(/<meta\b[^>]*name\s*=\s*["']ad\.size["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']ad\.size["'][^>]*>/i);
  return size ? { kind: 'size', value: size[1].toLowerCase() } : null;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function commonChecks(context) {
  const html = context.html || '';
  const sessions = context.sessions || [];
  const errors = sessions.filter((session) => session.error);
  return [
    result('doctype', 'DOCTYPE', /<!doctype\s+html/i.test(html) ? 'pass' : 'warn', /<!doctype\s+html/i.test(html) ? '<!DOCTYPE html> detected.' : 'No HTML doctype detected.'),
    result('html-tag', '<html> tag', /<html\b/i.test(html) ? 'pass' : 'fail', /<html\b/i.test(html) ? 'Present.' : 'Missing <html> tag.'),
    result('body-tag', '<body> tag', /<body\b/i.test(html) ? 'pass' : 'fail', /<body\b/i.test(html) ? 'Present.' : 'Missing <body> tag.'),
    result('runtime-errors', 'Runtime errors', errors.length ? 'fail' : sessions.length ? 'pass' : 'warn', errors.length ? `${errors.length} preview runtime(s) reported an error.` : sessions.length ? `No errors reported by ${sessions.length} active runtime(s).` : 'Load the playable to collect runtime errors.', 'Runtime'),
  ];
}

function unityChecks(context) {
  const html = context.html || '';
  const refs = extractAssetReferences(html).filter((value) => !isEmbeddedReference(value));
  const ctaEvents = context.ctaEvents || [];
  const networkEvents = runtimeExternalEvents(context.networkEvents);
  const finalCtas = ctaEvents.filter((event) => event.type === 'attempt');
  const realFinalCtas = finalCtas.filter((event) => !event.previewCommand);
  const nonMraid = realFinalCtas.filter((event) => event.via !== 'mraid.open');
  const autoRedirect = realFinalCtas.filter((event) => !event.userInitiated);
  const orientation = hasOrientationMeta(html);
  const hasMraidUsage = /\bmraid\s*\./i.test(html) || /mraid\.js/i.test(html);

  return [
    result('unity-size', 'File size < 5 MB', context.fileSize < 5_000_000 ? 'pass' : 'fail', `${formatBytes(context.fileSize)} loaded. Unity requires a single inline playable under 5 MB.`),
    result('unity-inline', 'Single inline HTML', refs.length ? 'fail' : 'pass', refs.length ? `${refs.length} non-inline asset reference(s) found. First: ${refs[0]}` : 'No non-inline asset references found.'),
    result('unity-mraid', 'MRAID usage', hasMraidUsage ? 'pass' : 'warn', hasMraidUsage ? 'MRAID usage detected in the creative.' : 'No static mraid.* usage detected. Obfuscation may hide it; validate CTA at runtime.'),
    result('unity-orientation', 'Portrait + landscape', orientation && /portrait/.test(orientation.value) && /landscape/.test(orientation.value) ? 'pass' : 'warn', orientation ? `Orientation metadata: ${orientation.value}. Unity requires both orientations; also verify both live views.` : 'No dual-orientation metadata detected. Verify both live views manually.'),
    result('unity-network', 'No required network requests', networkEvents.length ? 'warn' : 'pass', networkEvents.length ? `${networkEvents.length} external runtime fetch/XHR request(s) observed. Unity permits limited analytics but the playable must not require network resources. First: ${networkEvents[0].url}` : 'No external fetch/XHR requests observed in the current runtime passes.', 'Runtime'),
    result('unity-cta-api', 'CTA uses mraid.open()', !realFinalCtas.length ? 'warn' : nonMraid.length ? 'fail' : 'pass', !realFinalCtas.length ? 'No real gameplay CTA captured yet.' : nonMraid.length ? `${nonMraid.length} final CTA attempt(s) did not use mraid.open().` : 'Captured gameplay CTA attempts used mraid.open().', 'Runtime'),
    result('unity-no-auto-redirect', 'No automatic store redirect', autoRedirect.length ? 'fail' : 'pass', autoRedirect.length ? `${autoRedirect.length} store-open attempt(s) occurred without a recent user gesture.` : 'No non-user-initiated gameplay store redirect observed.', 'Runtime'),
    result('unity-viewable', 'Wait for MRAID viewableChange', 'manual', 'Generic Preview Lab cannot reliably determine when gameplay visually starts. Treat this as a manual/integration check.', 'Runtime'),
  ];
}

function googleChecks(context) {
  const html = context.html || '';
  const refs = extractAssetReferences(html).filter((value) => isAbsoluteNetworkReference(value));
  const disallowed = refs.filter((value) => !allowedGoogleExternal(value));
  const orientation = hasOrientationMeta(html);
  const orientationOkay = orientation && (orientation.kind === 'orientation'
    ? /portrait|landscape/.test(orientation.value)
    : /width\s*=\s*(?:320|480)\s*,\s*height\s*=\s*(?:480|320)/.test(orientation.value));

  return [
    result('google-size', 'Asset size ≤ 5 MB', context.fileSize <= 5_000_000 ? 'pass' : 'fail', `${formatBytes(context.fileSize)} loaded. Google documents a maximum 5 MB ZIP for App Campaign HTML5/Playable assets.`),
    result('google-files', 'ZIP file count ≤ 512', 'manual', 'Preview Lab currently loads a single HTML file, not the final ZIP. Validate the exported ZIP separately.'),
    result('google-orientation', 'Orientation metadata', orientationOkay ? 'pass' : 'fail', orientation ? `Detected ${orientation.kind}: ${orientation.value}.` : 'Missing ad.orientation / supported ad.size metadata.'),
    result('google-external', 'External references', disallowed.length ? 'fail' : 'pass', disallowed.length ? `${disallowed.length} disallowed absolute external reference(s) found. First: ${disallowed[0]}` : refs.length ? 'Only recognized Google-hosted external references were found.' : 'No absolute external references found.'),
    result('google-responsive', 'Responsive full-screen layout', 'manual', 'Use Compare View portrait/landscape and multiple device profiles; static HTML cannot prove responsive behavior.'),
    result('google-sound', 'Sound starts after interaction', 'manual', 'Current bridge enforces preview mute but does not yet certify Google user-interaction timing for every audio path.', 'Runtime'),
  ];
}

function applovinChecks(context) {
  const html = context.html || '';
  const ctaEvents = context.ctaEvents || [];
  const mraidEvents = ctaEvents.filter((event) => event.via === 'mraid.open');
  const bridgeDetected = (context.sessions || []).some((session) => session.hasCgbBridge);
  return [
    result('applovin-html', 'HTML creative', 'pass', 'Loaded creative is an HTML document.'),
    result('applovin-mraid', 'HTML / MRAID compatibility', /\bmraid\s*\./i.test(html) || mraidEvents.length ? 'pass' : 'warn', mraidEvents.length ? 'Runtime mraid.open() activity captured.' : 'No MRAID activity captured yet. AppLovin publicly supports HTML and MRAID 1/2/3 creative types.'),
    result('applovin-cgb', 'CGB packaged bridge', bridgeDetected ? 'pass' : 'warn', bridgeDetected ? 'window.cgb / window.super_html detected in the active preview.' : 'CGB bridge not detected; network-specific CTA checks may be limited.', 'Runtime'),
    result('applovin-public-scope', 'Public ruleset coverage', 'manual', 'Public AppLovin DSP documentation does not expose the complete upload/moderation validator contract. This preset is intentionally partial.'),
  ];
}

export function runNetworkValidation(context) {
  const preset = NETWORK_PRESETS.find((item) => item.id === context.presetId) || NETWORK_PRESETS[0];
  let checks = commonChecks(context);
  if (preset.id === 'unity') checks = checks.concat(unityChecks(context));
  else if (preset.id === 'google-app') checks = checks.concat(googleChecks(context));
  else if (preset.id === 'applovin') checks = checks.concat(applovinChecks(context));
  else {
    const refs = extractAssetReferences(context.html || '').filter((value) => isAbsoluteNetworkReference(value));
    checks.push(result('generic-external', 'Absolute external references', refs.length ? 'warn' : 'pass', refs.length ? `${refs.length} absolute external reference(s) found.` : 'No absolute external references found.'));
  }

  const score = checks.reduce((summary, check) => {
    summary[check.status] = (summary[check.status] || 0) + 1;
    return summary;
  }, { pass: 0, warn: 0, fail: 0, manual: 0 });
  return { preset, checks, score };
}
