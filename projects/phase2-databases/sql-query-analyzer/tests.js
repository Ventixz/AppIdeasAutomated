/*
 * tests.js — dependency-free test suite for sql-core.js.
 *
 *     node tests.js
 *
 * No framework. Grouped by the three hard parts of the project, plus broad
 * coverage of the engine and the analyzer.
 */
'use strict';

const {
  Database, tokenize, parse, renderPlan, compareValues, likeToRegex, conjuncts, SqlError,
} = require('./sql-core.js');

let passed = 0, failed = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  if (!pass) msg += `  (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`;
  ok(pass, msg);
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  ok(threw, msg);
}
function section(name) { console.log('\n' + name); }

// Helper: a fresh database seeded with a users table.
function seedUsers(n, withIndex = false) {
  const db = new Database();
  db.exec('CREATE TABLE users (id INTEGER, name TEXT, city TEXT, age INTEGER)');
  const cities = ['NYC', 'LA', 'SF', 'ATX', 'SEA'];
  const vals = [];
  for (let i = 1; i <= n; i++) {
    vals.push(`(${i}, 'user${i}', '${cities[i % cities.length]}', ${18 + (i % 50)})`);
  }
  db.exec(`INSERT INTO users (id, name, city, age) VALUES ${vals.join(',')}`);
  if (withIndex) db.exec('CREATE INDEX idx_users_city ON users(city)');
  return db;
}

/* ===================================================================== *
 * Group 1 — Tokenizer & parser: SQL is parsed, not split on keywords.
 * ===================================================================== */
section('Group 1 — Tokenizer & parser (TRAP 1)');

// A keyword inside a string literal must NOT become a clause boundary.
(() => {
  const toks = tokenize("SELECT * FROM t WHERE note = 'the where and from clause'");
  const strToks = toks.filter((t) => t.type === 'str');
  eq(strToks.length, 1, 'exactly one string literal recognized');
  eq(strToks[0].value, 'the where and from clause', 'string keeps embedded keywords verbatim');
  const kws = toks.filter((t) => t.type === 'kw').map((t) => t.value);
  eq(kws, ['select', 'from', 'where'], 'keywords inside the string are NOT tokenized as keywords');
})();

// Doubled single-quote is an escaped quote inside a string.
(() => {
  const toks = tokenize("SELECT 'O''Brien'");
  eq(toks.find((t) => t.type === 'str').value, "O'Brien", "doubled '' is an escaped quote");
})();

// Multi-char operators are single tokens; '<=' is not '<' then '='.
(() => {
  const toks = tokenize('a <= b <> c >= d');
  const ops = toks.filter((t) => t.type === 'op').map((t) => t.value);
  eq(ops, ['<=', '<>', '>='], 'multi-character operators tokenize as one token each');
})();

// Comments are stripped.
(() => {
  const toks = tokenize('SELECT 1 -- a comment\n , 2 /* block */ , 3');
  const nums = toks.filter((t) => t.type === 'num').map((t) => t.value);
  eq(nums, [1, 2, 3], 'line and block comments are ignored');
})();

// AND binds tighter than OR:  a OR b AND c  ==  a OR (b AND c)
(() => {
  const ast = parse('SELECT 1 WHERE a OR b AND c')[0];
  eq(ast.where.op, 'or', 'top of "a OR b AND c" is OR');
  eq(ast.where.right.op, 'and', 'right child of OR is the AND group');
})();

// Comparison binds tighter than AND:  x = 1 AND y = 2
(() => {
  const ast = parse('SELECT 1 WHERE x = 1 AND y = 2')[0];
  eq(ast.where.op, 'and', 'top is AND');
  eq(ast.where.left.kind, 'compare', 'left of AND is a comparison, not a column');
})();

// Arithmetic precedence: 2 + 3 * 4 parses as 2 + (3*4)
(() => {
  const db = new Database();
  const r = db.run('SELECT 2 + 3 * 4 AS v');
  eq(r.rows[0][0], 14, 'multiplication binds tighter than addition (=> 14, not 20)');
})();

