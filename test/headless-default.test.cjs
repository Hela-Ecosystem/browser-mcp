const assert = require('node:assert');
const { resolveHeadless } = require('../src/core/browser.js');

// Explicit values always win.
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: 'true', DISPLAY: ':0' }), true);
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: 'false', DISPLAY: ':0' }), false);
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: '1' }), true);
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: 'on', DISPLAY: ':0' }), true);

// Unset or empty falls back to display detection.
assert.strictEqual(resolveHeadless({}), true, 'no DISPLAY means headless');
assert.strictEqual(resolveHeadless({ DISPLAY: ':0' }), false, 'a display means headful');
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: '', DISPLAY: ':0' }), false, 'empty is unset');
assert.strictEqual(resolveHeadless({ BROWSER_HEADLESS: '   ' }), true, 'blank is unset');

console.log('headless default tests passed');
