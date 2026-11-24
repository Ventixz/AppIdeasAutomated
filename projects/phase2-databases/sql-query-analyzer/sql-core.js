/*
 * sql-core.js — a tiny SQL engine and query analyzer, from scratch.
 *
 * No SQL library (no sql.js, no parser generator). This file is a complete,
 * dependency-free pipeline:
 *
 *     tokenize  ->  parse (recursive descent -> AST)
 *               ->  catalog (in-memory tables + indexes)
 *               ->  plan + execute (instrumented: counts ROWS EXAMINED)
 *               ->  analyze (cost-based optimization suggestions)
 *
 * The whole point of the project ("run a query against a local database and
 * look for ways to make it more efficient") lives in two places: the executor
 * counts exactly how many rows each operator touched, and the analyzer turns
 * those counts into concrete, provable advice — e.g. "this full scan examined
 * 10000 rows; an index on users(email) would examine 1". Because the engine
 * can actually use an index once you CREATE one, the advice is verifiable:
 * create the index, re-run, watch rowsExamined collapse.
 *
 * Runs in the browser and under Node. Exported at the bottom both ways.
 */
'use strict';

/* ============================================================= *
 * 1. Tokenizer
 *
 * SQL cannot be understood by splitting on keywords, because a keyword can
 * appear inside a string literal ('the WHERE clause') or inside an identifier
 * ("order"), and operators glue together ('<=' is one token, not two). So we
 * scan character by character and emit typed tokens.
 * ============================================================= */

const KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'in', 'like',
  'between', 'group', 'by', 'having', 'order', 'asc', 'desc', 'limit', 'offset',
  'join', 'inner', 'left', 'on', 'as', 'create', 'table', 'index', 'insert',
  'into', 'values', 'distinct', 'true', 'false',
]);

// Multi-character operators must be tried before single-character ones.
const OPERATORS = ['<=', '>=', '<>', '!=', '==', '=', '<', '>', '+', '-', '*', '/'];

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;

  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_]/.test(c);
  const isDigit = (c) => c >= '0' && c <= '9';

  while (i < n) {
    const c = sql[i];

    // Whitespace
    if (/\s/.test(c)) { i++; continue; }

    // Line comment: -- to end of line
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment: /* ... */
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // String literal: '...'. A doubled quote '' is a literal quote.
    if (c === "'") {
      let str = '';
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { str += "'"; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        str += sql[i++];
      }
      tokens.push({ type: 'str', value: str });
      continue;
    }

    // Double-quoted identifier: "col name"
    if (c === '"') {
      let id = '';
      i++;
      while (i < n && sql[i] !== '"') id += sql[i++];
      i++; // closing quote
      tokens.push({ type: 'ident', value: id, raw: id, quoted: true });
      continue;
    }

    // Number: 12, 12.5, .5, 1e3
    if (isDigit(c) || (c === '.' && isDigit(sql[i + 1]))) {
      let num = '';
      while (i < n && /[0-9.eE+\-]/.test(sql[i])) {
        // stop the exponent sign from eating a following operator
        if ((sql[i] === '+' || sql[i] === '-') && !/[eE]/.test(sql[i - 1])) break;
        num += sql[i++];
      }
      tokens.push({ type: 'num', value: Number(num) });
      continue;
    }

    // Identifier or keyword
    if (isIdentStart(c)) {
      let id = '';
      while (i < n && isIdentPart(sql[i])) id += sql[i++];
      const lower = id.toLowerCase();
      if (KEYWORDS.has(lower)) tokens.push({ type: 'kw', value: lower, raw: id });
      else tokens.push({ type: 'ident', value: lower, raw: id });
      continue;
    }

    // Punctuation
    if (c === '(' || c === ')' || c === ',' || c === ';' || c === '.') {
      tokens.push({ type: 'punc', value: c });
      i++;
      continue;
    }

    // Operators (longest match first)
    let matched = null;
    for (const op of OPERATORS) {
      if (sql.startsWith(op, i)) { matched = op; break; }
    }
    if (matched) {
      tokens.push({ type: 'op', value: matched });
      i += matched.length;
      continue;
    }

    throw new SqlError(`Unexpected character '${c}' at position ${i}`);
  }

  tokens.push({ type: 'eof', value: null });
  return tokens;
}

class SqlError extends Error {
  constructor(message) { super(message); this.name = 'SqlError'; }
}

/* ============================================================= *
 * 2. Parser — recursive descent producing an AST.
 *
 * Precedence is encoded in the call chain (OR < AND < NOT < comparison <
 * add/sub < mul/div < primary), which is the only correct way to get
 * `a OR b AND c` to mean `a OR (b AND c)`.
 * ============================================================= */

class Parser {
  constructor(tokens) { this.t = tokens; this.pos = 0; }

  peek(k = 0) { return this.t[this.pos + k]; }
  next() { return this.t[this.pos++]; }
  atEnd() { const tk = this.peek(); return tk.type === 'eof'; }

  isKw(w) { const tk = this.peek(); return tk.type === 'kw' && tk.value === w; }
  isPunc(p) { const tk = this.peek(); return tk.type === 'punc' && tk.value === p; }
  isOp(o) { const tk = this.peek(); return tk.type === 'op' && tk.value === o; }

  eatKw(w) {
    if (!this.isKw(w)) this.err(`expected '${w.toUpperCase()}'`);
    return this.next();
  }
  eatPunc(p) {
    if (!this.isPunc(p)) this.err(`expected '${p}'`);
    return this.next();
  }
  err(msg) {
    const tk = this.peek();
    const got = tk.type === 'eof' ? 'end of input' : `'${tk.raw ?? tk.value}'`;
    throw new SqlError(`Parse error: ${msg}, got ${got}`);
  }

  // Parse all statements separated by ';'
  parseProgram() {
    const stmts = [];
    while (!this.atEnd()) {
      if (this.isPunc(';')) { this.next(); continue; }
      stmts.push(this.parseStatement());
      if (this.isPunc(';')) this.next();
    }
    return stmts;
  }

  parseStatement() {
    if (this.isKw('select')) return this.parseSelect();
    if (this.isKw('create')) return this.parseCreate();
    if (this.isKw('insert')) return this.parseInsert();
    this.err('expected a statement (SELECT, CREATE, INSERT)');
  }

