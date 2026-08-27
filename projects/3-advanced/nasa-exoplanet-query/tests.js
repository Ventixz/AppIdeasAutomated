// tests.js — dependency-free test suite for exoplanet-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const Core = require('./exoplanet-core.js');
const {
  parseCSV, parseRecords, rowsToObjects,
  normalizeRecord, normalizeRecords, toYear,
  buildDataset, fieldOptions, selectedValues, hasSelection,
  matchesRow, search, sortRows, fieldByKey, overviewUrl,
  QUERY_KEYS,
} = Core;
const Sample = require('./sample-data.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else { failed += 1; console.error(`  ✗ ${msg}`); }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function deq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b),
    `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function throws(fn, code, msg) {
  try { fn(); assert(false, `${msg} (expected throw)`); }
  catch (e) { assert(!code || e.code === code, `${msg} (expected code ${code}, got ${e.code})`); }
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
deq(parseCSV('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']], 'plain csv');
deq(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], 'CRLF line endings');
deq(parseCSV('a,b\n"x,y",z'), [['a', 'b'], ['x,y', 'z']], 'quoted field with comma');
deq(parseCSV('a\n"he said ""hi"""'), [['a'], ['he said "hi"']], 'doubled-quote escape');
deq(parseCSV('# comment\na,b\n1,2'), [['a', 'b'], ['1', '2']], 'leading # comment line skipped');
deq(parseCSV('a,b\n\n1,2\n'), [['a', 'b'], ['1', '2']], 'blank line dropped');
deq(parseCSV('a,b\n1,2'), [['a', 'b'], ['1', '2']], 'no trailing newline');
deq(parseCSV('a,b\n"#notacomment",2'), [['a', 'b'], ['#notacomment', '2']], '# inside quotes is data');
deq(parseCSV(''), [], 'empty text -> no rows');
deq(parseCSV('a,,c'), [['a', '', 'c']], 'empty middle field preserved');

// rowsToObjects / parseRecords
deq(rowsToObjects([['x', 'y'], ['1', '2']]), [{ x: '1', y: '2' }], 'rows to objects');
deq(rowsToObjects([]), [], 'rows to objects empty');
{
  const recs = parseRecords('pl_name,hostname,disc_year\nAb,A,2011\n');
  deq(recs, [{ pl_name: 'Ab', hostname: 'A', disc_year: '2011' }], 'parseRecords maps header');
}

// ---------------------------------------------------------------------------
// Year coercion + normalization
// ---------------------------------------------------------------------------
eq(toYear('2011'), 2011, 'toYear numeric string');
eq(toYear(' 1995 '), 1995, 'toYear trims');
eq(toYear(''), null, 'toYear empty -> null');
eq(toYear('n/a'), null, 'toYear garbage -> null');
eq(toYear('20111'), null, 'toYear 5 digits rejected');

deq(
  normalizeRecord({ pl_name: ' 51 Peg b ', hostname: ' 51 Peg ', disc_year: '1995', discoverymethod: ' Radial Velocity ', disc_facility: ' OHP ' }),
  { pl_name: '51 Peg b', hostname: '51 Peg', disc_year: 1995, discoverymethod: 'Radial Velocity', disc_facility: 'OHP' },
  'normalizeRecord trims + coerces year'
);
eq(normalizeRecord({ pl_name: '', hostname: 'A' }), null, 'reject missing planet name');
eq(normalizeRecord({ pl_name: 'Ab', hostname: '' }), null, 'reject missing host name');
eq(normalizeRecord(null), null, 'reject non-object');
{
  const rec = normalizeRecord({ pl_name: 'X b', hostname: 'X' });
  eq(rec.disc_year, null, 'missing year -> null');
  eq(rec.discoverymethod, '', 'missing method -> empty string');
}
deq(normalizeRecords([{ pl_name: 'A b', hostname: 'A' }, { pl_name: '', hostname: 'B' }]).length, 1, 'normalizeRecords drops invalid');
deq(normalizeRecords('nope'), [], 'normalizeRecords non-array -> []');

// ---------------------------------------------------------------------------
// buildDataset + option lists
// ---------------------------------------------------------------------------
{
  const csv = 'pl_name,hostname,disc_year,discoverymethod,disc_facility\n' +
    'A b,A,2011,Transit,Kepler\n' +
    'B c,B,1995,Radial Velocity,OHP\n' +
    'A c,A,2011,Transit,Kepler\n' +
    'D e,D,,Transit,\n';
  const ds = buildDataset(csv);
  eq(ds.rows.length, 4, 'dataset row count');
  deq(ds.options.disc_year, [1995, 2011], 'year options unique + numeric-sorted (blank dropped)');
  deq(ds.options.discoverymethod, ['Radial Velocity', 'Transit'], 'method options sorted');
  deq(ds.options.hostname, ['A', 'B', 'D'], 'host options sorted');
  deq(ds.options.disc_facility, ['Kepler', 'OHP'], 'facility options (blank dropped)');
}
// numeric year options sort as numbers, not strings
{
  const ds = buildDataset('pl_name,hostname,disc_year\nA b,A,9\nB c,B,100\nC d,C,20\n');
  deq(ds.options.disc_year, [9, 20, 100], 'year options sorted numerically');
}
// buildDataset accepts an already-normalized rows array too
{
  const ds = buildDataset([{ pl_name: 'A b', hostname: 'A', disc_year: '2011', discoverymethod: 'Transit', disc_facility: 'Kepler' }]);
  eq(ds.rows.length, 1, 'buildDataset from records array');
}

// ---------------------------------------------------------------------------
// selection helpers
// ---------------------------------------------------------------------------
deq(selectedValues({ disc_year: [2011, 1995] }, 'disc_year'), ['2011', '1995'], 'selectedValues stringifies');
deq(selectedValues({ hostname: 'A' }, 'hostname'), ['A'], 'selectedValues wraps scalar');
deq(selectedValues({ hostname: ['', 'A'] }, 'hostname'), ['A'], 'selectedValues drops empties');
deq(selectedValues({}, 'hostname'), [], 'selectedValues absent -> []');
assert(hasSelection({ hostname: ['A'] }), 'hasSelection true');
assert(!hasSelection({ hostname: [], disc_year: [] }), 'hasSelection false when all empty');
assert(!hasSelection({}), 'hasSelection false when empty query');

// ---------------------------------------------------------------------------
// matching + search (OR within field, AND across fields)
// ---------------------------------------------------------------------------
const rows = [
  { pl_name: 'A b', hostname: 'A', disc_year: 2011, discoverymethod: 'Transit', disc_facility: 'Kepler' },
  { pl_name: 'B c', hostname: 'B', disc_year: 1995, discoverymethod: 'Radial Velocity', disc_facility: 'OHP' },
  { pl_name: 'C d', hostname: 'C', disc_year: 2011, discoverymethod: 'Radial Velocity', disc_facility: 'Keck' },
  { pl_name: 'D e', hostname: 'D', disc_year: 2017, discoverymethod: 'Transit', disc_facility: 'K2' },
];
assert(matchesRow(rows[0], { discoverymethod: ['Transit'] }), 'matchesRow single field');
assert(!matchesRow(rows[1], { discoverymethod: ['Transit'] }), 'matchesRow single field miss');
assert(matchesRow(rows[0], { disc_year: [2011] }), 'matchesRow numeric year via string');
assert(matchesRow(rows[2], { disc_year: [2011], discoverymethod: ['Radial Velocity'] }), 'AND across fields hit');
assert(!matchesRow(rows[0], { disc_year: [2011], discoverymethod: ['Radial Velocity'] }), 'AND across fields miss');

deq(search(rows, { disc_year: [2011] }).map((r) => r.pl_name), ['A b', 'C d'], 'search one year -> two');
deq(search(rows, { discoverymethod: ['Transit', 'Radial Velocity'] }).length, 4, 'OR within a field');
deq(search(rows, { disc_year: [2011], discoverymethod: ['Transit'] }).map((r) => r.pl_name), ['A b'], 'AND two fields');
deq(search(rows, { hostname: ['Z'] }), [], 'search no match -> empty');
throws(() => search(rows, {}), 'NO_SELECTION', 'search with no selection throws');
throws(() => search(rows, { hostname: [] }), 'NO_SELECTION', 'search with empty selection throws');
// search accepts a dataset object, not just a rows array
{
  const ds = buildDataset('pl_name,hostname,disc_year,discoverymethod,disc_facility\nA b,A,2011,Transit,Kepler\n');
  eq(search(ds, { discoverymethod: ['Transit'] }).length, 1, 'search accepts dataset object');
}

// ---------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------
deq(sortRows(rows, 'disc_year', 'asc').map((r) => r.disc_year), [1995, 2011, 2011, 2017], 'sort year asc');
deq(sortRows(rows, 'disc_year', 'desc').map((r) => r.disc_year), [2017, 2011, 2011, 1995], 'sort year desc');
deq(sortRows(rows, 'hostname', 'asc').map((r) => r.hostname), ['A', 'B', 'C', 'D'], 'sort host asc');
deq(sortRows(rows, 'hostname', 'desc').map((r) => r.hostname), ['D', 'C', 'B', 'A'], 'sort host desc');
// stable tie-break: equal years keep original relative order
deq(sortRows(rows, 'disc_year', 'asc').filter((r) => r.disc_year === 2011).map((r) => r.pl_name), ['A b', 'C d'], 'stable sort keeps input order on ties');
// blanks sort last in both directions
{
  const withBlank = [
    { pl_name: 'Z', hostname: 'Z', disc_year: null },
    { pl_name: 'A', hostname: 'A', disc_year: 2000 },
  ];
  deq(sortRows(withBlank, 'disc_year', 'asc').map((r) => r.pl_name), ['A', 'Z'], 'blank year sorts last asc');
  deq(sortRows(withBlank, 'disc_year', 'desc').map((r) => r.pl_name), ['A', 'Z'], 'blank year sorts last desc');
}
deq(sortRows(rows, 'nope', 'asc').length, 4, 'sort on unknown key returns list unchanged');
assert(sortRows(rows, 'disc_year', 'asc') !== rows, 'sortRows returns a new array');
eq(fieldByKey('disc_year').numeric, true, 'fieldByKey numeric flag');
eq(fieldByKey('zzz'), null, 'fieldByKey unknown -> null');

// ---------------------------------------------------------------------------
// overview URL
// ---------------------------------------------------------------------------
eq(overviewUrl('51 Peg'), 'https://exoplanetarchive.ipac.caltech.edu/overview/51%20Peg', 'overview url encodes spaces');
eq(overviewUrl('  TRAPPIST-1 '), 'https://exoplanetarchive.ipac.caltech.edu/overview/TRAPPIST-1', 'overview url trims');
eq(overviewUrl(''), '', 'overview url empty host -> empty');

// ---------------------------------------------------------------------------
// bundled sample data integrity
// ---------------------------------------------------------------------------
{
  const ds = buildDataset(Sample.CSV);
  assert(ds.rows.length >= 40, `sample has a healthy row count (${ds.rows.length})`);
  ds.rows.forEach((r) => {
    assert(r.pl_name && r.hostname, `sample row "${r.pl_name}" has planet + host`);
    assert(r.disc_year && r.disc_year >= 1992 && r.disc_year <= 2026, `sample row "${r.pl_name}" has a plausible year`);
    QUERY_KEYS.forEach((k) => assert(k in r, `sample row has field ${k}`));
  });
  // Every dropdown has real variety.
  assert(ds.options.disc_year.length >= 10, 'sample spans many years');
  assert(ds.options.discoverymethod.length >= 3, 'sample spans multiple methods');
  assert(ds.options.disc_facility.length >= 8, 'sample spans many facilities');
  assert(ds.options.hostname.length >= 30, 'sample spans many hosts');
  // A known query returns the whole TRAPPIST-1 system.
  const trappist = search(ds, { hostname: ['TRAPPIST-1'] });
  eq(trappist.length, 7, 'TRAPPIST-1 has 7 planets in the sample');
  // The three pulsar planets all share a facility + method + year.
  const pulsar = search(ds, { discoverymethod: ['Pulsar Timing'] });
  eq(pulsar.length, 3, 'three pulsar-timing planets');
  pulsar.forEach((p) => eq(p.disc_year, 1992, 'pulsar planet discovered 1992'));
  // 51 Peg b — the first hot Jupiter — is present and correctly attributed.
  const peg = search(ds, { hostname: ['51 Peg'] });
  eq(peg.length, 1, 'one 51 Peg planet');
  eq(peg[0].disc_year, 1995, '51 Peg b discovered 1995');
  eq(peg[0].discoverymethod, 'Radial Velocity', '51 Peg b via radial velocity');
  // A quoted facility name survived parsing intact.
  assert(ds.options.disc_facility.includes('W. M. Keck Observatory'), 'quoted facility parsed intact');
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
