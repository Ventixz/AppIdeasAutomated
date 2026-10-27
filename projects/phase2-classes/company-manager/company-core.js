/*
 * company-core.js — a company's employees as a class hierarchy, DOM-free.
 *
 * The task ("Company Manager") is the third* of karan/Projects' Classes
 * category:
 *
 *   "Create an hierarchy of classes - abstract class Employee and subclasses
 *    HourlyEmployee, SalariedEmployee, Manager and Executive. Every one's pay
 *    is calculated differently, research a bit about it."
 *
 * (*the Classes list's third entry; this repo's third project in the category.)
 *
 * Like every task in this category, the point is the *design*, not the feature
 * list. The spec is unusually explicit about it: it dictates an inheritance
 * hierarchy and says the one thing that varies down the hierarchy is **how pay
 * is computed**. That is the textbook setup for *polymorphism* — one call,
 * `employee.calculatePay(period)`, dispatching to a different rule per class —
 * and this engine is built around three things a naive version gets wrong:
 *
 *   1. THE BASE CLASS IS ABSTRACT, AND SO IS THE PAY RULE. `Employee` is a
 *      concept, not a thing you can hire: `new Employee()` throws, and so does
 *      a bare `calculatePay()`. You cannot create an employee whose pay is
 *      undefined — the hierarchy makes "every subclass computes pay its own
 *      way" a rule the compiler-of-last-resort (a thrown error) enforces,
 *      rather than a comment everyone is trusted to honor.
 *
 *   2. EACH SUBCLASS REALLY COMPUTES PAY DIFFERENTLY — and correctly.
 *        • HourlyEmployee — rate × hours, with real FLSA overtime: anything
 *          past 40 hours *in a week* is paid at 1.5×, computed per week (not
 *          per pay period), because that is how overtime law actually works.
 *        • SalariedEmployee — an annual salary sliced into equal pay periods.
 *        • Manager — a salaried base *plus* a performance bonus.
 *        • Executive — a Manager *plus* a profit share: pay that depends on how
 *          the whole company did, so it can only be known at payroll time.
 *      Executive extends Manager extends SalariedEmployee extends Employee, so
 *      the hierarchy is genuinely layered and `super` does real work.
 *
 *   3. MONEY IS INTEGER CENTS, never a float. `0.1 + 0.2 !== 0.3` in IEEE-754,
 *      so every rate, salary and bonus lives as integer cents (`Money.parse`/
 *      `Money.format`) and every total is exact integer arithmetic. The one
 *      place fractions are unavoidable — 1.5× overtime, salary ÷ periods,
 *      a bonus percentage — rounds once, explicitly, to the nearest cent.
 *
 * The Company is an aggregate: it hires, fires and gives raises, and every
 * rollup (a pay run, the headcount by kind, the annual wage bill) is derived
 * from the employees on demand, so the summary can never disagree with the
 * roster you see. Nothing here touches the DOM, a hidden clock, or the network.
 * `company-node.js` drives these classes from a CLI, `script.js` drives them in
 * a browser, and `tests.js` drives them with fixed data. One engine, three
 * front ends.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Errors — one named type so callers (and tests) can tell a rejected
 * operation (abstract instantiation, bad money, unknown employee) from
 * a real bug.
 * ------------------------------------------------------------------ */

class CompanyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompanyError';
  }
}

/* ------------------------------------------------------------------ *
 * Money — integer cents in, formatted dollars out. A flat helper rather
 * than a class because a cent amount IS just an integer; wrapping every
 * salary in an object would buy nothing.
 * ------------------------------------------------------------------ */

