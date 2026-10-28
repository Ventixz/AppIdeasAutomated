/*
 * bank-core.js — bank accounts as a class hierarchy, DOM-free.
 *
 * The task ("Bank Account Manager") is the fourth* of karan/Projects' Classes
 * (Object-Oriented Programming) category:
 *
 *   "Create a class called Account which will be an abstract class for three
 *    other classes called CheckingAccount, SavingsAccount and BusinessAccount.
 *    Manage credits and debits from these accounts through an ATM style
 *    program."
 *
 * (*the Classes list's fourth entry; this repo's fourth project in the category.)
 *
 * Like every task in this category, the point is the *design*, not the feature
 * list. The spec dictates an inheritance hierarchy — an abstract `Account` and
 * three concrete kinds — and the one thing that varies down it is **how a debit
 * is allowed and charged**. That is the textbook setup for *polymorphism*: one
 * call, `account.withdraw(amount)`, dispatching to a different rule per class.
 * This engine is built around the three things a naive version gets wrong:
 *
 *   1. THE BASE CLASS IS ABSTRACT, AND SO IS THE DEBIT POLICY. `Account` is a
 *      concept, not something you can open: `new Account()` throws, and so does
 *      a bare account whose policy hooks were never overridden. You cannot open
 *      an account whose overdraft rule is undefined — the hierarchy makes "every
 *      kind debits its own way" a rule the objects enforce, not a comment
 *      everyone is trusted to honor.
 *
 *   2. EACH SUBCLASS REALLY DEBITS DIFFERENTLY — and correctly.
 *        • CheckingAccount — may overdraw down to a limit; the first debit that
 *          pushes the balance negative charges a one-time overdraft fee.
 *        • SavingsAccount — never overdraws (floor is zero), earns interest, and
 *          caps the number of withdrawals per statement cycle (Regulation-D
 *          style); the (N+1)th withdrawal is refused.
 *        • BusinessAccount — charges a flat per-transaction fee on every debit
 *          and carries a larger overdraft line of credit.
 *      The policy lives in two overridable hooks — `minimumBalanceCents` (the
 *      floor the balance may not cross) and `feeFor()` (what a debit costs) —
 *      so the shared `withdraw()` template calls the right rule per class.
 *
 *   3. MONEY IS INTEGER CENTS, THE LEDGER IS THE TRUTH, AND TRANSFERS ARE ATOMIC.
 *      `0.1 + 0.2 !== 0.3` in IEEE-754, so every amount is integer cents. The
 *      balance is not a stored number that a buggy path could desync — it is
 *      *derived* from the account's ledger (sum of signed entries), so the
 *      statement you read and the balance you spend can never disagree. A
 *      transfer debits one account and credits another all-or-nothing: if the
 *      debit is refused, the credit never happens, so money is never created or
 *      destroyed in flight.
 *
 * The Bank is an aggregate: it opens and closes accounts, moves money between
 * them, and every rollup (total assets, headcount by kind) is derived from the
 * accounts on demand. Nothing here touches the DOM, a hidden clock, or the
 * network. `bank-node.js` drives these classes from an ATM-style CLI,
 * `script.js` drives them in a browser, and `tests.js` drives them with fixed
 * data. One engine, three front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation (abstract instantiation, bad money, insufficient funds,
 * unknown account) from a real bug.
 * ------------------------------------------------------------------ */

class BankError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BankError';
  }
}

/* ------------------------------------------------------------------ *
 * Money — integer cents in, formatted dollars out. A flat helper rather
 * than a class because a cent amount IS just an integer; wrapping every
 * balance in an object would buy nothing.
 * ------------------------------------------------------------------ */

const Money = {
  // "500", "500.25", "$1,500.00", 500.25 -> cents. Rejects junk / >2dp.
  parse(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new BankError(`not a money amount: ${value}`);
      return Math.round(value * 100);
    }
    const s = String(value).trim().replace(/^\$/, '').replace(/,/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new BankError(`not a money amount: "${value}"`);
    const neg = s.startsWith('-');
    const [whole, frac = ''] = s.replace(/^-/, '').split('.');
    const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    return neg ? -cents : cents;
  },

  // cents -> "$1,500.00"
  format(cents) {
    const n = Math.trunc(cents);
    const neg = n < 0;
    const abs = Math.abs(n);
    const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
    const rem = String(abs % 100).padStart(2, '0');
    return `${neg ? '-' : ''}$${dollars}.${rem}`;
  },

  // a positive whole-cent amount for a credit/debit; rejects zero, negatives, junk
  parsePositive(value) {
    const cents = Money.parse(value);
    if (cents <= 0) throw new BankError('amount must be greater than zero');
    return cents;
  },
};