  parseCreate() {
    this.eatKw('create');
    if (this.isKw('table')) return this.parseCreateTable();
    if (this.isKw('index')) return this.parseCreateIndex();
    this.err("expected TABLE or INDEX after CREATE");
  }

  parseCreateTable() {
    this.eatKw('table');
    const name = this.parseIdentName();
    this.eatPunc('(');
    const columns = [];
    do {
      const col = this.parseIdentName();
      let type = 'text';
      const tk = this.peek();
      if (tk.type === 'kw' && ['integer', 'text', 'real'].includes(tk.value)) {
        type = this.next().value;
      } else if (tk.type === 'ident' && ['integer', 'int', 'text', 'real', 'string', 'number'].includes(tk.value)) {
        type = this.next().value;
      }
      columns.push({ name: col, type });
    } while (this.isPunc(',') && this.next());
    this.eatPunc(')');
    return { type: 'createTable', name, columns };
  }

  parseCreateIndex() {
    this.eatKw('index');
    const name = this.parseIdentName();
    this.eatKw('on');
    const table = this.parseIdentName();
    this.eatPunc('(');
    const column = this.parseIdentName();
    this.eatPunc(')');
    return { type: 'createIndex', name, table, column };
  }

  parseInsert() {
    this.eatKw('insert');
    this.eatKw('into');
    const table = this.parseIdentName();
    let columns = null;
    if (this.isPunc('(')) {
      this.next();
      columns = [];
      do { columns.push(this.parseIdentName()); } while (this.isPunc(',') && this.next());
      this.eatPunc(')');
    }
    this.eatKw('values');
    const rows = [];
    do {
      this.eatPunc('(');
      const vals = [];
      do { vals.push(this.parseExpr()); } while (this.isPunc(',') && this.next());
      this.eatPunc(')');
      rows.push(vals);
    } while (this.isPunc(',') && this.next());
    return { type: 'insert', table, columns, rows };
  }

  parseSelect() {
    this.eatKw('select');
    let distinct = false;
    if (this.isKw('distinct')) { distinct = true; this.next(); }

    const columns = [];
    do {
      if (this.isOp('*')) {
        this.next();
        columns.push({ kind: 'star' });
      } else {
        // table.* ?
        if (this.peek().type === 'ident' && this.peek(1).type === 'punc'
            && this.peek(1).value === '.' && this.peek(2).type === 'op'
            && this.peek(2).value === '*') {
          const tbl = this.next().value; this.next(); this.next();
          columns.push({ kind: 'star', table: tbl });
        } else {
          const expr = this.parseExpr();
          let alias = null;
          if (this.isKw('as')) { this.next(); alias = this.parseIdentName(); }
          else if (this.peek().type === 'ident') { alias = this.next().value; }
          columns.push({ kind: 'expr', expr, alias });
        }
      }
    } while (this.isPunc(',') && this.next());

    let from = null;
    const joins = [];
    if (this.isKw('from')) {
      this.next();
      from = this.parseTableRef();
      while (this.isKw('join') || this.isKw('inner') || this.isKw('left')) {
        let joinType = 'inner';
        if (this.isKw('left')) { joinType = 'left'; this.next(); }
        else if (this.isKw('inner')) { this.next(); }
        this.eatKw('join');
        const tbl = this.parseTableRef();
        this.eatKw('on');
        const on = this.parseExpr();
        joins.push({ joinType, table: tbl, on });
      }
    }

    let where = null;
    if (this.isKw('where')) { this.next(); where = this.parseExpr(); }

    let groupBy = null;
    if (this.isKw('group')) {
      this.next(); this.eatKw('by');
      groupBy = [];
      do { groupBy.push(this.parseExpr()); } while (this.isPunc(',') && this.next());
    }

    let having = null;
    if (this.isKw('having')) { this.next(); having = this.parseExpr(); }

    let orderBy = null;
    if (this.isKw('order')) {
      this.next(); this.eatKw('by');
      orderBy = [];
      do {
        const expr = this.parseExpr();
        let dir = 'asc';
        if (this.isKw('asc')) { this.next(); }
        else if (this.isKw('desc')) { dir = 'desc'; this.next(); }
        orderBy.push({ expr, dir });
      } while (this.isPunc(',') && this.next());
    }

    let limit = null, offset = null;
    if (this.isKw('limit')) {
      this.next();
      limit = this.parseExpr();
      if (this.isKw('offset')) { this.next(); offset = this.parseExpr(); }
    }

    return { type: 'select', distinct, columns, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  parseTableRef() {
    const name = this.parseIdentName();
    let alias = null;
    if (this.isKw('as')) { this.next(); alias = this.parseIdentName(); }
    else if (this.peek().type === 'ident') { alias = this.next().value; }
    return { name, alias: alias || name };
  }

  parseIdentName() {
    const tk = this.peek();
    if (tk.type === 'ident') { this.next(); return tk.value; }
    this.err('expected an identifier');
  }

  /* ---- expression grammar ---- */
  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.isKw('or')) { this.next(); const right = this.parseAnd(); left = { kind: 'logical', op: 'or', left, right }; }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.isKw('and')) { this.next(); const right = this.parseNot(); left = { kind: 'logical', op: 'and', left, right }; }
    return left;
  }
  parseNot() {
    if (this.isKw('not')) { this.next(); return { kind: 'not', expr: this.parseNot() }; }
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parseAdd();
    const tk = this.peek();
    if (tk.type === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(tk.value)) {
      const op = this.next().value;
      const right = this.parseAdd();
      return { kind: 'compare', op: normalizeOp(op), left, right };
    }
    if (this.isKw('is')) {
      this.next();
      let neg = false;
      if (this.isKw('not')) { neg = true; this.next(); }
      this.eatKw('null');
      return { kind: 'isnull', neg, expr: left };
    }
    if (this.isKw('like')) {
      this.next();
      const right = this.parseAdd();
      return { kind: 'like', left, right };
    }
    if (this.isKw('in')) {
      this.next();
      this.eatPunc('(');
      const list = [];
      do { list.push(this.parseExpr()); } while (this.isPunc(',') && this.next());
      this.eatPunc(')');
      return { kind: 'in', left, list };
    }
    if (this.isKw('between')) {
      this.next();
      const lo = this.parseAdd();
      this.eatKw('and');
      const hi = this.parseAdd();
      return { kind: 'between', expr: left, lo, hi };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      const right = this.parseMul();
      left = { kind: 'arith', op, left, right };
    }
    return left;
  }
  parseMul() {
    let left = this.parsePrimary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next().value;
      const right = this.parsePrimary();
      left = { kind: 'arith', op, left, right };
    }
    return left;
  }
  parsePrimary() {
    const tk = this.peek();
    if (tk.type === 'num') { this.next(); return { kind: 'lit', value: tk.value }; }
    if (tk.type === 'str') { this.next(); return { kind: 'lit', value: tk.value }; }
    if (this.isKw('null')) { this.next(); return { kind: 'lit', value: null }; }
    if (this.isKw('true')) { this.next(); return { kind: 'lit', value: 1 }; }
    if (this.isKw('false')) { this.next(); return { kind: 'lit', value: 0 }; }
    if (this.isPunc('(')) {
      this.next();
      const e = this.parseExpr();
      this.eatPunc(')');
      return e;
    }
    if (tk.type === 'ident') {
      // function call?  name( ... )
      if (this.peek(1).type === 'punc' && this.peek(1).value === '(') {
        const fn = this.next().value; this.next(); // consume name and '('
        let arg = null, star = false, distinct = false;
        if (this.isOp('*')) { this.next(); star = true; }
        else if (!this.isPunc(')')) {
          if (this.isKw('distinct')) { distinct = true; this.next(); }
          arg = this.parseExpr();
        }
        this.eatPunc(')');
        return { kind: 'func', name: fn, arg, star, distinct };
      }
      // column reference (optionally qualified a.b)
      let table = null, column = tk.value;
      this.next();
      if (this.isPunc('.')) {
        this.next();
        const colTk = this.peek();
        if (colTk.type !== 'ident') this.err('expected column name after "."');
        table = column; column = this.next().value;
      }
      return { kind: 'col', table, column };
    }
    this.err('expected an expression');
  }
}

