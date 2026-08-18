# Playable Preview Lab

A static browser-based viewport validator for single-HTML playable ads.

## MVP features

- Load a local `.html` playable by file picker or drag & drop.
- Single-device preview.
- Grid View with a four-column base grid: phones occupy one column, tablets occupy two.
- Portrait / landscape switch.
- Per-device CSS viewport dimensions and preview DPR override.
- Grid View Sync Input using normalized pointer coordinates.
- Only one Grid View frame is audible at a time.
- Global page mute.
- Global `Show Endcard` command (`window.cgb.gameEnd()` / `game_end()`).
- Global `CTA download` command (`window.cgb.download()`) with store navigation intercepted in preview mode.
- AppLovin-validator-style CTA confirmation banner.

## Important limitation

This page simulates **viewport dimensions and DPR**, not a real browser/device engine. It cannot emulate old WebView versions, GPU/WebGL capabilities, codec support, UA quirks or physical device performance. Real-device QA is still required.

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
