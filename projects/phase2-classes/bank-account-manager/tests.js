#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the bank engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on what the design
 * is supposed to guarantee: the base class is abstract (you can't open an
 * "Account" or use one whose policy hooks are missing), each subclass debits by
 * its own rule and gets it right (checking overdraft + fee, savings no-overdraft
 * + interest + withdrawal cap, business per-transaction fee), money stays exact
 * (integer cents) and the balance is derived from the ledger so the statement
 * can't lie, and the Bank aggregate moves money atomically (a refused debit
 * leaves nothing half-transferred). Transfers get their own block, because
 * "half-moved money" is the classic mistake in account code.
 */
'use strict';

const core = require('./bank-core');
const {
  BankError, Money,
  Account, CheckingAccount, SavingsAccount, BusinessAccount, Bank,
} = core;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof BankError, `${msg} — threw ${e.name}: ${e.message}`); }
}

/* --- Money ----------------------------------------------------------- */
eq(Money.parse('500'), 50000, 'parse whole dollars');
eq(Money.parse('500.25'), 50025, 'parse dollars.cents');
eq(Money.parse('$12,500.00'), 1250000, 'parse with $ and commas');
eq(Money.parse(0.25), 25, 'parse a number');
eq(Money.format(1250000), '$12,500.00', 'format');
eq(Money.format(-20000), '-$200.00', 'format negative');
throwsErr(() => Money.parse('12.345'), 'reject >2 decimals');
throwsErr(() => Money.parse('abc'), 'reject junk');
throwsErr(() => Money.parsePositive('0'), 'parsePositive rejects zero');
throwsErr(() => Money.parsePositive('-5'), 'parsePositive rejects negatives');

/* --- Account is abstract -------------------------------------------- */
throwsErr(() => new Account('Nobody'), 'cannot instantiate abstract Account');
throwsErr(() => new CheckingAccount(''), 'an account needs an owner');
throwsErr(() => new CheckingAccount('X', { openingBalance: '-5' }), 'opening balance cannot be negative');
// a hand-rolled subclass that forgets the policy hooks still can't be used:
class Broken extends Account {}
throwsErr(() => new Broken('X').kind, 'un-overridden kind throws');
ok(new CheckingAccount('A') instanceof Account, 'CheckingAccount is an Account');
ok(new SavingsAccount('B') instanceof Account, 'SavingsAccount is an Account');
ok(new BusinessAccount('C') instanceof Account, 'BusinessAccount is an Account');

/* --- balance is derived from the ledger ----------------------------- */
const d = new CheckingAccount('Ledger Lou', { openingBalance: '100' });
eq(d.balanceCents, 10000, 'opening balance recorded on the ledger');
d.deposit('50');
eq(d.balanceCents, 15000, 'deposit credits the balance');
d.withdraw('30');
eq(d.balanceCents, 12000, 'withdrawal debits the balance');
// balance equals the signed sum of every ledger entry — it is not stored
eq(d.transactions.reduce((a, t) => a + t.amountCents, 0), d.balanceCents, 'balance is the sum of the ledger');
eq(d.transactions[d.transactions.length - 1].balanceCents, 12000, 'each entry records the running balance');
throwsErr(() => d.deposit('0'), 'cannot deposit zero');
throwsErr(() => d.withdraw('-5'), 'cannot withdraw a negative');

/* --- CheckingAccount: overdraft down to a limit, one-time fee -------- */
const c = new CheckingAccount('Check Chris', { openingBalance: '100', overdraftLimit: '200', overdraftFee: '35' });
c.withdraw('50');
eq(c.balanceCents, 5000, '$100 - $50 = $50, no fee while positive');
// this debit takes +$50 into the red: $50 - $120 = -$70, then -$35 fee = -$105
c.withdraw('120');
eq(c.balanceCents, -10500, 'overdraft: -$70 then a one-time $35 fee = -$105.00');
ok(c.transactions.some((t) => t.type === 'fee' && t.amountCents === -3500), 'an overdraft fee entry was posted');
// already overdrawn: another small debit is NOT re-charged the fee
c.withdraw('50');
eq(c.balanceCents, -15500, 'already overdrawn => no second fee (-$105 - $50 = -$155)');
ok(c.transactions.filter((t) => t.type === 'fee').length === 1, 'the overdraft fee is charged only once');
// cannot cross the overdraft line (-$200 floor); -$155 - $50(+$0 fee) = -$205 < -$200
throwsErr(() => c.withdraw('50'), 'cannot overdraw past the overdraft limit');
eq(c.balanceCents, -15500, 'a refused withdrawal leaves the balance unchanged');

/* --- SavingsAccount: no overdraft, interest, withdrawal cap --------- */
const sv = new SavingsAccount('Save Sam', { openingBalance: '1000', annualInterestPercent: 2, withdrawalLimit: 2 });
eq(sv.minimumBalanceCents, 0, 'savings floor is zero (no overdraft)');
throwsErr(() => sv.withdraw('2000'), 'savings cannot be overdrawn');
sv.withdraw('100');
sv.withdraw('100');
eq(sv.withdrawalsThisCycle, 2, 'two withdrawals this cycle');
throwsErr(() => sv.withdraw('100'), 'the third withdrawal exceeds the cap');
eq(sv.balanceCents, 80000, 'the capped withdrawal did not debit anything');
// interest: 2%/yr on $800, monthly = 800 × 0.02 / 12 = 1.3333 -> $1.33
sv.accrueInterest(12);
eq(sv.balanceCents, 80133, 'monthly interest of $1.33 posted (2%/yr on $800 ÷ 12)');
// accruing interest opens a new cycle, so withdrawals are allowed again
eq(sv.withdrawalsThisCycle, 0, 'a new cycle resets the withdrawal count');
sv.withdraw('50');
eq(sv.withdrawalsThisCycle, 1, 'withdrawals count against the new cycle');
// deposits never count against the cap
sv.deposit('500');
eq(sv.withdrawalsThisCycle, 1, 'a deposit does not count as a withdrawal');
// no interest on a zero/overdrawn-floor balance is impossible here; zero-rate is a no-op
const sv0 = new SavingsAccount('Zero', { openingBalance: '1000' });
sv0.accrueInterest();
eq(sv0.balanceCents, 100000, 'a 0% savings account accrues nothing');

