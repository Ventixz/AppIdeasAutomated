#!/usr/bin/env node
/*
 * bank-node.js — an ATM-style CLI over the same Account hierarchy and Bank
 * aggregate the browser demo uses. No build step, no dependencies.
 *
 * With no arguments it loads the sample bank and prints every account with its
 * balance and a short statement. You can also drive it as a tiny REPL of
 * ATM-style commands, or pipe commands in.
 *
 * Usage:
 *   node bank-node.js                          # sample bank: accounts + statements
 *   node bank-node.js --json                   # same, as JSON
 *   node bank-node.js --empty                  # start with no accounts, then REPL
 *   echo "open checking 'Pat' 500; withdraw A-0001 600; statement A-0001" \
 *        | node bank-node.js --empty
 *
 * REPL commands (also accepted on stdin, ';'-separated):
 *   accounts                                    list accounts, kind, balance
 *   open checking <owner> <bal> [odLimit] [odFee]   open a checking account
 *   open savings  <owner> <bal> [rate%] [wdLimit]   open a savings account
 *   open business <owner> <bal> [txFee] [odLimit]   open a business account
 *   deposit  <id|owner> <amount>                credit an account
 *   withdraw <id|owner> <amount>                debit an account (ATM cash)
 *   transfer <from> <to> <amount>               move money, all-or-nothing
 *   interest <id|owner> [periods/yr]            post one period's interest (savings)
 *   statement <id|owner>                        print an account's transactions
 *   close <id|owner>                            close a settled account
 *   summary                                     total assets + count by kind
 *   help                                        this list
 */
'use strict';

const core = require('./bank-core');
const { Money, CheckingAccount, SavingsAccount, BusinessAccount, BankError } = core;
const fixtures = require('./bank-fixtures');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const bank = flag('--empty') ? new core.Bank('My Bank') : fixtures.buildBank(core);

/* ---- rendering ----------------------------------------------------- */

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function accountExtra(acct) {
  if (acct instanceof CheckingAccount) {
    return `overdraft to ${Money.format(-acct.minimumBalanceCents)}, ${Money.format(acct.overdraftFeeCents)} fee`;
  }
  if (acct instanceof SavingsAccount) {
    return `${acct.annualInterestPercent}%/yr, ${acct.withdrawalsThisCycle}/${acct.withdrawalLimit} withdrawals used`;
  }
  if (acct instanceof BusinessAccount) {
    return `${Money.format(acct.transactionFeeCents)}/transaction, overdraft to ${Money.format(-acct.minimumBalanceCents)}`;
  }
  return '';
}

function renderAccounts(bk) {
  const accts = bk.accounts();
  if (!accts.length) return '(no accounts)';
  const rows = accts.map((a) => [a.id, a.owner, a.kind, Money.format(a.balanceCents), accountExtra(a)]);
  const head = ['ID', 'Owner', 'Kind', 'Balance', 'Terms'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => `  ${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${padL(r[3], widths[3])}  ${pad(r[4], widths[4])}`;
  return [line(head), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line)].join('\n');
}

