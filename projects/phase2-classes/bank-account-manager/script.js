/*
 * script.js — the browser front end. It owns zero business logic: it builds one
 * Bank from the shared fixtures, calls the class methods on every action, and
 * re-renders from the bank's own state. Every rule (abstract base, per-kind
 * debit policy, exact integer-cent money, ledger-derived balance, atomic
 * transfers) lives in bank-core.js, so this file can't accidentally disagree
 * with the CLI or the tests.
 */
'use strict';

(function () {
  const core = window.BankManager;
  const { Money, CheckingAccount, SavingsAccount, BusinessAccount, BankError } = core;
  const fixtures = window.BankFixtures;

  const bank = fixtures.buildBank(core);
  let selectedId = bank.accounts()[0] ? bank.accounts()[0].id : null;

  const $ = (id) => document.getElementById(id);
  const openForm = $('open-form');
  const opForm = $('op-form');
  const transferForm = $('transfer-form');
  const kindSelect = $('f-kind');
  const msg = $('msg');

  function flash(text, kind) {
    msg.textContent = text || ' ';
    msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---- per-account "terms" blurb (the distinguishing rule, surfaced) --- */

  function terms(acct) {
    if (acct instanceof CheckingAccount) {
      return `overdraft to ${Money.format(-acct.minimumBalanceCents)} · ${Money.format(acct.overdraftFeeCents)} fee`;
    }
    if (acct instanceof SavingsAccount) {
      return `${acct.annualInterestPercent}%/yr · ${acct.withdrawalsThisCycle}/${acct.withdrawalLimit} withdrawals`;
    }
    if (acct instanceof BusinessAccount) {
      return `${Money.format(acct.transactionFeeCents)}/txn · overdraft to ${Money.format(-acct.minimumBalanceCents)}`;
    }
    return '';
  }

  /* ---- rendering --------------------------------------------------- */

  function render() {
    const accts = bank.accounts();
    if (accts.length && !bank.has(selectedId)) selectedId = accts[0].id;

    // tiles
    const s = bank.summary();
    $('t-count').textContent = s.size;
    $('t-kinds').textContent = Object.keys(s.countByKind).length;
    $('t-over').textContent = accts.filter((a) => a.balanceCents < 0).length;
    $('t-assets').textContent = Money.format(s.totalAssetsCents);

    // accounts table
    const rows = $('rows');
    rows.innerHTML = '';
    for (const acct of accts) {
      const tr = document.createElement('tr');
      tr.className = 'selectable' + (acct.id === selectedId ? ' selected' : '');
      tr.dataset.id = acct.id;
      const neg = acct.balanceCents < 0 ? ' neg' : '';
      tr.innerHTML =
        `<td class="id">${acct.id}</td>` +
        `<td>${esc(acct.owner)}</td>` +
        `<td><span class="pill k-${acct.kind}">${acct.kind}</span></td>` +
        `<td class="terms">${terms(acct)}</td>` +
        `<td class="r pay${neg}">${Money.format(acct.balanceCents)}</td>` +
        `<td class="r"><button class="mini danger" data-close="${acct.id}">close</button></td>`;
      rows.appendChild(tr);
    }
    $('foot-total').textContent = Money.format(s.totalAssetsCents);

    // account pickers (teller + transfer)
    fillSelect($('f-acct'), accts, selectedId);
    fillSelect($('f-from'), accts, selectedId);
    fillSelect($('f-to'), accts, accts[1] ? accts[1].id : selectedId);

    renderStatement();
  }

  function fillSelect(sel, accts, chosen) {
    const prev = sel.value;
    sel.innerHTML = '';
    for (const a of accts) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${a.id} — ${a.owner} (${a.kind})`;
      sel.appendChild(o);
    }
    sel.value = accts.some((a) => a.id === prev) ? prev : (chosen || (accts[0] && accts[0].id) || '');
  }

  function renderStatement() {
    const title = $('stmt-title');
    const body = $('stmt-rows');
    body.innerHTML = '';
    if (!bank.has(selectedId)) { title.textContent = '(select an account)'; return; }
    const acct = bank.get(selectedId);
    title.textContent = `${acct.owner} — ${acct.kind} (${acct.id})`;
    for (const t of acct.transactions) {
      const tr = document.createElement('tr');
      const amt = (t.amountCents >= 0 ? '+' : '') + Money.format(t.amountCents);
      const negBal = t.balanceCents < 0 ? ' neg' : '';
      tr.innerHTML =
        `<td>${t.seq}</td>` +
        `<td><span class="tx tx-${t.type}">${t.type}</span></td>` +
        `<td class="r pay">${amt}</td>` +
        `<td class="r pay${negBal}">${Money.format(t.balanceCents)}</td>` +
        `<td class="terms">${esc(t.note || '')}</td>`;
      body.appendChild(tr);
    }
  }

  /* ---- interactions ------------------------------------------------ */

  function syncKindFields() {
    const kind = kindSelect.value;
    document.querySelectorAll('.kind-fields').forEach((el) => {
      el.classList.toggle('active', el.dataset.kind === kind);
    });
  }
  kindSelect.addEventListener('change', syncKindFields);

  openForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const owner = $('f-owner').value.trim();
    const kind = kindSelect.value;
    const openingBalance = $('f-open').value;
    try {
      let acct;
      if (kind === 'Checking') {
        acct = new CheckingAccount(owner, { openingBalance, overdraftLimit: $('f-od-limit-c').value, overdraftFee: $('f-od-fee-c').value });
      } else if (kind === 'Savings') {
        acct = new SavingsAccount(owner, { openingBalance, annualInterestPercent: Number($('f-rate-s').value), withdrawalLimit: Number($('f-wd-s').value) });
      } else {
        acct = new BusinessAccount(owner, { openingBalance, transactionFee: $('f-fee-b').value, overdraftLimit: $('f-od-limit-b').value });
      }
      bank.open(acct);
      selectedId = acct.id;
      flash(`Opened ${acct.kind} ${acct.id} for ${acct.owner}.`, 'ok');
      $('f-owner').value = '';
      render();
    } catch (e) {
      if (e instanceof BankError) flash(e.message, 'err'); else throw e;
    }
  });

  // deposit / withdraw / interest all act on the teller account picker
  function teller(op) {
    const id = $('f-acct').value;
    const amount = $('f-amount').value;
    try {
      const acct = bank.get(id);
      if (op === 'deposit') { acct.deposit(amount, 'deposit'); flash(`Deposited ${Money.format(Money.parse(amount))} to ${id}.`, 'ok'); }
      else if (op === 'withdraw') { acct.withdraw(amount, 'ATM cash'); flash(`Withdrew ${Money.format(Money.parse(amount))} from ${id}.`, 'ok'); }
      else if (op === 'interest') {
        if (!(acct instanceof SavingsAccount)) throw new BankError(`${id} is ${acct.kind}, not savings`);
        acct.accrueInterest(12);
        flash(`Posted interest to ${id}.`, 'ok');
      }
      selectedId = id;
      render();
    } catch (e) {
      if (e instanceof BankError) flash(e.message, 'err'); else throw e;
    }
  }

  opForm.addEventListener('submit', (ev) => { ev.preventDefault(); teller('deposit'); });
  opForm.addEventListener('click', (ev) => {
    const op = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-op');
    if (op && op !== 'deposit') { ev.preventDefault(); teller(op); }
  });

  transferForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const from = $('f-from').value, to = $('f-to').value, amount = $('f-tamount').value;
    try {
      bank.transfer(from, to, amount);
      selectedId = from;
      flash(`Transferred ${Money.format(Money.parse(amount))}: ${from} → ${to}.`, 'ok');
      render();
    } catch (e) {
      if (e instanceof BankError) flash(e.message, 'err'); else throw e;
    }
  });

  // click a row to select it (for the statement); the close button is separate
  $('rows').addEventListener('click', (ev) => {
    const closeId = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-close');
    if (closeId) {
      try { bank.close(closeId); flash(`Closed ${closeId}.`, 'ok'); render(); }
      catch (e) { if (e instanceof BankError) flash(e.message, 'err'); else throw e; }
      return;
    }
    const tr = ev.target.closest && ev.target.closest('tr[data-id]');
    if (tr) { selectedId = tr.dataset.id; render(); }
  });

  /* ---- go ---------------------------------------------------------- */
  syncKindFields();
  render();
})();