// Qualified column refs and quoted identifiers parse.
(() => {
  const ast = parse('SELECT u.id, "weird col" FROM users u')[0];
  eq(ast.columns[0].expr.table, 'u', 'qualified column keeps its table alias');
})();

// Syntax errors are reported, not silently accepted.
throws(() => parse('SELECT FROM'), 'SELECT FROM is a parse error');
throws(() => parse('SELECT * FROM t WHERE'), 'dangling WHERE is a parse error');

/* ===================================================================== *
 * Group 2 — Execution correctness against a local database.
 * ===================================================================== */
section('Group 2 — Query execution');

(() => {
  const db = seedUsers(10);
  const r = db.run("SELECT id, name FROM users WHERE city = 'NYC' ORDER BY id");
  ok(r.rows.length > 0, 'equality filter returns rows');
  ok(r.rows.every((row) => typeof row[0] === 'number'), 'projected id column is numeric');
  // every returned user really is in NYC
  const all = db.run('SELECT id, city FROM users').rows;
  const nycIds = all.filter((x) => x[1] === 'NYC').map((x) => x[0]).sort((a, b) => a - b);
  eq(r.rows.map((x) => x[0]), nycIds, 'filter result matches a manual filter of the table');
})();

// ORDER BY DESC + LIMIT
(() => {
  const db = seedUsers(20);
  const r = db.run('SELECT id FROM users ORDER BY id DESC LIMIT 3');
  eq(r.rows.map((x) => x[0]), [20, 19, 18], 'ORDER BY DESC + LIMIT returns the top 3');
})();

// Aggregates + GROUP BY
(() => {
  const db = seedUsers(10);
  const r = db.run('SELECT city, COUNT(*) AS n FROM users GROUP BY city ORDER BY city');
  const total = r.rows.reduce((s, row) => s + row[1], 0);
  eq(total, 10, 'GROUP BY counts sum back to the table size');
  ok(r.columns[0] === 'city' && r.columns[1] === 'n', 'group columns and alias are named');
})();

// COUNT / SUM / AVG / MIN / MAX over a known set
(() => {
  const db = new Database();
  db.exec('CREATE TABLE nums (x INTEGER)');
  db.exec('INSERT INTO nums (x) VALUES (1),(2),(3),(4)');
  const r = db.run('SELECT COUNT(*), SUM(x), AVG(x), MIN(x), MAX(x) FROM nums');
  eq(r.rows[0], [4, 10, 2.5, 1, 4], 'aggregate functions compute correctly');
})();

// HAVING filters groups
(() => {
  const db = new Database();
  db.exec('CREATE TABLE t (g TEXT, v INTEGER)');
  db.exec("INSERT INTO t (g,v) VALUES ('a',1),('a',1),('b',1)");
  const r = db.run('SELECT g, COUNT(*) AS n FROM t GROUP BY g HAVING COUNT(*) > 1');
  eq(r.rows, [['a', 2]], 'HAVING keeps only groups with count > 1');
})();

// NULL semantics: comparisons with NULL are not true
(() => {
  const db = new Database();
  db.exec('CREATE TABLE t (x INTEGER)');
  db.exec('INSERT INTO t (x) VALUES (1),(NULL),(3)');
  eq(db.run('SELECT COUNT(*) FROM t WHERE x = 1').rows[0][0], 1, 'NULL does not equal 1');
  eq(db.run('SELECT COUNT(*) FROM t WHERE x IS NULL').rows[0][0], 1, 'IS NULL finds the NULL row');
  eq(db.run('SELECT COUNT(*) FROM t WHERE x IS NOT NULL').rows[0][0], 2, 'IS NOT NULL finds the others');
  eq(db.run('SELECT SUM(x) FROM t').rows[0][0], 4, 'SUM ignores NULLs');
})();