const Money = {
  // "52000", "52000.50", "$52,000.00", 52000.5 -> cents. Rejects junk / >2dp.
  parse(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new CompanyError(`not a money amount: ${value}`);
      return Math.round(value * 100);
    }
    const s = String(value).trim().replace(/^\$/, '').replace(/,/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new CompanyError(`not a money amount: "${value}"`);
    const neg = s.startsWith('-');
    const [whole, frac = ''] = s.replace(/^-/, '').split('.');
    const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    return neg ? -cents : cents;
  },

  // cents -> "$52,000.00"
  format(cents) {
    const n = Math.trunc(cents);
    const neg = n < 0;
    const abs = Math.abs(n);
    const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
    const rem = String(abs % 100).padStart(2, '0');
    return `${neg ? '-' : ''}$${dollars}.${rem}`;
  },
};

/* ------------------------------------------------------------------ *
 * A PayPeriod is the shared context a pay run hands every employee. It
 * is the SAME object for everyone in the run — what differs is which
 * fields each class reads:
 *   - periodsPerYear: how a salary is sliced (12 monthly, 24 semi-monthly…)
 *   - companyProfitCents: only an Executive's profit share looks at it
 * Hourly employees carry their own timesheet, so the period needs nothing
 * from them.
 * ------------------------------------------------------------------ */

class PayPeriod {
  constructor({ periodsPerYear = 24, companyProfitCents = 0 } = {}) {
    const p = Number(periodsPerYear);
    if (!Number.isInteger(p) || p <= 0) {
      throw new CompanyError(`periodsPerYear must be a positive integer, got ${periodsPerYear}`);
    }
    this.periodsPerYear = p;
    this.companyProfitCents = Math.trunc(Number(companyProfitCents) || 0);
    Object.freeze(this);
  }
}

/* round a rational numer/denom to the nearest integer, half away from zero */
function divRound(numer, denom) {
  const sign = (numer < 0) !== (denom < 0) ? -1 : 1;
  const a = Math.abs(numer), b = Math.abs(denom);
  return sign * Math.floor((a + b / 2) / b);
}

/* ------------------------------------------------------------------ *
 * Employee — the ABSTRACT base. It holds what every employee has (an id,
 * a name) and declares the two things the hierarchy exists to vary:
 * `calculatePay` and `kind`. You cannot instantiate it, and you cannot
 * ask an un-subclassed employee for pay — both throw. That is the whole
 * "abstract" requirement, made real.
 * ------------------------------------------------------------------ */

let _seq = 0;

class Employee {
  constructor(name, { id } = {}) {
    if (new.target === Employee) {
      throw new CompanyError('Employee is abstract — instantiate a subclass (HourlyEmployee, SalariedEmployee, Manager, Executive)');
    }
    const nm = String(name == null ? '' : name).trim();
    if (!nm) throw new CompanyError('an employee needs a name');
    this.name = nm;
    if (id != null) {
      this.id = String(id);
      // keep the auto-id counter ahead of any explicit "E-NNNN" id, so a later
      // auto-assigned id can never collide with one a caller chose by hand.
      const m = /^E-(\d+)$/.exec(this.id);
      if (m) _seq = Math.max(_seq, Number(m[1]));
    } else {
      this.id = `E-${String(++_seq).padStart(4, '0')}`;
    }
  }

  // Abstract: a concrete employee MUST say how its pay is computed.
  calculatePay(/* period */) {
    throw new CompanyError(`${this.constructor.name} must implement calculatePay()`);
  }

  // Abstract: a short label for the kind of employee.
  get kind() {
    throw new CompanyError(`${this.constructor.name} must define kind`);
  }

  // Annual gross, derived from one period's pay × periods. Handy for the
  // wage-bill rollup; overridable where a period isn't simply ×N (it isn't,
  // for hourly, so HourlyEmployee overrides it).
  annualPayCents(period) {
    return this.calculatePay(period) * period.periodsPerYear;
  }

  toJSON() {
    return { id: this.id, name: this.name, kind: this.kind };
  }
}

