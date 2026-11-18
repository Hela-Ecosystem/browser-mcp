const assert = require('node:assert/strict');
const { executeWithContextRecovery } = require('../src/core/context-recovery');


let page;
let pageId = 0;
const makeContext = () => ({
    newPage() {
        const id = ++pageId;
        page = {
            async title() {
                if (id === 1) throw new Error('Target page, context or browser has been closed');
                return 'ready';
            },
        };
        return page;
    },
});

(async () => {
    let context = makeContext();
    context.newPage();
    let warnings = 0;
    let calls = 0;
    let reconnects = 0;

    const result = await executeWithContextRecovery(
        async () => {
            calls++;
            return await page.title();
        },
        async () => {
            reconnects++;
            context = makeContext();
            context.newPage();
        },
        async () => false,
        () => warnings++,
    );

    assert.equal(result, 'ready');
    assert.equal(calls, 2);
    assert.equal(reconnects, 1);
    assert.equal(warnings, 1);

    calls = 0;
    await assert.rejects(
        executeWithContextRecovery(
            async () => { calls++; throw new Error('navigation failed'); },
            async () => assert.fail('must not reconnect for unrelated errors'),
            async () => false,
        ),
        /navigation failed/,
    );
    assert.equal(calls, 1);
    console.log('context recovery tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// A blank page must not be retried: the previous call may already have acted.
void (async () => {
    let calls = 0;
    await assert.rejects(
        executeWithContextRecovery(
            async () => { calls++; return 'ok'; },
            async () => assert.fail('must not reconnect for a blank page'),
            async () => true,
            () => {},
        ),
        /blank/,
    );
    assert.equal(calls, 1, 'the operation must not run twice');
    console.log('context recovery blank-page guard passed');
})();
