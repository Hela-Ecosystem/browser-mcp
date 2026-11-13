# HeLa Cytosol: canonical tools

Server version **3.1.0**. Generated from the ecosystem schema catalog; regenerate with `npm run docs:generate -- --servers` in the ecosystem checkout.

Only names advertised by `tools/list` are listed here. Older aliases in migration examples are not additional tools. Runtime namespace prefixes are optional and do not change these server-local names.

## `browser_agent_create`

Create or switch to a named page/agent. Each named page is independent — use this to run parallel automation flows.

## `browser_agent_list`

List all named agent pages and their URLs.

## `browser_agent_remove`

Remove and close a named agent page.

## `browser_agent_switch`

Switch the active page to an existing named agent.

## `browser_assert`

Validate page state: element existence/text, visibility, URL, or gated JavaScript. Returns PASS/FAIL without breaking the flow. Consolidates the former assert_visible, assert_text, and assert_url tools. type=js requires HELA_BROWSER_ALLOW_EVAL=true.

## `browser_back`

Navigate back in history.

## `browser_batch_answer_quiz`

Batch answer multiple quiz questions in a single tool call. Navigates through pages, selects answers, and optionally submits. Handles radio and checkbox questions. Returns results with errors.

## `browser_cache_stats`

Return statistics about the action selector cache (hit count, entries, stale entries). Read-only.

## `browser_check`

Check a checkbox or radio.

## `browser_clear`

Clear an input field.

## `browser_clear_intercepts`

Remove all active request intercept rules.

## `browser_clear_mocks`

Remove all network mock routes and restore normal behavior.

## `browser_clear_recording`

Clear the current session action recording. Call before a workflow you want to capture as a test.

## `browser_click`

Click by ref, visible text, CSS selector, or x/y coordinates. Supports nth/index match, left/right/middle button, single/double click, and smart selector fallbacks. Consolidates the former click_text, click_nth, click_ref, double_click, and right_click tools.

## `browser_close`

Close the browser session and clear state.

## `browser_console_messages`

Return captured browser console messages and page errors (last 100). Useful for debugging — check for JS errors after interactions. Read-only.

## `browser_dialog`

Set up handler for JavaScript dialogs (alert, confirm, prompt). Call BEFORE the action that triggers the dialog.

Actions: `accept`, `dismiss`.

## `browser_dismiss_popups`

Try to dismiss common popups and banners.

## `browser_download_click`

Click an element (by ref) that triggers a file download, intercepts the OS file dialog, and saves the file to the local workspace.

## `browser_drag`

Drag from source to target.

## `browser_emulate`

Emulate network conditions, CPU throttling, geolocation, locale, timezone, and color scheme.

## `browser_evaluate`

[R3 Privileged] Execute arbitrary JavaScript in the page context and return the result. Requires HELA_BROWSER_ALLOW_EVAL=true. Supports async/await, multi-statement scripts, and passing serializable data via args.

## `browser_export_state`

Export the current page state (URL, title, headings, text, interactive elements, cookies, localStorage, sessionStorage, optional AX tree) as a JSON file. Use to create a reproducible snapshot for sharing with other agents, debugging, or replay. Defaults to exports/state-<timestamp>.json.

## `browser_extract_schema`

Extract structured data from the page matching a JSON schema. Provide a schema object with property names and descriptions — the tool scrapes the page and returns a typed JSON object. More reliable than text extraction for structured data (prices, tables, forms, product info).

## `browser_extract_table`

Extract data from an HTML table into JSON.

## `browser_fill_form`

Fill multiple form fields at once. Set typeAware=true to auto-detect input types (date, number, email, tel, url, select, checkbox, radio, file, contenteditable) and format values with the right Playwright method — much more reliable for structured forms than raw fill.

## `browser_forward`

Navigate forward in history.

## `browser_generate_playwright_test`

Generate a replayable Playwright test script from the recorded actions in this session. Returns a .spec.js file content. Call browser_clear_recording first to start a fresh recording.

## `browser_get_captured_apis`

Retrieve all API responses captured by browser_intercept_api. Returns structured JSON data.

## `browser_get_content`

Restricted to browser or JavaScript-rendered content; prefer hela-enzyme extract_content for static pages. Extract page content as markdown, text, visible text, HTML, or accessibility tree. Consolidates the former get_text, get_html, get_visible_text, get_page_markdown, and get_accessibility_tree tools.

## `browser_get_cookies`

Get current browser cookies for the active page.

## `browser_get_state`

Capture the current page state: URL, title, headings, text blocks, interactive elements (with ref numbers), AX tree, popups, and CAPTCHA status. Auto-saves snapshot for browser_state_diff. Pass screenshot=true to also include a visual screenshot — only do this when elements may be hidden from the AX tree (canvas, shadow DOM, iframes, visual-only widgets) or when layout context is needed.

## `browser_handle_captcha`

Detect and handle CAPTCHA. Default: clicks checkbox, detects challenge type, returns immediately. Image: returns screenshot + prompt for agent to solve visually via browser_solve_captcha_grid. Audio: set audio=true to attempt whisper solve (with timeout param). Verify: set verify=true to check if solved. Agent is never blocked — can always use browser_screenshot or other tools between calls.

## `browser_health`

Check browser health: context alive, page responsive, page count, active URL, and evaluate latency. Read-only. Use to diagnose crashes, zombie contexts, or unresponsive pages.

