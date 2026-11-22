'use strict';

/*
 * Cookie scoping/redaction and upload path containment (browser-mcp#22).
 *
 * The persistent profile jar holds every site the profile ever logged into.
 * Handing that to whichever page the agent is driving turns a prompt-injected
 * page into session theft, so the default is the active page's cookies with
 * values redacted. Uploads are read into the page, so the default allowlist is
 * the workspace rather than the whole disk.
 */

const path = require('path');
const { checkInputPath, getWorkspaceRoots } = require('./path-guard');

const REDACTED_COOKIE_VALUE = '[redacted]';

/** Shape cookies for output: redact values unless explicitly requested. */
function shapeCookies(cookies, { includeValues = false } = {}) {
    return (cookies || []).map(cookie => ({
        ...cookie,
        value: includeValues ? cookie.value : REDACTED_COOKIE_VALUE,
        valueRedacted: !includeValues,
    }));
}

/**
 * Cookies visible to `url`. With no http(s) origin (about:blank, file:) there is
 * no page scope, so nothing is returned instead of the whole profile.
 */
async function cookiesForPage(context, url, { allDomains = false, includeValues = false } = {}) {
    const pageUrl = typeof url === 'string' ? url : '';
    const scoped = !allDomains && /^https?:/i.test(pageUrl);
    if (!allDomains && !scoped) {
        return {
            cookies: [],
            scope: 'active-page',
            reason: 'the active page has no http(s) origin',
        };
    }
    const cookies = scoped ? await context.cookies(pageUrl) : await context.cookies();
    return {
        cookies: shapeCookies(cookies, { includeValues }),
        scope: scoped ? 'active-page' : 'profile',
        ...(scoped ? {} : { warning: 'profile-wide cookie scope requested explicitly' }),
    };
}

/**
 * Resolve upload paths, refusing anything that is not a regular file inside the
 * workspace roots. `HELA_BROWSER_UPLOAD_ANY=true` is the explicit escape hatch.
 */
function resolveUploadPaths(filePaths, { cwd = process.cwd(), allowAny = process.env.HELA_BROWSER_UPLOAD_ANY === 'true' } = {}) {
    const roots = getWorkspaceRoots() ?? [cwd];
    return filePaths.map(filePath => {
        const resolved = checkInputPath(filePath);
        if (allowAny) return resolved;
        const inside = roots.some(root => {
            const rel = path.relative(root, resolved);
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        });
        if (!inside) {
            throw new Error(`upload path '${resolved}' is outside the workspace roots (${roots.join(', ')}); set HELA_BROWSER_UPLOAD_ANY=true or add it to HELA_ALLOWED_ROOTS`);
        }
        return resolved;
    });
}

module.exports = { shapeCookies, cookiesForPage, resolveUploadPaths, REDACTED_COOKIE_VALUE };
