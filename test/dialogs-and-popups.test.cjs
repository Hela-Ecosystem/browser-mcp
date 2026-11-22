'use strict';
const assert = require('node:assert/strict');
const { after, before, mock, test } = require('node:test');
const { chromium } = require('playwright');

process.env.BROWSERLESS_URL = 'ws://dialog-fixture.test/chromium';
process.env.BROWSERLESS_FALLBACK_LOCAL = 'false';
const { getBrowserContext, getPage, newPage } = require('../src/core/browser');
const { handleToolCall } = require('../src/tools');

const dialogFixture = `
    <button id="confirm" onclick="document.querySelector('output').value = confirm('Continue?')">Confirm</button>
    <button id="prompt" onclick="document.querySelector('output').value = JSON.stringify(prompt('Name?', 'Default'))">Prompt</button>
    <button id="alert" onclick="alert('Notice'); document.querySelector('output').value = 'done'">Alert</button>
    <output></output>
`;

let browser;
before(async () => {
    browser = await chromium.launch({ headless: true });
    mock.method(chromium, 'connectOverCDP', async () => browser);
});
after(async () => {
    await browser?.close();
    mock.restoreAll();
});

async function call(name, args, page) {
    const result = await handleToolCall(name, args, page);
    assert.equal(result.isError, undefined, result.content[0].text);
    return result;
}

async function clickDialog(page, id) {
    await page.locator(`#${id}`).click({ timeout: 5000 });
    return page.locator('output').textContent();
}

test('native dialogs use the default policy and appear in the page history', async () => {
    const page = await getPage();
    await page.setContent(dialogFixture);

    assert.equal(await clickDialog(page, 'confirm'), 'false');
    assert.equal(await clickDialog(page, 'prompt'), 'null');
    assert.equal(await clickDialog(page, 'alert'), 'done');

    const { structuredContent } = await call('browser_list_dialogs');
    assert.deepEqual(structuredContent.dialogs, [
        { type: 'confirm', message: 'Continue?', action: 'dismiss' },
        { type: 'prompt', message: 'Name?', action: 'dismiss' },
        { type: 'alert', message: 'Notice', action: 'accept' },
    ]);
});

test('the default beforeunload action keeps the page open', async () => {
    const page = await newPage();
    await page.setContent(`
        <button>Activate page</button>
        <script>
            window.addEventListener('beforeunload', event => event.preventDefault());
        </script>
    `);
    await page.getByRole('button').click({ timeout: 5000 });

    await assert.rejects(page.goto('data:text/html,Destination', { timeout: 5000 }), /ERR_ABORTED/);
    assert.equal(await page.getByRole('button').count(), 1);
    const { structuredContent } = await call('browser_list_dialogs', {}, page);
    assert.deepEqual(structuredContent.dialogs, [{ type: 'beforeunload', message: '', action: 'dismiss' }]);
});

test('browser_dialog replaces the next action and supplies prompt text', async () => {
    const page = await newPage();
    await page.setContent(dialogFixture);

    await call('browser_dialog', { action: 'accept' }, page);
    const dismiss = await call('browser_dialog', { action: 'dismiss' }, page);
    assert.match(dismiss.content[0].text, /dismiss/);
    assert.equal(await clickDialog(page, 'confirm'), 'false');

    const accept = await call('browser_dialog', { action: 'accept' }, page);
    assert.match(accept.content[0].text, /accept/);
    assert.equal(await clickDialog(page, 'confirm'), 'true');
    assert.equal(await clickDialog(page, 'confirm'), 'false', 'the override applies once');

    for (const promptText of ['Grace', '']) {
        await call('browser_dialog', { action: 'accept', promptText }, page);
        assert.equal(await clickDialog(page, 'prompt'), JSON.stringify(promptText));
    }
    assert.equal(page.listenerCount('dialog'), 1);
});

test('the context installs one handler per tab and keeps their policies independent', async () => {
    const first = await newPage();
    const second = await (await getBrowserContext()).newPage();
    await first.setContent(dialogFixture);
    await second.setContent(dialogFixture);
    await call('browser_dialog', { action: 'accept' }, first);

    assert.equal(await clickDialog(second, 'confirm'), 'false');
    assert.equal(await clickDialog(first, 'confirm'), 'true');
    assert.equal(second.listenerCount('dialog'), 1);
    const { structuredContent } = await call('browser_list_dialogs', {}, second);
    assert.deepEqual(structuredContent.dialogs, [{ type: 'confirm', message: 'Continue?', action: 'dismiss' }]);
});

test('dismiss_popups clicks and reports only visible close or reject controls', async () => {
    const page = await newPage();
    await page.setContent(`
        <div class="swal2-popup" role="alertdialog">
            <button class="swal2-confirm" aria-label="Close">Confirm deletion</button>
            <button class="swal2-close" hidden>Close</button>
            <button class="swal2-cancel">Cancel deletion</button>
        </div>
        <div role="dialog">
            <button data-bs-dismiss="modal">Accept all</button>
            <button>Only necessary</button>
        </div>
        <div aria-modal="true">
            <button>Accept all</button><button>Reject</button>
        </div>
        <script>
            window.clicked = [];
            document.addEventListener('click', event => window.clicked.push(event.target.textContent));
        </script>
    `);

    const result = await call('browser_dismiss_popups', {}, page);
    assert.equal(result.content[0].text, 'Dismissed: Cancel deletion, Only necessary, Reject');
    assert.deepEqual(await page.evaluate(() => window.clicked), ['Cancel deletion', 'Only necessary', 'Reject']);
});

test('dismiss_popups prefers SweetAlert close and reports when no safe control exists', async () => {
    const page = await newPage();
    await page.setContent(`
        <div class="swal2-popup" role="dialog">
            <button class="swal2-confirm">Close</button>
            <button class="swal2-cancel">Cancel</button>
            <button class="swal2-close" aria-label="Close">×</button>
        </div>
        <script>
            window.clicked = [];
            document.addEventListener('click', event => window.clicked.push(event.target.textContent));
        </script>
    `);

    const closed = await call('browser_dismiss_popups', {}, page);
    assert.equal(closed.content[0].text, 'Dismissed: ×');
    await page.locator('.swal2-close, .swal2-cancel').evaluateAll(buttons => buttons.forEach(button => button.remove()));
    const none = await call('browser_dismiss_popups', {}, page);
    assert.equal(none.content[0].text, 'No popup close or reject controls found.');
    assert.deepEqual(await page.evaluate(() => window.clicked), ['×']);
});
