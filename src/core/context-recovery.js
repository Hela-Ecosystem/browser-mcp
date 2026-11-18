const CLOSED_CONTEXT_MESSAGE = 'Target page, context or browser has been closed';

function isClosedContextError(error) {
    return typeof error?.message === 'string'
        && error.message.includes(CLOSED_CONTEXT_MESSAGE);
}

/**
 * Retry once when the browser context was closed under us.
 *
 * Only the closed-context error is retried: retrying after a successful call
 * could repeat a click or a form submit. A blank page is reported instead, so
 * the caller decides whether to reload.
 */
async function executeWithContextRecovery(operation, reinitialize, isBlankPage = async () => false, warn = console.warn) {
    try {
        const result = await operation();
        if (await isBlankPage()) {
            throw new Error('the browser page is blank (its context was likely closed); reload with browser_navigate and retry');
        }
        return result;
    } catch (error) {
        if (!isClosedContextError(error)) throw error;
    }

    warn('[Browser] Browser context closed; reconnecting and retrying once.');
    await reinitialize();
    return operation();
}

module.exports = { executeWithContextRecovery, isClosedContextError };
