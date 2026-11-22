'use strict';
const assert = require('node:assert/strict');
const { after, before, mock, test } = require('node:test');
const { chromium } = require('playwright');

process.env.BROWSERLESS_URL = 'ws://issue-26-fixture.test/chromium';
process.env.BROWSERLESS_FALLBACK_LOCAL = 'false';
const { newPage } = require('../src/core/browser');
const mirage = require('../src/core/mirage');
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

async function jsonPayload(name, args) {
    return JSON.parse((await call(name, args)).content[0].text);
}

// localhost is SSRF-blocked, so every fixture is injected with setContent.

test('extract_schema reads JSON-LD and tables before the h1 heuristic', async () => {
    const page = await newPage();
    await page.setContent(`
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Fixture Widget",
          "offers": { "@type": "Offer", "price": "9.99", "priceCurrency": "USD" }
        }
        </script>
        <h1>Cytosol Fixture</h1>
        <table>
            <tr><th>Fruit</th><th>Qty</th></tr>
            <tr><td>Pear</td><td>5</td></tr>
        </table>
    `);

    const schema = {
        properties: {
            productName: { type: 'string', description: 'product name' },
            price: { type: 'number', description: 'price in dollars' },
            pearQty: { type: 'number', description: 'quantity of pears' },
            heading: { type: 'string', description: 'page heading' },
        },
    };
    assert.deepEqual(await jsonPayload('browser_extract_schema', { schema }), {
        productName: 'Fixture Widget',
        price: 9.99,
        pearQty: 5,
        heading: 'Cytosol Fixture',
    });
});

test('extract_schema reads itemprop microdata and keeps the heuristic fallback', async () => {
    const page = await newPage();
    await page.setContent(`
        <div itemscope itemtype="https://schema.org/Product">
            <span itemprop="name">Micro Widget</span>
            <meta itemprop="price" content="12.50">
        </div>
        <h1>Micro Fixture</h1>
    `);
    assert.deepEqual(await jsonPayload('browser_extract_schema', {
        schema: { properties: { name: { type: 'string' }, price: { type: 'number' }, heading: { type: 'string', description: 'heading' } } },
    }), { name: 'Micro Widget', price: 12.5, heading: 'Micro Fixture' });

    await page.setContent('<h1>Plain Heading</h1><p>No structured data here.</p>');
    assert.deepEqual(await jsonPayload('browser_extract_schema', {
        schema: { properties: { heading: { type: 'string', description: 'heading' } } },
    }), { heading: 'Plain Heading' });
});

test('emulate sets navigator.language and Accept-Language, not only Intl', async () => {
    const page = await newPage();
    await page.setContent('<title>Locale fixture</title><p>locale</p>');

    let acceptLanguage;
    await page.route('https://issue-26.test/**', async route => {
        acceptLanguage = route.request().headers()['accept-language'];
        await route.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } });
    });

    const reply = (await call('browser_emulate', { locale: 'fr-FR', timezoneId: 'Asia/Tokyo', colorScheme: 'dark' })).content[0].text;
    assert.match(reply, /navigator\.language=fr-FR/);
    assert.doesNotMatch(reply, /successfully applied/);

    const env = await page.evaluate(() => ({
        language: navigator.language,
        languages: navigator.languages,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
    }));
    assert.equal(env.language, 'fr-FR');
    assert.equal(env.languages[0], 'fr-FR');
    assert.equal(env.timezone, 'Asia/Tokyo');
    assert.equal(env.dark, true);

    await page.evaluate(() => fetch('https://issue-26.test/probe').then(response => response.text()));
    assert.match(acceptLanguage || '', /^fr-FR/);
});

test('emulate reports an error instead of success when navigator.language stays unset', async () => {
    const page = await newPage();
    await page.setContent('<p>locale probe</p>');
    const originalEvaluate = page.evaluate.bind(page);
    try {
        page.evaluate = async (fn, arg) => {
            const source = typeof fn === 'function' ? fn.toString() : '';
            if (source.includes('navigator.userAgent')) return 'FixtureUA';
            if (source.includes('navigator.language')) return '';
            return originalEvaluate(fn, arg);
        };
        const result = await handleToolCall('browser_emulate', { locale: 'fr-FR' });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /navigator\.language is unset/);
    } finally {
        page.evaluate = originalEvaluate;
    }
});

