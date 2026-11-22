'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const WIDTH = 640;
const HEIGHT = 240;

function pngHeader(width, height) {
    const buffer = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

const screenshot = pngHeader(WIDTH, HEIGHT);
const page = Object.assign(new EventEmitter(), {
    url: () => 'https://example.test/vision',
    screenshot: async () => screenshot,
    evaluate: async () => [],
});

const browser = require('../src/core/browser');
browser.getPage = async () => page;

const mirage = require('../src/core/mirage');
const visionFixture = {
    scene: 'fixture scene',
    text: [
        { string: 'HELAOCR TEST 4821', bbox: [62, 240, 220, 302], score: 0.74 },
        { string: 'second line: Surabaya +41%', bbox: [57, 492, 268, 557], score: 0.805 },
    ],
    objects: [
        { label: 'button', bbox: [500, 100, 900, 300], score: 0.9 },
    ],
};
mirage.analyze = async () => structuredClone(visionFixture);

require('../src/core/image-input').resolveImageInput = async () => screenshot;

const tesseract = require('tesseract.js');
tesseract.recognize = async () => ({
    data: {
        text: 'HELAOCR TEST 4821',
        confidence: 74.4,
        lines: [
            { text: 'HELAOCR TEST 4821', confidence: 74, bbox: { x0: 40, y0: 58, x1: 141, y1: 72 } },
        ],
    },
});

const { handleToolCall } = require('../src/tools');
const { getImageDimensions } = require('../src/utils/image-dimensions');
const { applyImageUnits } = require('../src/utils/image-boxes');

async function payload(name, args) {
    const result = await handleToolCall(name, args);
    assert.equal(result.isError, undefined, `${name} failed: ${result.content?.[0]?.text}`);
    return result.structuredContent;
}

function assertBoxUnits(box, width, height) {
    for (const coordinate of box.bbox) {
        assert.ok(coordinate >= 0 && coordinate <= 1, `bbox ${coordinate} is not normalised`);
    }
    assert.equal(box.bbox.length, 4);
    assert.equal(box.bboxPx.length, 4);
    // The contract callers rely on: normalised x times image width is pixel x.
    assert.equal(box.bbox[0] * width, box.bboxPx[0]);
    assert.ok(Math.abs(box.bbox[1] * height - box.bboxPx[1]) < 0.01);
    assert.ok(Math.abs(box.bbox[2] * width - box.bboxPx[2]) < 0.01);
    assert.ok(Math.abs(box.bbox[3] * height - box.bboxPx[3]) < 0.01);
}

test('PNG dimensions are read from the header without decoding the image', () => {
    assert.deepEqual(getImageDimensions(pngHeader(WIDTH, HEIGHT)), { width: WIDTH, height: HEIGHT });
});

test('image_analyze returns normalised bbox plus pixel bbox for a known image size', async () => {
    const result = await payload('browser_image_analyze', {});

    assert.deepEqual(result.image, { width: WIDTH, height: HEIGHT });
    assert.equal(result.coordinateSpace, 'normalised-0-1');

    const [firstLine, secondLine] = result.text;
    assert.equal(firstLine.bbox[0], 0.062);
    assert.equal(firstLine.bboxPx[0], 39.68);
    assert.equal(firstLine.bbox[0] * WIDTH, firstLine.bboxPx[0]);
    assert.ok(Math.abs(firstLine.bbox[1] * HEIGHT - firstLine.bboxPx[1]) < 0.01);

    assertBoxUnits(firstLine, WIDTH, HEIGHT);
    assertBoxUnits(secondLine, WIDTH, HEIGHT);
    assertBoxUnits(result.objects[0], WIDTH, HEIGHT);

    // No pixel coordinate may escape the image it describes.
    for (const box of [...result.text, ...result.objects]) {
        assert.ok(box.bboxPx[0] >= 0 && box.bboxPx[2] <= WIDTH);
        assert.ok(box.bboxPx[1] >= 0 && box.bboxPx[3] <= HEIGHT);
    }
});

test('visual_analyze applies the same units to page screenshots', async () => {
    const result = await payload('browser_visual_analyze', {});

    assert.deepEqual(result.image, { width: WIDTH, height: HEIGHT });
    assert.equal(result.coordinateSpace, 'normalised-0-1');
    assert.equal(result.objects[0].bbox[0], 0.5);
    assert.equal(result.objects[0].bboxPx[0], 500 * WIDTH / 1000);
    assertBoxUnits(result.text[0], WIDTH, HEIGHT);
});

test('OCR line boxes are normalised and mirrored in pixels', async () => {
    const result = await payload('browser_ocr', { preprocess: 'none' });

    assert.deepEqual(result.image, { width: WIDTH, height: HEIGHT });
    assert.equal(result.coordinateSpace, 'normalised-0-1');
    assert.equal(result.lines.length, 1);
    assert.deepEqual(result.lines[0].bboxPx, [40, 58, 141, 72]);
    assert.equal(result.lines[0].bbox[0] * WIDTH, result.lines[0].bboxPx[0]);
    assert.equal(result.lines[0].bbox[1], 58 / HEIGHT);
});

test('boxes already in 0..1 are not divided by the backend 1000 scale', () => {
    const result = applyImageUnits({ objects: [{ bbox: [0.25, 0.25, 0.5, 0.5] }] }, { width: 400, height: 200 });
    assert.deepEqual(result.objects[0].bbox, [0.25, 0.25, 0.5, 0.5]);
    assert.deepEqual(result.objects[0].bboxPx, [100, 50, 200, 100]);
});
