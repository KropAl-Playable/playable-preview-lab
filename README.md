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

A loaded iframe is recreated only when:

- a new HTML file is loaded;
- `Reload runtimes` is explicitly pressed;
- the selected device profile requires a new additional view that does not already exist.

The following operations do **not** restart existing playable runtimes:

- Focus / Back to Compare;
- switching between normal two-view device profiles;
- changing Preview 1× / Device DPR;
- browser window resize;
- mute / audio-master changes;
- Sync Input changes.

Existing runtime sessions receive a live viewport update through the injected Preview Bridge, followed by `resize` and `orientationchange` events.

## Current features

- Load a local `.html` playable by file picker or drag & drop.
- Device-profile Compare View with 2 or 4 live views.
- Focus any viewport without restarting it; the other runtimes remain alive below it.
- `Preview 1×` mode by default to reduce GPU/render-target cost while preserving CSS viewport dimensions.
- Optional `Device DPR` mode for DPR-sensitive validation.
- Sync Input using normalized pointer coordinates. The viewport that receives a real pointer-down becomes `DRIVER` and mirrors subsequent input to the other active views.
- Only one active view is audible at a time, plus a global page mute.
- Global `Show Endcard` command (`window.cgb.gameEnd()` / `game_end()`).
- Global `CTA download` command (`window.cgb.download()`) with store navigation intercepted in preview mode.
- AppLovin-validator-style CTA confirmation banner.
- Preview-frame runtime error relay into each device card.
- Minimal preview `mraid` stub so AppLovin playables can run outside the ad-network container.

## Loading model

Loaded playables are rendered through `iframe.srcdoc` rather than Blob URLs. Preview Lab injects a small bridge and an explicit document `<base>` before the playable bootstrap. This keeps relative Cocos/SystemJS URLs resolvable while the packed runtime intercepts its embedded resources.

## DPR modes

`Preview 1×` is the recommended Compare setting. It keeps the logical CSS viewport intact but exposes DPR 1 to the preview runtime, substantially reducing the number of pixels that multiple Cocos renderers need to draw.

`Device DPR` exposes the configured device DPR. Use it when validating DPR-sensitive layout/rendering or final visual quality. Preview Lab changes this without recreating the iframe, but individual engines may cache some DPR-dependent state internally.

## Device-mode limitation

This page simulates **viewport dimensions and DPR**, not a real browser/device engine. It cannot emulate old WebView versions, GPU/WebGL capabilities, codec support, UA quirks, fold hinge behavior or physical device performance. Real-device QA is still required.

The Galaxy Z Fold5 CSS viewport values are a QA approximation derived from the cover/main display resolutions and should not be treated as a full foldable browser emulator.

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

CGB Studio packer already exposes its packaged playable bridge through `window.cgb` / `window.super_html`. The validator calls this bridge for Endcard and CTA commands. Non-CGB HTML files can still be viewport-tested, but the global Endcard/CTA commands may be unavailable.
