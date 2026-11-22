'use strict';

/**
 * Read the intrinsic pixel dimensions of an image buffer.
 *
 * Vision backends report boxes against the image they were given, so callers
 * need these dimensions to turn normalised coordinates into pixels. Supports
 * PNG, JPEG, WebP, GIF, and BMP headers without decoding the image body.
 *
 * @param {Buffer} buffer
 * @returns {{width: number, height: number}|null}
 */
function getImageDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;

    const png = readPng(buffer);
    if (png) return png;

    const jpeg = readJpeg(buffer);
    if (jpeg) return jpeg;

    const webp = readWebp(buffer);
    if (webp) return webp;

    const gif = readGif(buffer);
    if (gif) return gif;

    return readBmp(buffer);
}

function validSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
    if (width <= 0 || height <= 0) return null;
    if (width >= 100000 || height >= 100000) return null;
    return { width, height };
}

function readPng(buffer) {
    if (buffer.length < 24) return null;
    const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (!signature.every((byte, index) => buffer[index] === byte)) return null;
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
    return validSize(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

const JPEG_SOF_MARKERS = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9]);

function readJpeg(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

    let offset = 2;
    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xFF) {
            offset++;
            continue;
        }

        let marker = buffer[offset + 1];
        // Fill bytes: 0xFF 0xFF ... <marker>
        while (marker === 0xFF && offset + 2 < buffer.length) {
            offset++;
            marker = buffer[offset + 1];
        }

        if (JPEG_STANDALONE_MARKERS.has(marker) || marker === 0x00) {
            offset += 2;
            continue;
        }
        if (offset + 4 > buffer.length) return null;

        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2) return null;

        if (JPEG_SOF_MARKERS.has(marker)) {
            if (offset + 9 > buffer.length) return null;
            return validSize(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5));
        }

        offset += 2 + segmentLength;
    }

    return null;
}

function readWebp(buffer) {
    if (buffer.length < 30) return null;
    if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
        if (buffer[23] !== 0x9D || buffer[24] !== 0x01 || buffer[25] !== 0x2A) return null;
        return validSize(buffer.readUInt16LE(26) & 0x3FFF, buffer.readUInt16LE(28) & 0x3FFF);
    }
    if (chunk === 'VP8L') {
        if (buffer[20] !== 0x2F) return null;
        const bits = buffer.readUInt32LE(21);
        return validSize((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1);
    }
    if (chunk === 'VP8X') {
        return validSize(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1);
    }
    return null;
}

function readGif(buffer) {
    if (buffer.length < 10) return null;
    const header = buffer.toString('ascii', 0, 6);
    if (header !== 'GIF87a' && header !== 'GIF89a') return null;
    return validSize(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function readBmp(buffer) {
    if (buffer.length < 26) return null;
    if (buffer[0] !== 0x42 || buffer[1] !== 0x4D) return null;
    const width = buffer.readInt32LE(18);
    const height = Math.abs(buffer.readInt32LE(22));
    return validSize(width, height);
}

module.exports = { getImageDimensions };
