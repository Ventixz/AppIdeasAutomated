// contrib-core.js — the presentation-free engine for the Contribution Tracker.
//
// It knows nothing about the DOM, IndexedDB, SVG charts, or how the app is
// routed. It only knows how to parse and validate the fields of a charitable
// contribution, do the money maths by hand (integer cents — no third-party
// library, as the spec requires), keep an immutable ledger, sort it, and roll
// it up into the analytics the dashboard draws. Everything here is a pure
// function, so the exact same code runs in the browser and in the Node test
// suite (tests.js).
//
// A transaction record is:
//   { id, date, payee, cents, memo }
// where `date` is an ISO 'YYYY-MM-DD' string, `payee` and `memo` are trimmed
// strings, and `cents` is a non-negative integer number of cents.

'use strict';

// --- Small helpers --------------------------------------------------------

// Attach a machine-readable `.code` to an Error so the UI can turn a failure
// into a specific message without string-matching.
function coded(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function trimStr(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

// --- Money: parse and format by hand (integer cents) ----------------------

// Parse a user-typed amount into a non-negative integer number of cents.
// Accepts things like "12", "12.5", "12.50", "$1,200.00", "  3.4 ". Rejects
// blanks, non-numeric junk, negatives, and more than two decimal places.
// The maths is done on the digit strings themselves so no float rounding can
// creep in — "0.1 + 0.2" style drift is impossible because we never touch a
// fractional Number.
function parseAmount(input) {
  const raw = String(input == null ? '' : input).trim();
  if (raw === '') throw coded('AMOUNT_BLANK', 'Amount is required.');

  // Strip a single leading currency symbol and thousands separators, but only
  // commas that sit between digit groups — anything else is a typo we reject.
  let s = raw.replace(/^\$/, '').trim();
  if (/,/.test(s)) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      throw coded('AMOUNT_NAN', 'Amount is not a valid number.');
    }
    s = s.replace(/,/g, '');
  }

  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw coded('AMOUNT_NAN', 'Amount is not a valid number.');

  const dollars = m[1];
  const frac = (m[2] || '').padEnd(2, '0'); // "" -> "00", "5" -> "50"
  // Build cents as an integer without floating point.
  const cents = Number(dollars) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) {
    throw coded('AMOUNT_RANGE', 'Amount is too large.');
  }
  if (cents <= 0) throw coded('AMOUNT_ZERO', 'Amount must be greater than zero.');
  return cents;
}