// IN / BETWEEN / LIKE
(() => {
  const db = seedUsers(10);
  eq(db.run("SELECT COUNT(*) FROM users WHERE city IN ('NYC','LA')").rows[0][0],
     db.run("SELECT COUNT(*) FROM users WHERE city = 'NYC' OR city = 'LA'").rows[0][0],
     'IN (...) matches the equivalent OR chain');
  const between = db.run('SELECT COUNT(*) FROM users WHERE age BETWEEN 20 AND 25').rows[0][0];
  const manual = db.run('SELECT COUNT(*) FROM users WHERE age >= 20 AND age <= 25').rows[0][0];
  eq(between, manual, 'BETWEEN a AND b == >= a AND <= b');
  ok(db.run("SELECT COUNT(*) FROM users WHERE name LIKE 'user1%'").rows[0][0] >= 1, 'LIKE prefix matches');
})();

// DISTINCT
(() => {
  const db = seedUsers(10);
  const r = db.run('SELECT DISTINCT city FROM users');
  eq(r.rows.length, 5, 'DISTINCT collapses to the 5 distinct cities');
})();

/* ===================================================================== *
 * Group 3 — Indexes make it measurably more efficient (TRAP 2).
 *
 * The whole promise of the analyzer is that creating a suggested index really
 * does cut rows examined. These tests prove it on the live engine.
 * ===================================================================== */
section('Group 3 — Indexes cut rows examined (TRAP 2)');

(() => {
  const noIdx = seedUsers(10000, false);
  const before = noIdx.run("SELECT id FROM users WHERE city = 'NYC'");
  eq(before.plan.op, 'SeqScan', 'without an index the access is a sequential scan');
  eq(before.stats.rowsExamined, 10000, 'seq scan examines all 10000 rows');

  const withIdx = seedUsers(10000, true);
  const after = withIdx.run("SELECT id FROM users WHERE city = 'NYC'");
  eq(after.plan.op, 'IndexLookup', 'with an index the access is an index lookup');
  ok(after.stats.rowsExamined < 10000 / 4, 'index lookup examines far fewer rows');
  eq(after.rows.length, before.rows.length, 'indexed and non-indexed queries return identical results');
  ok(after.stats.rowsExamined === after.rows.length, 'index lookup examines exactly the matching rows');
})();

// An index is NOT used for a non-sargable predicate (function on the column).
(() => {
  const db = seedUsers(100, true);
  const r = db.run("SELECT id FROM users WHERE UPPER(city) = 'NYC'");
  eq(r.plan.op, 'SeqScan', 'index is NOT used when a function wraps the indexed column');
})();

// An index is NOT used for a range predicate (hash index) — honest modeling.
(() => {
  const db = new Database();
  db.exec('CREATE TABLE t (x INTEGER)');
  db.exec('INSERT INTO t (x) VALUES (1),(2),(3),(4),(5)');
  db.exec('CREATE INDEX idx_t_x ON t(x)');
  const r = db.run('SELECT x FROM t WHERE x > 2');
  eq(r.plan.op, 'SeqScan', 'a hash index does not serve a range predicate');
})();

// Index built AFTER inserts still sees existing rows.
(() => {
  const db = seedUsers(500, false);
  db.exec('CREATE INDEX idx_users_city ON users(city)');
  const r = db.run("SELECT COUNT(*) FROM users WHERE city = 'SF'");
  const manual = seedUsers(500, false).run("SELECT COUNT(*) FROM users WHERE city = 'SF'").rows[0][0];
  eq(r.rows[0][0], manual, 'index created after inserts indexes the existing rows');
})();

/* ===================================================================== *
 * Group 4 — Joins: cost is a product unless the inner side is indexed (TRAP 3).
 * ===================================================================== */
section('Group 4 — Joins and join-order cost (TRAP 3)');

