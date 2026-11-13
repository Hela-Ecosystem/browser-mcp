const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { validateURL, resolveAndValidate, isPrivateIP } = require('../src/utils/url-validator');
const { checkOutputPath, safeFilename, PolicyDeniedError } = require('../src/utils/path-guard');
const { handleToolCall } = require('../src/tools/index');

let n = 0;
const t = (name, fn) => {
    try {
        fn();
        n++;
        console.log(`ok ${n} - ${name}`);
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

const asyncT = async (name, fn) => {
    try {
        await fn();
        n++;
        console.log(`ok ${n} - ${name}`);
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

(async () => {
    // ── 1. URL & DNS SSRF Validation ──
    t('isPrivateIP identifies private ranges and loopbacks', () => {
        assert.equal(isPrivateIP('127.0.0.1'), true);
        assert.equal(isPrivateIP('10.0.0.1'), true);
        assert.equal(isPrivateIP('192.168.1.1'), true);
        assert.equal(isPrivateIP('172.16.0.1'), true);
        assert.equal(isPrivateIP('169.254.169.254'), true);
        assert.equal(isPrivateIP('::1'), true);
        assert.equal(isPrivateIP('fe80::1'), true);
        assert.equal(isPrivateIP('fc00::1'), true);
        assert.equal(isPrivateIP('8.8.8.8'), false);
        assert.equal(isPrivateIP('1.1.1.1'), false);
    });

    t('validateURL blocks dangerous schemes and hostnames', () => {
        assert.throws(() => validateURL('file:///etc/passwd'), /Forbidden scheme|Unsupported scheme/);
        assert.throws(() => validateURL('javascript:alert(1)'), /Forbidden scheme|Unsupported scheme/);
        assert.throws(() => validateURL('data:text/html,evil'), /Forbidden scheme|Unsupported scheme/);
        assert.throws(() => validateURL('http://admin:secret@example.com'), /credentials/);
        assert.throws(() => validateURL('http://127.0.0.1/status'), /blocked/);
        assert.throws(() => validateURL('http://localhost:8080/'), /blocked/);
        assert.throws(() => validateURL('http://169.254.169.254/latest/meta-data'), /blocked/);
        assert.doesNotThrow(() => validateURL('https://example.com/api'));
    });

    await asyncT('resolveAndValidate blocks DNS rebinding to loopback/private IPs', async () => {
        await assert.rejects(
            async () => resolveAndValidate('localhost'),
            /blocked|Private|private IP/
        );
        await assert.rejects(
            async () => resolveAndValidate('127.0.0.1'),
            /blocked|Private|private IP/
        );
    });

    // ── 2. Path Guard & Workspace Containment ──
    t('safeFilename rejects traversal components and null bytes', () => {
        assert.throws(() => safeFilename('../escape'), /directory traversal/);
        assert.throws(() => safeFilename('foo/bar'), /directory traversal/);
        assert.throws(() => safeFilename('foo\\bar'), /directory traversal/);
        assert.throws(() => safeFilename(''), /Invalid name/);
        assert.throws(() => safeFilename('..'), /directory traversal/);
        assert.equal(safeFilename('valid-session_01'), 'valid-session_01');
    });

    t('checkOutputPath blocks system paths by default', () => {
        assert.throws(() => checkOutputPath('/etc/shadow'), PolicyDeniedError);
        assert.throws(() => checkOutputPath('/bin/sh'), PolicyDeniedError);
        assert.throws(() => checkOutputPath('/usr/bin/node'), PolicyDeniedError);
        assert.doesNotThrow(() => checkOutputPath(path.join(__dirname, 'test-output.json')));
    });

    t('checkOutputPath enforces HELA_ALLOWED_ROOTS when set', () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hela-root-'));
        try {
            process.env.HELA_ALLOWED_ROOTS = tmpRoot;
            assert.doesNotThrow(() => checkOutputPath(path.join(tmpRoot, 'file.pdf')));
            assert.throws(() => checkOutputPath(path.join(__dirname, 'outside.json')), PolicyDeniedError);
            assert.throws(() => checkOutputPath(path.join(tmpRoot, '../escape.json')), PolicyDeniedError);
        } finally {
            delete process.env.HELA_ALLOWED_ROOTS;
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    // ── 3. Tool Env Gates & Session Mode ──
    await asyncT('browser_evaluate is blocked without HELA_BROWSER_ALLOW_EVAL=true', async () => {
        delete process.env.HELA_BROWSER_ALLOW_EVAL;
        const res = await handleToolCall('browser_evaluate', { script: '1 + 1' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /HELA_BROWSER_ALLOW_EVAL=true/);
    });

    await asyncT('browser_assert (js) is blocked without HELA_BROWSER_ALLOW_EVAL=true', async () => {
        delete process.env.HELA_BROWSER_ALLOW_EVAL;
        const res = await handleToolCall('browser_assert', { condition: '1 === 1', conditionType: 'js' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /HELA_BROWSER_ALLOW_EVAL=true/);
    });

    await asyncT('browser_save_session rejects directory traversal in name', async () => {
        const res = await handleToolCall('browser_save_session', { name: '../../evil_session' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /Invalid session name/);
    });

    await asyncT('browser_load_session rejects directory traversal in name', async () => {
        const res = await handleToolCall('browser_load_session', { name: '../../evil_session' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /Invalid session name/);
    });

    console.log(`\nAll ${n} cytosol-safety tests passed.`);
    const { closeBrowser } = require('../src/core/browser');
    await closeBrowser().catch(() => {});
    process.exit(0);
})();
