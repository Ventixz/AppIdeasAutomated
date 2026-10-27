/*
 * script.js — the browser front end. It owns zero business logic: it builds one
 * Company from the shared fixtures, calls the class methods on every action, and
 * re-renders from the company's own state. Every rule (abstract base, per-kind
 * pay, exact integer-cent money, derived rollups) lives in company-core.js, so
 * this file can't accidentally disagree with the CLI or the tests.
 */
'use strict';

(function () {
  const core = window.CompanyManager;
  const { Money, PayPeriod, HourlyEmployee, SalariedEmployee, Manager, Executive, CompanyError } = core;
  const fixtures = window.CompanyFixtures;

  const company = fixtures.buildCompany(core);

  const $ = (id) => document.getElementById(id);
  const periodForm = $('period-form');
  const hireForm = $('hire-form');
  const kindSelect = $('f-kind');
  const msg = $('msg');

  function currentPeriod() {
    const periodsPerYear = Number($('f-periods').value) || 24;
    let companyProfitCents = 0;
    try { companyProfitCents = Money.parse($('f-profit').value || '0'); } catch { companyProfitCents = 0; }
    return new PayPeriod({ periodsPerYear, companyProfitCents });
  }

  function flash(text, kind) {
    msg.textContent = text || ' ';
    msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  /* ---- rendering --------------------------------------------------- */

  function render() {
    const period = currentPeriod();
    const run = company.runPayroll(period);
    const byId = new Map(run.slips.map((s) => [s.id, s]));

    // tiles
    const s = company.summary(period);
    $('t-head').textContent = s.size;
    $('t-kinds').textContent = Object.keys(s.headcountByKind).length;
    $('t-run').textContent = Money.format(run.totalCents);
    $('t-year').textContent = Money.format(s.annualPayrollCents);

    // payroll table
    const rows = $('rows');
    rows.innerHTML = '';
    for (const emp of company.employees()) {
      const slip = byId.get(emp.id);
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="id">${emp.id}</td>` +
        `<td>${esc(emp.name)}${payDetail(emp, period)}</td>` +
        `<td><span class="pill k-${emp.kind}">${emp.kind}</span></td>` +
        `<td class="r pay">${Money.format(emp.annualPayCents(period))}</td>` +
        `<td class="r pay">${Money.format(slip.payCents)}</td>` +
        `<td class="r"><button class="danger" data-fire="${emp.id}">fire</button></td>`;
      rows.appendChild(tr);
    }
    $('foot-total').textContent = Money.format(run.totalCents);

    // org chart
    $('org').innerHTML = renderOrg();

    $('period-note').textContent =
      `Each pay run slices annual pay into ${period.periodsPerYear} periods. ` +
      `Executives also take their profit share of ${Money.format(period.companyProfitCents)}.`;
  }

  // a tiny per-kind explanation of how this employee's pay was computed
  function payDetail(emp, period) {
    if (emp instanceof HourlyEmployee) {
      const weeks = emp.loggedWeeks;
      if (!weeks.length) return ` <span class="pay-detail">· no hours logged</span>`;
      return ` <span class="pay-detail">· ${Money.format(emp.hourlyRateCents)}/h × ${weeks.join('+')}h</span>`;
    }
    if (emp instanceof Executive) {
      return ` <span class="pay-detail">· salary + bonus + ${emp.profitSharePercent}% profit</span>`;
    }
    if (emp instanceof Manager) {
      return ` <span class="pay-detail">· salary + ${Money.format(emp.annualBonusCents)}/yr bonus</span>`;
    }
    if (emp instanceof SalariedEmployee) {
      return ` <span class="pay-detail">· salary ÷ ${period.periodsPerYear}</span>`;
    }
    return '';
  }

  function renderOrg() {
    const managers = company.employees().filter((e) => e instanceof Manager);
    const reportsOf = new Map(managers.map((m) => [m.id, m.reports]));
    const managed = new Set();
    for (const m of managers) for (const r of m.reports) managed.add(r.id);
    const roots = company.employees().filter((e) => !managed.has(e.id));

    const node = (emp) => {
      const kids = reportsOf.get(emp.id) || [];
      const inner = kids.length ? `<ul>${kids.map(node).join('')}</ul>` : '';
      return `<li><span class="node"><span class="name">${esc(emp.name)}</span>` +
             `<span class="pill k-${emp.kind}">${emp.kind}</span></span>${inner}</li>`;
    };
    return roots.length ? `<ul>${roots.map(node).join('')}</ul>` : '<p class="muted">(no employees)</p>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---- interactions ------------------------------------------------ */

  // show only the fields that belong to the chosen employee kind
  function syncKindFields() {
    const kind = kindSelect.value;
    document.querySelectorAll('.kind-fields').forEach((el) => {
      el.classList.toggle('active', el.dataset.kind === kind);
    });
  }
  kindSelect.addEventListener('change', syncKindFields);

  hireForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('f-name').value.trim();
    const kind = kindSelect.value;
    try {
      let emp;
      if (kind === 'Hourly') {
        emp = new HourlyEmployee(name, $('f-rate').value);
        for (const h of $('f-hours').value.trim().split(/\s+/).filter(Boolean)) emp.logWeek(Number(h));
      } else if (kind === 'Salaried') {
        emp = new SalariedEmployee(name, $('f-salary-s').value);
      } else if (kind === 'Manager') {
        emp = new Manager(name, $('f-salary-m').value, { annualBonus: $('f-bonus-m').value });
      } else {
        emp = new Executive(name, $('f-salary-e').value, {
          annualBonus: $('f-bonus-e').value,
          profitSharePercent: Number($('f-share-e').value),
        });
      }
      company.hire(emp);
      flash(`Hired ${emp.name} — ${emp.kind} (${emp.id}).`, 'ok');
      $('f-name').value = '';
      render();
    } catch (e) {
      if (e instanceof CompanyError) flash(e.message, 'err'); else throw e;
    }
  });

  $('rows').addEventListener('click', (ev) => {
    const id = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-fire');
    if (!id) return;
    try {
      const emp = company.fire(id);
      flash(`Let ${emp.name} go.`, 'ok');
      render();
    } catch (e) {
      if (e instanceof CompanyError) flash(e.message, 'err'); else throw e;
    }
  });

  periodForm.addEventListener('submit', (ev) => { ev.preventDefault(); flash(''); render(); });
  $('f-periods').addEventListener('change', render);

  /* ---- go ---------------------------------------------------------- */
  syncKindFields();
  render();
})();
