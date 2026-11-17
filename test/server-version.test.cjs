const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const { SERVER_VERSION } = require('../src/version');

assert.equal(SERVER_VERSION, packageJson.version);
console.log('ok - advertised server version matches package.json');
