'use strict';
/*
 * Issue #21 — browser_network_requests must distinguish synthetic traffic from
 * real traffic. A request answered by a mock/intercept rule is flagged in the
 * readable line ([MOCKED pattern]) and structurally (mocked:true plus
 * matchingPattern), filters can select one class, and the active mock count is
 * visible without asking. Clearing a rule clears the flagging.
 *
 * localhost navigation is SSRF-blocked in the navigate tool, so the fixture is
 * served by an in-process HTTP server and the page is driven with Playwright
 * directly; mock rules are installed through the real tools.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, mock, test } = require('node:test');
const { chromium } = require('playwright');

process.env.BROWSERLESS_URL = 'ws://issue-21-fixture.test/chromium';
process.env.BROWSERLESS_FALLBACK_LOCAL = 'false';
const { newPage, getNetworkRequests, clearNetworkRequests } = require('../src/core/browser');
const { handleToolCall } = require('../src/tools');

const PAGE_MOCK_PATTERN = '**/api/data*';
const CONTEXT_MOCK_PATTERN = '**/api/intercepted*';

const fixtureHtml = '<!doctype html><html><body><div id="out">fixture</div></body></html>';

let browser;
let page;
let server;
let baseUrl;
const hits = new Map();

before(async () => {
    server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        hits.set(pathname, (hits.get(pathname) || 0) + 1);
        if (pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html' });
            return res.end(fixtureHtml);
        }
        if (pathname === '/api/data') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end('{"value":"ORIGINAL-PAYLOAD"}');
        }
        if (pathname === '/api/real') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end('{"value":"REAL-PAYLOAD"}');
        }
        if (pathname === '/api/intercepted') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end('{"value":"REAL-INTERCEPTED"}');
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"not found"}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({ headless: true });
    mock.method(chromium, 'connectOverCDP', async () => browser);

    page = await newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
});

after(async () => {
    await handleToolCall('browser_close', {}).catch(() => {});
    await browser?.close();
    mock.restoreAll();
    server?.close();
});

async function call(name, args) {
    const result = await handleToolCall(name, args, page);
    assert.equal(result.isError, undefined, result.content[0].text);
    return result;
}

// No mock rules, empty request log: every test starts from a clean session.
async function resetSession() {
    await call('browser_clear_intercepts', {});
    await call('browser_clear_mocks', {});
    clearNetworkRequests(page);
    hits.clear();
}

async function fetchText(path) {
    return page.evaluate(async target => {
        const response = await fetch(target, { cache: 'no-store' });
        return response.text();
    }, path);
}

// The response event can land a tick after fetch() resolves.
async function waitForEntry(pathFragment) {
    for (let i = 0; i < 80; i++) {
        const entry = getNetworkRequests(page).find(r => r.url.includes(pathFragment));
        if (entry) return entry;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`no network log entry for ${pathFragment}`);
}

test('a mocked request is flagged; a real request made alongside it is not', async () => {
    await resetSession();
    await call('browser_mock_network', {
        pattern: PAGE_MOCK_PATTERN,
        body: { value: 'MOCKED-PAYLOAD' },
        status: 200,
    });

    assert.equal(await fetchText('/api/data'), '{"value":"MOCKED-PAYLOAD"}');
    assert.equal(await fetchText('/api/real'), '{"value":"REAL-PAYLOAD"}');

    // Provenance is real: the mock never reached the server, the real one did.
    assert.equal(hits.get('/api/data') || 0, 0);
    assert.equal(hits.get('/api/real'), 1);

    const mocked = await waitForEntry('/api/data');
    const real = await waitForEntry('/api/real');
    assert.equal(mocked.mocked, true);
    assert.equal(mocked.matchingPattern, PAGE_MOCK_PATTERN);
    assert.equal(real.mocked, undefined);
    assert.equal(real.matchingPattern, undefined);

    const listed = await call('browser_network_requests', { filter: '/api/' });
    const lines = listed.content[0].text.split('\n');
    assert.ok(lines.some(line => line.includes('/api/data') && line.includes(`[MOCKED ${PAGE_MOCK_PATTERN}]`)), listed.content[0].text);
    assert.ok(lines.every(line => !(line.includes('/api/real') && line.includes('[MOCKED'))), listed.content[0].text);

    const { structuredContent } = listed;
    const structuredMocked = structuredContent.requests.find(r => r.url.includes('/api/data'));
    const structuredReal = structuredContent.requests.find(r => r.url.includes('/api/real'));
    assert.equal(structuredMocked.mocked, true);
    assert.equal(structuredMocked.matchingPattern, PAGE_MOCK_PATTERN);
    assert.equal(structuredReal.mocked, undefined);
    assert.equal(structuredReal.matchingPattern, undefined);
});