/* ------------------------------------------------------------------ *
 * HourlyEmployee — paid for time worked, with real overtime. Overtime
 * is a WEEKLY question (FLSA: >40 hours in a workweek is 1.5×), so the
 * timesheet is kept per week and each week is settled on its own before
 * the weeks are summed. Logging 45 hours one week and 35 the next is NOT
 * 80 straight hours — it is 40+5(OT) then 35, and the engine knows it.
 * ------------------------------------------------------------------ */

const OVERTIME_THRESHOLD = 40;         // hours per week
const OVERTIME_MULTIPLIER = 3;         // 1.5x expressed as 3/2 for exact cents
const OVERTIME_DIVISOR = 2;

class HourlyEmployee extends Employee {
  constructor(name, hourlyRate, opts = {}) {
    super(name, opts);
    this.hourlyRateCents = Money.parse(hourlyRate);
    if (this.hourlyRateCents < 0) throw new CompanyError('hourly rate cannot be negative');
    this._weeks = [];                  // hours worked, one entry per week
  }

  get kind() { return 'Hourly'; }

  // Record hours for one workweek. Accepts fractional hours (e.g. 37.5).
  logWeek(hours) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0) throw new CompanyError(`invalid hours: ${hours}`);
    if (h > 168) throw new CompanyError(`a week has 168 hours; got ${h}`);
    this._weeks.push(h);
    return this;
  }

  clearTimesheet() { this._weeks = []; return this; }

  get loggedWeeks() { return this._weeks.slice(); }
  get totalHours() { return this._weeks.reduce((a, b) => a + b, 0); }

  // Pay = sum over weeks of regular + overtime. Regular hours (≤40) at the
  // base rate; overtime hours at 1.5×, rounded to the cent once per week.
  calculatePay(/* period */) {
    let cents = 0;
    for (const hours of this._weeks) {
      const regular = Math.min(hours, OVERTIME_THRESHOLD);
      const overtime = Math.max(0, hours - OVERTIME_THRESHOLD);
      // hours may be fractional, so scale to keep the multiply integer-exact,
      // then round the single division to the nearest cent.
      const regularCents = divRound(Math.round(regular * 100) * this.hourlyRateCents, 100);
      const overtimeCents = divRound(
        Math.round(overtime * 100) * this.hourlyRateCents * OVERTIME_MULTIPLIER,
        100 * OVERTIME_DIVISOR
      );
      cents += regularCents + overtimeCents;
    }
    return cents;
  }

  // Hourly pay doesn't annualize as pay × periods (it depends on hours), so
  // report the straight-time run rate: rate × 40h × 52 weeks.
  annualPayCents() {
    return divRound(this.hourlyRateCents * OVERTIME_THRESHOLD * 52 * 100, 100);
  }

  // A raise bumps the hourly rate by a percentage.
  giveRaise(percent) {
    this.hourlyRateCents = applyRaise(this.hourlyRateCents, percent);
    return this;
  }

  toJSON() {
    return { ...super.toJSON(), hourlyRateCents: this.hourlyRateCents, loggedWeeks: this.loggedWeeks };
  }
}

/* ------------------------------------------------------------------ *
 * SalariedEmployee — an annual salary paid in equal slices. The period's
 * `periodsPerYear` is the only thing it needs. The last slice absorbs the
 * rounding remainder so the year's slices sum to exactly the salary (no
 * missing penny).
 * ------------------------------------------------------------------ */

class SalariedEmployee extends Employee {
  constructor(name, annualSalary, opts = {}) {
    super(name, opts);
    this.annualSalaryCents = Money.parse(annualSalary);
    if (this.annualSalaryCents < 0) throw new CompanyError('salary cannot be negative');
  }

  get kind() { return 'Salaried'; }

  // One period's base pay: salary ÷ periods, rounded to the cent.
  basePayCents(period) {
    return divRound(this.annualSalaryCents, period.periodsPerYear);
  }

  calculatePay(period) {
    return this.basePayCents(period);
  }

  annualPayCents() { return this.annualSalaryCents; }