function normalizeOp(op) {
  if (op === '==') return '=';
  if (op === '!=') return '<>';
  return op;
}

function parse(sql) { return new Parser(tokenize(sql)).parseProgram(); }

/* ============================================================= *
 * 3. Catalog — tables and indexes held in memory.
 * ============================================================= */

class Table {
  constructor(name, columns) {
    this.name = name;
    this.columns = columns;                   // [{name, type}]
    this.colNames = columns.map((c) => c.name);
    this.rows = [];                           // array of plain objects keyed by column name
    this.indexes = new Map();                 // column -> Index
  }
  columnType(col) {
    const c = this.columns.find((x) => x.name === col);
    return c ? c.type : null;
  }
  hasColumn(col) { return this.colNames.includes(col); }
}

class Index {
  // A hash index: equality lookups in O(1); range scans fall back to a seq
  // scan (we model that honestly in the planner).
  constructor(name, column) {
    this.name = name;
    this.column = column;
    this.map = new Map();   // value-key -> array of row references
  }
  static keyOf(v) {
    if (v === null || v === undefined) return '\u0000NULL';
    return typeof v + ':' + v;
  }
  add(row) {
    const k = Index.keyOf(row[this.column]);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(row);
  }
  lookup(v) { return this.map.get(Index.keyOf(v)) || []; }
  get distinctKeys() { return this.map.size; }
}

/* ============================================================= *
 * 4. Expression evaluation (NULL-aware, SQL-ish three-valued logic).
 * ============================================================= */

function sqlTruthy(v) { return v !== null && v !== undefined && v !== false && v !== 0 && v !== ''; }

function compareValues(a, b) {
  // returns -1 / 0 / 1 ; NULLs sort first
  if (a === null || a === undefined) return (b === null || b === undefined) ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const as = String(a), bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function likeToRegex(pattern) {
  let re = '^';
  for (const ch of String(pattern)) {
    if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'i');
}

// env: { alias -> rowObject }.  Evaluates an AST node to a scalar value.
function evalExpr(node, env, aggValues) {
  switch (node.kind) {
    case 'lit': return node.value;
    case 'col': return resolveColumn(node, env);
    case 'func': {
      if (aggValues && isAggregate(node.name)) {
        // aggregate results are pre-computed and keyed by a stable signature
        const sig = aggSignature(node);
        if (sig in aggValues) return aggValues[sig];
      }
      return applyScalarFunc(node, env, aggValues);
    }
    case 'arith': {
      const l = evalExpr(node.left, env, aggValues);
      const r = evalExpr(node.right, env, aggValues);
      if (l === null || r === null) return null;
      const a = Number(l), b = Number(r);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
      }
      return null;
    }
    case 'compare': {
      const l = evalExpr(node.left, env, aggValues);
      const r = evalExpr(node.right, env, aggValues);
      if (l === null || r === null) return null; // unknown
      const c = compareValues(l, r);
      switch (node.op) {
        case '=': return c === 0;
        case '<>': return c !== 0;
        case '<': return c < 0;
        case '<=': return c <= 0;
        case '>': return c > 0;
        case '>=': return c >= 0;
      }
      return null;
    }
    case 'logical': {
      const l = evalExpr(node.left, env, aggValues);
      if (node.op === 'and') {
        if (l === false || (l !== null && !sqlTruthy(l))) return false;
        const r = evalExpr(node.right, env, aggValues);
        if (l === null || r === null) return (sqlTruthy(l) === false || sqlTruthy(r) === false) ? false : null;
        return sqlTruthy(l) && sqlTruthy(r);
      } else {
        const r = evalExpr(node.right, env, aggValues);
        if (sqlTruthy(l) || sqlTruthy(r)) return true;
        if (l === null || r === null) return null;
        return false;
      }
    }
    case 'not': {
      const v = evalExpr(node.expr, env, aggValues);
      if (v === null) return null;
      return !sqlTruthy(v);
    }
    case 'isnull': {
      const v = evalExpr(node.expr, env, aggValues);
      const isNull = v === null || v === undefined;
      return node.neg ? !isNull : isNull;
    }
    case 'like': {
      const l = evalExpr(node.left, env, aggValues);
      const r = evalExpr(node.right, env, aggValues);
      if (l === null || r === null) return null;
      return likeToRegex(r).test(String(l));
    }
    case 'in': {
      const l = evalExpr(node.left, env, aggValues);
      if (l === null) return null;
      for (const item of node.list) {
        const v = evalExpr(item, env, aggValues);
        if (v !== null && compareValues(l, v) === 0) return true;
      }
      return false;
    }
    case 'between': {
      const v = evalExpr(node.expr, env, aggValues);
      const lo = evalExpr(node.lo, env, aggValues);
      const hi = evalExpr(node.hi, env, aggValues);
      if (v === null || lo === null || hi === null) return null;
      return compareValues(v, lo) >= 0 && compareValues(v, hi) <= 0;
    }
    default:
      throw new SqlError(`Cannot evaluate node of kind '${node.kind}'`);
  }
}

