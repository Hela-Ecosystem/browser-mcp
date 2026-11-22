'use strict';

/**
 * Vision backends (Mirage, Tesseract) report boxes in three different spaces:
 * normalised 0-1000, normalised 0-1, and raw pixels. Every tool response in
 * this server uses one explicit space instead:
 *
 *   bbox       normalised 0-1 against image.width x image.height
 *   bboxPx     the same box multiplied by those dimensions
 *   image      the pixel dimensions the boxes refer to
 *
 * Callers that act on a box (browser_click, crops, overlays) use bboxPx.
 */

const NORMALISED_SPACE = 'normalised-0-1';
const NORMALISED_BACKEND_SCALE = 1000;

function clampUnit(value) {
    return Math.min(1, Math.max(0, value));
}

function isBoxArray(value) {
    return Array.isArray(value)
        && value.length === 4
        && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isNormalisedBackendBox(box) {
    return box.some(coordinate => Math.abs(coordinate) > 1);
}

function normaliseArrayBox(box) {
    const scale = isNormalisedBackendBox(box) ? NORMALISED_BACKEND_SCALE : 1;
    return box.map(coordinate => clampUnit(coordinate / scale));
}

function pixelBox(box, dimensions) {
    return [
        box[0] * dimensions.width,
        box[1] * dimensions.height,
        box[2] * dimensions.width,
        box[3] * dimensions.height,
    ];
}

function walk(node, visit, seen = new WeakSet()) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
        node.forEach(entry => walk(entry, visit, seen));
        return;
    }

    visit(node);
    Object.values(node).forEach(entry => walk(entry, visit, seen));
}

/**
 * Rewrite every `bbox` array in a vision result as normalised 0-1 and add the
 * equivalent `bboxPx` when the source dimensions are known.
 *
 * @param {object} result Vision result, mutated in place.
 * @param {{width: number, height: number}|null} dimensions
 * @returns {number} Number of boxes rewritten.
 */
function annotateBBoxes(result, dimensions) {
    if (!result || typeof result !== 'object') return 0;

    let count = 0;
    walk(result, node => {
        if (!isBoxArray(node.bbox)) return;
        node.bbox = normaliseArrayBox(node.bbox);
        if (dimensions) node.bboxPx = pixelBox(node.bbox, dimensions);
        count++;
    });
    return count;
}

/**
 * Apply the response-level coordinate contract after annotating boxes.
 * Adds `image` and `coordinateSpace` when boxes exist (or when `always` is set
 * and dimensions are known).
 */
function applyImageUnits(result, dimensions, { always = false } = {}) {
    const count = annotateBBoxes(result, dimensions);
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

    if (count > 0 || (always && dimensions)) result.coordinateSpace = NORMALISED_SPACE;
    if (dimensions && (count > 0 || always)) {
        result.image = { width: dimensions.width, height: dimensions.height };
    }
    return result;
}

/**
 * Tesseract exposes line boxes on `data.lines` when blocks are requested; older
 * output shapes nest them under blocks -> paragraphs -> lines.
 */
function extractOcrLines(data) {
    if (Array.isArray(data?.lines)) return data.lines;
    if (!Array.isArray(data?.blocks)) return [];
    return data.blocks.flatMap(block =>
        (block?.paragraphs ?? []).flatMap(paragraph => paragraph?.lines ?? []));
}

/**
 * Convert Tesseract line boxes (raw pixels) to the server convention.
 *
 * @param {Array<object>} lines Tesseract `data.lines`
 * @param {{width: number, height: number}} dimensions
 */
function normaliseOcrLines(lines, dimensions) {
    return lines.flatMap(line => {
        const box = line?.bbox;
        if (!box || !['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(box[key]))) return [];

        const bboxPx = [box.x0, box.y0, box.x1, box.y1];
        return [{
            text: line.text,
            confidence: line.confidence,
            bbox: [
                clampUnit(box.x0 / dimensions.width),
                clampUnit(box.y0 / dimensions.height),
                clampUnit(box.x1 / dimensions.width),
                clampUnit(box.y1 / dimensions.height),
            ],
            bboxPx,
        }];
    });
}

module.exports = {
    NORMALISED_SPACE,
    annotateBBoxes,
    applyImageUnits,
    extractOcrLines,
    normaliseOcrLines,
};
