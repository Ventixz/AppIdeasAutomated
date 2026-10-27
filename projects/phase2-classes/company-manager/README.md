# Company Manager

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**third entry of its Classes (Object-Oriented Programming) category**, after
[Product Inventory](../product-inventory/) and the
[Airline / Hotel Reservation System](../reservation-system/).

> "Create an hierarchy of classes - abstract class Employee and subclasses
> HourlyEmployee, SalariedEmployee, Manager and Executive. Every one's pay is
> calculated differently, research a bit about it."

Open `index.html` to hire employees, watch a live payroll table and org chart,
and recalculate across pay periods — or run `node company-node.js` for the same
classes behind a CLI. No build step, no dependencies.

## The point of this one is the design

The Classes category isn't about features; it's about objects that are correct
by construction. This task is the most explicit of the lot: it *dictates* an
inheritance hierarchy and tells you the one thing that varies down it — **how
pay is computed**. That is the textbook setup for *polymorphism*: one call,
`employee.calculatePay(period)`, dispatching to a different rule per class. The
engine ([`company-core.js`](./company-core.js)) is built around the three things
a naïve version gets wrong.

### 1. The base class is abstract — and so is the pay rule

`Employee` is a *concept*, not someone you can hire. `new Employee()` throws, and
so does a bare `calculatePay()` on a subclass that forgot to override it:

```
Employee is abstract — instantiate a subclass (HourlyEmployee, SalariedEmployee, Manager, Executive)
```

So you can't create an employee whose pay is undefined. "Every subclass computes
pay its own way" stops being a comment everyone is trusted to honor and becomes a
rule the objects enforce.

### 2. Each subclass really computes pay differently — and correctly

This is the literal task. The four rules are genuinely different, and the hard
one is overtime:

| Class | Pay for one period |
| --- | --- |
| `HourlyEmployee` | rate × hours, with **real FLSA overtime** — anything past 40 hours *in a week* is paid at 1.5× |
| `SalariedEmployee` | annual salary ÷ number of pay periods |
| `Manager` | a salaried base **+** a performance bonus |
| `Executive` | a Manager **+** a share of the company's profit |

The overtime is the one most code gets wrong. Overtime is a **weekly** question,
not a pay-period one: 45 hours one week and 35 the next is **not** 80 straight
hours (which would be 40 regular + 40 overtime). It is 40 + 5(OT), then 35 — and
the timesheet is kept per week so the engine settles each week on its own before
summing. The classes form a real chain —

```
Employee (abstract)
├── HourlyEmployee
└── SalariedEmployee
    └── Manager
        └── Executive
```

— so `super.calculatePay(period)` does real work: a `Manager` adds its bonus to
the salaried base, and an `Executive` adds its profit share to *that*.

### 3. Money is integer cents, and the Company is one index of truth

`0.1 + 0.2 !== 0.3` in IEEE-754, so every rate, salary and bonus lives as
**integer cents** (`Money.parse` / `Money.format`) and every total is exact
integer math. The unavoidable fractions — 1.5× overtime, salary ÷ periods, a
bonus percentage, an executive's profit share — each round **once**, explicitly,
to the nearest cent. The `Company` keeps employees in a `Map` keyed by id, and
every rollup — a pay run, the headcount by kind, the annual wage bill — is
**derived from that on demand**, so the summary can never disagree with the
roster you see. Firing an employee also detaches them from every manager's report
list, so the org chart can't dangle.

## Files

| File | What it is |
| --- | --- |
| [`company-core.js`](./company-core.js) | The whole engine: `Employee` (abstract), `HourlyEmployee`, `SalariedEmployee`, `Manager`, `Executive`, `Company`, `PayPeriod`, `Money`, `CompanyError`. DOM-free, network-free. |
| [`company-fixtures.js`](./company-fixtures.js) | A sample company (seven employees of every kind, an org chart, two logged timesheets) and a `buildCompany` helper shared by all three front ends. |
| [`tests.js`](./tests.js) | 57 dependency-free checks: the abstract guard, each pay rule (including weekly overtime and rounding), polymorphic raises, hire/fire, derived rollups. |
| [`company-node.js`](./company-node.js) | A CLI front end — a roster, org chart and pay run, plus a REPL of hire/fire/raise/pay commands. |
| [`index.html`](./index.html) · [`script.js`](./script.js) · [`style.css`](./style.css) | The browser demo: hire employees, a live payroll table with per-kind pay breakdowns, and a rendered org chart. |

## Run it

```bash
node tests.js                          # the engine's proof suite (57 checks)
node company-node.js                   # demo company: roster + org chart + pay run
node company-node.js --json            # the same, as JSON
node company-node.js --periods 12      # run payroll monthly (default is 24, semi-monthly)
node company-node.js --profit 4000000  # set company profit in cents (for executives' share)

# drive it with commands (also works interactively, and over a pipe):
echo "hire hourly 'Pat' 30; hours Pat 45 35; pay; raise Pat 10; pay" \
     | node company-node.js --empty
```

Then open `index.html` in a browser for the interactive version.

## One engine, three front ends

`company-core.js` exports the classes and touches nothing outside itself — no
DOM, no hidden clock, no I/O. The CLI binds them to `stdin`/`stdout`, the demo
binds them to a form, a table and an org tree, and the tests drive them with
fixed data. The pay rules only exist in one place, so the three can't drift
apart.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project built per day by
an automated Claude Code routine. This is Phase 2, Classes category, project 3.*
