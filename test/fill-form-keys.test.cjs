// browser_observe hands back `ref` and `name`, never CSS. Passing those straight
// into browser_fill_form used to miss and then block on Playwright's 30s locator
// timeout, so the observe -> fill path failed in the slowest possible way.
const assert = require('node:assert/strict');
const { resolveFieldSelector, TOOLS } = require('../src/tools/index');
const { storeElementRefs } = require('../src/core/state');

// A page whose querySelector only knows the fields a real form would expose.
const present = new Set(['[name="comments"]', '#notes', 'textarea', '[name="odd\\"name"]']);
const page = {
    async evaluate(fn, selector) {
        if (typeof selector !== 'string') throw new Error('selector must be a string');
        return present.has(selector);
    },
};

(async () => {
    storeElementRefs([
        { ref: 1, tag: 'TEXTAREA', name: 'comments' },
        { ref: 2, tag: 'INPUT', id: 'notes' },
        { ref: 3, tag: 'INPUT', name: 'ghost' },
    ]);

    // A bare name, exactly as browser_observe prints it.
    assert.equal(await resolveFieldSelector(page, 'comments'), '[name="comments"]');

    // A bare id.
    assert.equal(await resolveFieldSelector(page, 'notes'), '#notes');

    // A ref number resolves through the stored observe result.
    assert.equal(await resolveFieldSelector(page, '1'), '[name="comments"]');
    assert.equal(await resolveFieldSelector(page, '2'), '#notes');

    // Existing CSS selectors keep working unchanged.
    assert.equal(await resolveFieldSelector(page, '[name="comments"]'), '[name="comments"]');
    assert.equal(await resolveFieldSelector(page, 'textarea'), 'textarea');

    // Quotes in a name must not break out of the attribute selector.
    storeElementRefs([{ ref: 1, tag: 'INPUT', name: 'odd"name' }]);
    assert.equal(await resolveFieldSelector(page, '1'), '[name="odd\\"name"]');

    // Nothing matched: resolve to null so the caller can fail fast rather than
    // handing an unmatched selector to page.fill and waiting out the timeout.
    assert.equal(await resolveFieldSelector(page, 'ghost'), null);
    assert.equal(await resolveFieldSelector(page, '.missing'), null);

    // The schema has to advertise what the keys now accept.
    const tool = TOOLS.find(t => t.name === 'browser_fill_form');
    assert.match(tool.inputSchema.properties.data.description, /ref|name|id/i);

    console.log('fill-form key resolution: ok');
})();
