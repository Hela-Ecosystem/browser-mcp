'use strict';
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { shapeCookies, cookiesForPage, resolveUploadPaths } = require('../src/utils/cookie-scope.js');

const JAR = [
  { name: 'sid', value: 'secret-token', domain: 'app.example', path: '/' },
  { name: 'other', value: 'other-secret', domain: 'bank.example', path: '/' },
];

(async () => {
  // browser-mcp#22: values are redacted unless explicitly requested.
  {
    const shaped = shapeCookies(JAR);
    assert.deepEqual(shaped.map(c => c.value), ['[redacted]', '[redacted]']);
    assert.ok(shaped.every(c => c.valueRedacted === true));
    const clear = shapeCookies(JAR, { includeValues: true });
    assert.equal(clear[0].value, 'secret-token');
    assert.ok(clear.every(c => c.valueRedacted === false));
    console.log('ok 1 - cookie values redacted by default');
  }

  // Only the active page's cookies are requested from the context.
  {
    const asked = [];
    const context = { cookies: async (url) => { asked.push(url); return JAR.filter(c => c.domain === 'app.example'); } };
    const result = await cookiesForPage(context, 'https://app.example/dashboard');
    assert.deepEqual(asked, ['https://app.example/dashboard']);
    assert.equal(result.scope, 'active-page');
    assert.deepEqual(result.cookies.map(c => c.domain), ['app.example']);
    console.log('ok 2 - active page scope, not the whole jar');
  }

  // No origin means no cookies rather than the profile.
  {
    const context = { cookies: async () => JAR };
    const result = await cookiesForPage(context, 'about:blank');
    assert.deepEqual(result.cookies, []);
    assert.match(result.reason, /no http\(s\) origin/);
    console.log('ok 3 - about:blank returns nothing, not the profile');
  }

  // allDomains is explicit and still redacts unless asked.
  {
    const context = { cookies: async () => JAR };
    const result = await cookiesForPage(context, 'https://app.example', { allDomains: true });
    assert.equal(result.scope, 'profile');
    assert.equal(result.cookies.length, 2);
    assert.equal(result.cookies[0].value, '[redacted]');
    assert.match(result.warning, /profile-wide/);
    console.log('ok 4 - profile scope requires the explicit flag and still redacts');
  }

  // Uploads stay inside the workspace.
  {
    const root = mkdtempSync(join(tmpdir(), 'upload-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'upload-outside-'));
    try {
      mkdirSync(join(root, 'assets'), { recursive: true });
      writeFileSync(join(root, 'assets', 'logo.txt'), 'ok');
      writeFileSync(join(outside, 'id_rsa'), 'private');
      const [inside] = resolveUploadPaths([join(root, 'assets', 'logo.txt')], { cwd: root, allowAny: false });
      assert.equal(inside, join(root, 'assets', 'logo.txt'));
      assert.throws(
        () => resolveUploadPaths([join(outside, 'id_rsa')], { cwd: root, allowAny: false }),
        /outside the workspace roots/,
      );
      assert.throws(
        () => resolveUploadPaths([join(root, '..', 'escape.txt')], { cwd: root, allowAny: false }),
        /does not exist|outside the workspace roots/,
      );
      symlinkSync(join(outside, 'id_rsa'), join(root, 'assets', 'link'));
      assert.throws(
        () => resolveUploadPaths([join(root, 'assets', 'link')], { cwd: root, allowAny: false }),
        /outside the workspace roots/,
      );
      console.log('ok 5 - upload refuses traversal, outside paths and symlinks');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }

  console.log('\n5 cookie/upload checks passed');
})().catch(error => { console.error(error); process.exit(1); });
