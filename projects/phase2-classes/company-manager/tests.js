#!/usr/bin/env node
/*
 * tests.js — dependency-free checks for the company engine. Run: node tests.js
 *
 * The Classes category is about design, so these tests lean on what the design
 * is supposed to guarantee: the base class is abstract (you can't hire an
 * "Employee" or get pay from one), each subclass computes pay its own way and
 * gets it right (hourly overtime, salary slicing, manager bonus, executive
 * profit share), money stays exact (integer cents), and the Company aggregate
 * keeps its roster and org chart consistent (firing detaches reports; rollups
 * are derived). Overtime gets its own block, because weekly-vs-period is the
 * classic mistake in payroll code.
 */
'use strict';

const core = require('./company-core');
const {
  CompanyError, Money, PayPeriod,
  Employee, HourlyEmployee, SalariedEmployee, Manager, Executive, Company,
} = core;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throwsErr(fn, msg) {
  try { fn(); fail++; console.error('  FAIL (no throw):', msg); }
  catch (e) { ok(e instanceof CompanyError, `${msg} — threw ${e.name}: ${e.message}`); }
}

const period = new PayPeriod({ periodsPerYear: 24 }); // semi-monthly

/* --- Money ----------------------------------------------------------- */
eq(Money.parse('52000'), 5200000, 'parse whole dollars');
eq(Money.parse('52000.50'), 5200050, 'parse dollars.cents');
eq(Money.parse('$1,299.00'), 129900, 'parse with $ and commas');
eq(Money.parse(38.5), 3850, 'parse a number');
eq(Money.format(5200050), '$52,000.50', 'format');
eq(Money.format(-129900), '-$1,299.00', 'format negative');
throwsErr(() => Money.parse('12.345'), 'reject >2 decimals');
throwsErr(() => Money.parse('abc'), 'reject junk');

/* --- Employee is abstract ------------------------------------------- */
throwsErr(() => new Employee('Nobody'), 'cannot instantiate abstract Employee');
throwsErr(() => new HourlyEmployee('', '20'), 'an employee needs a name');
// a hand-rolled subclass that forgets to implement calculatePay still can't pay:
class Broken extends Employee { get kind() { return 'Broken'; } }
throwsErr(() => new Broken('X').calculatePay(period), 'un-overridden calculatePay throws');
ok(new HourlyEmployee('A', '20') instanceof Employee, 'HourlyEmployee is an Employee');
ok(new Executive('B', '1') instanceof Manager, 'Executive is a Manager');
ok(new Manager('C', '1') instanceof SalariedEmployee, 'Manager is a SalariedEmployee');

/* --- HourlyEmployee: each pay rule is its own ----------------------- */
const h = new HourlyEmployee('Hourly Hal', '30.00');
h.logWeek(40);
eq(h.calculatePay(period), 120000, '40h at $30 = $1,200.00');
h.clearTimesheet().logWeek(45);
// 40×30 + 5×30×1.5 = 1200 + 225 = 1425
eq(h.calculatePay(period), 142500, '45h: 40 straight + 5 overtime at 1.5x');
h.clearTimesheet().logWeek(45).logWeek(35);
// week1: 1425.00 ; week2: 35×30 = 1050.00 ; total 2475.00
eq(h.calculatePay(period), 247500, 'overtime is WEEKLY, not pooled across weeks');
// the trap: 80 hours pooled would be 40 straight + 40 OT = 1200 + 1800 = 3000 — wrong
ok(h.calculatePay(period) !== 300000, 'pooling weeks would overpay — engine does not');
h.clearTimesheet().logWeek(37.5);
eq(h.calculatePay(period), 112500, 'fractional hours: 37.5h at $30 = $1,125.00');
throwsErr(() => h.logWeek(-1), 'reject negative hours');
throwsErr(() => h.logWeek(200), 'reject >168 hours in a week');

// overtime rounding to the cent: $33.33/h, 41h -> 40×33.33 + 1×33.33×1.5
const hr = new HourlyEmployee('Round', '33.33');
hr.logWeek(41);
// 40×3333 = 133320 ; OT 1×3333×1.5 = 4999.5 -> 5000 ; total 138320
eq(hr.calculatePay(period), 138320, 'overtime rounds to the nearest cent');

/* --- SalariedEmployee: salary sliced into periods ------------------- */
const s = new SalariedEmployee('Salaried Sue', '120000');
eq(s.calculatePay(period), 500000, '$120,000 / 24 = $5,000.00 per period');
eq(s.calculatePay(new PayPeriod({ periodsPerYear: 12 })), 1000000, 'monthly = $10,000.00');
eq(s.annualPayCents(), 12000000, 'annual pay is the salary');
// a salary that doesn't divide evenly still rounds each slice to the cent
const s2 = new SalariedEmployee('Odd', '100000');
eq(s2.calculatePay(new PayPeriod({ periodsPerYear: 7 })), 1428571, '$100,000/7 rounds to $14,285.71');

/* --- Manager: salary + bonus ---------------------------------------- */
const m = new Manager('Manager Mia', '150000', { annualBonus: '24000' });
// base 150000/24 = 6250.00 ; bonus 24000/24 = 1000.00 ; total 7250.00
eq(m.calculatePay(period), 725000, 'manager pay = salary slice + bonus slice');
eq(m.annualPayCents(), 17400000, 'manager annual = salary + bonus');
ok(m.reportCount === 0, 'a fresh manager has no reports');

