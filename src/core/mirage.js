'use strict';

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');

const WORKER_PATH = path.join(__dirname, '..', 'vision', 'mirage_worker.py');
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MIRAGE_VENV = process.env.HELA_CYTOSOL_MIRAGE_VENV || path.join(PROJECT_ROOT, 'user_data', 'mirage', '.venv');
const MAX_IMAGE_BYTES = Math.max(1024, Number.parseInt(process.env.HELA_CYTOSOL_MIRAGE_MAX_IMAGE_BYTES || `${12 * 1024 * 1024}`, 10));
const REQUEST_TIMEOUT_MS = Math.max(10_000, Number.parseInt(process.env.HELA_CYTOSOL_MIRAGE_TIMEOUT_MS || '120000', 10));
const STARTUP_TIMEOUT_MS = 10_000;

let worker = null;
let startupPromise = null;
let requestId = 0;
const pending = new Map();

function pythonCandidates() {
    const configured = process.env.HELA_CYTOSOL_MIRAGE_PYTHON;
    const managed = process.platform === 'win32'
        ? path.join(MIRAGE_VENV, 'Scripts', 'python.exe')
        : path.join(MIRAGE_VENV, 'bin', 'python');
    const defaults = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    return [...new Set([configured, fs.existsSync(managed) ? managed : null, ...defaults].filter(Boolean))];
}

function rejectPending(error) {
    for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
    }
    pending.clear();
}

function detachWorker(child) {
    if (worker?.child === child) worker = null;
    rejectPending(new Error('Mirage worker exited before completing the request'));
}

function startCandidate(command) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, [WORKER_PATH], {
            env: {
                ...process.env,
                CACTUS_TELEMETRY: process.env.CACTUS_TELEMETRY ?? '0',
                DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error(`Mirage worker did not start within ${STARTUP_TIMEOUT_MS}ms`));
        }, STARTUP_TIMEOUT_MS);

        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(result);
        };

        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', (line) => {
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }

            if (message.type === 'ready') {
                worker = { child, lines };
                finish(null, worker);
                return;
            }

            if (message.type === 'startup_error') {
                child.kill();
                finish(new Error(message.error || 'Mirage worker failed during startup'));
                return;
            }

            if (message.type !== 'response' || !message.id) return;
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.ok) request.resolve(message.result);
            else request.reject(new Error(message.error || 'Mirage inference failed'));
        });

        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[Mirage] ${chunk.toString()}`);
        });
        child.once('error', (error) => finish(error));
        child.once('exit', (code, signal) => {
            if (!settled) finish(new Error(`Mirage worker exited during startup (${code ?? signal})`));
            if (worker?.child === child) detachWorker(child);
        });
    });
}

async function ensureWorker() {
    if (worker?.child && !worker.child.killed) return worker;
    if (startupPromise) return startupPromise;

    startupPromise = (async () => {
        let lastError;
        for (const command of pythonCandidates()) {
            try {
                return await startCandidate(command);
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(`Mirage requires Python 3.9+ with cactus-compute[vision]. ${lastError?.message || 'No Python executable found.'}`);
    })();

    try {
        return await startupPromise;
    } finally {
        startupPromise = null;
    }
}

async function analyze(imageBuffer, options = {}) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) throw new Error('Mirage requires a non-empty image buffer');
    if (imageBuffer.length > MAX_IMAGE_BYTES) throw new Error(`Image exceeds the Mirage limit of ${MAX_IMAGE_BYTES} bytes`);

    const activeWorker = await ensureWorker();
    const id = String(++requestId);
    const payload = JSON.stringify({
        id,
        operation: options.operation || 'describe',
        image: imageBuffer.toString('base64'),
        sections: options.sections,
        fields: options.fields,
        schema: options.schema,
        language: options.language,
        maskFormat: options.maskFormat,
        conf: options.conf,
        textConf: options.textConf,
        maxObjects: options.maxObjects,
        maxTextLines: options.maxTextLines,
        maxTokens: options.maxTokens,
    });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Mirage inference timed out after ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        activeWorker.child.stdin.write(`${payload}\n`, (error) => {
            if (!error) return;
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function close() {
    const activeWorker = worker;
    worker = null;
    if (!activeWorker?.child) return;
    rejectPending(new Error('Mirage worker closed'));
    activeWorker.lines.close();
    activeWorker.child.kill();
}

module.exports = { analyze, close };