/* round a rational numer/denom to the nearest integer, half away from zero */
function divRound(numer, denom) {
  const sign = (numer < 0) !== (denom < 0) ? -1 : 1;
  const a = Math.abs(numer), b = Math.abs(denom);
  return sign * Math.floor((a + b / 2) / b);
}

/* ------------------------------------------------------------------ *
 * Account — the ABSTRACT base. It owns everything every account shares:
 * an id, an owner, and a ledger of transactions from which the balance is
 * derived. It also declares the two things the hierarchy exists to vary —
 * `minimumBalanceCents` (the floor a debit may not cross) and
 * `feeFor(amountCents)` (what a debit costs) — plus `kind`. You cannot
 * instantiate it. That is the whole "abstract" requirement, made real.
 * ------------------------------------------------------------------ */

let _seq = 0;

class Account {
  constructor(owner, { id, openingBalance = 0 } = {}) {
    if (new.target === Account) {
      throw new BankError('Account is abstract — open a subclass (CheckingAccount, SavingsAccount, BusinessAccount)');
    }
    const name = String(owner == null ? '' : owner).trim();
    if (!name) throw new BankError('an account needs an owner');
    this.owner = name;

    if (id != null) {
      this.id = String(id);
      // keep the auto-id counter ahead of any explicit "A-NNNN" id so a later
      // auto-assigned id can never collide with one a caller chose by hand.
      const m = /^A-(\d+)$/.exec(this.id);
      if (m) _seq = Math.max(_seq, Number(m[1]));
    } else {
      this.id = `A-${String(++_seq).padStart(4, '0')}`;
    }

    this._ledger = [];                 // signed entries; balance is derived from these
    this._txSeq = 0;
    const opening = Money.parse(openingBalance);
    if (opening < 0) throw new BankError('opening balance cannot be negative');
    if (opening > 0) this._record('open', opening, 0, 'opening balance');
  }

  /* --- abstract policy hooks the subclasses MUST define ------------- */

  // A short label for the kind of account.
  get kind() {
    throw new BankError(`${this.constructor.name} must define kind`);
  }

  // The lowest the balance is allowed to reach after a debit. Checking and
  // Business return a negative number (an overdraft line); Savings returns 0.
  get minimumBalanceCents() {
    throw new BankError(`${this.constructor.name} must define minimumBalanceCents`);
  }

  // The fee charged for debiting `amountCents` right now. Default: free.
  // Subclasses override to add an overdraft fee, a per-transaction fee, etc.
  feeFor(/* amountCents */) {
    return 0;
  }

  // Hook: throw if this debit is not permitted for a reason other than funds
  // (e.g. Savings' withdrawal cap). Default: always permitted.
  _assertWithdrawable(/* amountCents */) {}

  /* --- balance & ledger, both derived ------------------------------ */

  // The balance is the running sum of the ledger — never a stored field that
  // could drift from the statement. Credits add, debits and fees subtract.
  get balanceCents() {
    return this._ledger.reduce((sum, t) => sum + t.amountCents, 0);
  }

  get transactions() {
    return this._ledger.map((t) => ({ ...t }));
  }

  _record(type, signedCents, feeCents, note) {
    const entry = {
      seq: ++this._txSeq,
      type,
      amountCents: signedCents,       // signed: credits positive, debits negative
      feeCents,
      note: note || '',
    };
    entry.balanceCents = this.balanceCents + signedCents; // balance AFTER this entry
    this._ledger.push(entry);
    return entry;
  }

  /* --- credits & debits -------------------------------------------- */

  // Credit the account. Every kind takes a deposit the same way, so this is
  // not polymorphic — it lives here once.
  deposit(amount, note) {
    const cents = Money.parsePositive(amount);
    this._record('deposit', cents, 0, note);
    return this;
  }

  // Debit the account — the one polymorphic operation. The template is shared;
  // the rules it consults (`feeFor`, `minimumBalanceCents`, `_assertWithdrawable`)
  // are each overridden per class. A debit costs the amount PLUS its fee, and
  // the resulting balance may not cross the account's floor.
  withdraw(amount, note) {
    const cents = Money.parsePositive(amount);
    this._assertWithdrawable(cents);
    const fee = this.feeFor(cents);
    const total = cents + fee;
    if (this.balanceCents - total < this.minimumBalanceCents) {
      throw new BankError(
        `insufficient funds: ${this.owner}'s ${this.kind} cannot withdraw ` +
        `${Money.format(cents)}${fee ? ` (+ ${Money.format(fee)} fee)` : ''} ` +
        `— balance ${Money.format(this.balanceCents)}, floor ${Money.format(this.minimumBalanceCents)}`
      );
    }
    this._record('withdrawal', -cents, 0, note);
    if (fee > 0) this._record('fee', -fee, fee, 'fee');
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      owner: this.owner,
      kind: this.kind,
      balanceCents: this.balanceCents,
      transactions: this.transactions,
    };
  }
}

