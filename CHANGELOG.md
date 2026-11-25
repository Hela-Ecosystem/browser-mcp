## [3.3.8] - 2026-11-25

### Fixed
- `browser_save_session` → `browser_load_session` no longer corrupts cookies. A default save wrote `value: "[redacted]"` and `load_session` added it back over the live cookie, silently logging the user out (a regression from the 3.3.7-era redaction fix). The session file is mode 0600 and page-scoped, so it now keeps real values; redaction stays on what the tools return. `load_session` also skips masked cookies from files saved by earlier releases, restores the rest, reports how many it skipped, and returns an error when nothing is restorable. (`browser-mcp#22`)
- `browser_upload` always refuses credential and system locations (`.ssh`, `.aws`, `.gnupg`, `.config`, `.kube`, `.docker`, every `.env*` file, `id_*`, shell history, `/etc`, `/proc`, `/sys`, `/dev`), judged on the real path so a symlink is checked by its target, even when `HELA_ALLOWED_ROOTS` is `/` or contains `$HOME`. `HELA_BROWSER_UPLOAD_ANY=true` still lifts both checks.
- `browser_export_state` and `browser_save_session` write owner-only (0600) atomically: a private temp file is renamed over the destination, so an existing world-readable file is replaced rather than chmod'd by path and a failure cannot leave secrets under the old permissions.

### Added
- `HELA_SESSIONS_DIR` sets where session files are kept (default `sessions/` in the checkout). The regression suite uses a per-run directory so it can never touch real saved sessions.

## [3.3.7] - 2026-11-23

### Fixed
- `browser_network_requests` distinguishes a mock-served request from real traffic: the readable line appends `[MOCKED <pattern>]` and the entry carries `mocked:true` + `matchingPattern`; `mockedOnly`/`realOnly` filters select one class; `browser_get_state` and `browser_health` expose the active mock count so a session that forgot to clear them is visible. (`browser-mcp#21`)

## [3.3.6] - 2026-11-23

### Fixed
- `browser_extract_schema` reads JSON-LD (`@graph` included), `itemprop` microdata and tables before its keyword heuristic, so `Product.name`/`offers.price` no longer fall through to the `h1`. (`browser-mcp#26`)
- `browser_emulate` sets `navigator.language(s)` and `Accept-Language`, reports the language the page actually sees, and fails with `isError` when it stays unset.
- `browser_visual_analyze` mirrors every box as normalised `bbox` + `bboxPx`, and adds `ocrQuality` warning that Mirage OCR is weaker than `browser_ocr`.
- `browser_handle_captcha(verify:true)` reports no CAPTCHA present instead of an error.
- `browser_get_state` returns `checked` and `name` for checkboxes/radios and every visible text block via `textBlocks` (with `text` joined from the same list).
- `switch_tab` out of range is `isError`; replacing an intercept rule warns about the prior action; `cache_stats` reports a real `hits` count.

## [3.3.5] - 2026-11-22

### Changed
- Vision boxes carry their units. `bbox` is normalised 0-1, `bboxPx` is the same box in source pixels, and the response includes `image: {width, height}` plus `coordinateSpace: "normalised-0-1"`. Applies to `browser_image_analyze`, `browser_visual_analyze` and `browser_ocr` lines. Previously `bbox` was normalised but named as if it were pixels, so an element 48 px tall reported coordinates up to 971. (`browser-mcp#19`)
- **Shape change:** the preprocessed OCR image, previously returned as `image` when `returnImage: true`, is now `imageBase64`, because `image` carries the pixel dimensions every box refers to.

## [3.3.4] - 2026-11-22

### Fixed
- `browser_search` keeps its restricted wording (the ecosystem boundary check asserts it) while documenting the `scope: "tools"` mode added in 3.3.3.

## [3.3.3] - 2026-11-22

### Fixed
- `browser_switch_to_new_tab` no longer crashes: the page is awaited before its context is read, and the result reports the tab url, title and index. (`browser-mcp#25`)
- `batch_answer_quiz` counts an answer only when the control actually changed, reports the true answered/total and lists the unanswered questions.
- Macro export honours `format` and `save`: content is returned when save is false, written under `user_data/macros/` with the matching extension when true, and an unknown action is an error instead of a silent no-op.
- Generated tests are runnable: the emitted Playwright script carries a shebang and a run instruction.
- `browser_search` with `scope: "tools"` searches the tool catalogue and finds exact and partial tool names; the web-search scope is unchanged.

## [3.3.2] - 2026-11-22

### Added
- `browser_list_dialogs` returns the last 100 JavaScript dialogs on the active page with type, message and the action taken (76 tools).

### Fixed
- JavaScript dialogs are no longer auto-accepted. One per-page policy dismisses `confirm` and `beforeunload`, accepts `alert`, and dismisses `prompt` unless the caller supplied text; `browser_dialog` sets the action for the next dialog instead of racing a second handler, and `promptText` is actually typed. Verified live: default `confirm` returns false, `browser_dialog accept` returns true, default `prompt` returns null and returns "Grace" after `promptText`. (`browser-mcp#23`)
- `browser_dismiss_popups` never clicks an affirmative control: it prefers a close control, then a reject/decline/only-necessary label, and reports the label it clicked or that none was found. Previously it clicked `.swal2-confirm` and Accept all. (`browser-mcp#23`)

## [3.3.1] - 2026-11-22

### Fixed
- Tool payloads reach MCP clients. Seventeen handlers put the result in a non-standard `data` field that clients drop, so callers saw only the summary line; they now return `structuredContent` plus a text summary capped at 2,000 UTF-16 units. Failed assertions and failed replay/parallel/batch operations set `isError` and keep their diagnostics. (`browser-mcp#24`)

## [3.3.0] - 2026-11-22

### Changed
- `browser_get_cookies`, `save_session` and `export_state` are scoped to the active page and redact values by default. `includeValues` and `allDomains` are explicit widenings; a page with no http(s) origin returns nothing instead of the profile jar. `browser_upload` resolves real paths and refuses anything outside `HELA_ALLOWED_ROOTS` (default cwd), symlink-safe, with `HELA_BROWSER_UPLOAD_ANY=true` as the documented escape hatch. (`browser-mcp#22`)
- `browser_extract_table` honours its `header` default. JSON-Schema defaults are not applied server-side, so `undefined` previously meant "flat"; now only `header:false` opts out. A first row is consumed as headers only when it really is one (`<th>`/`<thead>`), duplicate and blank column names are disambiguated, and the response includes `headers` plus a note when no header row exists. (`browser-mcp#20`)

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

