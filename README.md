# Browser-Agent


> **Part of the [HeLa MCP Ecosystem](https://github.com/Hela-Ecosystem/hela-mcp-ecosystem)** — This server is **HeLa Cytosol (`hela-cytosol`)** — the *Browser Automation* component of the HeLa cellular architecture. See the [ecosystem docs](https://github.com/Hela-Ecosystem/hela-mcp-ecosystem) for profiles, workflows, and multi-client setup.

A modular, production-ready browser automation agent implemented as a Model Context Protocol (MCP) server. Powered by Playwright, it provides **73 tools** for human-like web interaction, state analysis, automated navigation, and network-level control.

## Features

- **Semantic Interaction**: Click by text, selector, `ref`, or nth match with `browser_click`, and fill entire forms (`browser_fill_form`) with single commands.
- **Multi-Tab Management**: Handle multiple sites simultaneously with tab list, switch, and creation tools.
- **Resilient Navigation**: Automatic retry with configurable attempts and backoff on network failures.
- **Request Interception**: Block, mock, or modify requests at the network level — stub APIs, strip ads, inject auth headers.
- **Session & Persistence**: Persistent browser contexts with named session save/load for both cookies and Web Storage (`localStorage`/`sessionStorage`).
- **Remote Browserless Support**: Seamlessly offload browser automation to remote [Browserless](https://github.com/browserless/browserless) instances over Chrome DevTools Protocol (CDP) via WebSocket (`ws://`, `wss://`) or HTTPS (`http://`, `https://`). Features automatic endpoint normalization, token authentication, connection retries, and automatic fallback to local Chromium.
- **Crash Recovery**: Browser state is automatically persisted to disk. If the browser process dies, tabs and intercept rules are restored on the next tool call — no data loss.
- **Parallel Agents**: Run independent named pages within a single browser context. Create, switch, and remove agents to handle multi-page workflows without interference.
- **PDF Export**: Save pages to disk as PDF with a custom output path and accurate file size reporting.
- **Smart Wait Strategy**: `browser_wait` supports fixed delays, selectors, URLs, load events, network-idle, attribute change, and post-action navigation waits.
- **Stealth and Evasion**: Anti-detection behavioral profiles (`stealth` vs `speed`), realistic user-agent spoofing, human-like mouse jitter and typing delay.
- **Robust State Capture**: Extracts semantic page data including Accessibility Trees (AX Tree), interactive elements, and structural headings. **Natively pierces cross-origin iframes (like Stripe/CAPTCHA)** to provide unified DOM extraction.
- **Vision & Set-of-Mark (SoM)**: Supports `mark_elements=true` to draw numbered bounding boxes over interactable elements in screenshots, bypassing semantic limitations of Canvas/ShadowDOM.
- **Data Extraction**: Table-to-JSON extraction, high-fidelity PDF/HTML capture, and `browser_get_content` for Markdown, text, visible text, HTML, or AX trees.
- **CAPTCHA Management**: Automated detection and assisted resolution for reCAPTCHA, hCaptcha, and common challenge pages.
- **API Interception & Capture**: Capture XHR/fetch responses as structured JSON — extract quiz data without DOM scraping.
- **Batch Automation**: Answer entire quizzes in one tool call; batch form filling with index-based selection.
- **OCR**: Extract text from code screenshots and images via Tesseract.js with preprocessing.
- **Macro Recording & Replay**: Record workflows once, replay them with different parameters.
- **Parallel Execution**: Run actions on multiple named pages concurrently.
- **Assertions**: Verify outcomes without breaking flow — `browser_assert` checks elements, visibility, text, URLs, or JavaScript expressions and returns PASS/FAIL.
- **Perception Tools**: Read page content as structured Markdown, text, HTML, or accessibility tree with `browser_get_content` — no screenshots needed.
- **Network Mocking**: Mock API responses for frontend testing without touching the backend.
- **SSRF Protection**: Blocks navigation to `file://`, `javascript://`, private IPs, DNS rebinding, and cloud metadata endpoints.

## Demo

See the General Browser Agent in action with Gemini CLI: [Watch on YouTube](https://youtu.be/O6nYKjmlaGk)

## Toolset

### Navigation & Tabs

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL with automatic retry on failure (`retries`, `retryDelay`) — state is saved for crash recovery |
| `browser_new_tab` | Open a new tab, optionally at a URL |
| `browser_list_tabs` | List all open tabs and their active status |
| `browser_switch_tab` | Switch active tab by index |
| `browser_back` / `browser_forward` / `browser_reload` | Standard history control |
| `browser_wait` | Wait for a delay, selector, URL, load state, network-idle, attribute change, or navigation (`condition`) |

### Named Agents / Parallelism

![Blotcat acting as a puppeteer, controlling multiple isolated parallel browser contexts on strings](assets/blotcat-parallel.jpg)

| Tool | Description |
|------|-------------|
| `browser_agent_create` | Create a new named agent page, or switch to an existing one |
| `browser_agent_switch` | Switch active context to a named agent |
| `browser_agent_remove` | Close and remove a named agent |
| `browser_agent_list` | List all active named agents and their URLs |

Named agents are independent pages within the same browser. Use them to parallelize workflows — each agent keeps its own navigation state, forms, and cookies. Create one, work on it, switch to another, come back later.

**Wait strategy guide:**

| Situation | Call |
|-----------|------|
| Standard page navigation | `browser_wait({ condition: 'load' })` |
| SPA / AJAX-heavy content | `browser_wait({ condition: 'stable' })` |
| Page with WebSocket or long-polling | `browser_wait({ condition: 'load' })` — networkidle will hang |
| Specific element expected | `browser_wait({ condition: 'selector', target })` |
| URL change after action | `browser_wait({ condition: 'url', target })` or `condition: 'navigation'` |
| Text or attribute change | `browser_wait({ condition: 'change', target, attribute })` |

### Interaction

| Tool | Description |
|------|-------------|
| `browser_click` | Click by selector, text, `ref`, `nth`, or `x`/`y`; supports button, click count, and delay |
| `browser_fill_form` | Populate multiple fields at once from a `{selector: value}` object |
| `browser_hover` | Hover over an element or coordinates |
| `browser_drag` | Drag source element to target |
| `browser_upload` | Upload a file to an `<input type="file">` element |
| `browser_download_click` | Click an element (by ref) that triggers an OS file download, bypass the dialog, and save locally |
| `browser_scroll` | Scroll by direction, to a selector/coordinate, or incrementally to trigger lazy loading (`mode`) |

### Assertions

Verify outcomes without breaking flow — each returns `[PASS]` or `[FAIL]`:

| Tool | Description |
|------|-------------|
| `browser_assert` | Assert an element, visibility, text, URL, or JS condition (`type`) |

**Example:**
```
browser_assert({ type: "visible", target: "button#submit", timeoutMs: 5000 })
→ [PASS] button#submit is visible

browser_assert({ type: "text", target: "#output", expected: "Success" })
→ [PASS] Found "Success" in #output

browser_assert({ type: "url", target: "/dashboard" })
→ [PASS] URL contains "/dashboard"
```

### Forms & Input

| Tool | Description |
|------|-------------|
| `browser_type` | Human-like character insertion with configurable delay |
| `browser_clear` | Clear an input field |
| `browser_press` | Press a keyboard key |
| `browser_select` | Select a dropdown option by value or label |
| `browser_select_by_index` | Select radio/checkbox by 0-based index (reliable for quiz questions) |
| `browser_check` / `browser_uncheck` | Checkbox and radio control |

### Observation & Extraction

![Blotcat using AX Tree goggles to turn a messy web scribble into a neat grid of Set-of-Mark boxes](assets/blotcat-perception.jpg)

| Tool | Description |
|------|-------------|
| `browser_get_state` | Unified page snapshot: URL, title, AX tree, interactive elements, screenshot. Use `mark_elements=true` for Set-of-Mark visual bounding boxes. |
| `browser_observe` | **Low-token alternative to `browser_get_state`** — returns only interactable elements with `ref` numbers, no screenshot. Use for pre-action planning. |
| `browser_click` | Pass `ref` to click an element by its `ref` number. Includes closed-loop Action Verification (auto-awaits `networkidle` and reports navigation status). |
| `browser_state_diff` | Compare last two AX snapshots: URL/title changes, new/removed headings, element shifts, popups, captcha |
| `browser_screenshot` | Take a screenshot (supports `mark_elements=true`) |
| `browser_get_content` | Read content as `markdown`, `text`, `visible`, `html`, or `axtree`, scoped by `selector` |
| `browser_extract_table` | Convert an HTML table to structured JSON |
| `browser_get_cookies` | Get all cookies for the active page |
| `browser_evaluate` | Execute JavaScript in the page context (supports `return`, `await`, and `args` injection) |
| `browser_print_to_pdf` | Save the page as a PDF file to a specified path |
| `browser_console_messages` | Return captured browser console messages and JS errors (last 100). Filter by `type`. Pass `clear: true` to flush. |
| `browser_network_requests` | Return captured network requests with status and timing (last 100). Filter by URL substring or `statusMin`. |
| `browser_health` | Check browser health: context alive, page responsive, latency, active URL. Use to diagnose crashes or unresponsive pages. |

**`browser_evaluate` usage:**
```js
// Return a value
script: "return document.title"

// Use await
script: "const r = await fetch('/api/status'); return r.status"

// Pass data via args (no string interpolation needed)
script: "return args.x * args.y"
args: { "x": 6, "y": 7 }
```

### Request Interception & API Capture

![Blotcat acting as a network tollbooth, holding a block sign to an envelope while stamping another with mock](assets/blotcat-interception.jpg)

| Tool | Description |
|------|-------------|
| `browser_intercept` | Add an intercept rule: `block`, `mock`, or `modify` |
| `browser_intercept_list` | List all active intercept rules |
| `browser_clear_intercepts` | Remove all intercept rules |
| `browser_intercept_api` | Capture API responses matching a URL pattern as structured JSON |
| `browser_get_captured_apis` | Retrieve all captured API responses with optional filter |

**Actions:**
- `block` — abort matching requests (ads, trackers, heavy assets)
- `mock` — return a synthetic response with `status`, `body`, `contentType`, `headers`
- `modify` — pass the request through with injected headers (auth tokens, API keys)

**Examples:**
```
# Block all images
pattern: "**/*.{png,jpg,jpeg,gif,webp}", action: "block"

# Mock an API endpoint
pattern: "https://api.example.com/users*", action: "mock"
body: { "users": [] }, status: 200

# Inject Authorization header
pattern: "https://api.example.com/*", action: "modify"
headers: { "Authorization": "Bearer <token>" }
```

Rules persist across page navigations until `browser_clear_intercepts` is called.

### Network Mocking

Mock API responses without touching the backend — ideal for testing error states and edge cases:

| Tool | Description |
|------|-------------|
| `browser_mock_network` | Mock responses for requests matching a URL pattern |
| `browser_clear_mocks` | Remove all mock rules (keeps other intercept rules) |

**Example:**
```
# Mock a 500 error
browser_mock_network(pattern="**/api/users*", status=500, body={"error": "Internal Server Error"})

# Mock a slow response
browser_mock_network(pattern="**/api/data*", body={"data": [...]}, delay=3000)

# Clear all mocks
browser_clear_mocks()
```

### Session & Profile Management

| Tool | Description |
|------|-------------|
| `browser_save_session` | Save cookies (and optionally `localStorage`/`sessionStorage`) to a named file |
| `browser_load_session` | Restore a saved session |
| `browser_list_sessions` | List saved session files with size, cookie count, and origin |
| `browser_set_agent_profile` | Switch between `stealth` and `speed` behavioral profiles |
| `browser_handle_captcha` | Detect and manage CAPTCHA with optional manual hand-off |
| `browser_solve_captcha_grid` | Click specific grid cells in a visual CAPTCHA |
| `browser_switch_to_new_tab` | Detect and switch to a newly opened tab/popup |
| `browser_dialog` | Handle JavaScript `alert`, `confirm`, `prompt` dialogs (auto-dismissed by default) |
| `browser_highlight` | Highlight element(s) by selector — visual debug overlay |
| `browser_wait` | Use `condition: 'change'` to wait for a text or attribute change (SPA detection) |
| `browser_close` | Terminate the browser session and clear all state |

### Batch Automation

| Tool | Description |
|------|-------------|
| `browser_batch_answer_quiz` | Answer all quiz questions in one call — auto-detects radio/checkbox, navigates, optional submit |
| `browser_fill_form` | Fill multiple form fields at once (see Forms & Input) |

### OCR & Macros

| Tool | Description |
|------|-------------|
| `browser_ocr` | Extract text from screenshots/code via Tesseract.js with preprocessing (threshold, grayscale, sharpen) |
| `browser_record_macro` | Start/stop/clear/export macro recordings as Playwright tests or JSON |
| `browser_replay_macro` | Replay recorded macros or action arrays with speed control and dry-run |
| `browser_parallel_execute` | Run actions on multiple named pages concurrently |

**Session storage note:** Pass `includeStorage: true` to `browser_save_session` to also capture `localStorage` and `sessionStorage`. Required for sites that store auth tokens in Web Storage instead of cookies (most modern SPAs). Storage is only restored if the current page origin matches the saved origin.

### Helpers

| Tool | Description |
|------|-------------|
| `browser_dismiss_popups` | Suppress modals, banners, and dialogs |
| `browser_export_state` | Export current page state (URL/title/AX/cookies/storage) as a JSON snapshot for sharing or replay |

## Installation

### Prerequisites
- Node.js 18.x or higher
- npm

### Setup

```bash
# Standard local setup (installs npm deps and bundled Playwright Chromium)
bash install.sh

# Or lightweight setup for remote Browserless (no local browser binaries needed):
npm install --production
```

## Remote Browserless Connection

The agent natively supports offloading all browser automation to a remote [Browserless](https://github.com/browserless/browserless) instance (self-hosted or cloud) via Chrome DevTools Protocol (CDP).

### Advantages:
- **Zero Heavy Binaries**: Ideal for lightweight VPS, Docker containers, or ARM servers (e.g. Oracle Cloud A1, Raspberry Pi) without needing gigabytes of Chromium binaries, GUI libraries, or X11/Wayland display servers.
- **Centralized Agent Fleet**: Multiple AI agents and MCP servers across different hosts can concurrently drive the same Browserless instance.
- **Failover Protection**: Automatically falls back to launching local Chromium if the remote server becomes unavailable (enabled by default).

### Quick Setup:
Add to your `.env` file or MCP server `env` configuration:
```env
# Remote Browserless endpoint (supports https://, http://, wss://, ws://)
BROWSERLESS_URL=https://browserless.example.com

# Optional auth token if the Browserless instance requires authentication
# BROWSERLESS_TOKEN=my-secret-token

# Enable/disable automatic fallback to local Chromium (default: true)
BROWSERLESS_FALLBACK_LOCAL=true
```

> **Endpoint Auto-Normalization**: You can provide a plain HTTP/HTTPS URL (e.g. `https://browserless.example.com`). The agent automatically normalizes it into Playwright's required WebSocket CDP endpoint (`wss://browserless.example.com/chromium`) and attaches authentication query parameters if provided.

## Cookie Injection (Firefox Sync)

Place a `cookies.json` file in the project root. The agent will automatically inject these cookies into every new session (both local and remote Browserless sessions).

## Configuration

Register in your MCP client config:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/browser-mcp/src/server.js"],
      "env": {
        "BROWSERLESS_URL": "https://browserless.example.com"
      }
    }
  }
}
```

### Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `START_URL` | — | Page to open when the session starts. |
| `GOAL` | — | Task description exposed to MCP clients. |
| `BROWSERLESS_URL` | — | Connect to a remote Browserless instance over CDP (supports `http://`, `https://`, `ws://`, `wss://`). Auto-normalizes to `/chromium` WebSocket endpoint. |
| `BROWSERLESS_TOKEN` | — | Authentication token for secured Browserless instances (passed as `?token=...`). |
| `BROWSERLESS_FALLBACK_LOCAL` | `true` | When `true`, automatically falls back to launching local Chromium if the remote Browserless connection fails. |
| `CHROMIUM_EXECUTABLE_PATH` | Playwright bundled | Path to a dedicated Chromium binary. If set, Playwright uses this instead of its bundled Chromium. |
| `CHROMIUM_CHANNEL` | — | Playwright channel hint (e.g. `chromium`, `chrome`, `chrome-beta`). Ignored if `CHROMIUM_EXECUTABLE_PATH` is set. |
| `BROWSER_HEADLESS` | `false` | Set to `true` for headless operation (CI / production). |
| `BROWSER_LAUNCH_RETRIES` | `3` | Number of retries on browser launch failure. |
| `BROWSER_LAUNCH_BACKOFF` | `1000` | Base delay (ms) between launch retries; doubled each retry. |
| `ALLOW_PRIVATE_IPS` | `false` | Allow navigation to private/internal IPs (localhost, 192.168.x, etc.) — SSRF protection is enabled by default. |
| `ALLOW_ALL_SCHEMES` | `false` | Allow all URL schemes (`file://`, `data://`, `javascript://`, etc.) — only `http`/`https` allowed by default. |
| `HELA_BROWSER_ALLOW_EVAL` | *unset = off* | Set to `true` to allow `browser_evaluate` and `browser_assert` with `conditionType="js"` (R3 privilege). Off = denied. |
| `HELA_ALLOWED_ROOTS` | *unset = off* | Colon-separated directory paths for Cytosol file output containment. If set, export/trace/download/session paths must resolve inside one of these roots. |
| `HELA_ENVELOPE` | *unset = off* | Set to `true` to wrap tool results in the canonical HeLaResult envelope (`ok/summary/data/artifacts/provenance/warnings/sideEffects/execution`; captures report `sideEffects`, `export_state` stamps `state.provenance`, file outputs append `[sha256:<hex>]`). Off = byte-identical legacy output. Run/step ids propagate from `HELA_RUN_ID`/`HELA_STEP_ID`. |

### Enabling `browser_evaluate` (R3 privilege) + output roots

`browser_evaluate` executes arbitrary JavaScript in the page, so it is **denied by default**.
Set `HELA_BROWSER_ALLOW_EVAL=true` on the Cytosol server entry, then restart the
harness (or its MCP servers). The key name depends on the harness:

- **opencode** (`~/.config/opencode/opencode.json`) — `environment`:
  ```json
  "hela-cytosol": { "...": "...", "environment": { "HELA_BROWSER_ALLOW_EVAL": "true" } }
  ```
- **zed** (`context_servers` in `settings.json`) / **gemini** (`mcpServers`) — `env`:
  ```json
  "hela-cytosol": { "...": "...", "env": { "HELA_BROWSER_ALLOW_EVAL": "true" } }
  ```

Without the flag the tool returns `Evaluation blocked ...` with `isError: true` — that is
the gate working, not a bug. Note: scripts need an explicit `return` (e.g.
`return document.title`); a bare expression like `document.title` evaluates to `(undefined)`.

`HELA_ALLOWED_ROOTS` (colon-separated, same `environment`/`env` key) confines where
capture/export/session/trace/download paths may be written — symlink-aware, resolved
against real paths. Example: `/home/azzar/project:/home/azzar/Documents:/home/azzar/Downloads:/tmp`.
Paths outside the roots are rejected with `PolicyDeniedError`. When unset, only
protected system prefixes (`/etc`, `/usr`, `/proc`, ...) are forbidden.

### Browser Stability

The browser layer is hardened for long-running sessions:

- **Launch retry** with exponential backoff — if `chromium.launchPersistentContext` fails, the launcher retries up to `BROWSER_LAUNCH_RETRIES` times, doubling the wait between attempts.
- **Tab creation retry** — if `Target.createTarget` or related protocol errors occur when opening a new tab, the context is reset and the call is retried.
- **Context health probe** — the cached context is checked for liveness (with timeout) before reuse; dead contexts are torn down and relaunched transparently.
- **Stability flags** — Chromium is launched with flags that disable background timer throttling, renderer backgrounding, BackForwardCache, and other features that commonly cause crashes in automation.
- **`browser_health` tool** — returns `{ contextAlive, pageResponsive, pageCount, pageLatencyMs, activePageUrl, headless, executablePath, launchRetries }` for runtime diagnostics.

## Token-Efficient Interaction: Observe → Act

For repetitive or well-understood pages, skip the heavy `browser_get_state` screenshot and use the observe→click loop:

```
1. browser_observe()           # Returns elements with ref numbers, no screenshot
   → { elements: [{ ref: 1, tag: "BUTTON", text: "Sign In" }, ...] }

2. browser_click(ref=1)        # Click by ref — no re-snapshot needed
   → "Clicked ref 1 (BUTTON "Sign In") at (320, 240)."
```

This matches the approach used by browser-use (93% context reduction) and Stagehand's `act` primitive.

For debugging after an interaction:
```
browser_console_messages(type='error')   # Any JS errors?
browser_network_requests(statusMin=400)  # Any failed API calls?
```

## Architecture: Sense-Think-Act

![Blotcat walking through a closed-loop automation cycle: Sense (eye) -> Think (lightbulb) -> Act (mouse)](assets/blotcat-architecture.jpg)

The agent is designed for closed-loop automation with a **hybrid screenshot strategy** — screenshots are used only when the AX tree is insufficient.

```
Unfamiliar page      → browser_get_state()               # AX tree + elements, no image
Planning an action   → browser_observe()                  # interactable elements + refs only
Visual verification  → browser_get_state(screenshot=true) # full state + screenshot
Act by ref           → browser_click(ref)                 # stable, no re-snapshot needed
After action         → browser_state_diff()               # diff only, no image
Debug failures       → browser_console_messages()         # JS errors
                       browser_network_requests()         # failed API calls
```

**When to request a screenshot:**
- Canvas-rendered UIs, game elements, charts
- `aria-hidden` elements that are visually significant
- Cross-origin iframes
- Visual layout verification (CAPTCHA, image-heavy pages)

All other cases → AX tree is sufficient and far cheaper in tokens.
