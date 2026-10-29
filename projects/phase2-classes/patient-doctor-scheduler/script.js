/*
 * script.js — the browser front end. It owns zero scheduling logic: it builds
 * one Scheduler from the shared fixtures, calls the class methods on every
 * action, and re-renders from the clinic's own state. Every rule (abstract base,
 * the slot grid, no double-booking, the daily cap, one-patient-one-place, atomic
 * booking, derived patient views) lives in scheduler-core.js, so this file can't
 * accidentally disagree with the CLI or the tests.
 */
'use strict';

(function () {
  const core = window.ClinicScheduler;
  const { Slot, Doctor, Patient, SchedulerError, SLOTS_PER_DAY } = core;
  const fixtures = window.ClinicFixtures;

  const clinic = fixtures.buildClinic(core);
  let day = fixtures.DEMO_DAY;

  const $ = (id) => document.getElementById(id);
  const msg = $('msg');

  function flash(text, kind) {
    msg.textContent = text || ' ';
    msg.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  $('b-day').value = day;

  /* ---- rendering --------------------------------------------------- */

  function render() {
    const docs = clinic.doctors();
    const report = clinic.dayReport(day);

    // tiles
    $('t-docs').textContent = clinic.doctorCount;
    $('t-pats').textContent = clinic.patientCount;
    $('t-booked').textContent = report.reduce((n, r) => n + r.used, 0);
    $('t-free').textContent = report.reduce((n, r) => n + r.free, 0);

    // pickers
    fillSelect($('b-doctor'), docs, (d) => `${d.id} — Dr. ${d.name} (${d.specialization})`);
    fillSelect($('b-patient'), clinic.patients(), (p) => `${p.id} — ${p.name}`);
    fillSelect($('w-patient'), clinic.patients(), (p) => `${p.id} — ${p.name}`);

    renderGrid(report);
    $('grid-day').textContent = day;
  }

  function fillSelect(sel, items, labelOf) {
    const prev = sel.value;
    sel.innerHTML = '';
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = labelOf(it);
      sel.appendChild(o);
    }
    if (items.some((it) => it.id === prev)) sel.value = prev;
  }

  function renderGrid(report) {
    // header: Slot | each doctor (with load)
    const head = $('grid-head');
    head.innerHTML = '<th class="slot-col">Slot</th>' +
      report.map((r) => {
        const full = r.used >= r.cap;
        return `<th>Dr. ${esc(r.doctor.name)}<span class="cap${full ? ' full' : ''}">${r.used}/${r.cap}</span></th>`;
      }).join('');

    // body: one row per slot
    const body = $('grid-body');
    body.innerHTML = '';
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const tr = document.createElement('tr');
      let cells = `<td class="slot-col">${Slot.label(i)}</td>`;
      for (const r of report) {
        const appt = r.doctor.appointmentsOn(day).find((a) => a.slotIndex === i);
        if (appt) {
          cells += `<td class="booked" data-doctor="${r.doctor.id}" data-slot="${i}" title="click to cancel">` +
            `<span class="pname">${esc(appt.patient.name)}</span></td>`;
        } else {
          cells += `<td class="open" data-doctor="${r.doctor.id}" data-slot="${i}" title="click to book">·</td>`;
        }
      }
      tr.innerHTML = cells;
      body.appendChild(tr);
    }
  }

  function renderWho(patientId) {
    const rows = $('who-rows');
    rows.innerHTML = '';
    let appts;
    try { appts = clinic.appointmentsFor(patientId); }
    catch (e) { if (e instanceof SchedulerError) { flash(e.message, 'err'); return; } throw e; }
    if (!appts.length) {
      rows.innerHTML = '<tr><td colspan="5" class="muted">no appointments</td></tr>';
      return;
    }
    for (const a of appts) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${a.day}</td><td class="pay">${a.label}</td>` +
        `<td>Dr. ${esc(a.doctor.name)}</td><td class="terms">${esc(a.doctor.specialization)}</td>` +
        `<td class="r"><button class="mini danger" data-cancel="${a.doctor.id}" data-cslot="${a.slotIndex}">cancel</button></td>`;
      rows.appendChild(tr);
    }
  }

  /* ---- interactions ------------------------------------------------ */

  $('doctor-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const d = new Doctor($('d-name').value, {
        specialization: $('d-spec').value.trim() || undefined,
        maxPerDay: Number($('d-cap').value),
      });
      clinic.addDoctor(d);
      flash(`Registered Dr. ${d.name} (${d.id}).`, 'ok');
      $('d-name').value = '';
      render();
    } catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
  });

  $('patient-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const p = new Patient($('p-name').value, { reason: $('p-reason').value.trim() || undefined });
      clinic.addPatient(p);
      flash(`Registered ${p.name} (${p.id}).`, 'ok');
      $('p-name').value = ''; $('p-reason').value = '';
      render();
    } catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
  });

  function doBook(nextFree) {
    const patientId = $('b-patient').value;
    const doctorId = $('b-doctor').value;
    try {
      day = core.assertDay($('b-day').value);
      const appt = nextFree
        ? clinic.bookNext(patientId, doctorId, day)
        : clinic.book(patientId, doctorId, day, $('b-time').value);
      flash(`Booked ${appt.patient.name} with Dr. ${appt.doctor.name} at ${appt.label}.`, 'ok');
      render();
    } catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
  }

  $('book-form').addEventListener('submit', (ev) => { ev.preventDefault(); doBook(false); });
  $('book-next').addEventListener('click', () => doBook(true));

  // click a grid cell: open -> pre-fill + book the selected patient; booked -> cancel
  $('grid-body').addEventListener('click', (ev) => {
    const cell = ev.target.closest('td');
    if (!cell || !cell.dataset.doctor) return;
    const doctorId = cell.dataset.doctor;
    const slot = Number(cell.dataset.slot);
    if (cell.classList.contains('booked')) {
      try { const a = clinic.cancel(doctorId, day, slot); flash(`Cancelled ${a.patient.name} at ${a.label}.`, 'ok'); render(); }
      catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
    } else {
      $('b-doctor').value = doctorId;
      $('b-time').value = Slot.time(slot);
      try {
        const appt = clinic.book($('b-patient').value, doctorId, day, slot);
        flash(`Booked ${appt.patient.name} with Dr. ${appt.doctor.name} at ${appt.label}.`, 'ok');
        render();
      } catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
    }
  });

  $('who-form').addEventListener('submit', (ev) => { ev.preventDefault(); renderWho($('w-patient').value); });

  $('who-rows').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-cancel]');
    if (!btn) return;
    try {
      const a = clinic.cancel(btn.dataset.cancel, day, Number(btn.dataset.cslot));
      flash(`Cancelled ${a.patient.name} at ${a.label}.`, 'ok');
      render();
      renderWho($('w-patient').value);
    } catch (e) { if (e instanceof SchedulerError) flash(e.message, 'err'); else throw e; }
  });

  /* ---- go ---------------------------------------------------------- */
  render();
})();
