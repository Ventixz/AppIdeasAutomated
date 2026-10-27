#!/usr/bin/env node
/*
 * company-node.js — a CLI front end over the same Employee hierarchy and
 * Company aggregate the browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample company and prints the roster, the org
 * chart, and a pay run. You can also drive it as a tiny REPL of commands, or
 * pipe commands in.
 *
 * Usage:
 *   node company-node.js                       # demo company: roster + payroll
 *   node company-node.js --json                # same, as JSON
 *   node company-node.js --empty               # start with no employees, then REPL
 *   node company-node.js --periods 12          # run payroll monthly (default 24)
 *   node company-node.js --profit 4000000      # company profit in cents (for execs)
 *   echo "hire hourly 'Pat' 30; hours Pat 45; pay" | node company-node.js --empty
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   roster                                      list employees, kind, annual pay
 *   org                                         the reporting tree
 *   hire hourly   <name> <rate>                 add an hourly employee
 *   hire salaried <name> <salary>               add a salaried employee
 *   hire manager  <name> <salary> [bonus]       add a manager
 *   hire exec     <name> <salary> [bonus] [pct] add an executive (pct = profit %)
 *   hours <name|id> <h> [h...]                  log weekly hours for an hourly employee
 *   report <manager> <employee>                 make <employee> report to <manager>
 *   raise <name|id> <percent>                   give a raise
 *   fire  <name|id>                             let an employee go
 *   pay                                         run payroll for the period
 *   summary                                     headcount + annual wage bill
 *   help                                        this list
 */
'use strict';

const core = require('./company-core');
const { Money, PayPeriod, HourlyEmployee, SalariedEmployee, Manager, Executive, CompanyError } = core;
const fixtures = require('./company-fixtures');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
function opt(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
}

const PERIODS = Number(opt('--periods', 24));
const PROFIT = Number(opt('--profit', 0));
const periodSpec = { periodsPerYear: PERIODS, companyProfitCents: PROFIT };

const company = flag('--empty') ? new core.Company('My Company') : fixtures.buildCompany(core);

/* ---- rendering ----------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function renderRoster(co) {
  const emps = co.employees();
  if (!emps.length) return '(no employees)';
  const rows = emps.map((e) => [
    e.id, e.name, e.kind, Money.format(e.annualPayCents(new PayPeriod(periodSpec))),
  ]);
  const head = ['ID', 'Name', 'Kind', 'Annual pay'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => `  ${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${padL(r[3], widths[3])}`;
  return [line(head), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line)].join('\n');
}

function renderOrg(co) {
  // Managers and the people who report to them; anyone with no manager is a root.
  const managers = co.employees().filter((e) => e instanceof Manager);
  const reportsOf = new Map(managers.map((m) => [m.id, m.reports]));
  const managed = new Set();
  for (const m of managers) for (const r of m.reports) managed.add(r.id);
  const roots = co.employees().filter((e) => !managed.has(e.id));

  const lines = [];
  const walk = (emp, depth) => {
    lines.push(`${'  '.repeat(depth)}- ${emp.name} (${emp.kind})`);
    const kids = reportsOf.get(emp.id) || [];
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join('\n') || '(no org chart)';
}

function renderPayroll(co) {
  const run = co.runPayroll(periodSpec);
  const rows = run.slips.map((s) => [s.name, s.kind, Money.format(s.payCents)]);
  const head = ['Name', 'Kind', `Pay (1/${run.period.periodsPerYear} yr)`];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => `  ${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${padL(r[2], widths[2])}`;
  const out = [line(head), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line)];
  out.push(`  ${' '.repeat(widths[0])}  ${pad('TOTAL', widths[1])}  ${padL(Money.format(run.totalCents), widths[2])}`);
  return out.join('\n');
}

function renderSummary(co) {
  const s = co.summary(periodSpec);
  const kinds = Object.entries(s.headcountByKind).map(([k, n]) => `${k}: ${n}`).join(', ') || '(none)';
  return `  ${s.name}: ${s.size} employees (${kinds})\n  Annual wage bill: ${Money.format(s.annualPayrollCents)}`;
}

function report(co) {
  console.log(`\n${co.name} — roster\n`);
  console.log(renderRoster(co));
  console.log(`\nOrg chart\n`);
  console.log(renderOrg(co));
  console.log(`\nPay run (${PERIODS} periods/yr${PROFIT ? `, profit ${Money.format(PROFIT)}` : ''})\n`);
  console.log(renderPayroll(co));
  console.log('');
  console.log(renderSummary(co));
  console.log('');
}

/* ---- command parsing (shared by REPL and piped input) ------------- */