/* ------------------------------------------------------------------ *
 * CheckingAccount — the everyday account. It MAY overdraw, down to a set
 * limit (a small line of credit), and the first debit that pushes the
 * balance below zero charges a one-time overdraft fee. A debit that stays
 * at or above zero is free; one already overdrawn is not re-charged.
 * ------------------------------------------------------------------ */

class CheckingAccount extends Account {
  constructor(owner, opts = {}) {
    super(owner, opts);
    this.overdraftLimitCents = Money.parse(opts.overdraftLimit != null ? opts.overdraftLimit : 0);
    if (this.overdraftLimitCents < 0) throw new BankError('overdraft limit cannot be negative');
    this.overdraftFeeCents = Money.parse(opts.overdraftFee != null ? opts.overdraftFee : 0);
    if (this.overdraftFeeCents < 0) throw new BankError('overdraft fee cannot be negative');
  }

  get kind() { return 'Checking'; }

  // May go negative, but not past the overdraft line.
  get minimumBalanceCents() { return -this.overdraftLimitCents; }

  // Charge the overdraft fee only when this debit takes a non-negative balance
  // into the red — i.e. it starts the overdraft. Already overdrawn => no new fee.
  feeFor(amountCents) {
    const wasPositive = this.balanceCents >= 0;
    const goesNegative = this.balanceCents - amountCents < 0;
    return wasPositive && goesNegative ? this.overdraftFeeCents : 0;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      overdraftLimitCents: this.overdraftLimitCents,
      overdraftFeeCents: this.overdraftFeeCents,
    };
  }
}

/* ------------------------------------------------------------------ *
 * SavingsAccount — never overdraws (floor is zero), earns interest, and
 * caps the number of withdrawals per statement cycle (a nod to the old
 * Regulation D six-per-month rule). The (N+1)th withdrawal in a cycle is
 * refused. `accrueInterest` posts one period's interest and opens a fresh
 * cycle, resetting the count. Deposits never count against the cap.
 * ------------------------------------------------------------------ */

class SavingsAccount extends Account {
  constructor(owner, opts = {}) {
    super(owner, opts);
    const rate = Number(opts.annualInterestPercent != null ? opts.annualInterestPercent : 0);
    if (!Number.isFinite(rate) || rate < 0) throw new BankError(`invalid interest rate: ${opts.annualInterestPercent}`);
    this.annualInterestPercent = rate;

    const cap = opts.withdrawalLimit != null ? Number(opts.withdrawalLimit) : 6;
    if (!Number.isInteger(cap) || cap < 0) throw new BankError(`withdrawalLimit must be a non-negative integer, got ${opts.withdrawalLimit}`);
    this.withdrawalLimit = cap;

    this._cycleStart = this._ledger.length; // ledger index where the current cycle began
  }

  get kind() { return 'Savings'; }

  // No overdraft: a savings balance can never drop below zero.
  get minimumBalanceCents() { return 0; }

  // Withdrawals made since the cycle began.
  get withdrawalsThisCycle() {
    return this._ledger.slice(this._cycleStart).filter((t) => t.type === 'withdrawal').length;
  }

  // Refuse the withdrawal that would exceed the cycle cap (before any funds check).
  _assertWithdrawable() {
    if (this.withdrawalsThisCycle >= this.withdrawalLimit) {
      throw new BankError(
        `withdrawal limit reached: ${this.owner}'s Savings allows ${this.withdrawalLimit} withdrawals per cycle`
      );
    }
  }

  // Post one period's interest on the current balance and open a new cycle.
  // periodsPerYear defaults to 12 (monthly). Interest rounds to the cent once.
  accrueInterest(periodsPerYear = 12) {
    const p = Number(periodsPerYear);
    if (!Number.isInteger(p) || p <= 0) throw new BankError(`periodsPerYear must be a positive integer, got ${periodsPerYear}`);
    const bal = this.balanceCents;
    if (bal > 0 && this.annualInterestPercent > 0) {
      // bal × (rate/100) / periods, rate scaled to basis points to stay exact.
      const bp = Math.round(this.annualInterestPercent * 100);   // percent -> basis points of a percent
      const annual = divRound(bal * bp, 100 * 100);
      const interest = divRound(annual, p);
      if (interest > 0) this._record('interest', interest, 0, `interest (${this.annualInterestPercent}%/yr ÷ ${p})`);
    }
    this._cycleStart = this._ledger.length; // a fresh cycle: withdrawal count resets
    return this;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      annualInterestPercent: this.annualInterestPercent,
      withdrawalLimit: this.withdrawalLimit,
      withdrawalsThisCycle: this.withdrawalsThisCycle,
    };
  }
}

