'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { after, before, mock, test } = require('node:test');
const { chromium } = require('playwright');

process.env.BROWSERLESS_URL = 'ws://issue-25-fixture.test/chromium';
process.env.BROWSERLESS_FALLBACK_LOCAL = 'false';
const { getPage, newPage } = require('../src/core/browser');
const recorder = require('../src/core/recorder');
const { handleToolCall } = require('../src/tools');

let browser;
before(async () => {
    browser = await chromium.launch({ headless: true });
    mock.method(chromium, 'connectOverCDP', async () => browser);
});
after(async () => {
    await browser?.close();
    mock.restoreAll();
});

async function call(name, args) {
    const result = await handleToolCall(name, args);
    assert.equal(result.isError, undefined, result.content[0].text);
    return result;
}

// Inject HTML directly because the navigation tool blocks localhost via its SSRF guard.
test('switches to an already opened popup and returns its identity', async () => {
    const page = await newPage();
    await page.setContent('<a href="about:blank#fixture-popup" target="_blank">Open popup</a>');
    const popupPending = page.waitForEvent('popup');
    await page.getByRole('link').click();
    const popup = await popupPending;
    await popup.setContent('<title>Fixture popup</title>');
    const index = page.context().pages().indexOf(popup);
    const result = await call('browser_switch_to_new_tab', { urlPattern: 'fixture-popup', timeout: 500 });
    assert.deepEqual(result.structuredContent, { url: 'about:blank#fixture-popup', title: 'Fixture popup', index });
    assert.equal(await getPage(), popup);
    assert.equal(page.context().pages().length, index + 1);
});

test('waits for a matching popup and leaves other page listeners installed', async () => {
    const page = await newPage();
    await page.setContent(
        '<a href="about:blank#ignored" target="_blank">Ignore</a>' +
        '<a href="about:blank#matching" target="_blank">Match</a>',
    );
    const context = page.context();
    const initialListeners = context.listenerCount('page');
    const pending = call('browser_switch_to_new_tab', { urlPattern: '#matching', timeout: 5000 });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(context.listenerCount('page') > initialListeners);
    await page.getByRole('link', { name: 'Ignore' }).click();
    await page.getByRole('link', { name: 'Match' }).click();
    const { structuredContent } = await pending;
    assert.equal(structuredContent.url, 'about:blank#matching');
    assert.equal(context.pages()[structuredContent.index], await getPage());

    const timedOut = await handleToolCall('browser_switch_to_new_tab', { timeout: 100 });
    assert.equal(timedOut.isError, true);
    assert.match(timedOut.content[0].text, /No new tab appeared/);
    assert.equal(context.listenerCount('page'), initialListeners);
});

test('batch quiz selects the indexed group and counts only changed, verified answers', async () => {
    const page = await newPage();
    await page.setContent(`
        <input type="radio" name="q1" value="3"><input type="radio" name="q1" value="4" disabled>
        <input type="radio" name="q2" value="Paris" onclick="event.preventDefault()"><input type="radio" name="q2" value="Rome">
        <input type="checkbox" name="q3" value="a" checked><input type="checkbox" name="q3" value="b">
    `);
    const partial = await handleToolCall('browser_batch_answer_quiz', { answers: [{ q: 0, option: 0 }, { q: 1, option: 0 }] });
    assert.equal(partial.isError, true);
    assert.match(partial.content[0].text, /Batch answered: 1\/2.*\nUnanswered questions: 1/);
    assert.equal(partial.structuredContent.answered, 1);
    assert.equal(partial.structuredContent.total, 2);
    assert.deepEqual(partial.structuredContent.unanswered, [1]);
    assert.equal(await page.locator('input[name=q1][value="3"]').isChecked(), true);
    assert.equal(await page.locator('input[name=q2]:checked').count(), 0);

    const fixed = await call('browser_batch_answer_quiz', { answers: [{ q: 1, option: 1 }, { q: 2, options: [0, 1] }] });
    assert.equal(fixed.structuredContent.answered, 2);
    assert.deepEqual(fixed.structuredContent.unanswered, []);
    assert.equal(await page.locator('input[name=q2][value="Rome"]').isChecked(), true);
    assert.equal(await page.locator('input[name=q3]:checked').count(), 2);

    const unchanged = await handleToolCall('browser_batch_answer_quiz', {
        answers: [{ q: 0, option: 1 }, { q: 1, option: 1 }, { q: 2, options: [2] }, { q: 3, option: 0 }],
    });
    assert.equal(unchanged.structuredContent.answered, 0);
    assert.deepEqual(unchanged.structuredContent.unanswered, [0, 1, 2, 3]);

    await page.setContent('<p>No questions</p>');
    const empty = await handleToolCall('browser_batch_answer_quiz', { answers: [{ q: 0, option: 0 }] });
    assert.equal(empty.isError, true);
    assert.deepEqual(empty.structuredContent.unanswered, [0]);
    assert.match(empty.structuredContent.errors[0].error, /No radio\/checkbox inputs/);
});

