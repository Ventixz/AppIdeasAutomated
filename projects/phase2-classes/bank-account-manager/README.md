# Bank Account Manager

A **Source 2** project, built by the automated Claude routine from the
[karan/Projects "Mega Project List"](https://github.com/karan/Projects) — the
**fourth entry of its Classes (Object-Oriented Programming) category**, after
[Product Inventory](../product-inventory/), the
[Airline / Hotel Reservation System](../reservation-system/) and the
[Company Manager](../company-manager/).

> "Create a class called Account which will be an abstract class for three other
> classes called CheckingAccount, SavingsAccount and BusinessAccount. Manage
> credits and debits from these accounts through an ATM style program."

Open `index.html` to open accounts, deposit and withdraw ATM-style, move money
between accounts and read each account's statement — or run `node bank-node.js`
for the same classes behind a CLI. No build step, no dependencies.

## The point of this one is the design

The Classes category isn't about features; it's about objects that are correct
by construction. This task *dictates* an inheritance hierarchy — an abstract
`Account` and three concrete kinds — and the one thing that varies down it is
**how a debit is allowed and charged**. That is the textbook setup for
*polymorphism*: one call, `account.withdraw(amount)`, dispatching to a different
rule per class. The engine ([`bank-core.js`](./bank-core.js)) is built around the
three things a naïve version gets wrong.

### 1. The base class is abstract — and so is the debit policy

`Account` is a *concept*, not something you can open. `new Account()` throws, and
so does a subclass that forgot to define its policy hooks:

```
Account is abstract — open a subclass (CheckingAccount, SavingsAccount, BusinessAccount)
```

So you can't open an account whose overdraft rule is undefined. "Every kind
debits its own way" stops being a comment everyone is trusted to honor and
becomes a rule the objects enforce.

### 2. Each subclass really debits differently — and correctly

This is the literal task. The three rules are genuinely different, and each lives
in two overridable hooks — `minimumBalanceCents` (the floor a debit may not
cross) and `feeFor()` (what a debit costs) — that the shared `withdraw()`
template consults:

| Class | How a withdrawal behaves |
| --- | --- |
| `CheckingAccount` | may overdraw down to a limit; the **first** debit that pushes the balance negative charges a one-time overdraft fee (an already-overdrawn account isn't re-charged) |
| `SavingsAccount` | **never** overdraws (floor is zero), earns interest, and **caps the number of withdrawals** per statement cycle — the (N+1)th is refused |
| `BusinessAccount` | charges a **flat per-transaction fee on every debit** and carries a larger overdraft line of credit |

Because the policy is in the hooks, the `withdraw()` method is written **once**
and still does the right thing for each class. A checking overdraft, a savings
withdrawal cap, and a business transaction fee are three different rules reached
through one call.

### 3. Money is integer cents, the ledger is the truth, and transfers are atomic

`0.1 + 0.2 !== 0.3` in IEEE-754, so every amount lives as **integer cents**
(`Money.parse` / `Money.format`) and every total is exact integer math. The one
unavoidable fraction — savings interest — rounds **once**, explicitly, to the
nearest cent.

The balance is not a stored number a buggy path could desync from history. It is
**derived from the account's ledger** (the signed sum of every entry), so the
statement you read and the balance you spend can never disagree. And a transfer
is **all-or-nothing**: the `Bank` attempts the debit first, and only if it
succeeds does the credit happen —

```
from.withdraw(amount)   // throws if insufficient / capped — the transfer stops here
to.deposit(amount)      // only reached when the debit succeeded
```

— so money is never created or destroyed in flight. A transfer a savings account
can't fund (or has hit its withdrawal cap for) leaves **both** sides untouched.

## Files

| File | What it is |
| --- | --- |
| [`bank-core.js`](./bank-core.js) | The whole engine: `Account` (abstract), `CheckingAccount`, `SavingsAccount`, `BusinessAccount`, `Bank`, `Money`, `BankError`. DOM-free, network-free. |
| [`bank-fixtures.js`](./bank-fixtures.js) | A sample bank (a checking, a savings and a business account, each exercising its own rule) and a `buildBank` helper shared by all three front ends. |
| [`tests.js`](./tests.js) | 70 dependency-free checks: the abstract guard, each debit rule (overdraft + one-time fee, no-overdraft + interest + withdrawal cap, per-transaction fee), the ledger-derived balance, and atomic transfers. |
| [`bank-node.js`](./bank-node.js) | An ATM-style CLI — the accounts, their statements, and a REPL of open/deposit/withdraw/transfer/interest/close commands. |
| [`index.html`](./index.html) · [`script.js`](./script.js) · [`style.css`](./style.css) | The browser demo: open accounts, a teller panel for deposits/withdrawals/transfers, and a live statement. |

## Run it

```bash
node tests.js                          # the engine's proof suite (70 checks)
node bank-node.js                      # sample bank: accounts + statements
node bank-node.js --json               # the same, as JSON

# drive it ATM-style (also works interactively, and over a pipe):
echo "open checking 'Pat' 500 200 35; withdraw Pat 600; statement Pat" \
     | node bank-node.js --empty
```

Then open `index.html` in a browser for the interactive version.

## One engine, three front ends

`bank-core.js` exports the classes and touches nothing outside itself — no DOM,
no hidden clock, no I/O. The CLI binds them to `stdin`/`stdout`, the demo binds
them to a form, a table and a statement, and the tests drive them with fixed
data. The debit rules only exist in one place, so the three can't drift apart.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project built per day by
an automated Claude Code routine. This is Phase 2, Classes category, project 4.*
