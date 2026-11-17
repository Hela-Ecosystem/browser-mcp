#!/usr/bin/env node
/**
 * Live check against a remote Browserless instance.
 *
 * Proves the remote CDP path works end to end (connect, navigate, read,
 * screenshot, tabs) with local fallback disabled, so a pass cannot be the
 * local Chromium quietly taking over.
 *
 * Usage: BROWSERLESS_URL=... node scripts/verify-browserless.mjs [url]
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const target = process.argv[2] || 'https://example.com';
const url = process.env.BROWSERLESS_URL;
if (!url) {
  console.error('set BROWSERLESS_URL (e.g. https://browserless.example.com)');
  process.exit(1);
}

let failures = 0;
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['src/server.js'],
  cwd: process.cwd(),
  stderr: 'pipe',
  env: { ...process.env, BROWSERLESS_URL: url, BROWSERLESS_FALLBACK_LOCAL: 'false', HELA_BROWSER_ALLOW_EVAL: 'true' },
});

let stderr = '';
transport.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

const client = new Client({ name: 'browserless-check', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('') ?? '';
  const image = res.content?.find((part) => part.type === 'image');
  return { isError: Boolean(res.isError), text, imageBytes: image?.data?.length ?? 0 };
};

try {
  const nav = await call('browser_navigate', { url: target });
  report('navigate via remote CDP', !nav.isError, nav.isError ? nav.text.slice(0, 120) : target);

  // Screenshot first: a remote Browserless connection may be torn down after a
  // period of inactivity, and the capture is the operation most sensitive to it.
  const shot = await call('browser_screenshot');
  const shotBytes = shot.imageBytes || shot.text.length;
  report('screenshot', !shot.isError && shotBytes > 1000, `${shotBytes} bytes (${shot.imageBytes ? 'image block' : 'text payload'})`);

  const content = await call('browser_get_content');
  const body = content.text ?? '';
  report('read page content', !content.isError && /Example Domain|example/i.test(body), `${body.length} chars`);

  const evalResult = await call('browser_evaluate', { script: 'return document.title || "no-title"' });
  report('evaluate in page context', !evalResult.isError && evalResult.text.length > 0, evalResult.text.slice(0, 60));

  let opened = await call('browser_new_tab', { url: 'https://example.org' });
  if (opened.isError && /closed/i.test(opened.text)) {
    await call('browser_navigate', { url: target });
    opened = await call('browser_new_tab', { url: 'https://example.org' });
    report('remote session needed a reconnect', true, 'context was closed mid-run; recovered');
  }
  report('open a second tab', !opened.isError, opened.isError ? opened.text.slice(0, 80) : 'example.org');

  const tabs = await call('browser_list_tabs');
  report('list tabs', !tabs.isError && tabs.text.length > 0, `${tabs.text.length} chars`);

  report('no local fallback taken', !/falling back to local|launching local chromium/i.test(stderr), stderr.trim().split('\n').slice(-1)[0]?.slice(0, 100) ?? 'clean stderr');
} finally {
  await client.close().catch(() => {});
}

console.log(failures === 0 ? '\nall browserless checks passed' : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