function resolveColumn(node, env) {
  const { table, column } = node;
  if (table) {
    const row = env[table];
    if (!row) throw new SqlError(`Unknown table/alias '${table}'`);
    if (!(column in row)) throw new SqlError(`Unknown column '${table}.${column}'`);
    return row[column];
  }
  // unqualified: search all aliases, error if ambiguous
  let found, count = 0;
  for (const alias in env) {
    if (column in env[alias]) { found = env[alias][column]; count++; }
  }
  if (count === 0) throw new SqlError(`Unknown column '${column}'`);
  if (count > 1) throw new SqlError(`Ambiguous column '${column}'`);
  return found;
}

function applyScalarFunc(node, env) {
  const name = node.name;
  const a = node.arg ? evalExpr(node.arg, env) : null;
  switch (name) {
    case 'upper': return a === null ? null : String(a).toUpperCase();
    case 'lower': return a === null ? null : String(a).toLowerCase();
    case 'length': return a === null ? null : String(a).length;
    case 'abs': return a === null ? null : Math.abs(Number(a));
    case 'round': return a === null ? null : Math.round(Number(a));
    default:
      throw new SqlError(`Unknown function '${name.toUpperCase()}'`);
  }
}

const AGG_FUNCS = new Set(['count', 'sum', 'avg', 'min', 'max']);
function isAggregate(name) { return AGG_FUNCS.has(name); }
function aggSignature(node) {
  return node.name + '|' + (node.star ? '*' : exprKey(node.arg)) + (node.distinct ? '|d' : '');
}
function exprKey(node) {
  if (!node) return '';
  switch (node.kind) {
    case 'lit': return 'L' + JSON.stringify(node.value);
    case 'col': return 'C' + (node.table ? node.table + '.' : '') + node.column;
    case 'arith': return `(${exprKey(node.left)}${node.op}${exprKey(node.right)})`;
    case 'func': return node.name + '(' + (node.star ? '*' : exprKey(node.arg)) + ')';
    default: return node.kind;
  }
}

/* ============================================================= *
 * 5. Planner + executor (instrumented).
 *
 * Every operator records how many rows it examined. That single number is
 * what the analyzer later turns into advice — so the counting is not cosmetic,
 * it is the product.
 * ============================================================= */

class Plan {
  constructor(op, extra = {}) {
    this.op = op;
    this.rowsExamined = 0;
    this.rowsOut = 0;
    this.children = [];
    Object.assign(this, extra);
  }
  addChild(p) { this.children.push(p); return p; }
  totalExamined() {
    return this.rowsExamined + this.children.reduce((s, c) => s + c.totalExamined(), 0);
  }
}

// Decompose a WHERE AST into top-level AND conjuncts (so we can match a single
// conjunct against an index without being fooled by OR).
function conjuncts(node, out = []) {
  if (node && node.kind === 'logical' && node.op === 'and') {
    conjuncts(node.left, out);
    conjuncts(node.right, out);
  } else if (node) {
    out.push(node);
  }
  return out;
}

// Is `expr` a bare column reference to the given alias?
function colOf(expr, alias) {
  if (expr.kind !== 'col') return null;
  if (expr.table && expr.table !== alias) return null;
  return expr.column;
}

// Find an equality conjunct `col = <const>` usable by an index on `alias`.
// Returns { column, valueNode } or null. "const" here means: contains no
// reference to `alias` (so it can be evaluated once, before scanning).
function findIndexableEquality(whereConjuncts, alias, table) {
  for (const c of whereConjuncts) {
    if (c.kind !== 'compare' || c.op !== '=') continue;
    let col = colOf(c.left, alias), valueNode = c.right;
    if (col === null) { col = colOf(c.right, alias); valueNode = c.left; }
    if (col === null) continue;
    if (!table.indexes.has(col)) continue;
    if (referencesAlias(valueNode, alias)) continue;
    return { column: col, valueNode, conjunct: c };
  }
  return null;
}

function referencesAlias(node, alias) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'col') return !node.table || node.table === alias;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { if (v.some((x) => referencesAlias(x, alias))) return true; }
    else if (v && typeof v === 'object') { if (referencesAlias(v, alias)) return true; }
  }
  return false;
}

// Scan one base table, using an index when a sargable equality is present, and
// applying all pushed-down single-table predicates INLINE. "rowsExamined"
// counts only rows read from storage (the whole table for a seq scan, or just
// the matching bucket for an index lookup) — filtering the examined rows does
// not add to the count, exactly as a real engine reports it. That is why
// creating an index visibly collapses the number.
// Produces { rows: [envRowFragment], plan }.
function scanTable(db, tableRef, pushConjuncts) {
  const table = db.getTable(tableRef.name);
  const alias = tableRef.alias;
  const hit = findIndexableEquality(pushConjuncts, alias, table);

  let read, plan, consumed = null;
  if (hit) {
    const value = evalExpr(hit.valueNode, {}); // constant
    read = table.indexes.get(hit.column).lookup(value);
    consumed = hit.conjunct;
    plan = new Plan('IndexLookup', {
      table: table.name, alias, index: table.indexes.get(hit.column).name,
      key: `${hit.column} = ${fmtVal(value)}`,
    });
  } else {
    read = table.rows;
    plan = new Plan('SeqScan', { table: table.name, alias });
  }
  plan.rowsExamined = read.length;

  // Apply every remaining single-table predicate as an inline filter.
  const residual = pushConjuncts.filter((c) => c !== consumed);
  let out = read.map((r) => ({ [alias]: r }));
  if (residual.length) {
    out = out.filter((env) => residual.every((c) => sqlTruthy(evalExpr(c, env))));
  }
  plan.rowsOut = out.length;
  return { rows: out, plan };
}

