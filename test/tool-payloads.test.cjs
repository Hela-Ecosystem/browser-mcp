'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
const browser = require('../src/core/browser');
const mirage = require('../src/core/mirage');
const recorder = require('../src/core/recorder');

const largeText = 'fixture text '.repeat(300);
const image = Buffer.from('fixture image');
const page = Object.assign(new EventEmitter(), {
    url: () => 'https://example.test/dashboard',
    locator: () => ({ first: () => ({ textContent: async () => 'Fixture heading', isVisible: async () => false }) }),
    screenshot: async () => image,
    evaluate: async () => [],
    waitForTimeout: async () => {},
});
const namedPages = new Map(['audit-a', 'audit-b'].map(name => [name, {
    evaluate: async () => `Read from ${name}`,
    isClosed: () => false,
    url: () => `https://example.test/${name}`,
}]));
browser.getPage = async () => page;
browser.getNamedPage = name => namedPages.get(name);
browser.switchToNamedPage = async name => namedPages.has(name);
require('../src/utils/path-guard').checkOutputPath = filePath => filePath;
require('../src/core/image-input').resolveImageInput = async () => image;
require('tesseract.js').recognize = async () => ({ data: { text: largeText.trim(), confidence: 93.2 } });
const vision = { scene: largeText, objects: [{ label: 'fixture' }] };
mirage.analyze = async () => vision;

const { handleToolCall } = require('../src/tools');
const { withEnvelope } = require('../src/envelope');

async function call(name, args, summary, isError = false) {
    const raw = await handleToolCall(name, args);
    const wire = JSON.parse(JSON.stringify(raw));
    const parsed = CallToolResultSchema.parse(wire);
    assert.ok(parsed.structuredContent, `${name} must expose its payload`);
    assert.equal(parsed.isError === true, isError, name);
    assert.match(parsed.content[0].text, summary);
    for (const block of wire.content.filter(block => block.type === 'text')) {
        assert.ok(Object.keys(block).every(key => ['type', 'text', 'annotations', '_meta'].includes(key)), name);
        assert.ok(block.text.length <= 2000, `${name} text exceeds the cap`);
    }
    return parsed.structuredContent;
}

test('text and URL assertions expose both passing and failing diagnostics', async () => {
    const cases = [
        [{ type: 'text', target: 'h1', expected: 'Fixture' }, { found: true, context: 'Fixture heading' }],
        [{ type: 'text', target: 'h1', expected: 'absent' }, { found: false, text: 'Fixture heading' }],
        [{ type: 'url', target: '/dashboard' }, { match: true, url: page.url() }],
        [{ type: 'url', target: '/absent' }, { match: false, url: page.url() }],
    ];
    for (const [args, payload] of cases) {
        const passed = payload.found ?? payload.match;
        assert.deepEqual(await call('browser_assert', args, passed ? /^\[PASS\]/ : /^\[FAIL\]/, !passed), payload);
    }
    const invisible = await handleToolCall('browser_assert', { type: 'visible', target: 'h1' });
    assert.equal(invisible.isError, true);
});

test('capture stop, get, and retrieval expose the full response and honor clearAfter', async t => {
    const url = 'https://example.test/api/item';
    const body = { description: largeText };
    const pattern = '**/api/**';
    await handleToolCall('browser_intercept_api', { action: 'start', pattern });
    await page.listeners('response')[0]({ url: () => url, headers: () => ({ 'content-type': 'application/json' }), status: () => 200, json: async () => body });

    const stopped = await call('browser_intercept_api', { action: 'stop', pattern }, /1 responses captured/);
    const response = stopped.responses[0];
    assert.deepEqual(response, { url, body, status: 200, contentType: 'application/json', timestamp: response.timestamp });
    assert.deepEqual(await call('browser_intercept_api', { action: 'get', pattern: '/api/' }, /1 API responses/), stopped);
    assert.deepEqual(await call('browser_intercept_api', { action: 'get', pattern: '/missing' }, /0 API responses/), { responses: [] });

    const previousEnvelope = process.env.HELA_ENVELOPE;
    process.env.HELA_ENVELOPE = 'true';
    t.after(() => {
        if (previousEnvelope === undefined) delete process.env.HELA_ENVELOPE;
        else process.env.HELA_ENVELOPE = previousEnvelope;
    });
    const raw = await handleToolCall('browser_get_captured_apis');
    assert.deepEqual(CallToolResultSchema.parse(withEnvelope('browser_get_captured_apis', raw)).structuredContent, stopped);
    assert.deepEqual(await call('browser_get_captured_apis', { clearAfter: true }, /1 API responses/), stopped);
    assert.deepEqual(await call('browser_get_captured_apis', {}, /0 API responses/), { responses: [] });
});