/* --- Executive: salary + bonus + profit share ----------------------- */
const e = new Executive('Exec Evan', '300000', { annualBonus: '60000', profitSharePercent: 2 });
const profitable = new PayPeriod({ periodsPerYear: 24, companyProfitCents: Money.parse('5000000') });
// base 300000/24 = 12500.00 ; bonus 60000/24 = 2500.00
// profit share: 2% of 5,000,000 = 100,000 /yr ; /24 = 4166.67
// total = 12500 + 2500 + 4166.67 = 19166.67
eq(e.calculatePay(profitable), 1916667, 'executive pay = salary + bonus + profit share');
// in a period with no profit, the share is zero (salary+bonus only)
eq(e.calculatePay(period), 1500000, 'no profit => no profit share, just salary + bonus');
// a loss never claws back pay
const lossy = new PayPeriod({ periodsPerYear: 24, companyProfitCents: Money.parse('-1000000') });
eq(e.calculatePay(lossy), 1500000, 'a loss pays no profit share (not negative)');
throwsErr(() => new Executive('Bad', '1', { profitSharePercent: 150 }), 'reject profit share over 100%');

/* --- giveRaise is polymorphic --------------------------------------- */
const rh = new HourlyEmployee('RaiseH', '20.00');
rh.giveRaise(10);
eq(rh.hourlyRateCents, 2200, '10% raise on $20.00 hourly -> $22.00');
const rs = new SalariedEmployee('RaiseS', '100000');
rs.giveRaise(3.5);
eq(rs.annualSalaryCents, 10350000, '3.5% raise on $100,000 -> $103,500.00');
throwsErr(() => rs.giveRaise(-100), 'a raise cannot zero out pay');

/* --- Company: hire / fire / rollups --------------------------------- */
const co = new Company('Test Co');
const mgr = new Manager('Boss', '150000', { id: 'M1', annualBonus: '0' });
const rep = new SalariedEmployee('Report', '90000', { id: 'S1' });
const tmp = new HourlyEmployee('Temp', '25', { id: 'H1' });
co.hire(mgr); co.hire(rep); co.hire(tmp);
mgr.addReport(rep); mgr.addReport(tmp);
eq(co.size, 3, 'three employees hired');
throwsErr(() => co.hire(mgr), 'cannot hire the same employee twice');
throwsErr(() => co.hire({ name: 'plain object' }), 'hire() rejects non-Employee');
throwsErr(() => co.get('nope'), 'get() throws on unknown id');
eq(JSON.stringify(co.headcountByKind()), JSON.stringify({ Manager: 1, Salaried: 1, Hourly: 1 }), 'headcount by kind');

// firing detaches the employee from the manager's reports — no dangling report
eq(mgr.reportCount, 2, 'manager has two reports before firing');
co.fire('S1');
eq(co.size, 2, 'roster shrinks after firing');
eq(mgr.reportCount, 1, 'fired employee is removed from the manager\'s reports');
ok(!mgr.reports.some((r) => r.id === 'S1'), 'no dangling report after fire');

/* --- Company.runPayroll: polymorphic dispatch, exact total ---------- */
const payco = new Company('Pay Co');
const pm = new Manager('M', '120000', { id: 'PM', annualBonus: '24000' });
const ph = new HourlyEmployee('H', '30.00', { id: 'PH' });
ph.logWeek(40);
payco.hire(pm); payco.hire(ph);
const run = payco.runPayroll({ periodsPerYear: 24 });
// manager: 120000/24 + 24000/24 = 5000 + 1000 = 6000.00 ; hourly 40×30 = 1200.00
eq(run.totalCents, 720000, 'payroll total = $6,000 + $1,200 = $7,200.00');
eq(run.slips.length, 2, 'one payslip per employee');
ok(run.slips.every((s) => typeof s.payCents === 'number'), 'every slip carries integer cents');
// the total is exactly the sum of the slips — derived, not stored
eq(run.slips.reduce((a, s) => a + s.payCents, 0), run.totalCents, 'total equals the sum of slips');

/* --- raise flows through to the next pay run ------------------------ */
payco.giveRaise('PH', 10); // $30 -> $33/h
ph.clearTimesheet().logWeek(40);
const run2 = payco.runPayroll({ periodsPerYear: 24 });
// hourly now 40×33 = 1320.00 ; total 6000 + 1320 = 7320.00
eq(run2.totalCents, 732000, 'a raise shows up in the next payroll run');

/* --- PayPeriod validation ------------------------------------------- */
throwsErr(() => new PayPeriod({ periodsPerYear: 0 }), 'reject 0 pay periods');
throwsErr(() => new PayPeriod({ periodsPerYear: 2.5 }), 'reject fractional pay periods');

/* --- auto ids never collide with explicit "E-NNNN" ids -------------- */
const idco = new Company('Id Co');
idco.hire(new SalariedEmployee('Explicit', '50000', { id: 'E-0003' }));
const auto = new SalariedEmployee('Auto', '50000'); // no id -> auto-assigned
ok(auto.id !== 'E-0003', 'an auto id skips past an explicit E-0003');
idco.hire(auto); // would throw "already hired" if the ids collided
eq(idco.size, 2, 'explicit and auto ids coexist');

/* --- fixtures load and pay out -------------------------------------- */
const fixtures = require('./company-fixtures');
const demo = fixtures.buildCompany(core);
eq(demo.size, 7, 'fixture company has seven employees');
const demoRun = demo.runPayroll({ periodsPerYear: 24, companyProfitCents: Money.parse('4000000') });
ok(demoRun.totalCents > 0, 'fixture payroll pays out something');
ok(demoRun.slips.length === 7, 'fixture payroll has seven slips');

/* -------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