function seedJoin(nUsers, nOrders, indexFk) {
  const db = new Database();
  db.exec('CREATE TABLE users (id INTEGER, name TEXT)');
  db.exec('CREATE TABLE orders (id INTEGER, user_id INTEGER, total REAL)');
  const u = [], o = [];
  for (let i = 1; i <= nUsers; i++) u.push(`(${i}, 'u${i}')`);
  for (let i = 1; i <= nOrders; i++) o.push(`(${i}, ${1 + (i % nUsers)}, ${i * 1.5})`);
  db.exec(`INSERT INTO users (id,name) VALUES ${u.join(',')}`);
  db.exec(`INSERT INTO orders (id,user_id,total) VALUES ${o.join(',')}`);
  if (indexFk) db.exec('CREATE INDEX idx_orders_user ON orders(user_id)');
  return db;
}

(() => {
  const db = seedJoin(100, 1000, false);
  const r = db.run('SELECT users.name, orders.total FROM users JOIN orders ON orders.user_id = users.id');
  // outer users (100) each scan all orders (1000) -> ~100k examined on the inner side
  const joinNode = findPlan(r.plan, 'NestedLoopJoin');
  eq(joinNode.method, 'scan', 'without a FK index the join is a scan join');
  ok(r.stats.rowsExamined >= 100 * 1000 * 0.9, 'unindexed join examines ~ outer*inner rows');
  eq(r.rows.length, 1000, 'join still returns one row per order');

  const dbi = seedJoin(100, 1000, true);
  const ri = dbi.run('SELECT users.name, orders.total FROM users JOIN orders ON orders.user_id = users.id');
  const joinNodeI = findPlan(ri.plan, 'NestedLoopJoin');
  eq(joinNodeI.method, 'index', 'with a FK index the join uses an index lookup');
  ok(ri.stats.rowsExamined < r.stats.rowsExamined / 10, 'indexed join examines an order of magnitude fewer rows');
  eq(ri.rows.length, r.rows.length, 'indexed and unindexed joins return the same number of rows');
})();

// LEFT JOIN keeps unmatched outer rows with NULLs.
(() => {
  const db = new Database();
  db.exec('CREATE TABLE a (id INTEGER)');
  db.exec('CREATE TABLE b (id INTEGER, a_id INTEGER)');
  db.exec('INSERT INTO a (id) VALUES (1),(2),(3)');
  db.exec('INSERT INTO b (id,a_id) VALUES (10,1)');
  const r = db.run('SELECT a.id, b.id FROM a LEFT JOIN b ON b.a_id = a.id ORDER BY a.id');
  eq(r.rows, [[1, 10], [2, null], [3, null]], 'LEFT JOIN emits NULLs for unmatched outer rows');
})();

/* ===================================================================== *
 * Group 5 — The analyzer's advice is correct and verifiable.
 * ===================================================================== */
section('Group 5 — Optimization suggestions');

// Suggests an index for an unindexed equality filter, with a real before/after.
(() => {
  const db = seedUsers(10000, false);
  const r = db.run("SELECT id FROM users WHERE city = 'NYC'");
  const s = r.suggestions.find((x) => x.kind === 'add-index');
  ok(s, 'an add-index suggestion is produced for an unindexed equality filter');
  eq(s.column, 'city', 'suggestion targets the filtered column');
  ok(/CREATE INDEX/.test(s.ddl), 'suggestion includes runnable CREATE INDEX DDL');
  ok(s.before === 10000 && s.after < s.before, 'suggestion carries a concrete before/after row count');

  // Apply the advice and confirm the predicted improvement.
  db.exec(s.ddl);
  const after = db.run("SELECT id FROM users WHERE city = 'NYC'");
  eq(after.stats.rowsExamined, s.after, 'applying the suggested index yields the predicted rows examined');
})();

// No index suggestion once the column is already indexed.
(() => {
  const db = seedUsers(1000, true);
  const r = db.run("SELECT id FROM users WHERE city = 'NYC'");
  ok(!r.suggestions.some((x) => x.kind === 'add-index' && x.column === 'city'),
     'no add-index suggestion when the column is already indexed');
})();