test('mockedOnly and realOnly each select one class and reject being combined', async () => {
    await resetSession();
    await call('browser_mock_network', { pattern: PAGE_MOCK_PATTERN, body: { value: 'MOCKED-PAYLOAD' } });
    await fetchText('/api/data');
    await fetchText('/api/real');
    await waitForEntry('/api/data');
    await waitForEntry('/api/real');

    const mockedOnly = await call('browser_network_requests', { filter: '/api/', mockedOnly: true });
    assert.match(mockedOnly.content[0].text, /\/api\/data.*\[MOCKED/);
    assert.doesNotMatch(mockedOnly.content[0].text, /\/api\/real/);
    assert.equal(mockedOnly.structuredContent.requests.length, 1);

    const realOnly = await call('browser_network_requests', { filter: '/api/', realOnly: true });
    assert.match(realOnly.content[0].text, /\/api\/real/);
    assert.doesNotMatch(realOnly.content[0].text, /\/api\/data/);
    assert.equal(realOnly.structuredContent.requests.length, 1);

    const both = await handleToolCall('browser_network_requests', { mockedOnly: true, realOnly: true }, page);
    assert.equal(both.isError, true);
    assert.match(both.content[0].text, /mutually exclusive/);
});

test('get_state, health, and the request list all expose the active mock count', async () => {
    await resetSession();
    await call('browser_mock_network', { pattern: PAGE_MOCK_PATTERN, body: { value: 'x' } });

    const health = JSON.parse((await call('browser_health', {})).content[0].text);
    assert.equal(health.mockRouteCount, 1);
    assert.deepEqual(health.mockRoutes.map(r => r.pattern), [PAGE_MOCK_PATTERN]);

    const state = JSON.parse((await call('browser_get_state', {})).content[0].text);
    assert.equal(state.mocks.count, 1);
    assert.deepEqual(state.mocks.routes.map(r => r.pattern), [PAGE_MOCK_PATTERN]);

    const listed = await call('browser_network_requests', {});
    assert.equal(listed.structuredContent.mockRouteCount, 1);
});

test('browser_clear_mocks removes the rule and stops flagging new traffic', async () => {
    await resetSession();
    await call('browser_mock_network', { pattern: PAGE_MOCK_PATTERN, body: { value: 'MOCKED-PAYLOAD' } });
    assert.equal(await fetchText('/api/data'), '{"value":"MOCKED-PAYLOAD"}');
    await waitForEntry('/api/data');

    await call('browser_clear_mocks', {});
    const health = JSON.parse((await call('browser_health', {})).content[0].text);
    assert.equal(health.mockRouteCount, 0);

    clearNetworkRequests(page);
    assert.equal(await fetchText('/api/data'), '{"value":"ORIGINAL-PAYLOAD"}');
    const entry = await waitForEntry('/api/data');
    assert.equal(entry.mocked, undefined);
    assert.equal(entry.matchingPattern, undefined);
});

test('browser_clear_intercepts resets flagging for intercept mocks', async () => {
    await resetSession();
    await call('browser_intercept', {
        pattern: CONTEXT_MOCK_PATTERN,
        action: 'mock',
        body: { value: 'INTERCEPT-MOCKED' },
        status: 200,
    });

    assert.equal(await fetchText('/api/intercepted'), '{"value":"INTERCEPT-MOCKED"}');
    const mocked = await waitForEntry('/api/intercepted');
    assert.equal(mocked.mocked, true);
    assert.equal(mocked.matchingPattern, CONTEXT_MOCK_PATTERN);

    const health = JSON.parse((await call('browser_health', {})).content[0].text);
    assert.equal(health.mockRouteCount, 1);
    assert.equal(health.mockRoutes[0].scope, 'context');

    await call('browser_clear_intercepts', {});
    clearNetworkRequests(page);

    assert.equal(await fetchText('/api/intercepted'), '{"value":"REAL-INTERCEPTED"}');
    const real = await waitForEntry('/api/intercepted');
    assert.equal(real.mocked, undefined);
    assert.equal(real.matchingPattern, undefined);
});
