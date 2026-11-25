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

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

/** True for a cookie whose value was masked by shapeCookies (or by an older save). */
function isRedactedCookie(cookie) {
    return !!cookie && (cookie.valueRedacted === true || cookie.value === REDACTED_COOKIE_VALUE);
}

/**
 * Cookies as they are written to a saved session. The session file is mode 600 and
 * scoped to the active page, and its only job is to be loaded back, so it keeps the
 * real values; redaction applies to what the tools *return*, not to what they persist
 * (browser-mcp#22: a redacted save followed by load_session overwrote live cookies).
 */
function cookiesForStorage(cookies) {
    return (cookies || []).map(({ valueRedacted, ...cookie }) => cookie);
}

/**
 * Split a saved session's cookies into those that can be restored and those that
 * cannot because their value was masked (sessions saved before this fix).
 */
function cookiesForLoad(cookies) {
    const usable = [];
    let skippedRedacted = 0;
    for (const cookie of cookies || []) {
        if (isRedactedCookie(cookie)) { skippedRedacted++; continue; }
        const { valueRedacted, ...rest } = cookie;
        usable.push(rest);
    }
    return { usable, skippedRedacted };
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

const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.gpg', '.kube', '.docker', '.config', '.azure', '.password-store']);
const SENSITIVE_FILES = [
    /^\.env/i, /^\.netrc$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.git-credentials$/i,
    /^id_(rsa|dsa|ecdsa|ed25519)$/i, /^\.(bash|zsh|python|node|mysql|psql)_history$/i,
];
const SENSITIVE_PREFIXES = ['/etc/', '/proc/', '/sys/', '/dev/'];

/**
 * Credential and system locations that stay off-limits for uploads even inside the
 * workspace roots. A root of `/` (or $HOME) makes the roots check allow everything,
 * so this list is what actually protects ~/.ssh and friends (browser-mcp#22).
 */
function sensitiveUploadReason(resolved) {
    const normalized = resolved.split(path.sep).join('/');
    for (const prefix of SENSITIVE_PREFIXES) {
        if (normalized.startsWith(prefix)) return `system path (${prefix.slice(0, -1)})`;
    }
    const parts = normalized.split('/').filter(Boolean);
    const dir = parts.slice(0, -1).find(part => SENSITIVE_DIRS.has(part));
    if (dir) return `credential or config directory (${dir})`;
    const base = parts[parts.length - 1] || '';
    if (SENSITIVE_FILES.some(re => re.test(base))) return `credential file (${base})`;
    return null;
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
        // Inside the roots is not enough: a root of `/` or $HOME contains credentials too.
        const sensitive = sensitiveUploadReason(resolved);
        if (sensitive) {
            throw new Error(`upload path '${resolved}' is a protected ${sensitive}; set HELA_BROWSER_UPLOAD_ANY=true to override`);
        }
        return resolved;
    });
}

/**
 * Write `data` to `dest` owner-only (0600), atomically. The bytes go to a fresh 0600
 * temp file beside the destination and are renamed over it, so an existing 0644 file
 * is replaced rather than chmod'd by path, and a failure never leaves secrets behind
 * under the old permissions (browser-mcp#22).
 */
function writePrivateFile(dest, data) {
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    let fd;
    try {
        fd = fs.openSync(tmp, 'wx', 0o600);
        fs.writeFileSync(fd, data);
        fs.fchmodSync(fd, 0o600);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, dest);
    } catch (error) {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(tmp, { force: true });
        throw error;
    }
}

/** Where saved sessions live; HELA_SESSIONS_DIR overrides the in-repo default. */
function sessionsDir() {
    return process.env.HELA_SESSIONS_DIR
        ? path.resolve(process.env.HELA_SESSIONS_DIR)
        : path.join(__dirname, '../../sessions');
}

module.exports = {
    writePrivateFile,
    sessionsDir,
    shapeCookies,
    cookiesForPage,
    cookiesForStorage,
    cookiesForLoad,
    isRedactedCookie,
    resolveUploadPaths,
    sensitiveUploadReason,
    REDACTED_COOKIE_VALUE,
};
