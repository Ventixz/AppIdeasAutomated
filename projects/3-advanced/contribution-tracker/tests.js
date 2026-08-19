// tests.js — dependency-free test suite for contrib-core.js.
// Run with: node tests.js   (exits non-zero if any assertion fails)

const C = require('./contrib-core.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function eq(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function deepEq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}
function throwsCode(fn, code, msg) {
  let got = null;
  try { fn(); } catch (e) { got = e.code || e.message; }
  eq(got, code, msg);
}

// --- Money parsing (by hand, no float drift) ------------------------------

eq(C.parseAmount('12'), 1200, 'whole dollars -> cents');
eq(C.parseAmount('12.5'), 1250, 'one decimal place padded');
eq(C.parseAmount('12.50'), 1250, 'two decimal places');
eq(C.parseAmount('0.01'), 1, 'one cent');
eq(C.parseAmount('$1,200.00'), 120000, 'currency symbol and thousands separator');
eq(C.parseAmount('  3.4 '), 340, 'surrounding whitespace trimmed');
eq(C.parseAmount('1,234,567.89'), 123456789, 'multiple thousands groups');

throwsCode(() => C.parseAmount(''), 'AMOUNT_BLANK', 'blank amount rejected');
throwsCode(() => C.parseAmount('abc'), 'AMOUNT_NAN', 'non-numeric rejected');
throwsCode(() => C.parseAmount('12.345'), 'AMOUNT_NAN', 'three decimals rejected');
throwsCode(() => C.parseAmount('-5'), 'AMOUNT_NAN', 'negative rejected as NaN shape');
throwsCode(() => C.parseAmount('0'), 'AMOUNT_ZERO', 'zero rejected');
throwsCode(() => C.parseAmount('0.00'), 'AMOUNT_ZERO', 'zero with decimals rejected');
throwsCode(() => C.parseAmount('1,20'), 'AMOUNT_NAN', 'malformed grouping rejected');
throwsCode(() => C.parseAmount('12,34.5'), 'AMOUNT_NAN', 'bad comma placement rejected');

// The classic float trap: 0.1 + 0.2 should be exactly 0.30, i.e. 30 cents.
eq(C.parseAmount('0.10') + C.parseAmount('0.20'), 30, '0.10 + 0.20 == 30 cents exactly');

// --- Money formatting -----------------------------------------------------

eq(C.formatMoney(0), '$0.00', 'zero formats');
eq(C.formatMoney(5), '$0.05', 'nickels');
eq(C.formatMoney(1250), '$12.50', 'basic');
eq(C.formatMoney(120000), '$1,200.00', 'thousands grouped');
eq(C.formatMoney(123456789), '$1,234,567.89', 'millions grouped');
eq(C.formatMoney(-1250), '-$12.50', 'negative delta');
eq(C.centsToInput(1250), '12.50', 'centsToInput round trips');
eq(C.centsToInput(5), '0.05', 'centsToInput pads');

// --- Date validation ------------------------------------------------------

eq(C.validateDate('2026-08-19'), '2026-08-19', 'valid ISO date');
throwsCode(() => C.validateDate(''), 'DATE_BLANK', 'blank date');
throwsCode(() => C.validateDate('2026-13-01'), 'DATE_INVALID', 'month 13 rejected');
throwsCode(() => C.validateDate('2026-02-30'), 'DATE_INVALID', 'Feb 30 rejected');
throwsCode(() => C.validateDate('08/19/2026'), 'DATE_INVALID', 'US format rejected');
eq(C.validateDate('2024-02-29'), '2024-02-29', 'leap day accepted');
throwsCode(() => C.validateDate('2026-02-29'), 'DATE_INVALID', 'non-leap Feb 29 rejected');

// --- Consolidated entry validation ----------------------------------------

const good = C.validateEntry({ date: '2026-08-19', payee: '  Red  Cross ', amount: '$50', memo: '  gift ' });
deepEq(good, { date: '2026-08-19', payee: 'Red Cross', cents: 5000, memo: 'gift' }, 'clean entry normalized');

let agg = null;
try { C.validateEntry({ date: 'nope', payee: '', amount: 'x' }); } catch (e) { agg = e; }
assert(agg && agg.code === 'INVALID_ENTRY', 'invalid entry throws INVALID_ENTRY');
eq(agg.errors.length, 3, 'three problems reported together (date, payee, amount)');

// --- Immutable ledger operations ------------------------------------------

let led = [];
led = C.addTransaction(led, { date: '2026-01-15', payee: 'Alpha', amount: '10.00', memo: '' });
led = C.addTransaction(led, { date: '2026-03-02', payee: 'Beta', amount: '25.50', memo: 'x' });
eq(led.length, 2, 'two transactions added');
eq(led[0].id, 't1', 'first id is t1');
eq(led[1].id, 't2', 'second id is t2');

const before = C.toJSON(led);
C.addTransaction(led, { date: '2026-04-01', payee: 'Gamma', amount: '1', memo: '' });
eq(C.toJSON(led), before, 'addTransaction did not mutate the input array');

led = C.updateTransaction(led, 't1', { date: '2026-01-15', payee: 'Alpha', amount: '12.00', memo: 'raised' });
eq(led[0].cents, 1200, 'update changed the amount');
eq(led[0].id, 't1', 'update kept the id');
throwsCode(() => C.updateTransaction(led, 'tX', { date: '2026-01-01', payee: 'p', amount: '1' }), 'NOT_FOUND', 'update of missing id throws');

led = C.deleteTransaction(led, 't2');
eq(led.length, 1, 'delete removed one');
throwsCode(() => C.deleteTransaction(led, 't2'), 'NOT_FOUND', 'delete of missing id throws');

// New ids never collide with survivors after deletes.
led = C.addTransaction(led, { date: '2026-05-05', payee: 'Delta', amount: '5', memo: '' });
eq(led[led.length - 1].id, 't2', 'nextSeq reuses the gap left by delete (max+1 over survivors)');

// --- Sorting --------------------------------------------------------------

const s = [
  { id: 't1', date: '2026-03-01', payee: 'Zed', cents: 500, memo: 'b' },
  { id: 't2', date: '2026-01-01', payee: 'amy', cents: 900, memo: 'a' },
  { id: 't3', date: '2026-02-01', payee: 'Bob', cents: 500, memo: 'c' },
];
deepEq(C.sortTransactions(s, 'date', 'asc').map((t) => t.id), ['t2', 't3', 't1'], 'sort by date asc');
deepEq(C.sortTransactions(s, 'date', 'desc').map((t) => t.id), ['t1', 't3', 't2'], 'sort by date desc');
deepEq(C.sortTransactions(s, 'amount', 'asc').map((t) => t.id), ['t1', 't3', 't2'], 'sort by amount asc, ties stable by id');
deepEq(C.sortTransactions(s, 'payee', 'asc').map((t) => t.id), ['t2', 't3', 't1'], 'sort by payee asc, case-insensitive');
// Sorting a copy leaves the original untouched.
const sBefore = JSON.stringify(s);
C.sortTransactions(s, 'amount', 'desc');
eq(JSON.stringify(s), sBefore, 'sortTransactions does not mutate input');

// --- Analytics ------------------------------------------------------------

const ax = [
  { id: 't1', date: '2025-02-10', payee: 'A', cents: 10000, memo: '' },
  { id: 't2', date: '2025-02-20', payee: 'B', cents: 5000, memo: '' },
  { id: 't3', date: '2026-02-01', payee: 'C', cents: 20000, memo: '' },
  { id: 't4', date: '2026-08-01', payee: 'D', cents: 10000, memo: '' },
];

const m2026 = C.monthlyTotals(ax, 2026);
eq(m2026[1], 20000, 'Feb 2026 total');
eq(m2026[7], 10000, 'Aug 2026 total');
eq(m2026[0], 0, 'Jan 2026 empty');
eq(m2026.length, 12, 'twelve months');
eq(C.sumCents(m2026), 30000, 'monthly totals sum to the year total');

deepEq(
  C.yearlyTotals(ax),
  [
    { year: 2025, cents: 15000, count: 2 },
    { year: 2026, cents: 30000, count: 2 },
  ],
  'yearly totals with counts, sorted'
);

const yoy = C.yearOverYear(ax);
eq(yoy[0].deltaCents, 0, 'first year has no delta');
eq(yoy[0].pct, null, 'first year has no pct');
eq(yoy[1].deltaCents, 15000, 'year-over-year delta in cents');
eq(yoy[1].pct, 100, 'doubling is +100%');

const avg = C.averages(ax);
eq(avg.count, 4, 'average count');
eq(avg.totalCents, 45000, 'average total');
eq(avg.perTxCents, 11250, 'average per transaction');
// Two active months in 2025 (single Feb) — wait: both 2025 rows are Feb, so 3 distinct YYYY-MM: 2025-02, 2026-02, 2026-08.
eq(avg.perMonthCents, 15000, 'average per active month (3 active months)');
eq(avg.perYearCents, 22500, 'average per year (2 years)');

// Empty ledger analytics are all zero, never NaN.
const empty = C.averages([]);
eq(empty.perTxCents, 0, 'empty average per tx is 0 not NaN');
eq(empty.perMonthCents, 0, 'empty average per month is 0');
deepEq(C.monthlyTotals([], 2026), new Array(12).fill(0), 'empty monthly totals all zero');
deepEq(C.yearlyTotals([]), [], 'empty yearly totals');
deepEq(C.yearOverYear([]), [], 'empty yoy');

// summarize bundles it all for a focus year.
const sum = C.summarize(ax, 2026);
eq(sum.focusYear, 2026, 'summary focus year');
eq(sum.monthly[1], 20000, 'summary monthly');
eq(sum.yearly.length, 2, 'summary yearly length');

// --- Serialization: files persistence, corrupt-row recovery ---------------

const json = C.toJSON(ax);
const round = C.fromJSON(json);
eq(round.length, 4, 'JSON round trip keeps all rows');
eq(round[0].cents, 10000, 'JSON round trip keeps cents');
eq(round[0].id, 't1', 'JSON round trip re-sequences ids from 1');

// A file with some junk rows keeps the good ones and drops the bad.
const messy = JSON.stringify({
  transactions: [
    { date: '2026-01-01', payee: 'Keep', cents: 100, memo: 'ok' },
    { date: 'garbage', payee: 'Drop', cents: 100, memo: 'bad date' },
    { date: '2026-01-02', payee: '', cents: 100, memo: 'blank payee' },
    { date: '2026-01-03', payee: 'AlsoKeep', cents: 250, memo: '' },
  ],
});
const recovered = C.fromJSON(messy);
eq(recovered.length, 2, 'corrupt rows skipped, good rows kept');
deepEq(recovered.map((t) => t.payee), ['Keep', 'AlsoKeep'], 'only valid rows survive import');

throwsCode(() => C.fromJSON('{not json'), 'BAD_JSON', 'invalid JSON rejected');
throwsCode(() => C.fromJSON('{"nope": 1}'), 'BAD_SHAPE', 'JSON without transactions rejected');
// A bare array of rows is also accepted.
eq(C.fromJSON('[{"date":"2026-01-01","payee":"P","cents":500,"memo":""}]').length, 1, 'bare array import');

// --- CSV export -----------------------------------------------------------

const csv = C.toCSV([
  { id: 't1', date: '2026-01-01', payee: 'Red, Cross', cents: 5000, memo: 'say "hi"' },
]);
const lines = csv.split('\r\n');
eq(lines[0], '"Date","Payee","Amount","Memo"', 'CSV header quoted');
eq(lines[1], '"2026-01-01","Red, Cross","50.00","say ""hi"""', 'CSV escapes commas and quotes');

// --- Report ---------------------------------------------------------------

if (failed) {
  console.error(`\n${passed} passed, ${failed} failed.`);
  process.exit(1);
} else {
  console.log(`${passed} passed, ${failed} failed.`);
}