// Format an integer number of cents as a "$1,200.00" string. Grouping and the
// decimal split are done by hand on the digit string.
function formatMoney(cents) {
  const n = Math.round(Number(cents) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const centStr = String(rem).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + grouped + '.' + centStr;
}

// Sum a list of cents values. Kept explicit so callers never reach for a
// floating-point reduce.
function sumCents(list) {
  let total = 0;
  for (const c of list) total += Math.round(Number(c) || 0);
  return total;
}

// --- Dates ----------------------------------------------------------------

// Validate an ISO 'YYYY-MM-DD' date string and return it normalized. Rejects
// impossible dates (2026-02-30) by round-tripping through UTC components, which
// keeps the check independent of the machine's timezone.
function validateDate(input) {
  const raw = String(input == null ? '' : input).trim();
  if (raw === '') throw coded('DATE_BLANK', 'Date is required.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw coded('DATE_INVALID', 'Date must be a real calendar date.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw coded('DATE_INVALID', 'Date must be a real calendar date.');
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw coded('DATE_INVALID', 'Date must be a real calendar date.');
  }
  return raw;
}

function yearOf(date) {
  return Number(date.slice(0, 4));
}
function monthOf(date) {
  // 0-based month index, matching Date semantics.
  return Number(date.slice(5, 7)) - 1;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// --- Validation of a whole entry ------------------------------------------

// Validate the raw fields of the input panel and return either a clean
// transaction (minus its id) or throw an aggregate error. The spec asks for
// *consolidated* error messages, so we collect every problem and attach the
// list as `.errors` on the thrown Error.
function validateEntry(fields) {
  const errors = [];
  let date = '';
  let payee = '';
  let cents = 0;

  try {
    date = validateDate(fields && fields.date);
  } catch (e) {
    errors.push(e.message);
  }

  payee = trimStr(fields && fields.payee);
  if (payee === '') errors.push('Payee is required.');
  else if (payee.length > 80) errors.push('Payee must be 80 characters or fewer.');

  try {
    cents = parseAmount(fields && fields.amount);
  } catch (e) {
    errors.push(e.message);
  }

  const memo = trimStr(fields && fields.memo);
  if (memo.length > 200) errors.push('Memo must be 200 characters or fewer.');

  if (errors.length) {
    const err = coded('INVALID_ENTRY', errors.join(' '));
    err.errors = errors;
    throw err;
  }
  return { date, payee, cents, memo };
}

// --- Ids ------------------------------------------------------------------

// Deterministic id from a monotonically increasing sequence plus a seed, so the
// core stays pure (no Date.now/Math.random) and tests are reproducible. The UI
// passes the current max id + 1.
function makeId(seq) {
  return 't' + String(seq);
}

function nextSeq(transactions) {
  let max = 0;
  for (const t of transactions) {
    const n = Number(String(t.id).replace(/^t/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// --- Immutable ledger operations ------------------------------------------

// Add a validated entry, returning a new array (never mutating the input).
function addTransaction(transactions, fields) {
  const clean = validateEntry(fields);
  const tx = Object.assign({ id: makeId(nextSeq(transactions)) }, clean);
  return transactions.concat([tx]);
}

// Replace the fields of an existing transaction by id, keeping its id.
function updateTransaction(transactions, id, fields) {
  const clean = validateEntry(fields);
  let found = false;
  const next = transactions.map((t) => {
    if (t.id !== id) return t;
    found = true;
    return Object.assign({ id: t.id }, clean);
  });
  if (!found) throw coded('NOT_FOUND', 'That transaction no longer exists.');
  return next;
}

function deleteTransaction(transactions, id) {
  const next = transactions.filter((t) => t.id !== id);
  if (next.length === transactions.length) {
    throw coded('NOT_FOUND', 'That transaction no longer exists.');
  }
  return next;
}

// --- Sorting --------------------------------------------------------------

// Sort a copy of the ledger by a column and direction. 'date', 'payee',
// 'amount' and 'memo' are supported; ties fall back to id so the order is
// always stable and deterministic.
function sortTransactions(transactions, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = (a, b) => {
    let r = 0;
    if (key === 'amount') r = a.cents - b.cents;
    else if (key === 'payee') r = a.payee.toLowerCase().localeCompare(b.payee.toLowerCase());
    else if (key === 'memo') r = a.memo.toLowerCase().localeCompare(b.memo.toLowerCase());
    else r = a.date < b.date ? -1 : a.date > b.date ? 1 : 0; // date default
    if (r !== 0) return r * sign;
    // Stable tiebreak by numeric id, always ascending.
    return nextSeqId(a) - nextSeqId(b);
  };
  return transactions.slice().sort(cmp);
}
function nextSeqId(t) {
  const n = Number(String(t.id).replace(/^t/, ''));
  return Number.isFinite(n) ? n : 0;
}

// --- Analytics for the dashboard ------------------------------------------

// Contributions by month for a given year: an array of 12 integer-cent totals,
// index 0 = January. Months with no contributions are 0.
function monthlyTotals(transactions, year) {
  const out = new Array(12).fill(0);
  for (const t of transactions) {
    if (yearOf(t.date) === year) out[monthOf(t.date)] += t.cents;
  }
  return out;
}

// Total contributions per year: sorted array of { year, cents, count }.
function yearlyTotals(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const y = yearOf(t.date);
    const cur = map.get(y) || { year: y, cents: 0, count: 0 };
    cur.cents += t.cents;
    cur.count += 1;
    map.set(y, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.year - b.year);
}

// Year-over-year change: for each year (after the first with data) the delta in
// cents versus the previous *present* year and the percentage change. The first
// year gets deltaCents = 0 and pct = null (nothing to compare against).
function yearOverYear(transactions) {
  const years = yearlyTotals(transactions);
  const out = [];
  let prev = null;
  for (const y of years) {
    let deltaCents = 0;
    let pct = null;
    if (prev) {
      deltaCents = y.cents - prev.cents;
      pct = prev.cents === 0 ? null : (deltaCents / prev.cents) * 100;
    }
    out.push({ year: y.year, cents: y.cents, deltaCents, pct });
    prev = y;
  }
  return out;
}

// Averages: overall average per transaction, average per active month (months
// that actually had at least one contribution) and average per year with data.
// All returned as integer cents (rounded half-up).
function averages(transactions) {
  const count = transactions.length;
  const total = sumCents(transactions.map((t) => t.cents));
  const perTx = count ? Math.round(total / count) : 0;

  const activeMonths = new Set();
  for (const t of transactions) activeMonths.add(t.date.slice(0, 7)); // YYYY-MM
  const perMonth = activeMonths.size ? Math.round(total / activeMonths.size) : 0;

  const years = new Set(transactions.map((t) => yearOf(t.date)));
  const perYear = years.size ? Math.round(total / years.size) : 0;

  return { count, totalCents: total, perTxCents: perTx, perMonthCents: perMonth, perYearCents: perYear };
}

// A compact bundle the dashboard needs, computed for a focus year.
function summarize(transactions, focusYear) {
  return {
    focusYear,
    monthly: monthlyTotals(transactions, focusYear),
    yearly: yearlyTotals(transactions),
    yoy: yearOverYear(transactions),
    averages: averages(transactions),
  };
}

// --- Serialization (files persistence, not localStorage) ------------------

// The spec forbids keeping transactions in localStorage. The UI persists to an
// IndexedDB database and offers JSON/CSV file export; these helpers build the
// serializable payloads purely.

function toJSON(transactions) {
  return JSON.stringify(
    { app: 'contribution-tracker', version: 1, transactions },
    null,
    2
  );
}

// Parse a previously exported JSON payload back into a validated ledger. A
// corrupt or partial record is skipped rather than throwing the whole import
// away, matching how the other apps here recover a damaged store.
function fromJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw coded('BAD_JSON', 'That file is not valid JSON.');
  }
  const rows = (data && Array.isArray(data.transactions)) ? data.transactions
    : (Array.isArray(data) ? data : null);
  if (!rows) throw coded('BAD_SHAPE', 'That file has no transactions.');
  const clean = [];
  let seq = 1;
  for (const r of rows) {
    try {
      const entry = validateEntry({ date: r.date, payee: r.payee, amount: centsToInput(r.cents), memo: r.memo });
      clean.push(Object.assign({ id: makeId(seq++) }, entry));
    } catch (e) {
      // skip the bad row
    }
  }
  return clean;
}

// Turn stored integer cents back into a plain "12.50" string suitable for
// re-parsing or filling the amount input.
function centsToInput(cents) {
  const n = Math.round(Number(cents) || 0);
  const dollars = Math.floor(n / 100);
  const rem = n % 100;
  return dollars + '.' + String(rem).padStart(2, '0');
}

// CSV for the PDF/spreadsheet export bonus. Fields are quoted and internal
// quotes doubled so a payee with a comma survives the round trip.
function toCSV(transactions) {
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const head = ['Date', 'Payee', 'Amount', 'Memo'].map(esc).join(',');
  const rows = transactions.map((t) =>
    [esc(t.date), esc(t.payee), esc(centsToInput(t.cents)), esc(t.memo)].join(',')
  );
  return [head].concat(rows).join('\r\n');
}

// --- Public API -----------------------------------------------------------

const API = {
  MONTHS,
  coded,
  trimStr,
  parseAmount,
  formatMoney,
  sumCents,
  centsToInput,
  validateDate,
  yearOf,
  monthOf,
  validateEntry,
  makeId,
  nextSeq,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  sortTransactions,
  monthlyTotals,
  yearlyTotals,
  yearOverYear,
  averages,
  summarize,
  toJSON,
  fromJSON,
  toCSV,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else {
  this.ContribCore = API;
}
