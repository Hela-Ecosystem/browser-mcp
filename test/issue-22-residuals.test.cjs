'use strict';
// browser-mcp#22 residuals: session round-trip, export_state mode, upload denylist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, mock, test } = require('node:test');
const { chromium } = require('playwright');

process.env.BROWSERLESS_URL = 'ws://issue-22-fixture.test/chromium';
process.env.BROWSERLESS_FALLBACK_LOCAL = 'false';
const { newPage } = require('../src/core/browser');
const { handleToolCall } = require('../src/tools');
const { resolveUploadPaths } = require('../src/utils/cookie-scope');

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions');
const ORIGIN = 'https://app.issue22.test';
const created = [];
let browser;

before(async () => {
    browser = await chromium.launch({ headless: true });
    mock.method(chromium, 'connectOverCDP', async () => browser);
});
after(async () => {
    await browser?.close();
    mock.restoreAll();
    for (const file of created) fs.rmSync(file, { force: true });
});

async function pageOnOrigin() {
    const page = await newPage();
    await page.route(`${ORIGIN}/**`, route => route.fulfill({ contentType: 'text/html', body: '<title>fixture</title>' }));
    await page.goto(`${ORIGIN}/`);
    return page;
}
const cookieValue = async (page, name) => (await page.context().cookies(ORIGIN)).find(c => c.name === name)?.value;
const mode = file => fs.statSync(file).mode & 0o777;

test('save_session keeps real cookie values and load_session restores them', async () => {
    const page = await pageOnOrigin();
    await page.context().addCookies([{ name: 'sid', value: 'abc123', url: ORIGIN }]);
    const saved = await handleToolCall('browser_save_session', { name: 'issue22-roundtrip' });
    const file = path.join(SESSIONS_DIR, 'issue22-roundtrip.json');
    created.push(file);
    assert.equal(saved.isError, undefined, saved.content[0].text);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.cookies.find(c => c.name === 'sid').value, 'abc123');
    assert.equal(mode(file), 0o600);

    await page.context().clearCookies();
    const loaded = await handleToolCall('browser_load_session', { name: 'issue22-roundtrip' });
    assert.equal(loaded.isError, undefined, loaded.content[0].text);
    assert.equal(await cookieValue(page, 'sid'), 'abc123');
});

test('load_session never writes a masked value over a live cookie', async () => {
    const page = await pageOnOrigin();
    await page.context().addCookies([{ name: 'sid', value: 'live-value', url: ORIGIN }]);
    const file = path.join(SESSIONS_DIR, 'issue22-redacted.json');
    created.push(file);
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ cookies: [
        { name: 'sid', value: '[redacted]', valueRedacted: true, domain: 'app.issue22.test', path: '/' },
    ] }));
    const loaded = await handleToolCall('browser_load_session', { name: 'issue22-redacted' });
    assert.equal(loaded.isError, true);
    assert.match(loaded.content[0].text, /redacted/);
    assert.equal(await cookieValue(page, 'sid'), 'live-value');
});

test('load_session restores real cookies from a mixed file and reports the skipped ones', async () => {
    const page = await pageOnOrigin();
    await page.context().clearCookies();
    const file = path.join(SESSIONS_DIR, 'issue22-mixed.json');
    created.push(file);
    fs.writeFileSync(file, JSON.stringify({ cookies: [
        { name: 'masked', value: '[redacted]', valueRedacted: true, domain: 'app.issue22.test', path: '/' },
        { name: 'real', value: 'kept', valueRedacted: false, domain: 'app.issue22.test', path: '/' },
    ] }));
    const loaded = await handleToolCall('browser_load_session', { name: 'issue22-mixed' });
    assert.equal(loaded.isError, undefined, loaded.content[0].text);
    assert.match(loaded.content[0].text, /1 redacted cookie\(s\) skipped/);
    assert.equal(await cookieValue(page, 'real'), 'kept');
    assert.equal(await cookieValue(page, 'masked'), undefined);
});

test('export_state writes owner-only, including over an existing world-readable file', async () => {
    await pageOnOrigin();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue22-export-'));
    const file = path.join(dir, 'state.json');
    try {
        fs.writeFileSync(file, '{}', { mode: 0o644 });
        fs.chmodSync(file, 0o644);
        const result = await handleToolCall('browser_export_state', { outputPath: file });
        assert.equal(result.isError, undefined, result.content[0].text);
        assert.equal(mode(file), 0o600);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('uploads refuse credential locations even when the allowed root is /', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue22-upload-'));
    const previous = process.env.HELA_ALLOWED_ROOTS;
    process.env.HELA_ALLOWED_ROOTS = '/';
    try {
        for (const rel of ['.ssh/id_ed25519', '.aws/credentials', '.config/tool/token', 'proj/.env', 'proj/.env.production', '.gnupg/key']) {
            const file = path.join(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, 'not-a-real-secret');
            assert.throws(() => resolveUploadPaths([file], { cwd: root, allowAny: false }), /protected/, rel);
        }
        // a symlink to a protected file is judged by its target
        fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
        fs.symlinkSync(path.join(root, '.ssh', 'id_ed25519'), path.join(root, 'proj', 'innocent.txt'));
        assert.throws(() => resolveUploadPaths([path.join(root, 'proj', 'innocent.txt')], { cwd: root, allowAny: false }), /protected/);
        // system paths stay refused under a root of /
        assert.throws(() => resolveUploadPaths(['/etc/hostname'], { cwd: root, allowAny: false }), /protected/);
        // ordinary files still upload, and the explicit override still works
        const ordinary = path.join(root, 'proj', 'report.txt');
        fs.writeFileSync(ordinary, 'ok');
        assert.deepEqual(resolveUploadPaths([ordinary], { cwd: root, allowAny: false }), [fs.realpathSync(ordinary)]);
        const secret = path.join(root, '.ssh', 'id_ed25519');
        assert.deepEqual(resolveUploadPaths([secret], { cwd: root, allowAny: true }), [fs.realpathSync(secret)]);
    } finally {
        if (previous === undefined) delete process.env.HELA_ALLOWED_ROOTS; else process.env.HELA_ALLOWED_ROOTS = previous;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