test('visual_analyze emits normalised bbox plus pixels and flags low-confidence OCR', async t => {
    const page = await newPage();
    await page.setContent('<h1>HELLO OCR 4271</h1>');
    const fixture = {
        scene: 'fixture scene',
        text: [{ string: 'ELLOOCR 4271', bbox: [62, 240, 220, 302], score: 0.47 }],
        objects: [{ label: 'heading', bbox: [100, 200, 800, 260], score: 0.9 }],
    };
    t.mock.method(mirage, 'analyze', async () => structuredClone(fixture));

    const result = (await call('browser_visual_analyze', {})).structuredContent;
    assert.equal(result.coordinateSpace, 'normalised-0-1');
    assert.ok(result.image.width > 0 && result.image.height > 0);

    const box = result.text[0];
    assert.deepEqual(box.bbox.map(value => Math.round(value * 1000) / 1000), [0.062, 0.24, 0.22, 0.302]);
    for (const coordinate of box.bbox) assert.ok(coordinate >= 0 && coordinate <= 1);
    assert.ok(box.bboxPx[2] <= result.image.width && box.bboxPx[3] <= result.image.height);
    for (const [index, dimension] of [[0, result.image.width], [1, result.image.height], [2, result.image.width], [3, result.image.height]]) {
        assert.ok(Math.abs(box.bboxPx[index] - box.bbox[index] * dimension) < 0.01);
    }

    assert.equal(result.ocrQuality.engine, 'mirage');
    assert.match(result.ocrQuality.warning, /browser_ocr/);
    assert.deepEqual(result.ocrQuality.lowConfidenceLines, [{ text: 'ELLOOCR 4271', score: 0.47 }]);
});

test('handle_captcha verify on a page without a CAPTCHA is not an error', async () => {
    const page = await newPage();
    await page.setContent('<h1>No CAPTCHA here</h1><p>Plain fixture page.</p>');
    const result = await call('browser_handle_captcha', { verify: true });
    assert.match(result.content[0].text, /No CAPTCHA present/);
});

test('get_state reports checked state, radio names, and every text block', async () => {
    const page = await newPage();
    await page.setContent(`
        <form>
            <input type="checkbox" name="agree" checked>
            <input type="radio" name="plan" value="4" checked>
            <input type="radio" name="plan" value="5">
        </form>
        <div>Hi</div>
        <section>
            <h2>Section heading</h2>
            <span>Inline text block</span>
            <p>First paragraph block.</p>
            <p>Second paragraph block.</p>
            <dl><dd>Definition block</dd></dl>
        </section>
    `);

    const state = await jsonPayload('browser_get_state', {});
    for (const block of ['Hi', 'Section heading', 'Inline text block', 'First paragraph block.', 'Second paragraph block.', 'Definition block']) {
        assert.ok(state.textBlocks.includes(block), `missing text block: ${block}`);
        assert.ok(state.text.includes(block), `text field missing block: ${block}`);
    }

    const checkbox = state.elements.find(el => el.inputType === 'checkbox');
    assert.equal(checkbox.name, 'agree');
    assert.equal(checkbox.checked, true);

    const radios = state.elements.filter(el => el.inputType === 'radio');
    assert.equal(radios.length, 2);
    assert.ok(radios.every(radio => radio.name === 'plan'));
    assert.equal(radios.find(radio => radio.value === '4').checked, true);
    assert.equal(radios.find(radio => radio.value === '5').checked, false);
});

test('switch_tab out of range is an error', async () => {
    await newPage();
    const result = await handleToolCall('browser_switch_tab', { index: 999 });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no such tab/);
});

test('replacing a mock intercept with block warns instead of silently swapping', async t => {
    const pattern = `**/issue-26-intercept-${process.pid}.json`;
    t.after(() => handleToolCall('browser_clear_intercepts'));
    await call('browser_intercept', { pattern, action: 'mock', body: { ok: true } });

    const replaced = (await call('browser_intercept', { pattern, action: 'block' })).content[0].text;
    assert.match(replaced, /Warning: replaced the existing "mock" rule/);
    const listed = (await call('browser_intercept_list', {})).content[0].text;
    assert.match(listed, new RegExp(`\\[block\\] ${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('cache_stats reports a real hit count', async () => {
    const page = await newPage();
    const label = `Cache Fixture ${process.pid}`;
    await page.setContent(`<button onclick="window.clicked = (window.clicked || 0) + 1">${label}</button>`);

    const beforeStats = await jsonPayload('browser_cache_stats', {});
    assert.equal(typeof beforeStats.hits, 'number');

    await call('browser_click', { text: label });
    const second = (await call('browser_click', { text: label })).content[0].text;
    assert.match(second, /cache hit/);

    const afterStats = await jsonPayload('browser_cache_stats', {});
    assert.ok(afterStats.hits > beforeStats.hits, `expected hit count to grow: ${beforeStats.hits} -> ${afterStats.hits}`);
    assert.equal(await page.evaluate(() => window.clicked), 2);
});
