const assert = require('node:assert/strict');
const http = require('node:http');
const { sideEffectsFor } = require('../src/envelope.js');

process.env['BROWSERLESS_URL'] = '';
process.env['BROWSER_WS_ENDPOINT'] = '';
process.env['BROWSER_URL'] = '';
process.env['BROWSER_HEADLESS'] = 'true';
process.env['ALLOW_PRIVATE_IPS'] = 'true';

const OLD_NAMES = [
  'browser_click_text', 'browser_click_nth', 'browser_click_ref',
  'browser_double_click', 'browser_right_click',
  'browser_get_text', 'browser_get_html', 'browser_get_visible_text',
  'browser_get_page_markdown', 'browser_get_accessibility_tree',
  'browser_wait_until_stable', 'browser_wait_for_load',
  'browser_wait_for_selector', 'browser_wait_for_url',
  'browser_wait_for_navigation', 'browser_wait_for_change',
  'browser_assert_visible', 'browser_assert_text', 'browser_assert_url',
  'browser_scroll_to', 'browser_smart_scroll',
];

const NEW_NAMES = [
  'browser_click', 'browser_get_content', 'browser_wait',
  'browser_assert', 'browser_scroll',
];

const { TOOLS, handleToolCall } = require('../src/tools');

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok ${n} - ${name}`); };
const text = (r) => {
  assert.ok(!r.isError, r.content?.[0]?.text);
  return r.content[0].text;
};

const html = `<!doctype html>
<html><body style="min-height:3000px">
<main id="main">
  <h1>Hello</h1>
  <p id="intro">ready</p>
  <div id="hidden" style="display:none">SECRET</div>
  <button id="btn" onclick="document.getElementById('output').textContent='clicked'">Click me now</button>
  <button id="dbl" ondblclick="document.getElementById('output').textContent='double'">Double</button>
  <button id="ctx" oncontextmenu="event.preventDefault();document.getElementById('output').textContent='context'">Context</button>
  <button class="pick" data-id="A" onclick="document.getElementById('pick').textContent=this.dataset.id">A</button>
  <button class="pick" data-id="B" onclick="document.getElementById('pick').textContent=this.dataset.id">B</button>
  <div id="output">ready</div>
  <div id="pick">none</div>
  <input aria-label="Name" />
</main>
<div id="bottom" style="margin-top:2000px">Bottom</div>
</body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  await t('registry advertises 73 tools with all five consolidated names', () => {
    assert.equal(TOOLS.length, 73);
    const names = TOOLS.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length);
    for (const name of NEW_NAMES) assert.ok(names.includes(name), name);
    for (const name of OLD_NAMES) assert.ok(!names.includes(name), name);
  });

  await t('consolidated tools declare the intended side effects', () => {
    for (const name of ['browser_get_content', 'browser_wait', 'browser_assert']) {
      assert.deepEqual(sideEffectsFor(name), [], name);
    }
    assert.deepEqual(sideEffectsFor('browser_click'), ['browser-act']);
    assert.deepEqual(sideEffectsFor('browser_scroll'), ['browser-act']);
  });

  await t('browser_get_content exposes markdown, text, html, visible, and axtree', async () => {
    text(await handleToolCall('browser_navigate', { url }));
    assert.match(text(await handleToolCall('browser_get_content', { format: 'markdown', selector: '#main' })), /# Hello/);
    assert.equal(text(await handleToolCall('browser_get_content', { format: 'text', selector: '#intro' })), 'ready');
    assert.match(text(await handleToolCall('browser_get_content', { format: 'html', selector: '#main' })), /<h1>Hello<\/h1>/);
    const visible = text(await handleToolCall('browser_get_content', { format: 'visible', selector: '#main' }));
    assert.match(visible, /ready/);
    assert.doesNotMatch(visible, /SECRET/);
    assert.match(text(await handleToolCall('browser_get_content', { format: 'axtree', selector: '#main' })), /button/);
  });

  await t('browser_click covers text, nth, double, right, and count', async () => {
    assert.match(text(await handleToolCall('browser_click', { text: 'Click me' })), /Clicked .*Click me/);
    assert.equal(text(await handleToolCall('browser_get_content', { format: 'text', selector: '#output' })), 'clicked');
    await handleToolCall('browser_click', { selector: '.pick', nth: 1 });
    assert.equal(text(await handleToolCall('browser_get_content', { format: 'text', selector: '#pick' })), 'B');
    await handleToolCall('browser_click', { selector: '#dbl', count: 2 });
    assert.equal(text(await handleToolCall('browser_get_content', { format: 'text', selector: '#output' })), 'double');
    await handleToolCall('browser_click', { selector: '#ctx', button: 'right' });
    assert.equal(text(await handleToolCall('browser_get_content', { format: 'text', selector: '#output' })), 'context');
  });

  await t('browser_wait handles time, selector, url, load, and stable conditions', async () => {
    text(await handleToolCall('browser_wait', { condition: 'time', ms: 10 }));
    assert.equal(text(await handleToolCall('browser_wait', { condition: 'selector', target: '#output' })), 'Selector #output is visible.');
    assert.equal(text(await handleToolCall('browser_wait', { condition: 'url', target: '/' })), 'URL matches pattern.');
    text(await handleToolCall('browser_wait', { condition: 'load', state: 'domcontentloaded' }));
    assert.equal(text(await handleToolCall('browser_wait', { condition: 'stable' })), 'Page state is stable.');
  });

  await t('browser_assert covers text, url, and visible checks', async () => {
    assert.match(text(await handleToolCall('browser_assert', { type: 'text', target: '#output', expected: 'context' })), /\[PASS\]/);
    assert.match(text(await handleToolCall('browser_assert', { type: 'url', target: '/' })), /\[PASS\]/);
    assert.match(text(await handleToolCall('browser_assert', { type: 'visible', target: '#intro' })), /\[PASS\]/);
  });

  await t('browser_scroll covers by, to, and lazy modes', async () => {
    text(await handleToolCall('browser_scroll', { mode: 'by', amount: 200 }));
    assert.equal(text(await handleToolCall('browser_scroll', { mode: 'to', x: 0, y: 0 })), 'Scrolled to target.');
    text(await handleToolCall('browser_scroll', { mode: 'to', selector: '#bottom' }));
    assert.equal(text(await handleToolCall('browser_scroll', { mode: 'lazy', steps: 2, delayMs: 10 })), 'Smart scroll completed (2 steps).');
  });

  await t('deprecated names remain callable through hidden aliases', async () => {
    assert.match(text(await handleToolCall('browser_click_text', { text: 'Click me' })), /Clicked/);
    assert.equal(text(await handleToolCall('browser_get_text', { selector: '#output' })), 'clicked');
    assert.match(text(await handleToolCall('browser_assert_text', { selector: '#output', expected: 'clicked' })), /\[PASS\]/);
    assert.match(text(await handleToolCall('browser_assert', { condition: '#output', expected: 'clicked' })), /Assert passed/);
    assert.equal(text(await handleToolCall('browser_wait_for_selector', { selector: '#output' })), 'Selector #output is visible.');
    assert.equal(text(await handleToolCall('browser_scroll_to', { x: 0, y: 0 })), 'Scrolled to target.');
    assert.match(text(await handleToolCall('browser_get_page_markdown', { selector: '#main' })), /# Hello/);
  });

  await handleToolCall('browser_close', {}).catch(() => {});
  server.close();
  console.log(`\nAll ${n} tool-consolidation tests passed.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