/* --- BusinessAccount: a flat fee on every debit --------------------- */
const b = new BusinessAccount('Biz Beth', { openingBalance: '1000', transactionFee: '0.25', overdraftLimit: '500' });
b.withdraw('100');
// $1000 - $100 - $0.25 fee = $899.75
eq(b.balanceCents, 89975, 'business debit charges a $0.25 fee ($1000 - $100 - $0.25)');
ok(b.transactions.some((t) => t.type === 'fee' && t.amountCents === -25), 'a transaction fee was posted');
b.withdraw('100');
eq(b.balanceCents, 79950, 'the fee applies to EVERY debit, not just the first');
eq(b.transactions.filter((t) => t.type === 'fee').length, 2, 'two debits => two fees');
// the fee counts toward the overdraft floor too
const bz = new BusinessAccount('Edge', { openingBalance: '100', transactionFee: '1', overdraftLimit: '0' });
throwsErr(() => bz.withdraw('100'), 'a debit whose fee would cross the floor is refused');

/* --- Bank: open / close / rollups ----------------------------------- */
const bank = new Bank('Test Bank');
const ca = new CheckingAccount('Owner A', { id: 'A-0001', openingBalance: '500' });
const sa = new SavingsAccount('Owner B', { id: 'A-0002', openingBalance: '2000' });
bank.open(ca); bank.open(sa);
eq(bank.size, 2, 'two accounts opened');
throwsErr(() => bank.open(ca), 'cannot open the same account twice');
throwsErr(() => bank.open({ owner: 'plain object' }), 'open() rejects a non-Account');
throwsErr(() => bank.get('nope'), 'get() throws on unknown id');
eq(JSON.stringify(bank.countByKind()), JSON.stringify({ Checking: 1, Savings: 1 }), 'count by kind');
eq(bank.totalAssetsCents(), 250000, 'total assets = $500 + $2,000 = $2,500.00');

/* --- Bank.transfer is atomic ---------------------------------------- */
const tb = new Bank('Transfer Bank');
const src = new CheckingAccount('Src', { id: 'S', openingBalance: '300' });
const dst = new SavingsAccount('Dst', { id: 'D', openingBalance: '0' });
tb.open(src); tb.open(dst);
tb.transfer('S', 'D', '100');
eq(src.balanceCents, 20000, 'transfer debits the source');
eq(dst.balanceCents, 10000, 'transfer credits the destination');
eq(tb.totalAssetsCents(), 30000, 'a transfer conserves total assets');
throwsErr(() => tb.transfer('S', 'S', '10'), 'cannot transfer to the same account');
// a transfer that the source cannot fund leaves BOTH sides untouched (atomic)
throwsErr(() => tb.transfer('S', 'D', '10000'), 'an unfundable transfer is refused');
eq(src.balanceCents, 20000, 'the source is unchanged after a refused transfer');
eq(dst.balanceCents, 10000, 'the destination is unchanged after a refused transfer');
// a savings source that has hit its cap refuses the transfer, money intact
const capb = new Bank('Cap Bank');
const capsrc = new SavingsAccount('CapSrc', { id: 'CS', openingBalance: '1000', withdrawalLimit: 0 });
const capdst = new CheckingAccount('CapDst', { id: 'CD', openingBalance: '0' });
capb.open(capsrc); capb.open(capdst);
throwsErr(() => capb.transfer('CS', 'CD', '10'), 'a capped savings source refuses a transfer');
eq(capsrc.balanceCents, 100000, 'the capped source keeps its money');
eq(capdst.balanceCents, 0, 'the destination got nothing from the refused transfer');

/* --- Bank.close ----------------------------------------------------- */
const clb = new Bank('Close Bank');
const good = new SavingsAccount('Good', { id: 'G', openingBalance: '100' });
const bad = new CheckingAccount('Bad', { id: 'B', openingBalance: '0', overdraftLimit: '100', overdraftFee: '0' });
clb.open(good); clb.open(bad);
bad.withdraw('50'); // now -$50
throwsErr(() => clb.close('B'), 'cannot close an overdrawn account');
eq(clb.size, 2, 'the overdrawn account stays open');
clb.close('G');
eq(clb.size, 1, 'a settled account closes');

/* --- auto ids never collide with explicit "A-NNNN" ids -------------- */
const idbank = new Bank('Id Bank');
idbank.open(new CheckingAccount('Explicit', { id: 'A-0007', openingBalance: '0' }));
const auto = new CheckingAccount('Auto', { openingBalance: '0' }); // no id -> auto-assigned
ok(auto.id !== 'A-0007', 'an auto id skips past an explicit A-0007');
idbank.open(auto); // would throw "already open" if the ids collided
eq(idbank.size, 2, 'explicit and auto ids coexist');

/* --- fixtures load and behave --------------------------------------- */
const fixtures = require('./bank-fixtures');
const demo = fixtures.buildBank(core);
eq(demo.size, 3, 'fixture bank has three accounts');
eq(demo.get('A-0002').withdrawalsThisCycle, 1, 'the savings fixture has one withdrawal logged');
ok(demo.totalAssetsCents() > 0, 'fixture bank holds positive total assets');

/* -------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