// split on ';', respecting single/double quotes so names with spaces survive
function splitCommands(text) { return text.split(';').map((c) => c.trim()).filter(Boolean); }
function tokenize(cmd) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function findEmployee(co, nameOrId) {
  if (co.has(nameOrId)) return co.get(nameOrId);
  const match = co.employees().filter((e) => e.name.toLowerCase() === String(nameOrId).toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length > 1) throw new CompanyError(`"${nameOrId}" is ambiguous — use an id`);
  throw new CompanyError(`no employee "${nameOrId}"`);
}

function runCommand(co, cmd) {
  const [verb, ...rest] = tokenize(cmd);
  switch ((verb || '').toLowerCase()) {
    case 'roster': console.log(renderRoster(co)); break;
    case 'org': console.log(renderOrg(co)); break;
    case 'summary': console.log(renderSummary(co)); break;
    case 'pay': console.log(renderPayroll(co)); break;
    case 'help': console.log(helpText()); break;
    case 'hire': {
      const [type, name, ...nums] = rest;
      let emp;
      switch ((type || '').toLowerCase()) {
        case 'hourly':   emp = new HourlyEmployee(name, nums[0]); break;
        case 'salaried': emp = new SalariedEmployee(name, nums[0]); break;
        case 'manager':  emp = new Manager(name, nums[0], { annualBonus: nums[1] || 0 }); break;
        case 'exec': case 'executive':
          emp = new Executive(name, nums[0], { annualBonus: nums[1] || 0, profitSharePercent: Number(nums[2] || 0) });
          break;
        default: throw new CompanyError(`unknown employee type "${type}" (hourly|salaried|manager|exec)`);
      }
      co.hire(emp);
      console.log(`hired ${emp.name} (${emp.kind}, ${emp.id})`);
      break;
    }
    case 'hours': {
      const emp = findEmployee(co, rest[0]);
      if (!(emp instanceof HourlyEmployee)) throw new CompanyError(`${emp.name} is ${emp.kind}, not hourly`);
      emp.clearTimesheet();
      for (const h of rest.slice(1)) emp.logWeek(Number(h));
      console.log(`logged ${emp.loggedWeeks.join(', ')} h for ${emp.name}`);
      break;
    }
    case 'report': {
      const mgr = findEmployee(co, rest[0]);
      if (!(mgr instanceof Manager)) throw new CompanyError(`${mgr.name} is ${mgr.kind}, not a manager`);
      const emp = findEmployee(co, rest[1]);
      mgr.addReport(emp);
      console.log(`${emp.name} now reports to ${mgr.name}`);
      break;
    }
    case 'raise': {
      const emp = findEmployee(co, rest[0]);
      co.giveRaise(emp.id, Number(rest[1]));
      console.log(`raised ${emp.name} by ${rest[1]}% -> ${Money.format(emp.annualPayCents(new PayPeriod(periodSpec)))}/yr`);
      break;
    }
    case 'fire': {
      const emp = findEmployee(co, rest[0]);
      co.fire(emp.id);
      console.log(`let ${emp.name} go`);
      break;
    }
    case '': break;
    default: console.log(`unknown command "${verb}" — try "help"`);
  }
}

function helpText() {
  return [
    'commands:',
    '  roster                              list employees',
    '  org                                 reporting tree',
    '  hire hourly   <name> <rate>         add an hourly employee',
    '  hire salaried <name> <salary>       add a salaried employee',
    '  hire manager  <name> <salary> [bonus]',
    '  hire exec     <name> <salary> [bonus] [profit%]',
    "  hours <name|id> <h> [h...]          log weekly hours (one number per week)",
    '  report <manager> <employee>         set a reporting line',
    '  raise  <name|id> <percent>          give a raise',
    '  fire   <name|id>                    let someone go',
    '  pay                                 run payroll',
    '  summary                             headcount + wage bill',
  ].join('\n');
}

/* ---- entry points -------------------------------------------------- */

function runRepl() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'company> ' });
  console.log('Company Manager CLI. Type "help" for commands, Ctrl-D to exit.\n');
  rl.prompt();
  rl.on('line', (line) => {
    for (const cmd of splitCommands(line)) {
      try { runCommand(company, cmd); } catch (e) {
        if (e instanceof CompanyError) console.error(`error: ${e.message}`); else throw e;
      }
    }
    rl.prompt();
  });
  rl.on('close', () => { console.log(); process.exit(0); });
}

function runPiped(text) {
  for (const cmd of splitCommands(text)) {
    try { runCommand(company, cmd); } catch (e) {
      if (e instanceof CompanyError) console.error(`error: ${e.message}`); else throw e;
    }
  }
}

if (flag('--json')) {
  console.log(JSON.stringify(company.toJSON(), null, 2));
} else if (process.stdin.isTTY) {
  if (!flag('--empty')) report(company);
  runRepl();
} else {
  // input piped in: run those commands over the current company
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    if (!flag('--empty') && !buf.trim()) report(company);
    else runPiped(buf);
  });
}
