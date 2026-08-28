# Network Validation

This branch adds a local preflight mode on top of `feature/compare-view-runtime`.

The validator does **not** upload a playable to an ad network and does not claim parity with private moderation systems. It combines published requirements with runtime telemetry from the injected Preview Bridge.

## Presets

### Generic Preflight

Checks basic HTML structure, runtime errors, and absolute external references.

### Unity Ads

Published source:

- https://docs.unity.com/en-us/user-acquisition/creatives/creative-specifications

Implemented checks:

- single inline HTML;
- file size under 5 MB;
- MRAID usage;
- portrait + landscape requirement;
- external runtime fetch/XHR telemetry;
- real gameplay CTA should finish through `mraid.open()`;
- no store redirect without a recent user gesture;
- `viewableChange` remains manual because generic browser instrumentation cannot reliably determine the exact moment gameplay visually starts.

### Google App Campaigns

Published sources:

- https://support.google.com/google-ads/answer/9981650
- https://support.google.com/google-ads/answer/12771973

Implemented checks:

- HTML structure / doctype;
- loaded asset size against the documented 5 MB upload ceiling;
- `ad.orientation` or supported `ad.size` metadata;
- absolute external references with limited recognition of documented Google-hosted exceptions;
- ZIP file-count limit is reported as manual because Preview Lab currently loads one HTML file rather than the final ZIP;
- responsive behavior and sound timing remain manual/runtime QA items.

### AppLovin

Published source used for the current public-doc scope:

- https://developers.applovin.com/en/max/demand-partners/demand-side-platforms/applovin-ortb-specification/bid-responses/

The public DSP documentation confirms HTML and MRAID 1/2/3 creative types, but it does not expose the complete creative-upload/moderation validator contract used by AppLovin's own tools. Therefore the AppLovin preset is deliberately marked **partial** and focuses on HTML/MRAID/CGB runtime behavior rather than inventing undocumented hard requirements.

## Runtime telemetry

The Preview Bridge reports:

- runtime errors and unhandled promise rejections;
- `cgb.download(url)` / `super_html.download(url)` calls;
- final CTA attempts through `mraid.open`, `window.open`, or anchors;
- whether the final CTA followed a recent user gesture;
- whether a CTA was triggered by Preview Lab's own global CTA test;
- Host / iOS / Android emulation mode associated with the event;
- `fetch` and XHR attempts.

Embedded/data/blob and same-origin preview-loader traffic is filtered from the Unity external-network summary to reduce false positives.

## Known limitations

- Platform emulation changes navigator/platform values but does not turn Chromium into Safari or a real Android WebView.
- Static checks cannot reliably recover arbitrary encrypted/obfuscated constants; runtime hooks are preferred for CTA URLs.
- Direct `location.href = ...` navigation is not guaranteed to be interceptable.
- MRAID `viewableChange` startup compliance needs a more explicit CGB/engine lifecycle hook for deterministic automated verification.
- Google ZIP structure/file-count validation will become more accurate once Preview Lab can accept the final exported ZIP in addition to single HTML.