function fmtVal(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

function mergeEnv(a, b) { return Object.assign({}, a, b); }

// Build alias -> Table for the tables in a SELECT's scope.
function scopeTables(db, ast) {
  const m = new Map();
  for (const tr of [ast.from, ...ast.joins.map((j) => j.table)].filter(Boolean)) {
    m.set(tr.alias, db.getTable(tr.name));
  }
  return m;
}

// Which aliases does an expression touch? Unqualified columns resolve against
// the scope (and may be ambiguous -> they touch every table that has the
// column, which keeps such predicates out of single-table pushdown).
function exprAliases(node, scope, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.kind === 'col') {
    if (node.table) out.add(node.table);
    else for (const [alias, t] of scope) if (t.hasColumn(node.column)) out.add(alias);
    return out;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => exprAliases(x, scope, out));
    else if (v && typeof v === 'object') exprAliases(v, scope, out);
  }
  return out;
}

// Static check that every column reference resolves against the schema, so an
// unknown or ambiguous column errors even when the data set is empty.
function validateColumns(db, ast) {
  const scope = scopeTables(db, ast);
  const check = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'col') {
      if (node.table) {
        const t = scope.get(node.table);
        if (!t) throw new SqlError(`Unknown table/alias '${node.table}'`);
        if (!t.hasColumn(node.column)) throw new SqlError(`Unknown column '${node.table}.${node.column}'`);
      } else {
        let count = 0;
        for (const t of scope.values()) if (t.hasColumn(node.column)) count++;
        if (count === 0) throw new SqlError(`Unknown column '${node.column}'`);
        if (count > 1) throw new SqlError(`Ambiguous column '${node.column}'`);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(check);
      else if (v && typeof v === 'object') check(v);
    }
  };
  for (const item of ast.columns) if (item.kind === 'expr') check(item.expr);
  if (ast.where) check(ast.where);
  for (const j of ast.joins) check(j.on);
  if (ast.groupBy) ast.groupBy.forEach(check);
  if (ast.having) check(ast.having);
  if (ast.orderBy) ast.orderBy.forEach((o) => check(o.expr));
}

