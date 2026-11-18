#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const venv = path.join(root, 'user_data', 'mirage', '.venv');
const pythonPath = process.platform === 'win32'
  ? path.join(venv, 'Scripts', 'python.exe')
  : path.join(venv, 'bin', 'python');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr?.trim().slice(-2000) || result.error?.message || `exit ${result.status}`}`);
  }
  return result;
}

function pythonCommand() {
  const candidates = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']]]
    : [['python3', []], ['python', []]];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', stdio: 'pipe' });
    const version = `${result.stdout ?? ''} ${result.stderr ?? ''}`.match(/Python\s+(\d+)\.(\d+)/i);
    if (!result.error && result.status === 0 && version && (Number(version[1]) > 3 || Number(version[1]) === 3 && Number(version[2]) >= 9)) return { command, prefix };
  }
  throw new Error('Mirage requires Python 3.9 or newer');
}

function importable(command, args = []) {
  const result = spawnSync(command, [...args, '-c', 'import cactus'], { encoding: 'utf8', stdio: 'ignore' });
  return !result.error && result.status === 0;
}

const systemPython = pythonCommand();
fs.mkdirSync(path.dirname(venv), { recursive: true, mode: 0o700 });
if (!fs.existsSync(pythonPath)) run(systemPython.command, [...systemPython.prefix, '-m', 'venv', venv]);
if (!fs.existsSync(pythonPath)) throw new Error(`Mirage virtualenv was not created: ${pythonPath}`);
if (!importable(pythonPath)) run(pythonPath, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', 'cactus-compute[vision]']);
if (!importable(pythonPath)) throw new Error('cactus-compute[vision] could not be imported after installation');
console.log(JSON.stringify({ ready: true, python: pythonPath, venv, package: 'cactus-compute[vision]' }));
