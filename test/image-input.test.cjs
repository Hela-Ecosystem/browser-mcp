const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveImageInput } = require('../src/core/image-input');

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
    const expected = Buffer.from(ONE_PIXEL_PNG, 'base64');
    assert.deepEqual(await resolveImageInput({ imageBase64: ONE_PIXEL_PNG }), expected);
    assert.deepEqual(await resolveImageInput({ imageBase64: `data:image/png;base64,${ONE_PIXEL_PNG}` }), expected);

    const filePath = path.join(os.tmpdir(), `hela-cytosol-image-${process.pid}.png`);
    fs.writeFileSync(filePath, expected);
    try {
        assert.deepEqual(await resolveImageInput({ imagePath: filePath }), expected);
        await assert.rejects(() => resolveImageInput({ imageBase64: 'not-base64' }), /valid base64/);
        await assert.rejects(() => resolveImageInput({ imagePath: filePath, imageBase64: ONE_PIXEL_PNG }), /exactly one/);
        await assert.rejects(() => resolveImageInput({ imageUrl: 'file:///tmp/image.png' }), /Forbidden scheme/);
    } finally {
        fs.rmSync(filePath, { force: true });
    }
    console.log('image-input tests passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
