/*
 * tests.js — logic tests for the Sort Excel/CSV File Utility engine.
 * No dependencies. Run with:  node tests.js
 *
 * The suite leans on the three things that are genuinely hard: parsing CSV
 * with quotes/commas/newlines, sorting with the right type and stable ties,
 * and serializing back losslessly.
 */
'use strict';
var C = require('./csv-core.js');

var passed = 0, failed = 0;
function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error('FAIL: ' + msg + '\n   expected ' + e + '\n   got      ' + a); }
}
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('FAIL: ' + msg); }
}

/* ---------------------------------------------------------------- parsing */
eq(C.parseCSV('a,b,c'), [['a', 'b', 'c']], 'simple single row');
eq(C.parseCSV('a,b\n c,d'), [['a', 'b'], [' c', 'd']], 'two rows, leading space kept');
eq(C.parseCSV('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']], 'CRLF line endings');
eq(C.parseCSV('a,b\rc,d'), [['a', 'b'], ['c', 'd']], 'lone CR line endings');
eq(C.parseCSV('a,b\n'), [['a', 'b']], 'trailing newline makes no phantom row');
eq(C.parseCSV(''), [], 'empty string -> no rows');
eq(C.parseCSV('a,,c'), [['a', '', 'c']], 'empty field preserved');
eq(C.parseCSV(',\n,'), [['', ''], ['', '']], 'all-empty fields');

// the quoting rules — the whole reason you cannot just split on commas
eq(C.parseCSV('"a,b",c'), [['a,b', 'c']], 'quoted comma stays in one field');
eq(C.parseCSV('"he said ""hi""",x'), [['he said "hi"', 'x']], 'escaped double-quote');
eq(C.parseCSV('"line1\nline2",x'), [['line1\nline2', 'x']], 'newline inside quotes');
eq(C.parseCSV('"a,b\nc,d",e'), [['a,b\nc,d', 'e']], 'comma AND newline inside quotes');
eq(C.parseCSV('"",x'), [['', 'x']], 'empty quoted field');
eq(C.parseCSV('a,"b"'), [['a', 'b']], 'quoted field at end of row');

// BOM
eq(C.parseCSV('﻿a,b'), [['a', 'b']], 'leading BOM stripped');

// custom delimiter
eq(C.parseCSV('a;b;c', { delimiter: ';' }), [['a', 'b', 'c']], 'semicolon delimiter');
ok((function () { try { C.parseCSV('a', { delimiter: ',,' }); return false; } catch (e) { return true; } })(),
  'multi-char delimiter rejected');

/* ------------------------------------------------------------- parseTable */
var t1 = C.parseTable('name,age\nAnna,30\nBob,25');
eq(t1.header, ['name', 'age'], 'header row read');
eq(t1.rows, [{ name: 'Anna', age: '30' }, { name: 'Bob', age: '25' }], 'rows as objects');

// ragged row padded to header width
var t2 = C.parseTable('a,b,c\n1,2');
eq(t2.rows, [{ a: '1', b: '2', c: '' }], 'short row padded, no undefined');

// no-header mode synthesizes column names
var t3 = C.parseTable('1,2\n3,4', { hasHeader: false });
eq(t3.header, ['Column 1', 'Column 2'], 'synthesized headers');
eq(t3.rows, [{ 'Column 1': '1', 'Column 2': '2' }, { 'Column 1': '3', 'Column 2': '4' }], 'no-header rows');

/* ---------------------------------------------------------- type detection */
eq(C.detectType(['1', '2', '3']), 'number', 'all ints -> number');
eq(C.detectType(['1.5', '-2', '3e2', '1,000']), 'number', 'floats/sci/thousands -> number');
eq(C.detectType(['1', '', '3']), 'number', 'blanks do not break number detection');
eq(C.detectType(['1', 'two', '3']), 'string', 'one label collapses to string');
eq(C.detectType(['2024-01-01', '2023-12-31']), 'date', 'ISO dates -> date');
eq(C.detectType(['1/2/2024', '12/31/2023']), 'date', 'slashed dates -> date');
eq(C.detectType(['', '', '']), 'string', 'all blank -> string');
eq(C.detectType(['007', '042']), 'number', 'zero-padded still numeric');

/* numeric vs lexical — the canonical bug */
ok(C.parseNumber('10') > C.parseNumber('9'), '10 > 9 numerically');
ok('10' < '9', 'guard: 10 < 9 lexically (what we must NOT do for numbers)');