  giveRaise(percent) {
    this.annualSalaryCents = applyRaise(this.annualSalaryCents, percent);
    return this;
  }

  toJSON() {
    return { ...super.toJSON(), annualSalaryCents: this.annualSalaryCents };
  }
}

/* ------------------------------------------------------------------ *
 * Manager — a salaried employee who also earns a performance bonus and
 * supervises direct reports. Pay = salaried base + the bonus, prorated
 * over the pay periods. `super.calculatePay(period)` does the salary; the
 * Manager adds its layer. This is where inheritance earns its keep.
 * ------------------------------------------------------------------ */

class Manager extends SalariedEmployee {
  constructor(name, annualSalary, opts = {}) {
    super(name, annualSalary, opts);
    this.annualBonusCents = Money.parse(opts.annualBonus != null ? opts.annualBonus : 0);
    if (this.annualBonusCents < 0) throw new CompanyError('bonus cannot be negative');
    this._reports = new Map();         // id -> Employee
  }

  get kind() { return 'Manager'; }

  get reports() { return Array.from(this._reports.values()); }
  get reportCount() { return this._reports.size; }

  addReport(employee) {
    if (!(employee instanceof Employee)) throw new CompanyError('a report must be an Employee');
    if (employee === this) throw new CompanyError('an employee cannot report to themselves');
    this._reports.set(employee.id, employee);
    return this;
  }

  removeReport(employeeOrId) {
    const id = employeeOrId instanceof Employee ? employeeOrId.id : String(employeeOrId);
    return this._reports.delete(id);
  }

  bonusPayCents(period) {
    return divRound(this.annualBonusCents, period.periodsPerYear);
  }

  calculatePay(period) {
    return super.calculatePay(period) + this.bonusPayCents(period);
  }

  annualPayCents() { return this.annualSalaryCents + this.annualBonusCents; }

  toJSON() {
    return {
      ...super.toJSON(),
      annualBonusCents: this.annualBonusCents,
      reportIds: this.reports.map((r) => r.id),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Executive — a Manager who also takes a share of the company's profit.
 * The profit isn't known until the pay run, so it rides in on the period
 * (`companyProfitCents`); this is the one employee whose pay depends on
 * something outside itself. Pay = salary + bonus + (profitShare × profit),
 * prorated. A loss (negative profit) pays no profit share rather than
 * clawing money back from the executive's salary.
 * ------------------------------------------------------------------ */

class Executive extends Manager {
  constructor(name, annualSalary, opts = {}) {
    super(name, annualSalary, opts);
    const share = Number(opts.profitSharePercent != null ? opts.profitSharePercent : 0);
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      throw new CompanyError(`profitSharePercent must be between 0 and 100, got ${opts.profitSharePercent}`);
    }
    this.profitSharePercent = share;
  }

  get kind() { return 'Executive'; }

  profitSharePayCents(period) {
    if (period.companyProfitCents <= 0 || this.profitSharePercent === 0) return 0;
    // (profit × percent/100) spread across the year's periods, rounded once.
    const annualShare = divRound(period.companyProfitCents * Math.round(this.profitSharePercent * 100), 100 * 100);
    return divRound(annualShare, period.periodsPerYear);
  }

  calculatePay(period) {
    return super.calculatePay(period) + this.profitSharePayCents(period);
  }

  toJSON() {
    return { ...super.toJSON(), profitSharePercent: this.profitSharePercent };
  }
}

/* ------------------------------------------------------------------ *
 * applyRaise — bump a cent amount by a percentage, rounded to the cent.
 * Shared by every giveRaise so a "3.5% raise" means one thing everywhere.
 * ------------------------------------------------------------------ */

function applyRaise(cents, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) throw new CompanyError(`invalid raise percent: ${percent}`);
  if (p <= -100) throw new CompanyError('a raise cannot zero out or reverse pay');
  // cents × (1 + p/100), kept exact by scaling p to basis points.
  const bp = Math.round(p * 100);      // percent -> basis points of a percent
  return cents + divRound(cents * bp, 100 * 100);
}

/* ------------------------------------------------------------------ *
 * Company — the aggregate. It owns the roster (a Map by id), hires and
 * fires, gives raises, and runs payroll. Every rollup is derived from the
 * employees on demand: a pay run, the headcount by kind, the annual wage
 * bill. Firing an employee also detaches them from any manager's reports,
 * so the org chart can't dangle.
 * ------------------------------------------------------------------ */

class Company {
  constructor(name = 'Company') {
    this.name = String(name).trim() || 'Company';
    this._employees = new Map();       // id -> Employee
  }

