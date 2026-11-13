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