function executeSelect(db, ast) {
  const where = ast.where;
  const whereConjs = where ? conjuncts(where) : [];

  if (!ast.from) {
    // SELECT with no FROM — evaluate a single row of expressions.
    const env = {};
    const root = new Plan('Result');
    root.rowsOut = 1;
    const cols = [], row = [];
    for (const item of ast.columns) {
      if (item.kind === 'star') throw new SqlError('SELECT * requires a FROM clause');
      cols.push(item.alias || exprLabel(item.expr));
      row.push(evalExpr(item.expr, env));
    }
    return { columns: cols, rows: [row], plan: root };
  }

  // --- FROM + JOINs: left-deep nested loop, with predicate pushdown ---
  const scope = scopeTables(db, ast);
  // A conjunct that touches exactly one table is pushed into that table's scan.
  const consumed = new Set();
  const pushFor = (alias) => whereConjs.filter((c) => {
    const al = exprAliases(c, scope);
    if (al.size === 1 && al.has(alias)) { consumed.add(c); return true; }
    return false;
  });

  const baseConjs = pushFor(ast.from.alias);
  const scan0 = scanTable(db, ast.from, baseConjs);
  let rows = scan0.rows;
  let rootPlan = scan0.plan;

  for (const join of ast.joins) {
    const innerRef = join.table;
    const innerTable = db.getTable(innerRef.name);
    const innerAlias = innerRef.alias;
    const innerConjs = pushFor(innerAlias); // single-table WHERE preds on the inner side

    // Can we probe the inner table by an index on its ON-equality column?
    const onConjs = conjuncts(join.on);
    let probe = null;
    for (const c of onConjs) {
      if (c.kind !== 'compare' || c.op !== '=') continue;
      let innerCol = colOf(c.left, innerAlias), outerSide = c.right;
      if (innerCol === null) { innerCol = colOf(c.right, innerAlias); outerSide = c.left; }
      if (innerCol === null) continue;
      if (!innerTable.indexes.has(innerCol)) continue;
      probe = { innerCol, outerSide };
      break;
    }

    const joinPlan = new Plan('NestedLoopJoin', {
      joinType: join.joinType,
      method: probe ? 'index' : 'scan',
      inner: innerTable.name, innerAlias,
      indexUsed: probe ? innerTable.indexes.get(probe.innerCol).name : null,
    });
    joinPlan.addChild(rootPlan);

    const scanPlan = new Plan(probe ? 'IndexLookup' : 'SeqScan',
      { table: innerTable.name, alias: innerAlias, index: probe ? innerTable.indexes.get(probe.innerCol).name : undefined });
    joinPlan.addChild(scanPlan);

    const outRows = [];
    for (const env of rows) {
      let candidates;
      if (probe) {
        const key = evalExpr(probe.outerSide, env);
        candidates = innerTable.indexes.get(probe.innerCol).lookup(key);
      } else {
        candidates = innerTable.rows;
      }
      scanPlan.rowsExamined += candidates.length;
      let matched = 0;
      for (const ir of candidates) {
        const merged = mergeEnv(env, { [innerAlias]: ir });
        if (!sqlTruthy(evalExpr(join.on, merged))) continue;
        if (innerConjs.length && !innerConjs.every((c) => sqlTruthy(evalExpr(c, merged)))) continue;
        outRows.push(merged); matched++;
      }
      if (join.joinType === 'left' && matched === 0) {
        const nulls = {};
        for (const col of innerTable.colNames) nulls[col] = null;
        outRows.push(mergeEnv(env, { [innerAlias]: nulls }));
      }
    }
    scanPlan.rowsOut = outRows.length;
    joinPlan.rowsOut = outRows.length;
    rows = outRows;
    rootPlan = joinPlan;
  }

  // --- WHERE (only predicates not pushed into a scan: multi-table ones) ---
  const residual = whereConjs.filter((c) => !consumed.has(c));
  if (residual.length) {
    const filterPlan = new Plan('Filter', { predicate: residual.map(exprLabel).join(' AND ') });
    filterPlan.addChild(rootPlan);
    filterPlan.rowsExamined = rows.length;
    rows = rows.filter((env) => residual.every((c) => sqlTruthy(evalExpr(c, env))));
    filterPlan.rowsOut = rows.length;
    rootPlan = filterPlan;
  }

  // --- aggregation / GROUP BY ---
  const aggNodes = collectAggregates(ast);
  const hasGroup = !!ast.groupBy || aggNodes.length > 0;
  let resultRows;      // array of { env, aggValues }
  if (hasGroup) {
    const aggPlan = new Plan(ast.groupBy ? 'GroupAggregate' : 'Aggregate');
    aggPlan.addChild(rootPlan);
    aggPlan.rowsExamined = rows.length;

    const groups = new Map();
    for (const env of rows) {
      const keyParts = ast.groupBy ? ast.groupBy.map((g) => evalExpr(g, env)) : ['__all__'];
      const key = JSON.stringify(keyParts);
      let g = groups.get(key);
      if (!g) { g = { env, rows: [] }; groups.set(key, g); }
      g.rows.push(env);
    }
    if (!ast.groupBy && groups.size === 0) {
      // aggregate over empty set still yields one row
      groups.set('[]', { env: {}, rows: [] });
    }

    resultRows = [];
    for (const g of groups.values()) {
      const aggValues = computeAggregates(aggNodes, g.rows);
      resultRows.push({ env: g.env, aggValues });
    }
    aggPlan.rowsOut = resultRows.length;
    rootPlan = aggPlan;
  } else {
    resultRows = rows.map((env) => ({ env, aggValues: {} }));
  }

  // --- HAVING ---
  if (ast.having) {
    const hp = new Plan('Having', { predicate: exprLabel(ast.having) });
    hp.addChild(rootPlan);
    hp.rowsExamined = resultRows.length;
    resultRows = resultRows.filter((r) => sqlTruthy(evalExpr(ast.having, r.env, r.aggValues)));
    hp.rowsOut = resultRows.length;
    rootPlan = hp;
  }

  // --- projection (compute output columns) ---
  const { names, exprs } = expandSelectList(db, ast);
  let projected = resultRows.map((r) => ({
    key: r,
    values: exprs.map((e) => evalExpr(e, r.env, r.aggValues)),
  }));

  // --- DISTINCT ---
  if (ast.distinct) {
    const seen = new Set();
    projected = projected.filter((p) => {
      const k = JSON.stringify(p.values);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  // --- ORDER BY ---
  if (ast.orderBy) {
    const sortPlan = new Plan('Sort', { keys: ast.orderBy.map((o) => exprLabel(o.expr) + ' ' + o.dir) });
    sortPlan.addChild(rootPlan);
    sortPlan.rowsExamined = projected.length;
    projected.sort((a, b) => {
      for (const o of ast.orderBy) {
        const av = evalExpr(o.expr, a.key.env, a.key.aggValues);
        const bv = evalExpr(o.expr, b.key.env, b.key.aggValues);
        const c = compareValues(av, bv);
        if (c !== 0) return o.dir === 'desc' ? -c : c;
      }
      return 0;
    });
    sortPlan.rowsOut = projected.length;
    rootPlan = sortPlan;
  }

  // --- LIMIT / OFFSET ---
  if (ast.limit !== null) {
    const lim = Number(evalExpr(ast.limit, {}));
    const off = ast.offset !== null ? Number(evalExpr(ast.offset, {})) : 0;
    const limPlan = new Plan('Limit', { limit: lim, offset: off });
    limPlan.addChild(rootPlan);
    projected = projected.slice(off, off + lim);
    limPlan.rowsOut = projected.length;
    rootPlan = limPlan;
  }

  return { columns: names, rows: projected.map((p) => p.values), plan: rootPlan };
}

function collectAggregates(ast) {
  const found = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'func' && isAggregate(node.name)) {
      const sig = aggSignature(node);
      if (!seen.has(sig)) { seen.add(sig); found.push(node); }
      return; // don't descend into aggregate args for nested aggregates
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  };
  for (const c of ast.columns) if (c.kind === 'expr') visit(c.expr);
  if (ast.having) visit(ast.having);
  if (ast.orderBy) ast.orderBy.forEach((o) => visit(o.expr));
  return found;
}

function computeAggregates(aggNodes, rows) {
  const out = {};
  for (const node of aggNodes) {
    const sig = aggSignature(node);
    let vals;
    if (node.star) {
      vals = rows.map(() => 1);
    } else {
      vals = rows.map((env) => evalExpr(node.arg, env)).filter((v) => v !== null && v !== undefined);
    }
    if (node.distinct) {
      const seen = new Set(); const dedup = [];
      for (const v of vals) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); dedup.push(v); } }
      vals = dedup;
    }
    switch (node.name) {
      case 'count': out[sig] = node.star ? rows.length : vals.length; break;
      case 'sum': out[sig] = vals.length ? vals.reduce((s, v) => s + Number(v), 0) : null; break;
      case 'avg': out[sig] = vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null; break;
      case 'min': out[sig] = vals.length ? vals.reduce((m, v) => (compareValues(v, m) < 0 ? v : m)) : null; break;
      case 'max': out[sig] = vals.length ? vals.reduce((m, v) => (compareValues(v, m) > 0 ? v : m)) : null; break;
    }
  }
  return out;
}

function expandSelectList(db, ast) {
  const names = [], exprs = [];
  const tableRefs = [ast.from, ...ast.joins.map((j) => j.table)].filter(Boolean);
  for (const item of ast.columns) {
    if (item.kind === 'star') {
      for (const tr of tableRefs) {
        if (item.table && item.table !== tr.alias) continue;
        const t = db.getTable(tr.name);
        for (const col of t.colNames) {
          names.push(col);
          exprs.push({ kind: 'col', table: tr.alias, column: col });
        }
      }
    } else {
      names.push(item.alias || exprLabel(item.expr));
      exprs.push(item.expr);
    }
  }
  return { names, exprs };
}