/* ------------------------------------------------------------------ *
 * BusinessAccount — built for volume. Every debit pays a flat
 * per-transaction fee, and the account carries a larger overdraft line of
 * credit than a personal checking account. The fee applies to every
 * withdrawal, overdrawn or not — that is the distinguishing rule.
 * ------------------------------------------------------------------ */

class BusinessAccount extends Account {
  constructor(owner, opts = {}) {
    super(owner, opts);
    this.transactionFeeCents = Money.parse(opts.transactionFee != null ? opts.transactionFee : 0);
    if (this.transactionFeeCents < 0) throw new BankError('transaction fee cannot be negative');
    this.overdraftLimitCents = Money.parse(opts.overdraftLimit != null ? opts.overdraftLimit : 0);
    if (this.overdraftLimitCents < 0) throw new BankError('overdraft limit cannot be negative');
  }

  get kind() { return 'Business'; }

  get minimumBalanceCents() { return -this.overdraftLimitCents; }

  // A flat fee on every debit, regardless of balance.
  feeFor() { return this.transactionFeeCents; }

  toJSON() {
    return {
      ...super.toJSON(),
      transactionFeeCents: this.transactionFeeCents,
      overdraftLimitCents: this.overdraftLimitCents,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Bank — the aggregate. It owns the accounts (a Map by id), opens and
 * closes them, and moves money between them. Every rollup (total assets,
 * headcount by kind) is derived from the accounts on demand. A transfer is
 * ATOMIC: the debit is attempted first, and only if it succeeds is the
 * credit applied — so a refused debit can never leave money half-moved.
 * ------------------------------------------------------------------ */

class Bank {
  constructor(name = 'Bank') {
    this.name = String(name).trim() || 'Bank';
    this._accounts = new Map();        // id -> Account
  }

  get size() { return this._accounts.size; }

  accounts() { return Array.from(this._accounts.values()); }

  get(id) {
    const key = String(id);
    const acct = this._accounts.get(key);
    if (!acct) throw new BankError(`no account ${key}`);
    return acct;
  }

  has(id) { return this._accounts.has(String(id)); }

  // Open: the account object is built by the caller (so the class — and thus
  // the debit policy — is chosen explicitly), the bank just takes it on.
  open(account) {
    if (!(account instanceof Account)) {
      throw new BankError('open() takes an Account instance (CheckingAccount, SavingsAccount, BusinessAccount)');
    }
    if (this._accounts.has(account.id)) throw new BankError(`account ${account.id} already open`);
    this._accounts.set(account.id, account);
    return account;
  }

  // Close: only an account that is not overdrawn may be closed (you cannot walk
  // away owing the bank). Returns the final balance paid out.
  close(id) {
    const acct = this.get(id);
    if (acct.balanceCents < 0) {
      throw new BankError(`cannot close ${acct.id}: overdrawn by ${Money.format(-acct.balanceCents)}`);
    }
    this._accounts.delete(acct.id);
    return acct;
  }

  deposit(id, amount, note) { return this.get(id).deposit(amount, note); }
  withdraw(id, amount, note) { return this.get(id).withdraw(amount, note); }

  // Move money between two accounts, all-or-nothing. The source's own debit
  // policy (overdraft, fees, caps) applies; the destination is credited only
  // if that debit succeeds, so money is never created or lost in flight.
  transfer(fromId, toId, amount) {
    const from = this.get(fromId);
    const to = this.get(toId);
    if (from === to) throw new BankError('cannot transfer to the same account');
    const cents = Money.parsePositive(amount); // validate once; both sides move this
    // Attempt the debit first. If it throws (insufficient funds, cap reached),
    // the credit below never runs — the transfer is atomic. Both calls are given
    // the same original amount, so they parse to the identical cent figure.
    from.withdraw(amount, `transfer to ${to.id}`);
    to.deposit(amount, `transfer from ${from.id}`);
    return { from, to, amountCents: cents };
  }

  // The bank's total assets — every balance summed (overdrawn accounts count
  // as the negative they are).
  totalAssetsCents() {
    let total = 0;
    for (const acct of this._accounts.values()) total += acct.balanceCents;
    return total;
  }

  // Account count grouped by kind, e.g. { Checking: 2, Savings: 1 }.
  countByKind() {
    const counts = {};
    for (const acct of this._accounts.values()) {
      counts[acct.kind] = (counts[acct.kind] || 0) + 1;
    }
    return counts;
  }

  summary() {
    return {
      name: this.name,
      size: this.size,
      countByKind: this.countByKind(),
      totalAssetsCents: this.totalAssetsCents(),
    };
  }

  toJSON() {
    return {
      name: this.name,
      accounts: this.accounts().map((a) => a.toJSON()),
      summary: this.summary(),
    };
  }
}

/* ------------------------------------------------------------------ */

const coreApi = {
  BankError, Money,
  Account, CheckingAccount, SavingsAccount, BusinessAccount,
  Bank,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.BankManager = coreApi;
