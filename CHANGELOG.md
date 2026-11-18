## [3.2.6] - 2026-11-19

### Fixed
- `browser_fill_form` now accepts what `browser_observe` actually reports. Keys resolve in order: a ref number from the last observe/get_state, a bare name or id, then the key as a CSS selector, so every existing caller keeps working. Attribute values are quoted, so a field name containing a quote cannot break out of the selector.
- Resolution runs for every key before anything is typed, so an unmatched key aborts the call and names what it tried instead of leaving a half-filled form; the no-element branch can no longer reach `page.fill`, which used to block for the full 30-second locator timeout (a miss now resolves in milliseconds).

## [3.2.5] - 2026-11-19

### Fixed
- Automatically reconnect a closed Browserless/CDP context and retry the interrupted tool once. Recovery is limited to the closed-context error and the explicit `no-title` blank-page state.

### Known limitation
- Browserless can still close a context during an operation; the client retries that operation only once. A second failure is returned to the caller.

## [3.2.4] - 2026-11-19

### Changed
- npm audit fix clears a critical advisory plus eight others; browser behaviour unchanged.

## [3.2.3] - 2026-11-18

### Changed
- `BROWSER_HEADLESS` now defaults to automatic: headless when `DISPLAY` is unavailable (services, Wayland bridges, CI), headful when a display exists. An explicit `true`/`false` still wins. Previously the default was always headful, which crashed Playwright in display-less service processes.

## [3.2.1] - 2026-11-18

### Added
- `npm run test:browserless` validates a remote Browserless instance end to end with local fallback disabled: connect, navigate, screenshot, read, evaluate, second tab, tab list. A pass cannot be the local Chromium taking over.

### Known limitation
- Browserless may still close a remote CDP context while an operation is running. The client now reconnects and retries once for the recognized closed-context error or explicit `no-title` blank-page state; a repeated failure is returned as an error.

# Changelog

All notable changes to this project.

## [Unreleased]

### Fixed
- Keep the standalone Mirage setup command usable on Linux, macOS, and native Windows by discovering Python cross-platform and creating the managed virtual environment in the repository data directory.

## [3.2.0] - 2026-11-13

### Added
- Added `browser_image_analyze` for dedicated image analysis from validated local paths, safe HTTP(S) URLs, or base64 image data.
- Added VLM scene understanding, OCR, object detection, segmentation, spatial relations, and schema-based decisions without requiring an active browser page.
- Added image size, redirect, content-type, workspace, and SSRF protections for direct image inputs.

## [3.1.0] - 2026-11-13

### Added
- Added first-class Mirage visual intelligence to HeLa Cytosol through `browser_visual_analyze`.
- Added a persistent Cactus worker with managed Python environment setup, lazy model download, local cache reuse, and telemetry disabled by default.
- Added scene description, object detection, OCR, segmentation, relations, and schema-based visual extraction from the active browser page or a selected element.

## [3.0.1] - 2026-11-13

### Fixed
- Tuned CDP timeouts and added support for local file schemes.

### Changed
- Updated runtime dependencies and synchronized canonical documentation.

## [3.0.0] - 2026-10-31

### Changed
- **Version reset to 3.0.0** — per-server version metadata baseline reset (Phase 7). All `package.json`, MCP `ServerInfo.version`, and HTTP metadata now report `3.0.0`. This is a metadata/interface baseline reset; for `hela-plastid` it is not an upgrade from the previous `4.2.0` advert.

