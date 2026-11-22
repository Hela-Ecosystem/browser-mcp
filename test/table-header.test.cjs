'use strict';
const assert = require('node:assert/strict');
const { structureTable } = require('../src/utils/table-structure.js');

const ROWS = [
  ['Region', 'Revenue'],
  ['Jakarta', '1,200'],
  ['Bandung', '850'],
];

// browser-mcp#20: the schema promised header: true by default, but the handler
// only keyed rows when the argument was truthy, and JSON-Schema defaults are not
// applied by the server. An omitted option must therefore behave like true.
{
  const shaped = structureTable(ROWS, { firstRowIsHeader: true });
  assert.deepEqual(shaped.headers, ['Region', 'Revenue']);
  assert.deepEqual(shaped.table, [
    { Region: 'Jakarta', Revenue: '1,200' },
    { Region: 'Bandung', Revenue: '850' },
  ]);
  console.log('ok 1 - omitted header keys rows by the header row');
}

{
  const shaped = structureTable(ROWS, { header: false, firstRowIsHeader: true });
  assert.deepEqual(shaped.table, ROWS);
  assert.equal(shaped.headers, null);
  console.log('ok 2 - header: false returns the flat table');
}

{
  const dataRows = [['Jakarta', '1,200'], ['Bandung', '850']];
  const shaped = structureTable(dataRows, { firstRowIsHeader: false });
  assert.deepEqual(shaped.table, dataRows, 'the first data row must not be eaten');
  assert.equal(shaped.headers, null);
  assert.match(shaped.note, /No header row found/);
  console.log('ok 3 - a table without <th> keeps every row');
}

{
  const shaped = structureTable([['', '', 'Δ'], ['a', 'b', 'c']], { firstRowIsHeader: true });
  assert.deepEqual(shaped.headers, ['col0', 'col1', 'Δ']);
  assert.deepEqual(shaped.table, [{ col0: 'a', col1: 'b', 'Δ': 'c' }]);
  console.log('ok 4 - blank header cells get positional names');
}

{
  const shaped = structureTable([['Name', 'Name'], ['a', 'b']], { firstRowIsHeader: true });
  assert.deepEqual(shaped.headers, ['Name', 'Name_2']);
  assert.deepEqual(shaped.table, [{ Name: 'a', Name_2: 'b' }]);
  console.log('ok 5 - duplicate header names are disambiguated');
}

{
  assert.deepEqual(structureTable([], {}), { table: [] });
  console.log('ok 6 - an empty table is empty, not an error');
}

console.log('\n6 table-header checks passed');