function renderStatement(acct) {
  const out = [`  ${acct.owner} — ${acct.kind} (${acct.id})`];
  const rows = acct.transactions.map((t) => [
    `#${t.seq}`,
    t.type,
    (t.amountCents >= 0 ? '+' : '') + Money.format(t.amountCents),
    Money.format(t.balanceCents),
    t.note || '',
  ]);
  const head = ['', 'Type', 'Amount', 'Balance', 'Note'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => `    ${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${padL(r[2], widths[2])}  ${padL(r[3], widths[3])}  ${pad(r[4], widths[4])}`;
  out.push(line(head), `    ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...rows.map(line));
  return out.join('\n');
}

function renderSummary(bk) {
  const s = bk.summary();
  const kinds = Object.entries(s.countByKind).map(([k, n]) => `${k}: ${n}`).join(', ') || '(none)';
  return `  ${s.name}: ${s.size} accounts (${kinds})\n  Total assets: ${Money.format(s.totalAssetsCents)}`;
}

function report(bk) {
  console.log(`\n${bk.name} — accounts\n`);
  console.log(renderAccounts(bk));
  console.log('');
  for (const acct of bk.accounts()) {
    console.log(renderStatement(acct));
    console.log('');
  }
  console.log(renderSummary(bk));
  console.log('');
}

/* ---- command parsing (shared by REPL and piped input) ------------- */

function splitCommands(text) { return text.split(';').map((c) => c.trim()).filter(Boolean); }
function tokenize(cmd) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function findAccount(bk, idOrOwner) {
  if (bk.has(idOrOwner)) return bk.get(idOrOwner);
  const match = bk.accounts().filter((a) => a.owner.toLowerCase() === String(idOrOwner).toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length > 1) throw new BankError(`"${idOrOwner}" is ambiguous — use an id`);
  throw new BankError(`no account "${idOrOwner}"`);
}

function runCommand(bk, cmd) {
  const [verb, ...rest] = tokenize(cmd);
  switch ((verb || '').toLowerCase()) {
    case 'accounts': console.log(renderAccounts(bk)); break;
    case 'summary': console.log(renderSummary(bk)); break;
    case 'help': console.log(helpText()); break;
    case 'statement': console.log(renderStatement(findAccount(bk, rest[0]))); break;
    case 'open': {
      const [type, owner, ...nums] = rest;
      let acct;
      switch ((type || '').toLowerCase()) {
        case 'checking':
          acct = new CheckingAccount(owner, { openingBalance: nums[0] || 0, overdraftLimit: nums[1] || 0, overdraftFee: nums[2] || 0 });
          break;
        case 'savings':
          acct = new SavingsAccount(owner, { openingBalance: nums[0] || 0, annualInterestPercent: Number(nums[1] || 0), withdrawalLimit: nums[2] != null ? Number(nums[2]) : 6 });
          break;
        case 'business':
          acct = new BusinessAccount(owner, { openingBalance: nums[0] || 0, transactionFee: nums[1] || 0, overdraftLimit: nums[2] || 0 });
          break;
        default: throw new BankError(`unknown account type "${type}" (checking|savings|business)`);
      }
      bk.open(acct);
      console.log(`opened ${acct.kind} ${acct.id} for ${acct.owner} (${Money.format(acct.balanceCents)})`);
      break;
    }
    case 'deposit': {
      const acct = findAccount(bk, rest[0]);
      acct.deposit(rest[1], 'deposit');
      console.log(`deposited ${Money.format(Money.parse(rest[1]))} -> ${acct.id} now ${Money.format(acct.balanceCents)}`);
      break;
    }
    case 'withdraw': {
      const acct = findAccount(bk, rest[0]);
      acct.withdraw(rest[1], 'ATM cash');
      console.log(`withdrew ${Money.format(Money.parse(rest[1]))} -> ${acct.id} now ${Money.format(acct.balanceCents)}`);
      break;
    }
    case 'transfer': {
      const from = findAccount(bk, rest[0]);
      const to = findAccount(bk, rest[1]);
      bk.transfer(from.id, to.id, rest[2]);
      console.log(`transferred ${Money.format(Money.parse(rest[2]))}: ${from.id} -> ${to.id}`);
      console.log(`  ${from.id} now ${Money.format(from.balanceCents)}, ${to.id} now ${Money.format(to.balanceCents)}`);
      break;
    }
    case 'interest': {
      const acct = findAccount(bk, rest[0]);
      if (!(acct instanceof SavingsAccount)) throw new BankError(`${acct.id} is ${acct.kind}, not savings`);
      acct.accrueInterest(rest[1] != null ? Number(rest[1]) : 12);
      console.log(`posted interest -> ${acct.id} now ${Money.format(acct.balanceCents)}`);
      break;
    }
    case 'close': {
      const acct = findAccount(bk, rest[0]);
      bk.close(acct.id);
      console.log(`closed ${acct.id}, paid out ${Money.format(acct.balanceCents)}`);
      break;
    }
    case '': break;
    default: console.log(`unknown command "${verb}" — try "help"`);
  }
}

function helpText() {
  return [
    'commands:',
    '  accounts                               list accounts',
    '  open checking <owner> <bal> [odLimit] [odFee]',
    '  open savings  <owner> <bal> [rate%] [wdLimit]',
    '  open business <owner> <bal> [txFee] [odLimit]',
    '  deposit  <id|owner> <amount>           credit an account',
    '  withdraw <id|owner> <amount>           debit an account',
    '  transfer <from> <to> <amount>          move money (atomic)',
    '  interest <id|owner> [periods/yr]       post interest (savings)',
    '  statement <id|owner>                   print transactions',
    '  close <id|owner>                        close a settled account',
    '  summary                                total assets + count by kind',
  ].join('\n');
}

/* ---- entry points -------------------------------------------------- */

function runRepl() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'atm> ' });
  console.log('Bank Account Manager ATM. Type "help" for commands, Ctrl-D to exit.\n');
  rl.prompt();
  rl.on('line', (line) => {
    for (const cmd of splitCommands(line)) {
      try { runCommand(bank, cmd); } catch (e) {
        if (e instanceof BankError) console.error(`error: ${e.message}`); else throw e;
      }
    }
    rl.prompt();
  });
  rl.on('close', () => { console.log(); process.exit(0); });
}

function runPiped(text) {
  for (const cmd of splitCommands(text)) {
    try { runCommand(bank, cmd); } catch (e) {
      if (e instanceof BankError) console.error(`error: ${e.message}`); else throw e;
    }
  }
}

if (flag('--json')) {
  console.log(JSON.stringify(bank.toJSON(), null, 2));
} else if (process.stdin.isTTY) {
  if (!flag('--empty')) report(bank);
  runRepl();
} else {
  let buf = '';
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', () => {
    if (!flag('--empty') && !buf.trim()) report(bank);
    else runPiped(buf);
  });
}