// Suggests a join index for a scan join.
(() => {
  const db = seedJoin(50, 500, false);
  const r = db.run('SELECT users.name FROM users JOIN orders ON orders.user_id = users.id');
  const s = r.suggestions.find((x) => x.kind === 'join-index');
  ok(s, 'a join-index suggestion is produced for a nested-loop scan join');
  eq(s.column, 'user_id', 'join-index suggestion targets the inner join key');
  db.exec(s.ddl);
  const after = db.run('SELECT users.name FROM users JOIN orders ON orders.user_id = users.id');
  eq(findPlan(after.plan, 'NestedLoopJoin').method, 'index', 'applying the join index enables an index join');
})();

// Flags SELECT *, non-sargable LIKE, and function-wrapped predicates.
(() => {
  const db = seedUsers(100, true);
  ok(db.run('SELECT * FROM users').suggestions.some((x) => x.kind === 'select-star'),
     'SELECT * is flagged');
  ok(db.run("SELECT id FROM users WHERE name LIKE '%abc'").suggestions.some((x) => x.kind === 'non-sargable'),
     'leading-wildcard LIKE is flagged as non-sargable');
  ok(db.run("SELECT id FROM users WHERE UPPER(city) = 'NYC'").suggestions.some((x) => x.kind === 'non-sargable'),
     'function-wrapped column predicate is flagged as non-sargable');
})();

/* ===================================================================== *
 * Group 6 — Robustness and helpers.
 * ===================================================================== */
section('Group 6 — Robustness');

throws(() => new Database().run('SELECT * FROM nope'), 'querying a missing table errors clearly');
throws(() => { const d = new Database(); d.exec('CREATE TABLE t (x INTEGER)'); d.run('SELECT bogus FROM t'); },
  'selecting an unknown column errors');
throws(() => { const d = new Database(); d.exec('CREATE TABLE a (x INTEGER)'); d.exec('CREATE TABLE b (x INTEGER)');
  d.run('SELECT x FROM a JOIN b ON a.x = b.x'); }, 'ambiguous unqualified column errors');

// compareValues orders NULLs first, numbers numerically, strings lexically.
eq([3, 1, 2, null].sort(compareValues), [null, 1, 2, 3], 'compareValues sorts NULLs first then numbers');

// likeToRegex handles % and _ and escapes regex metachars.
ok(likeToRegex('a%').test('abc'), '% matches any run');
ok(likeToRegex('a_c').test('abc'), '_ matches one char');
ok(!likeToRegex('a.c').test('axc'), 'literal "." in LIKE is not a regex wildcard');

// conjuncts splits only top-level ANDs, not ANDs under an OR.
(() => {
  const ast = parse('SELECT 1 WHERE a=1 AND b=2 AND c=3')[0];
  eq(conjuncts(ast.where).length, 3, 'three top-level AND conjuncts');
  const ast2 = parse('SELECT 1 WHERE a=1 AND (b=2 OR c=3)')[0];
  eq(conjuncts(ast2.where).length, 2, 'an OR group stays a single conjunct');
})();

// exec runs a multi-statement script and returns the last result.
(() => {
  const db = new Database();
  const last = db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t (x) VALUES (5); SELECT x FROM t');
  eq(last.rows, [[5]], 'exec() runs a semicolon-separated script and returns the final SELECT');
})();

// renderPlan produces a readable, indented tree.
(() => {
  const db = seedUsers(10, true);
  const r = db.run("SELECT id FROM users WHERE city = 'NYC' ORDER BY id");
  const txt = renderPlan(r.plan);
  ok(/IndexLookup/.test(txt) && /examined/.test(txt), 'renderPlan shows the access method and counts');
})();

/* ---- plan search helper ---- */
function findPlan(plan, op) {
  if (plan.op === op) return plan;
  for (const c of plan.children) { const f = findPlan(c, op); if (f) return f; }
  return null;
}

/* ===================================================================== */
console.log('\n' + '='.repeat(52));
if (failed === 0) console.log(`All ${passed} tests passed.`);
else { console.log(`${passed} passed, ${failed} failed.`); fails.forEach((f) => console.log('  - ' + f)); }
console.log('='.repeat(52));
process.exit(failed === 0 ? 0 : 1);
