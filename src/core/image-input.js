'use strict';

const fs = require('node:fs');
const { checkInputPath } = require('../utils/path-guard');
const { validateURL, resolveAndValidate } = require('../utils/url-validator');

const MAX_IMAGE_BYTES = Math.max(1024, Number.parseInt(process.env.HELA_CYTOSOL_MIRAGE_MAX_IMAGE_BYTES || `${12 * 1024 * 1024}`, 10));
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.HELA_CYTOSOL_IMAGE_FETCH_TIMEOUT_MS || '30000', 10));
const allowPrivateIPs = process.env.ALLOW_PRIVATE_IPS === 'true';

function assertImageSize(buffer) {
    if (!buffer.length) throw new Error('Image input is empty');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Image exceeds the limit of ${MAX_IMAGE_BYTES} bytes`);
    return buffer;
}

function decodeBase64(value) {
    const raw = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
    if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) {
        throw new Error('imageBase64 must contain valid base64 image data');
    }
    return assertImageSize(Buffer.from(raw, 'base64'));
}

async function readResponse(response) {
    const length = Number.parseInt(response.headers.get('content-length') || '', 10);
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) throw new Error(`Remote image exceeds the limit of ${MAX_IMAGE_BYTES} bytes`);
    if (!response.body) return assertImageSize(Buffer.from(await response.arrayBuffer()));

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error(`Remote image exceeds the limit of ${MAX_IMAGE_BYTES} bytes`);
        }
        chunks.push(Buffer.from(value));
    }
    return assertImageSize(Buffer.concat(chunks, total));
}

async function fetchImage(urlString, redirects = 0) {
    validateURL(urlString, { allowPrivate: allowPrivateIPs });
    const parsed = new URL(urlString);
    await resolveAndValidate(parsed.hostname, { allowPrivate: allowPrivateIPs });
    if (redirects > MAX_REDIRECTS) throw new Error(`Remote image exceeded the ${MAX_REDIRECTS}-redirect limit`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(parsed, { redirect: 'manual', signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error(`Remote image redirect ${response.status} has no Location header`);
            return fetchImage(new URL(location, parsed).toString(), redirects + 1);
        }
        if (!response.ok) throw new Error(`Remote image request failed with HTTP ${response.status}`);
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
            throw new Error(`Remote resource is not an image: ${contentType}`);
        }
        return readResponse(response);
    } finally {
        clearTimeout(timeout);
    }
}

async function resolveImageInput(args = {}) {
    const sources = [args.imagePath, args.imageUrl, args.imageBase64].filter(value => value !== undefined && value !== null && value !== '');
    if (sources.length !== 1) throw new Error('Provide exactly one of imagePath, imageUrl, or imageBase64');
    if (args.imagePath !== undefined) return assertImageSize(fs.readFileSync(checkInputPath(args.imagePath)));
    if (args.imageUrl !== undefined) return fetchImage(args.imageUrl);
    return decodeBase64(args.imageBase64);
}

module.exports = { resolveImageInput };
