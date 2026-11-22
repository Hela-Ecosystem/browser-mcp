/*
 * Copyright (c) 2026 Azzar Budiyanto / LilyOpenCMS.
 * Licensed under the MIT License.
 * Contact: azzar.mr.zs@gmail.com for inquiries.
 *
 * Record browser actions for macro replay and standalone Playwright scripts.
 */
const actions = [];
let startUrl;

function record(type, args) {
    actions.push({ type, args, ts: Date.now() });
}

function clear(url) {
    actions.length = 0;
    startUrl = url;
}

function clickStep(type, args) {
    const options = JSON.stringify({ button: args.button, clickCount: args.count });
    if (args.fallback || (args.selector && (args.x === undefined || args.ref !== undefined))) {
        const locator = `page.locator(${JSON.stringify(args.fallback || args.selector)})`;
        const index = args.nth ?? args.index;
        const target = index === undefined ? `${locator}.first()` : `${locator}.nth(${JSON.stringify(index)})`;
        return `await ${target}.click(${options});`;
    }
    if (args.x !== undefined && args.y !== undefined) {
        return `await page.mouse.click(${JSON.stringify(args.x)}, ${JSON.stringify(args.y)}, ${options});`;
    }
    if (type === 'click_text' || args.text !== undefined) {
        const base = args.elType === 'button' ? 'button, [role="button"]' : args.elType === 'link' ? 'a' : '*';
        return `await page.locator(${JSON.stringify(base)}).filter({ hasText: ${JSON.stringify(args.text)} }).first().click(${options});`;
    }
}

function renderAction({ type, args }) {
    const locator = `page.locator(${JSON.stringify(args.selector)}).first()`;
    switch (type) {
        case 'navigate':
            return `await page.goto(${JSON.stringify(args.url)});`;
        case 'click':
        case 'click_selector':
        case 'click_text':
        case 'click_coords':
        case 'click_ref':
            return clickStep(type, args);
        case 'type':
            return `await ${locator}.pressSequentially(${JSON.stringify(args.text)});`;
        case 'fill':
            return `await ${locator}.fill(${JSON.stringify(args.value)});`;
        case 'press':
            return `await page.keyboard.press(${JSON.stringify(args.key)});`;
        case 'select':
            return `await ${locator}.selectOption(${JSON.stringify(args.value)});`;
        case 'check':
            return `await ${locator}.check();`;
        case 'uncheck':
            return `await ${locator}.uncheck();`;
        case 'wait_for_selector':
            return `await ${locator}.waitFor();`;
        case 'wait_for_url':
            return `await page.waitForURL(${JSON.stringify(args.pattern)});`;
        case 'assert_url':
            return `assert.equal(page.url(), ${JSON.stringify(args.pattern)});`;
        case 'assert_text':
            return `assert.ok((await ${locator}.textContent()).includes(${JSON.stringify(args.expected)}));`;
    }
}

function generate(testName = 'recorded_session', fallbackUrl) {
    const steps = actions.map(renderAction).filter(Boolean);
    if (!steps.length) return null;

    const initialUrl = startUrl || fallbackUrl;
    if (initialUrl && !steps[0].startsWith('await page.goto(')) {
        steps.unshift(`await page.goto(${JSON.stringify(initialUrl)});`);
    }

    return [
        '#!/usr/bin/env node',
        '// Run with node <filename>. Install Playwright in the containing project with npm install playwright.',
        '// Install its browser with npx playwright install chromium.',
        '(async () => {',
        "    const { chromium } = await import('playwright');",
        "    const { default: assert } = await import('node:assert/strict');",
        "    const { test } = await import('node:test');",
        `    await test(${JSON.stringify(testName)}, async () => {`,
        '        const browser = await chromium.launch({ headless: true });',
        '        try {',
        '            const page = await browser.newPage();',
        ...steps.map(step => `            ${step}`),
        '        } finally {',
        '            await browser.close();',
        '        }',
        '    });',
        '})().catch(error => {',
        '    console.error(error);',
        '    process.exitCode = 1;',
        '});',
        '',
    ].join('\n');
}

function getActions() { return actions.slice(); }

module.exports = { record, clear, generate, getActions };