test('macro stop, save, list, and export expose their payloads', async t => {
    const name = 'payload-fixture';
    await handleToolCall('browser_record_macro', { action: 'start' });
    recorder.record('fill', { selector: '#fixture', value: largeText });
    const actions = recorder.getActions();

    assert.deepEqual(await call('browser_record_macro', { action: 'list' }, /1 actions in buffer/), { actions });
    assert.deepEqual(await call('browser_record_macro', { action: 'stop', format: 'json' }, /1 actions recorded/), {
        actions, script: JSON.stringify(actions, null, 2),
    });
    const exported = await call('browser_record_macro', { action: 'export', name }, /^#!\/usr\/bin\/env node/);
    assert.equal(exported.script, recorder.generate(name));
    assert.ok(exported.script.includes(largeText));

    t.mock.method(fs, 'mkdirSync', () => {});
    const write = t.mock.method(fs, 'writeFileSync', () => {});
    const saved = await call('browser_record_macro', { action: 'stop', name, format: 'json', save: true }, /Macro saved:/);
    assert.deepEqual(saved, { filePath: path.resolve(__dirname, `../user_data/macros/${name}.json`), actionCount: 1 });
    assert.deepEqual(write.mock.calls[0].arguments, [saved.filePath, JSON.stringify(actions, null, 2)]);
});

test('replay exposes action diagnostics and marks failed actions as errors', async () => {
    const actions = [
        { tool: 'browser_assert', args: { type: 'url', target: '/dashboard' } },
        { tool: 'browser_assert', args: { type: 'url', target: '/missing' } },
    ];
    assert.deepEqual(await call('browser_replay_macro', { actions }, /2 actions \(1 succeeded\)/, true), {
        results: [
            { action: 'browser_assert', success: true },
            { action: 'browser_assert', error: '[FAIL] URL does not contain "/missing"' },
        ],
    });
    assert.deepEqual(await call('browser_replay_macro', { actions, dryRun: true }, /2 actions/, false), {
        results: actions.map(({ tool, args }) => ({ action: tool, args, dryRun: true })),
    });
    assert.deepEqual(await call('browser_replay_macro', { actions: actions.slice(0, 1) }, /1 actions \(1 succeeded\)/), {
        results: [{ action: 'browser_assert', success: true }],
    });
});

test('parallel results retain each action response from its named page', async () => {
    const actions = [{ tool: 'browser_get_content', args: { format: 'text', selector: 'h1' } }];
    const tasks = ['audit-a', 'audit-b', 'missing'].map(page => ({ page, actions }));
    const { results } = await call('browser_parallel_execute', { tasks }, /audit-a: 1\/1 ok/, true);
    for (const result of results.slice(0, 2)) {
        assert.deepEqual(result.results, [{
            action: 'browser_get_content', success: true,
            result: { content: [{ type: 'text', text: `Read from ${result.page}` }] },
        }]);
    }
    assert.deepEqual(results.map(result => result.page), ['audit-a', 'audit-b', 'missing']);
    assert.deepEqual(results[2], { page: 'missing', error: 'Page "missing" not found', results: [] });

    const [task] = (await call('browser_parallel_execute', {
        tasks: [{ page: 'audit-a', actions: [{ tool: 'browser_assert', args: { type: 'url', target: '/missing' } }] }],
    }, /audit-a: 0\/1 ok/, true)).results;
    const [action] = task.results;
    assert.equal(action.success, false);
    assert.equal(action.result.isError, true);
    assert.deepEqual(action.result.structuredContent, { match: false, url: namedPages.get('audit-a').url() });
});

test('OCR and both visual analysis tools preserve large results beyond the text cap', async () => {
    const ocr = await call('browser_ocr', { preprocess: 'none', returnImage: true }, /^fixture text/);
    assert.deepEqual(ocr, { text: largeText.trim(), confidence: 93, language: 'eng', preprocessing: 'none', image: image.toString('base64') });
    for (const name of ['browser_visual_analyze', 'browser_image_analyze']) {
        assert.deepEqual(await call(name, {}, /"scene"/), vision);
    }
});

test('batch quiz results expose failure details with an error flag', async t => {
    t.mock.method(page, 'evaluate', async () => ({ groupCount: 0, error: 'No radio/checkbox inputs found' }));
    assert.deepEqual(await call('browser_batch_answer_quiz', { answers: [{ q: 4, option: 1 }] }, /Batch answered: 0\/1/, true), {
        answered: 0, total: 1, unanswered: [4], errors: [{ q: 4, error: 'No radio/checkbox inputs found' }], pages: [],
    });
});
