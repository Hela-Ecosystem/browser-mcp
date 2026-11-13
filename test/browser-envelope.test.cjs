const assert = require('node:assert/strict');
const {
  SERVER_NAME, sideEffectsFor, isEnvelopeEnabled,
  wrapResult, wrapError, withEnvelope, appendWarning, errorResult,
} = require('../src/envelope.js');

const KEYS = ['ok','summary','data','artifacts','provenance','warnings','sideEffects','execution','redaction'];
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

delete process.env['HELA_ENVELOPE'];
t('flag off by default; passthrough returns identical reference', () => {
  assert.equal(isEnvelopeEnabled(), false);
  const raw = { content: [{ type: 'text', text: 'hi' }] };
  assert.equal(withEnvelope('browser_click', raw), raw);
});
t('off-mode errorResult preserves legacy shape incl. key order', () => {
  const r = errorResult('browser_click', 'boom');
  assert.equal(JSON.stringify(r), JSON.stringify({
    isError: true,
    content: [{ type: 'text', text: 'Error: boom' }],
  }));
});
t('off-mode appendWarning adds a visible trailing block', () => {
  const r = appendWarning({ content: [{ type: 'text', text: 'ok' }] }, 'legacy alias');
  assert.equal(r.content.length, 2);
  assert.equal(r.content[1].text, 'Warning: legacy alias');
  const raw = { content: [{ type: 'text', text: 'ok' }] };
  assert.equal(appendWarning(raw, undefined), raw);
});

process.env['HELA_ENVELOPE'] = 'true';
t('on-mode envelope has all 9 keys', () => {
  const env = JSON.parse(withEnvelope('browser_navigate', { content: [{ type: 'text', text: 'Navigated.' }] }).content[0].text);
  for (const k of KEYS) assert.ok(k in env, `missing ${k}`);
  assert.equal(env.ok, true);
  assert.equal(env.data, 'Navigated.');
  assert.equal(env.execution.serverName, SERVER_NAME);
  assert.deepEqual(env.sideEffects, ['browser-act']);
});
t('reads declare none, captures/exports declare', () => {
  for (const tool of ['browser_get_state','browser_list_tabs','browser_extract_table','browser_observe','browser_assert','browser_health','browser_wait']) {
    assert.deepEqual(sideEffectsFor(tool), [], tool);
  }
  assert.deepEqual(sideEffectsFor('browser_screenshot'), ['browser-capture']);
  for (const tool of ['browser_print_to_pdf','browser_export_state','browser_save_session']) {
    assert.deepEqual(sideEffectsFor(tool), ['browser-export'], tool);
  }
});
t('image blocks preserved (screenshot Sources text enveloped, image kept)', () => {
  const raw = { content: [
    { type: 'text', text: 'Sources: x' },
    { type: 'image', data: 'abc', mimeType: 'image/png' },
  ]};
  const out = withEnvelope('browser_screenshot', raw);
  assert.equal(out.content.length, 2);
  assert.deepEqual(JSON.parse(out.content[0].text).sideEffects, ['browser-capture']);
  assert.deepEqual(out.content[1], raw.content[1]);
});
t('isError results map to ok:false, flag kept', () => {
  const out = withEnvelope('browser_navigate', { isError: true, content: [{ type: 'text', text: 'Failed: x' }] });
  assert.equal(out.isError, true);
  const env = JSON.parse(out.content[0].text);
  assert.equal(env.ok, false);
  assert.equal(env.error, 'Failed: x');
});
t('wrapping is idempotent (no double envelope)', () => {
  const once = withEnvelope('browser_click', { content: [{ type: 'text', text: 'Clicked.' }] });
  const twice = withEnvelope('browser_click', once);
  assert.equal(twice.content[0].text, once.content[0].text);
});
t('JSON text parsed into data', () => {
  const out = withEnvelope('browser_get_cookies', { content: [{ type: 'text', text: '{"a":1}' }] });
  assert.deepEqual(JSON.parse(out.content[0].text).data, { a: 1 });
});
t('on-mode appendWarning lands in envelope warnings', () => {
  const out = withEnvelope('browser_click', { content: [{ type: 'text', text: 'Clicked.' }] });
  const warned = appendWarning(out, 'legacy alias');
  assert.deepEqual(JSON.parse(warned.content[0].text).warnings, ['legacy alias']);
});
t('run/step ids propagate', () => {
  process.env['HELA_RUN_ID'] = 'r1';
  process.env['HELA_STEP_ID'] = 's2';
  assert.equal(wrapResult('browser_click', 'x').execution.run_id, 'r1');
  assert.equal(wrapError('browser_click', 'e').execution.step_id, 's2');
});
console.log(`\n${n} tests passed`);
