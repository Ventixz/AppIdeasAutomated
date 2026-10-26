/*
 * script.js — the browser front end. It owns zero business logic: it builds one
 * Hotel from the shared fixtures, calls the class methods on every action, and
 * re-renders from the hotel's own state. All the rules (no double-booking, exact
 * money, half-open dates, no unknown rooms) live in reservation-core.js, so this
 * file can't accidentally disagree with the CLI or the tests.
 */
'use strict';

(function () {
  const core = window.ReservationSystem;
  const { Money, DateRange, ReservationError } = core;
  const fixtures = window.ReservationFixtures;

  const hotel = fixtures.buildHotel(core);

  const $ = (id) => document.getElementById(id);
  const rowsEl = $('rows');
  const msgEl = $('msg');
  const availEl = $('avail');

  // "Tonight" for the occupancy tile = the earliest check-in in the data, so
  // the demo always shows a populated night rather than today's (empty) date.
  const demoNight = hotel.reservations().reduce(
    (min, r) => (min == null || r.range.checkIn < min ? r.range.checkIn : min),
    null
  );

  function flash(el, text, kind) {
    el.textContent = text || ' ';
    el.className = (el === msgEl ? 'msg' : 'avail') + (kind ? ' ' + kind : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function typeBadge(name) {
    return `<span class="pill t-${name.toLowerCase().replace(/[^a-z]/g, '')}">${escapeHtml(name)}</span>`;
  }

  function renderTiles() {
    const s = hotel.summary();
    $('t-rooms').textContent = s.roomCount;
    $('t-res').textContent = s.reservationCount;
    $('t-rev').textContent = Money.format(s.revenueCents);
    if (demoNight != null) {
      const o = hotel.occupancyOn(DateRange._toStr(demoNight));
      $('t-occ').textContent = `${o.occupied} / ${o.total}`;
    } else {
      $('t-occ').textContent = '0 / ' + hotel.rooms().length;
    }
  }

  function render() {
    rowsEl.innerHTML = '';
    const rows = hotel.reservations();
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="muted">No reservations yet — book a room above.</td></tr>';
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="id">${r.id}</td>` +
        `<td class="id">${r.room.number}</td>` +
        `<td>${typeBadge(r.room.typeName)}</td>` +
        `<td>${escapeHtml(r.guest)}</td>` +
        `<td>${r.range.checkInStr}</td>` +
        `<td>${r.range.checkOutStr}</td>` +
        `<td class="r">${r.nights}</td>` +
        `<td class="r">${Money.format(r.totalCents)}</td>` +
        `<td class="r"><button class="ghost" data-id="${r.id}">cancel</button></td>`;
      rowsEl.appendChild(tr);
    }
    renderTiles();
  }

  // Populate the room <select> (with rate) and the type filter <select>.
  function fillSelectors() {
    const roomSel = $('f-room');
    roomSel.innerHTML = '';
    for (const room of hotel.rooms()) {
      const opt = document.createElement('option');
      opt.value = room.number;
      opt.textContent = `${room.number} — ${room.typeName} (${Money.format(room.rateCents)}/night)`;
      roomSel.appendChild(opt);
    }
    const typeSel = $('a-type');
    for (const t of hotel.roomTypes()) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} (${Money.format(t.rateCents)}/night)`;
      typeSel.appendChild(opt);
    }
  }

  // Seed the date inputs with a sensible default stay (the demo night onward).
  function seedDates() {
    if (demoNight == null) return;
    const inStr = DateRange._toStr(demoNight);
    const outStr = DateRange._toStr(demoNight + 2);
    $('f-in').value = inStr; $('f-out').value = outStr;
    $('a-in').value = inStr; $('a-out').value = outStr;
  }

  // Cancel button — one handler for the whole table.
  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    try {
      const res = hotel.cancel(btn.dataset.id);
      flash(msgEl, `cancelled ${res.id} — room ${res.room.number} freed`, 'ok');
      render();
    } catch (err) {
      if (err instanceof ReservationError) flash(msgEl, err.message, 'err');
      else throw err;
    }
  });

  // Booking form routes straight through Hotel.book, so its guards (bad dates,
  // double-booking, unknown room) surface as the same friendly message.
  $('book-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const res = hotel.book($('f-room').value, $('f-guest').value, $('f-in').value, $('f-out').value);
      flash(msgEl, `booked ${res.id}: ${res.guest}, room ${res.room.number}, ${res.range} — ${Money.format(res.totalCents)}`, 'ok');
      $('f-guest').value = '';
      render();
    } catch (err) {
      if (err instanceof ReservationError) flash(msgEl, err.message, 'err');
      else throw err;
    }
  });

  // Availability search — read-only, lists the free rooms for a stay.
  $('avail-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const free = hotel.availableRooms($('a-in').value, $('a-out').value, $('a-type').value || null);
      const range = new DateRange($('a-in').value, $('a-out').value);
      if (!free.length) {
        flash(availEl, `No rooms free for ${range}${$('a-type').value ? ` of type ${$('a-type').value}` : ''}.`, 'err');
      } else {
        flash(availEl, `${free.length} free for ${range}: ` +
          free.map((r) => `${r.number} (${r.typeName}, ${Money.format(r.rateCents)})`).join(', '), 'ok');
      }
    } catch (err) {
      if (err instanceof ReservationError) flash(availEl, err.message, 'err');
      else throw err;
    }
  });

  fillSelectors();
  seedDates();
  render();
})();
