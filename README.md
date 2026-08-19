# Playable Preview Lab

A static browser-based viewport validator for single-HTML playable ads.

## Compare View architecture

Preview Lab intentionally does **not** run a wall of every known device. One device profile is selected at a time and that profile defines the live views that are actually useful for QA.

Typical phones and tablets use two live runtimes:

- Portrait
- Landscape

The Galaxy Z Fold profile uses four live runtimes:

- Folded / cover Portrait
- Folded / cover Landscape
- Open / main display Portrait
- Open / main display Landscape

This keeps the normal steady-state cost at 2 Cocos/WebGL runtimes and the special foldable case at 4.

## Persistent runtime rule

Runtime identity is based on persistent **slots**, not on a concrete device name:

- `primary-portrait`
- `primary-landscape`
- optional `secondary-portrait`
- optional `secondary-landscape`

Switching iPhone → Pixel → tablet reuses the same primary iframes and only changes their logical viewport. A foldable adds two secondary runtimes; leaving the foldable profile removes those secondary runtimes again.

A loaded iframe is recreated only when:

- a new HTML file is loaded;
- `Reload runtimes` is explicitly pressed;
- Platform Emulation changes (platform sniffing normally happens during bootstrap);
- the selected profile requires an additional runtime slot that does not exist yet.

The following operations do **not** restart existing playable runtimes:

- Focus / Back to Compare;
- switching between normal two-view device profiles;
- changing Preview 1× / Device DPR;
- browser window resize;
- mute / audio-master changes.

Device changes send `resize`. `orientationchange` is emitted only when the actual orientation of a runtime slot changes, rather than on every viewport update.

## Platform Emulation

The Compare toolbar provides:

- `Host` — use the real Chromium navigator values;
- `iOS` — restart the runtimes with representative iPhone/Safari-like `navigator.userAgent`, `platform`, `vendor`, touch capability and no Chromium `userAgentData`;
- `Android` — restart the runtimes with representative Android/Chrome-like navigator values and `userAgentData`.

This is intended for **runtime platform branching**, especially CTA/store selection. It does not turn Chromium into Safari or an Android WebView and therefore does not emulate browser-engine quirks or codec/WebGL support.

Platform changes intentionally restart the runtime because projects frequently cache platform detection during bootstrap. CTA captures are preserved across a platform change so an iOS pass and an Android pass can validate both store links in one session.

## Current features

- Load a local `.html` playable by file picker or drag & drop.
- Device-profile Compare View with 2 or 4 live views.
- Focus any viewport without restarting it; the other runtimes remain alive below it.
- `Preview 1×` mode by default to reduce GPU/render-target cost while preserving CSS viewport dimensions.
- Optional `Device DPR` mode for DPR-sensitive validation.
- Host / iOS / Android runtime platform emulation.
- Only one active view is audible at a time, plus a global page mute.
- Global `CTA download` bridge test with store navigation intercepted in preview mode.
- CTA URL validator with expected App Store / Google Play links and captured runtime URLs.
- AppLovin-validator-style CTA confirmation banner.
- Preview-frame runtime error relay into each device card.
- Minimal preview `mraid` stub so AppLovin playables can run outside the ad-network container.

## Global Mute

A normal web page cannot control the browser's native **Mute tab** state or tab speaker icon. Preview Lab therefore implements the equivalent behavior inside every loaded runtime.

The injected bridge:

- tracks Web Audio `AudioContext` instances created inside each iframe;
- suspends them when the frame should be silent;
- patches each context instance so later `resume()` calls from Cocos cannot bypass Global Mute;
- mutes `<audio>` / `<video>` elements;
- reapplies the mute policy after user-activation events;
- periodically enforces the policy only while a frame is intentionally muted.

The primary validation target is Cocos WebAudio output: Global Mute must remain silent even after interacting with the previously audible iframe, while unmuting must restore only the selected audio-master view.

## CTA URL validator

`Show Endcard` is intentionally not part of Preview Lab. In CGB playables, gameplay completion normally notifies the packaged bridge that `gameEnd()` should be emitted; calling `window.cgb.gameEnd()` from the validator would test the opposite direction and would not reliably force the project's real endcard flow.

CTA validation observes:

- the URL argument passed to `window.cgb.download(url)` / `window.super_html.download(url)`;
- final store-open attempts through `window.open(...)`;
- `mraid.open(...)`;
- external `<a href>` navigation.

The final navigation attempt has priority over the raw `download(url)` argument when both are available. Enter expected App Store and Google Play links in the validator fields. Green `✓` means captured URLs match; red `✕` means at least one differs; `Captured:` shows the actual destination.

The global `CTA download` button remains a bridge sanity check. Captures are not discarded between iOS and Android emulation passes, making it possible to collect and validate both platform-specific destinations.

Direct `location.href = ...` navigation is not reliably replaceable by a normal web page and is therefore not guaranteed to be captured. CGB/network-adapter paths using `download`, `window.open`, MRAID or anchors are the intended validation target.

## Sync Input status

Cross-runtime Sync Input is intentionally **deferred** and is not exposed in the UI. Synthetic DOM pointer-event mirroring is not reliable enough as a generic solution for independent Cocos runtimes. A future implementation should be Cocos-aware or expose an explicit Preview/QA input bridge from the playable itself.

## Loading model

Loaded playables are rendered through `iframe.srcdoc` rather than Blob URLs. Preview Lab injects a small bridge and an explicit document `<base>` before the playable bootstrap. This keeps relative Cocos/SystemJS URLs resolvable while the packed runtime intercepts its embedded resources.

## DPR modes

`Preview 1×` keeps the logical CSS viewport intact but exposes DPR 1 to the preview runtime, substantially reducing the number of pixels that multiple Cocos renderers need to draw.

`Device DPR` exposes the configured device DPR. Preview Lab changes DPR without recreating the iframe, but individual engines may cache some DPR-dependent state internally.

## Device-mode limitation

This page simulates viewport dimensions, DPR and selected navigator/platform values, not a real browser/device engine. It cannot emulate old WebView versions, Safari-vs-Chromium engine differences, GPU/WebGL capabilities, codec support, UA-independent quirks, fold hinge behavior or physical device performance. Real-device QA is still required.

The Galaxy Z Fold5 CSS viewport values are a QA approximation and should not be treated as a full foldable browser emulator.

## GitHub Pages

This project has no build step. Serve the repository root as GitHub Pages.

## Planned CGB Studio packer integration

The public GitHub Pages version intentionally requires manual local file selection because a normal web page cannot read an arbitrary local file path passed by the Cocos Editor.

For the packer `Preview` button, the recommended integration is:

1. The extension main process starts an ephemeral localhost HTTP server on `127.0.0.1`.
2. The same Preview Lab static files are served locally.
3. The selected packed HTML is exposed by the local server under a random session URL.
4. Cocos opens the preview URL in the system browser.
5. Preview Lab loads the HTML automatically from the same localhost origin.
6. Closing the Preview session or Editor stops the server.

This avoids uploading client playables anywhere and avoids browser restrictions around `file://` access.

## Preview bridge assumptions

CGB Studio packer exposes its packaged playable bridge through `window.cgb` / `window.super_html`. The validator observes this bridge for CTA calls and can invoke `download()` for the global CTA test. Non-CGB HTML files can still be viewport-tested, but CGB-specific CTA validation may be unavailable.