## `browser_highlight`

Draw a colored border around an element for visual debugging. Useful before taking screenshots to verify element location.

## `browser_hover`

Hover over an element.

## `browser_intercept`

Intercept network requests matching a URL pattern. Use to block ads/trackers, mock API responses, or inject headers. Rules persist for the session until browser_clear_intercepts is called.

Actions: `block`, `mock`, `modify`.

## `browser_intercept_api`

Capture API responses matching a URL pattern. Stores responses in memory for later retrieval. Use to extract quiz data, form options, or any XHR/fetch response without DOM scraping.

Actions: `start`, `stop`, `get`.

## `browser_intercept_list`

List all active request intercept rules.

## `browser_list_sessions`

List all saved session files in the sessions/ directory with name, size, cookie count, origin, and modified time. Read-only.

## `browser_list_tabs`

List all open browser tabs.

## `browser_load_session`

Load a previously saved session. Restores cookies and, if the session was saved with includeStorage=true, also restores localStorage and sessionStorage.

## `browser_mock_network`

Mock API responses for frontend testing. Intercepts matching URLs and returns synthetic data without touching the backend.

## `browser_navigate`

Navigate to a URL. Retries automatically on network failure. Auto-switches to DuckDuckGo if Google shows CAPTCHA.

## `browser_network_requests`

Return captured network requests and their response status/timing (last 100). Useful for verifying API calls, detecting failed fetches, or inspecting what URLs are being hit. Read-only.

## `browser_new_tab`

Open a new browser tab.

## `browser_observe`

Return only interactable elements (buttons, inputs, links, selects) without a screenshot. Each element gets a stable `ref` number. Use before planning an action to enumerate available targets with minimal token cost — then act with browser_click(ref=...) or browser_type.

## `browser_ocr`

Extract text from a screenshot or code block using OCR (Tesseract.js). Use for reading code images, CAPTCHAs, or any visual text that is not accessible via DOM.

## `browser_parallel_execute`

Execute actions on multiple named pages concurrently. Returns results from all pages.

## `browser_performance`

Return Core Web Vitals and browser performance metrics for the current page using CDP. Includes LCP, CLS, FID estimates, navigation timing, and resource counts. Read-only.

## `browser_press`

Press a keyboard key.

## `browser_print_to_pdf`

Print the current page to a PDF file. Returns the saved file path.

## `browser_record_macro`

Control macro recording. Start recording user actions, stop and get the recorded script, or clear the recording buffer.

Actions: `start`, `stop`, `clear`, `list`, `export`.

## `browser_reload`

Reload the current page.

## `browser_replay_macro`

Replay a recorded macro or a list of actions. Can replay from JSON actions or a saved macro file.

## `browser_resize_page`

Set viewport width and height dynamically on the active page.

## `browser_save_session`

Save the current session with a name. Saves cookies by default; set includeStorage=true to also capture localStorage and sessionStorage (needed for sites that store auth tokens in Web Storage instead of cookies).

## `browser_screenshot`

Take a screenshot. Pass mark_elements=true to draw numeric badges over all interactable elements on the screenshot (Set-of-Mark).

## `browser_scroll`

Scroll by direction and amount, to a selector or coordinates, or incrementally to trigger lazy loading. Consolidates the former scroll_to and smart_scroll tools.

## `browser_search`

Restricted to visual browser workflows (not general factual lookups); prefer hela-enzyme google_search. Search the web using DuckDuckGo (no CAPTCHA). Returns search results.

## `browser_select`

Select an option in a dropdown.

## `browser_select_by_index`

Select a radio button or checkbox by its 0-based index within a group. Use for quiz questions or radio groups where text matching is unreliable.

## `browser_set_agent_profile`

Set the agent behavior profile.

## `browser_solve_captcha_grid`

Click image CAPTCHA grid tiles by index (1-based, 1-9 for 3x3 grid). Use after browser_handle_captcha returns an image challenge. Call browser_handle_captcha again to verify result.

Actions: `verify`.

## `browser_start_trace`

Start recording a detailed Playwright trace including screenshots, snapshots, and network events.

## `browser_state_diff`

Compare the last two AX tree snapshots (saved automatically by browser_get_state). Returns structured diff: URL/title changes, new/removed headings, element changes, popup and captcha status transitions.

## `browser_stop_trace`

Stop recording trace and save zip file. Defaults to exports/trace-<timestamp>.zip.

## `browser_switch_tab`

Switch to a specific tab by index.

## `browser_switch_to_new_tab`

Detect and switch to a newly opened tab/popup. Returns the new tab URL and switches focus to it.

## `browser_type`

Type text into a field with optional human-like delay.

## `browser_uncheck`

Uncheck a checkbox.

## `browser_upload`

Upload a file to an <input type="file"> element. Provide absolute file path(s).

## `browser_visual_analyze`

Analyze the current page or a selected element with HeLa Cytosol visual intelligence. Mirage downloads and caches its local model on first use, then returns scene, object, text, relation, mask, or structured extraction results.

## `browser_wait`

Wait for time, selector, URL, page load, network idle, DOM change, or SPA navigation. Consolidates the former wait_until_stable, wait_for_load, wait_for_selector, wait_for_url, wait_for_navigation, and wait_for_change tools.