test('batch quiz keeps answering on one page before advancing to the next', async () => {
    const page = await newPage();
    await page.setContent(
        '<input type="radio" name="q1"><input type="radio" name="q2">' +
        '<button onclick="window.firstPage = Array.from(document.querySelectorAll(\'input:checked\'), e => e.name);' +
        'document.body.innerHTML = \'<input type=radio name=q3>\';">Next</button>',
    );
    const result = await call('browser_batch_answer_quiz', { answers: [{ q: 1, option: 0 }, { q: 0, option: 0 }, { q: 0, option: 0 }] });
    assert.equal(result.structuredContent.answered, 3);
    assert.deepEqual(await page.evaluate(() => window.firstPage), ['q1', 'q2']);
    assert.equal(await page.locator('input[name=q3]').isChecked(), true);
});

test('macro export honors format and save and produces a replayable JSON file', async t => {
    const page = await newPage();
    await page.setContent(
        '<input id="name"><button id="submit" onclick="document.querySelector(\'output\').value = document.querySelector(\'input\').value">Submit</button><output></output>',
    );
    const name = `issue-25-${process.pid}`;
    const base = path.resolve(__dirname, '../user_data/macros', name);
    t.after(async () => {
        for (const ext of ['json', 'spec.js']) await fs.rm(`${base}.${ext}`, { force: true });
    });
    await call('browser_record_macro', { action: 'start' });
    await call('browser_type', { selector: '#name', text: 'Fixture', delay: 1 });
    await call('browser_click', { selector: '#submit' });
    const inline = (await call('browser_record_macro', { action: 'export', format: 'json', name, save: false })).structuredContent;
    assert.equal(inline.script, JSON.stringify(recorder.getActions(), null, 2));
    await assert.rejects(fs.stat(`${base}.json`), { code: 'ENOENT' });

    for (const [format, ext] of [['json', 'json'], ['actions', 'json'], ['playwright', 'spec.js']]) {
        const { structuredContent } = await call('browser_record_macro', { action: 'export', format, name, save: true });
        assert.equal(structuredContent.filePath, `${base}.${ext}`);
        assert.equal(structuredContent.actionCount, 2);
        const saved = await fs.readFile(structuredContent.filePath, 'utf8');
        assert.equal(saved, format === 'playwright' ? recorder.generate(name) : inline.script);
    }
    await page.locator('#name').fill('');
    await page.locator('output').evaluate(output => { output.value = ''; });
    await call('browser_replay_macro', { macroName: name, speed: 'fast' });
    assert.equal(await page.locator('#name').inputValue(), 'Fixture');
    assert.equal(await page.locator('output').textContent(), 'Fixture');
});

test('the generated Node script starts at the recording URL and replays typing and clicking', async t => {
    const page = await newPage();
    const fixture = `
        <input id="name"><button id="submit" onclick="document.querySelector('output').textContent = document.querySelector('input').value">Submit</button>
        <output></output>
    `;
    await page.goto(`data:text/html,${encodeURIComponent(fixture)}`);
    await page.setContent(fixture);
    await call('browser_clear_recording');
    await call('browser_type', { selector: '#name', text: "O'Reilly\\fixture", delay: 1 });
    await call('browser_click', { selector: '#submit' });
    recorder.record('assert_text', { selector: 'output', expected: "O'Reilly\\fixture" });

    const dir = await fs.mkdtemp(path.join(__dirname, 'issue-25-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const outputPath = path.join(dir, 'fixture.spec.js');
    const result = await call('browser_generate_playwright_test', { testName: "Fixture's test", outputPath });
    const { stdout } = await promisify(execFile)(process.execPath, [outputPath], { timeout: 15000 });
    assert.match(stdout, /Fixture's test/);
    assert.match(result.content[0].text, /node .*fixture\.spec\.js/);
});

test('catalogue search matches exact and partial tool names case-insensitively', async () => {
    const page = await newPage();
    await page.route('https://duckduckgo.com/**', route => route.abort());
    for (const query of ['browser_switch_to_new_tab', '  SWITCH_TO_NEW  ']) {
        const { structuredContent } = await call('browser_search', { query, scope: 'tools' });
        assert.deepEqual(structuredContent.results.map(result => result.name), ['browser_switch_to_new_tab']);
    }
    const { structuredContent } = await call('browser_search', { query: 'tab', scope: 'tools' });
    assert.ok(structuredContent.results.some(result => result.name === 'browser_list_tabs'));
    assert.ok(structuredContent.results.some(result => result.name === 'browser_switch_to_new_tab'));
    const miss = await call('browser_search', { query: 'missing-tool-fixture', scope: 'tools' });
    assert.deepEqual(miss.structuredContent.results, []);
});