function exprLabel(node) {
  switch (node.kind) {
    case 'lit': return fmtVal(node.value);
    case 'col': return (node.table ? node.table + '.' : '') + node.column;
    case 'func': return node.name.toUpperCase() + '(' + (node.star ? '*' : exprLabel(node.arg)) + ')';
    case 'arith': return `${exprLabel(node.left)} ${node.op} ${exprLabel(node.right)}`;
    case 'compare': return `${exprLabel(node.left)} ${node.op} ${exprLabel(node.right)}`;
    case 'logical': return `${exprLabel(node.left)} ${node.op.toUpperCase()} ${exprLabel(node.right)}`;
    case 'not': return `NOT ${exprLabel(node.expr)}`;
    case 'isnull': return `${exprLabel(node.expr)} IS ${node.neg ? 'NOT ' : ''}NULL`;
    case 'like': return `${exprLabel(node.left)} LIKE ${exprLabel(node.right)}`;
    case 'in': return `${exprLabel(node.left)} IN (...)`;
    case 'between': return `${exprLabel(node.expr)} BETWEEN ${exprLabel(node.lo)} AND ${exprLabel(node.hi)}`;
    default: return node.kind;
  }
}

/* ============================================================= *
 * 6. The analyzer — turn a plan + the catalog into optimization advice.
 *
 * This is the "look for ways to make it more efficient" half. It never guesses:
 * where it recommends an index it computes, from the live data, exactly how
 * many rows the indexed access would examine, so the suggestion comes with a
 * before/after it can be held to.
 * ============================================================= */

function analyzeQuery(db, ast, plan) {
  const suggestions = [];
  const whereConjs = ast.where ? conjuncts(ast.where) : [];

  // Walk the plan tree collecting scan nodes.
  const scans = [];
  (function walk(p) { if (p.op === 'SeqScan' || p.op === 'IndexLookup') scans.push(p); p.children.forEach(walk); })(plan);

  // 1. Full table scans with a usable, selective equality predicate.
  for (const c of whereConjs) {
    if (c.kind !== 'compare' || c.op !== '=') continue;
    const target = baseTableScanFor(ast, c, db);
    if (!target) continue;
    const { table, alias, column, valueNode } = target;
    if (table.indexes.has(column)) continue; // already indexed
    if (referencesAlias(valueNode, alias)) continue; // not a constant
    // estimate rows an index would examine, from live data
    const value = safeConst(valueNode);
    const matching = value === undefined ? null
      : table.rows.filter((r) => compareValues(r[column], value) === 0).length;
    const total = table.rows.length;
    const scanned = total;
    if (total === 0) continue;
    const base = {
      kind: 'add-index',
      severity: matching !== null && matching * 4 < total ? 'high' : 'medium',
      table: table.name, column,
      ddl: `CREATE INDEX idx_${table.name}_${column} ON ${table.name}(${column});`,
    };
    if (matching !== null) {
      base.message = `Full scan of "${table.name}" filters by ${column} = ${fmtVal(value)}, but "${column}" is not indexed. `
        + `The scan examined ${scanned} rows to return ${matching}. An index would examine about ${matching}.`;
      base.before = scanned; base.after = matching;
    } else {
      base.message = `"${table.name}" is filtered by an equality on "${column}", which is not indexed, so the engine full-scans ${scanned} rows. Consider indexing it.`;
    }
    suggestions.push(base);
  }

  // 2. Range predicates on unindexed columns (hash index can't help ranges —
  //    say so honestly rather than over-promising).
  for (const c of whereConjs) {
    if (c.kind === 'compare' && ['<', '<=', '>', '>='].includes(c.op)) {
      const target = baseTableScanFor(ast, c, db);
      if (target && !target.table.indexes.has(target.column)) {
        suggestions.push({
          kind: 'range-note', severity: 'low', table: target.table.name, column: target.column,
          message: `Range filter on "${target.table.name}.${target.column}" needs a full scan; this engine's hash indexes accelerate equality and joins, not ranges. A sorted/B-tree index would help here.`,
        });
      }
    }
    // non-sargable: function on a column, or LIKE '%...'
    if (c.kind === 'like') {
      const pat = safeConst(c.right);
      if (typeof pat === 'string' && pat.startsWith('%')) {
        suggestions.push({ kind: 'non-sargable', severity: 'low',
          message: `LIKE '${pat}' starts with a wildcard, so no index can be used — the engine must scan and test every row.` });
      }
    }
    if (c.kind === 'compare' && (sideIsFuncOnCol(c.left) || sideIsFuncOnCol(c.right))) {
      suggestions.push({ kind: 'non-sargable', severity: 'low',
        message: `A function is applied to a column inside the predicate "${exprLabel(c)}", which prevents any index on that column from being used. Compare the bare column instead.` });
    }
  }

  // 3. Joins done by scan — recommend indexing the inner join key.
  (function walkJoins(p) {
    if (p.op === 'NestedLoopJoin' && p.method === 'scan') {
      // find the ON equality column on the inner table
      const join = ast.joins.find((j) => j.table.alias === p.innerAlias || j.table.name === p.inner);
      let innerCol = null;
      if (join) {
        for (const c of conjuncts(join.on)) {
          if (c.kind !== 'compare' || c.op !== '=') continue;
          innerCol = colOf(c.left, join.table.alias) || colOf(c.right, join.table.alias);
          if (innerCol) break;
        }
      }
      if (innerCol) {
        suggestions.push({
          kind: 'join-index', severity: 'high', table: p.inner, column: innerCol,
          message: `The join against "${p.inner}" is a nested loop that re-scans the whole table for every outer row (examined ${p.children[1] ? p.children[1].rowsExamined : '?'} rows). An index on "${p.inner}.${innerCol}" turns each pass into a direct lookup.`,
          ddl: `CREATE INDEX idx_${p.inner}_${innerCol} ON ${p.inner}(${innerCol});`,
        });
      } else {
        suggestions.push({ kind: 'join-note', severity: 'medium', table: p.inner,
          message: `The join against "${p.inner}" is a nested loop with no usable index, so its cost grows with the product of the two inputs.` });
      }
    }
    p.children.forEach(walkJoins);
  })(plan);

  // 4. SELECT * — advise explicit projection.
  if (ast.columns.some((c) => c.kind === 'star')) {
    suggestions.push({ kind: 'select-star', severity: 'low',
      message: 'SELECT * reads and returns every column. List only the columns you need to reduce the data moved (and to let covering indexes work in a real engine).' });
  }

  // 5. Large sort with no supporting order.
  (function walkSort(p) {
    if (p.op === 'Sort' && p.rowsExamined > 1000) {
      suggestions.push({ kind: 'sort-note', severity: 'low',
        message: `ORDER BY sorts ${p.rowsExamined} rows in memory. If you frequently sort by these keys, an index in that order would let the engine avoid the sort.` });
    }
    p.children.forEach(walkSort);
  })(plan);

  // de-duplicate by message
  const seen = new Set();
  return suggestions.filter((s) => { if (seen.has(s.message)) return false; seen.add(s.message); return true; });
}