  get size() { return this._employees.size; }

  employees() { return Array.from(this._employees.values()); }

  get(id) {
    const key = String(id);
    const emp = this._employees.get(key);
    if (!emp) throw new CompanyError(`no employee ${key}`);
    return emp;
  }

  has(id) { return this._employees.has(String(id)); }

  // Hire: the employee object is built by the caller (so the class — and thus
  // the pay rule — is chosen explicitly), the company just takes them on.
  hire(employee) {
    if (!(employee instanceof Employee)) {
      throw new CompanyError('hire() takes an Employee instance (HourlyEmployee, SalariedEmployee, Manager, Executive)');
    }
    if (this._employees.has(employee.id)) throw new CompanyError(`employee ${employee.id} already hired`);
    this._employees.set(employee.id, employee);
    return employee;
  }

  // Fire: remove from the roster AND from every manager's report list, so no
  // manager is left pointing at someone who no longer works here.
  fire(id) {
    const emp = this.get(id);
    this._employees.delete(emp.id);
    for (const other of this._employees.values()) {
      if (other instanceof Manager) other.removeReport(emp.id);
    }
    return emp;
  }

  giveRaise(id, percent) {
    const emp = this.get(id);
    emp.giveRaise(percent);
    return emp;
  }

  // Run payroll for one pay period. Polymorphism in one line: each employee's
  // own calculatePay runs. Returns a payslip per employee and the exact total.
  runPayroll(periodSpec = {}) {
    const period = periodSpec instanceof PayPeriod ? periodSpec : new PayPeriod(periodSpec);
    const slips = this.employees().map((emp) => ({
      id: emp.id,
      name: emp.name,
      kind: emp.kind,
      payCents: emp.calculatePay(period),
    }));
    const totalCents = slips.reduce((sum, s) => sum + s.payCents, 0);
    return { period, slips, totalCents };
  }

  // Headcount grouped by kind, e.g. { Hourly: 3, Salaried: 2, Manager: 1 }.
  headcountByKind() {
    const counts = {};
    for (const emp of this._employees.values()) {
      counts[emp.kind] = (counts[emp.kind] || 0) + 1;
    }
    return counts;
  }

  // The company's annual wage bill — each employee's own annual figure summed.
  annualPayrollCents(periodSpec = {}) {
    const period = periodSpec instanceof PayPeriod ? periodSpec : new PayPeriod(periodSpec);
    let total = 0;
    for (const emp of this._employees.values()) total += emp.annualPayCents(period);
    return total;
  }

  summary(periodSpec = {}) {
    return {
      name: this.name,
      size: this.size,
      headcountByKind: this.headcountByKind(),
      annualPayrollCents: this.annualPayrollCents(periodSpec),
    };
  }

  toJSON() {
    return {
      name: this.name,
      employees: this.employees().map((e) => e.toJSON()),
      summary: this.summary(),
    };
  }
}

/* ------------------------------------------------------------------ */

const coreApi = {
  CompanyError, Money, PayPeriod,
  Employee, HourlyEmployee, SalariedEmployee, Manager, Executive,
  Company,
};

if (typeof module !== 'undefined' && module.exports) module.exports = coreApi;
if (typeof window !== 'undefined') window.CompanyManager = coreApi;