/* ------------------------------------------------------------- sorting */
var rows = [
  { name: 'Charlie', age: '30', city: 'Rome' },
  { name: 'alice', age: '9', city: 'Rome' },
  { name: 'Bob', age: '10', city: 'Oslo' }
];

var byAgeNum = C.sortRows(rows, [{ column: 'age' }]);
eq(byAgeNum.map(function (r) { return r.age; }), ['9', '10', '30'], 'age sorted numerically, not lexically');

var byAgeDesc = C.sortRows(rows, [{ column: 'age', direction: 'desc' }]);
eq(byAgeDesc.map(function (r) { return r.age; }), ['30', '10', '9'], 'age desc');

var byName = C.sortRows(rows, [{ column: 'name' }]);
eq(byName.map(function (r) { return r.name; }), ['alice', 'Bob', 'Charlie'], 'name case-insensitive asc');

// multi-key: by city asc, then name asc. Within "Rome", case-insensitive name
// ordering puts alice before Charlie.
var multi = C.sortRows(rows, [{ column: 'city' }, { column: 'name' }]);
eq(multi.map(function (r) { return r.city + ':' + r.name; }),
   ['Oslo:Bob', 'Rome:alice', 'Rome:Charlie'],
   'multi-key: city asc then name asc');

// stability: equal keys keep original order
var dup = [
  { k: 'x', id: '1' }, { k: 'x', id: '2' }, { k: 'x', id: '3' }
];
var sortedDup = C.sortRows(dup, [{ column: 'k' }]);
eq(sortedDup.map(function (r) { return r.id; }), ['1', '2', '3'], 'stable sort preserves original order on ties');

// blanks sort to the end, both directions
var withBlank = [{ v: '3' }, { v: '' }, { v: '1' }];
eq(C.sortRows(withBlank, [{ column: 'v' }]).map(function (r) { return r.v; }), ['1', '3', ''], 'blanks last asc');
eq(C.sortRows(withBlank, [{ column: 'v', direction: 'desc' }]).map(function (r) { return r.v; }), ['3', '1', ''], 'blanks last desc too');

// dates sort chronologically, not lexically
var dates = [{ d: '2024-03-01' }, { d: '2024-01-15' }, { d: '2023-12-31' }];
eq(C.sortRows(dates, [{ column: 'd' }]).map(function (r) { return r.d; }),
   ['2023-12-31', '2024-01-15', '2024-03-01'], 'dates chronological');

// original array is not mutated
var orig = [{ v: '2' }, { v: '1' }];
C.sortRows(orig, [{ column: 'v' }]);
eq(orig.map(function (r) { return r.v; }), ['2', '1'], 'sortRows does not mutate input');

/* ------------------------------------------------------------- serialize */
eq(C.serializeCSV(['a', 'b'], [{ a: '1', b: '2' }]), 'a,b\n1,2', 'basic serialize with header');
eq(C.quoteField('a,b', ','), '"a,b"', 'comma forces quoting');
eq(C.quoteField('he "said"', ','), '"he ""said"""', 'interior quote doubled');
eq(C.quoteField('line\nbreak', ','), '"line\nbreak"', 'newline forces quoting');
eq(C.quoteField('plain', ','), 'plain', 'plain value unquoted');
eq(C.serializeCSV(['x'], [['a,b']]), 'x\n"a,b"', 'array row serialized + quoted');

/* --------------------------------------------------- round-trip (the point) */
var messy = 'name,note,qty\n"Smith, John","say ""hi""",10\n"O\'Hara","two\nlines",2\n';
var tbl = C.parseTable(messy);
var back = C.serializeCSV(tbl.header, tbl.rows);
var reparsed = C.parseTable(back);
eq(reparsed.rows, tbl.rows, 'parse -> serialize -> parse is lossless on messy data');

/* ----------------------------------------------- full pipeline sortCSVText */
var pipe = C.sortCSVText('name,age\nBob,10\nAnna,9\nCy,30', [{ column: 'age' }]);
eq(pipe.text, 'name,age\nAnna,9\nBob,10\nCy,30', 'sortCSVText sorts numerically and keeps header');
eq(pipe.types, [{ column: 'age', type: 'number' }], 'pipeline reports inferred type');

var pipeSemi = C.sortCSVText('a;b\n3;x\n1;y', [{ column: 'a' }], { delimiter: ';' });
eq(pipeSemi.text, 'a;b\n1;y\n3;x', 'pipeline honors custom delimiter both ways');

/* -------------------------------------------------------------- summary */
console.log('\n' + passed + ' passed, ' + failed + ' failed  (' + (passed + failed) + ' checks)');
process.exit(failed ? 1 : 0);