function sideIsFuncOnCol(node) {
  return node && node.kind === 'func' && !isAggregate(node.name)
    && node.arg && containsCol(node.arg);
}
function containsCol(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'col') return true;
  return Object.values(node).some((v) => (v && typeof v === 'object') ? containsCol(v) : false);
}

// Given a comparison conjunct, work out which base table/column it filters.
function baseTableScanFor(ast, cmp, db) {
  const tableRefs = [ast.from, ...ast.joins.map((j) => j.table)].filter(Boolean);
  for (const side of [[cmp.left, cmp.right], [cmp.right, cmp.left]]) {
    const [colNode, valNode] = side;
    if (colNode.kind !== 'col') continue;
    for (const tr of tableRefs) {
      const t = db.getTable(tr.name);
      if (colNode.table) {
        if (colNode.table === tr.alias && t.hasColumn(colNode.column)) {
          return { table: t, alias: tr.alias, column: colNode.column, valueNode: valNode };
        }
      } else if (t.hasColumn(colNode.column)) {
        return { table: t, alias: tr.alias, column: colNode.column, valueNode: valNode };
      }
    }
  }
  return null;
}

function safeConst(node) {
  try { return evalExpr(node, {}); } catch (_) { return undefined; }
}

/* ============================================================= *
 * 7. Database — the public surface.
 * ============================================================= */

class Database {
  constructor() { this.tables = new Map(); }

  getTable(name) {
    const t = this.tables.get(name);
    if (!t) throw new SqlError(`No such table: ${name}`);
    return t;
  }

  // Run one or more statements. Returns the result of the LAST statement.
  exec(sql) {
    const stmts = parse(sql);
    let last = null;
    for (const stmt of stmts) last = this.execStmt(stmt);
    return last;
  }

  // Run exactly one statement and, for SELECT, attach plan + analysis.
  run(sql) {
    const stmts = parse(sql);
    if (stmts.length === 0) throw new SqlError('No statement provided');
    if (stmts.length > 1) throw new SqlError('run() expects a single statement; use exec() for scripts');
    return this.execStmt(stmts[0]);
  }

  execStmt(stmt) {
    switch (stmt.type) {
      case 'createTable': return this.createTable(stmt);
      case 'createIndex': return this.createIndex(stmt);
      case 'insert': return this.insert(stmt);
      case 'select': {
        validateColumns(this, stmt);
        const { columns, rows, plan } = executeSelect(this, stmt);
        const suggestions = analyzeQuery(this, stmt, plan);
        return {
          type: 'select', columns, rows, plan,
          stats: { rowsExamined: plan.totalExamined(), rowsReturned: rows.length },
          suggestions,
        };
      }
      default: throw new SqlError(`Unsupported statement: ${stmt.type}`);
    }
  }

  createTable(stmt) {
    if (this.tables.has(stmt.name)) throw new SqlError(`Table already exists: ${stmt.name}`);
    this.tables.set(stmt.name, new Table(stmt.name, stmt.columns));
    return { type: 'createTable', table: stmt.name };
  }

  createIndex(stmt) {
    const t = this.getTable(stmt.table);
    if (!t.hasColumn(stmt.column)) throw new SqlError(`No such column ${stmt.table}.${stmt.column}`);
    const idx = new Index(stmt.name, stmt.column);
    for (const r of t.rows) idx.add(r);
    t.indexes.set(stmt.column, idx);
    return { type: 'createIndex', index: stmt.name, table: stmt.table, column: stmt.column };
  }

  insert(stmt) {
    const t = this.getTable(stmt.table);
    const cols = stmt.columns || t.colNames;
    let count = 0;
    for (const valExprs of stmt.rows) {
      if (valExprs.length !== cols.length) {
        throw new SqlError(`INSERT has ${valExprs.length} values but ${cols.length} columns`);
      }
      const row = {};
      for (const c of t.colNames) row[c] = null;
      cols.forEach((c, i) => {
        if (!t.hasColumn(c)) throw new SqlError(`No such column ${t.name}.${c}`);
        row[c] = coerce(evalExpr(valExprs[i], {}), t.columnType(c));
      });
      t.rows.push(row);
      for (const idx of t.indexes.values()) idx.add(row);
      count++;
    }
    return { type: 'insert', table: stmt.table, rowCount: count };
  }
}

function coerce(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'integer' || type === 'int') { const n = Math.trunc(Number(value)); return Number.isNaN(n) ? value : n; }
  if (type === 'real' || type === 'number') { const n = Number(value); return Number.isNaN(n) ? value : n; }
  return value; // text/string: keep as-is
}

/* ---- plan rendering (shared by UI and tests) ---- */
function renderPlan(plan, indent = 0) {
  const pad = '  '.repeat(indent);
  let label = plan.op;
  const bits = [];
  if (plan.table) bits.push(plan.alias && plan.alias !== plan.table ? `${plan.table} ${plan.alias}` : plan.table);
  if (plan.index) bits.push(`using ${plan.index}`);
  if (plan.key) bits.push(plan.key);
  if (plan.method) bits.push(plan.method === 'index' ? `index join (${plan.indexUsed})` : 'scan join');
  if (plan.predicate) bits.push(plan.predicate);
  if (plan.keys) bits.push(plan.keys.join(', '));
  if (plan.limit !== undefined) bits.push(`limit ${plan.limit}${plan.offset ? ' offset ' + plan.offset : ''}`);
  if (bits.length) label += ' [' + bits.join('; ') + ']';
  label += `  (examined ${plan.rowsExamined}, out ${plan.rowsOut})`;
  let s = pad + label + '\n';
  for (const c of plan.children) s += renderPlan(c, indent + 1);
  return s;
}

/* ============================================================= *
 * exports
 * ============================================================= */
const api = {
  SqlError, Database, Index, Table,
  tokenize, parse, executeSelect, analyzeQuery, renderPlan,
  evalExpr, compareValues, likeToRegex, conjuncts,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SQLCore = api;
