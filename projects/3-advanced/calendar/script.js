// script.js — the browser presentation layer for the Calendar.
//
// No calendar rules live here. Every date calculation, event mutation, reminder
// decision and storage (de)serialisation comes from calendar-core.js
// (window.CalendarCore). This file only renders the month grid, wires up
// clicks / drags / the editor dialog, and mirrors the engine's state into the
// DOM and localStorage.

(function () {
  'use strict';

  const C = window.CalendarCore;
  const STORAGE_KEY = 'calendar-app.events.v1';
  const THEME_KEY = 'calendar-app.theme';
  const MAX_CHIPS = 3; // chips shown per day cell before "+N more"

  // Injected dependencies for the pure core.
  const idGen = () =>
    `evt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  // --- State ---------------------------------------------------------------

  let events = C.deserialize(safeGet(STORAGE_KEY));
  const realNow = new Date();
  let view = { year: realNow.getFullYear(), month: realNow.getMonth() + 1 };
  let selectedKey = C.dateKey(view.year, view.month, realNow.getDate());
  let editingId = null; // null => creating a new event

  // --- Elements ------------------------------------------------------------

  const el = {
    monthLabel: document.getElementById('month-label'),
    weekdayRow: document.getElementById('weekday-row'),
    grid: document.getElementById('grid'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    today: document.getElementById('today-btn'),
    selectedLabel: document.getElementById('selected-label'),
    dayEvents: document.getElementById('day-events'),
    addBtn: document.getElementById('add-btn'),
    themeBtn: document.getElementById('theme-btn'),
    toasts: document.getElementById('toasts'),
    // modal
    backdrop: document.getElementById('modal-backdrop'),
    modalTitle: document.getElementById('modal-title'),
    form: document.getElementById('event-form'),
    fTitle: document.getElementById('f-title'),
    fDate: document.getElementById('f-date'),
    fTime: document.getElementById('f-time'),
    fDesc: document.getElementById('f-desc'),
    fReminder: document.getElementById('f-reminder'),
    fColor: document.getElementById('f-color'),
    errTitle: document.getElementById('err-title'),
    errDate: document.getElementById('err-date'),
    errTime: document.getElementById('err-time'),
    deleteBtn: document.getElementById('delete-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
  };

  // --- Storage helpers -----------------------------------------------------

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (_e) { return null; }
  }
  function persist() {
    try { window.localStorage.setItem(STORAGE_KEY, C.serialize(events)); } catch (_e) { /* private mode */ }
  }

  // --- Theme ---------------------------------------------------------------

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    el.themeBtn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
  function initTheme() {
    const saved = safeGet(THEME_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }
  el.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch (_e) { /* ignore */ }
  });

  // --- Rendering -----------------------------------------------------------

  function todayKey() {
    const n = new Date();
    return C.dateKey(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function render() {
    el.monthLabel.textContent = C.monthLabel(view.year, view.month);

    el.weekdayRow.innerHTML = '';
    for (const name of C.WEEKDAY_NAMES) {
      const d = document.createElement('div');
      d.textContent = name;
      el.weekdayRow.appendChild(d);
    }

    const byDate = C.eventsByDate(events);
    const grid = C.monthGrid(view.year, view.month, todayKey());
    el.grid.innerHTML = '';
    for (const week of grid) {
      for (const c of week) {
        el.grid.appendChild(renderDay(c, byDate[c.key] || []));
      }
    }
    renderSidebar();
  }

  function renderDay(c, dayEvents) {
    const div = document.createElement('div');
    div.className = 'day';
    div.dataset.key = c.key;
    if (!c.inMonth) div.classList.add('other');
    if (c.isToday) div.classList.add('today');
    if (c.key === selectedKey) div.classList.add('selected');

    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = c.day;
    div.appendChild(num);

    dayEvents.slice(0, MAX_CHIPS).forEach((ev) => div.appendChild(renderChip(ev)));
    if (dayEvents.length > MAX_CHIPS) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = `+${dayEvents.length - MAX_CHIPS} more`;
      div.appendChild(more);
    }

    // Click empty space in a day -> select it and open a new-event dialog.
    div.addEventListener('click', (e) => {
      if (e.target.closest('.chip')) return;
      selectedKey = c.key;
      render();
      openEditor(null, c.key);
    });

    // Drag-and-drop target for rescheduling.
    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      div.classList.add('drop-target');
    });
    div.addEventListener('dragleave', () => div.classList.remove('drop-target'));
    div.addEventListener('drop', (e) => {
      e.preventDefault();
      div.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/plain');
      if (id) {
        events = C.moveEvent(events, id, c.key);
        persist();
        selectedKey = c.key;
        render();
      }
    });

    return div;
  }

  function renderChip(ev) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.style.background = ev.color;
    chip.title = ev.title;
    chip.draggable = true;

    if (ev.time) {
      const t = document.createElement('span');
      t.className = 'chip-time';
      t.textContent = ev.time + ' ';
      chip.appendChild(t);
    }
    chip.appendChild(document.createTextNode(ev.title));

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedKey = ev.date;
      openEditor(ev.id);
    });
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', ev.id);
      e.dataTransfer.effectAllowed = 'move';
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    return chip;
  }

  function renderSidebar() {
    const { year, month, day } = C.parseDateKey(selectedKey);
    el.selectedLabel.textContent =
      `${C.WEEKDAY_NAMES[C.weekdayOf(selectedKey)]}, ${C.MONTH_NAMES[month - 1]} ${day}, ${year}`;

    const list = C.eventsForDate(events, selectedKey);
    el.dayEvents.innerHTML = '';
    for (const ev of list) {
      const row = document.createElement('div');
      row.className = 'event-row';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = ev.color;
      row.appendChild(swatch);

      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('div');
      title.className = 'ev-title';
      title.textContent = ev.title;
      meta.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'ev-sub';
      const parts = [ev.time ? ev.time : 'All day'];
      if (ev.description) parts.push(ev.description);
      sub.textContent = parts.join(' · ');
      meta.appendChild(sub);
      row.appendChild(meta);

      if (ev.reminderMinutes != null) {
        const bell = document.createElement('span');
        bell.className = 'bell';
        bell.textContent = '🔔';
        bell.title = reminderLabel(ev.reminderMinutes);
        row.appendChild(bell);
      }

      row.addEventListener('click', () => openEditor(ev.id));
      el.dayEvents.appendChild(row);
    }
  }

  // --- Editor dialog -------------------------------------------------------

  function reminderLabel(min) {
    if (min == null) return 'No reminder';
    if (min === 0) return 'At start time';
    if (min < 60) return `${min} minutes before`;
    if (min < 1440) return `${min / 60} hour${min === 60 ? '' : 's'} before`;
    return `${min / 1440} day${min === 1440 ? '' : 's'} before`;
  }

  function fillReminderOptions() {
    el.fReminder.innerHTML = '';
    for (const min of C.REMINDER_CHOICES) {
      const opt = document.createElement('option');
      opt.value = min == null ? '' : String(min);
      opt.textContent = reminderLabel(min);
      el.fReminder.appendChild(opt);
    }
  }

  function clearErrors() {
    el.errTitle.textContent = '';
    el.errDate.textContent = '';
    el.errTime.textContent = '';
  }

  function openEditor(id, presetDate) {
    editingId = id;
    clearErrors();
    const ev = id ? events.find((e) => e.id === id) : null;

    el.modalTitle.textContent = ev ? 'Edit event' : 'New event';
    el.fTitle.value = ev ? ev.title : '';
    el.fDate.value = ev ? ev.date : (presetDate || selectedKey);
    el.fTime.value = ev ? ev.time : '';
    el.fDesc.value = ev ? ev.description : '';
    el.fReminder.value = ev && ev.reminderMinutes != null ? String(ev.reminderMinutes) : '';
    el.fColor.value = ev ? ev.color : C.DEFAULT_COLOR;
    el.deleteBtn.classList.toggle('hidden', !ev);

    el.backdrop.classList.remove('hidden');
    el.fTitle.focus();
  }

  function closeEditor() {
    el.backdrop.classList.add('hidden');
    editingId = null;
  }

  function readForm() {
    const reminderRaw = el.fReminder.value;
    return {
      title: el.fTitle.value,
      date: el.fDate.value,
      time: el.fTime.value,
      description: el.fDesc.value,
      reminderMinutes: reminderRaw === '' ? null : Number(reminderRaw),
      color: el.fColor.value,
    };
  }

  function showErrors(errors) {
    clearErrors();
    if (errors.title) el.errTitle.textContent = errors.title;
    if (errors.date) el.errDate.textContent = errors.date;
    if (errors.time) el.errTime.textContent = errors.time;
  }

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = readForm();
    const { valid, errors } = C.validateEvent(input);
    if (!valid) { showErrors(errors); return; }

    if (editingId) {
      events = C.updateEvent(events, editingId, input);
    } else {
      events = C.addEvent(events, input, { idGen });
    }
    selectedKey = input.date;
    // Follow the event's month if it landed outside the current view.
    const { year, month } = C.parseDateKey(input.date);
    view = { year, month };
    persist();
    closeEditor();
    render();
  });

  el.deleteBtn.addEventListener('click', () => {
    if (editingId) {
      events = C.deleteEvent(events, editingId);
      persist();
      closeEditor();
      render();
    }
  });

  el.cancelBtn.addEventListener('click', closeEditor);
  el.backdrop.addEventListener('click', (e) => {
    if (e.target === el.backdrop) closeEditor();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.backdrop.classList.contains('hidden')) closeEditor();
  });

  // --- Navigation ----------------------------------------------------------

  el.prev.addEventListener('click', () => { view = C.addMonths(view.year, view.month, -1); render(); });
  el.next.addEventListener('click', () => { view = C.addMonths(view.year, view.month, 1); render(); });
  el.today.addEventListener('click', () => {
    const n = new Date();
    view = { year: n.getFullYear(), month: n.getMonth() + 1 };
    selectedKey = todayKey();
    render();
  });
  el.addBtn.addEventListener('click', () => openEditor(null, selectedKey));

  // --- Reminders -----------------------------------------------------------
  //
  // Every 20 seconds, ask the engine which reminders are due, toast them, and
  // mark them so they only fire once.

  function checkReminders() {
    const nowMs = C.wallClockNow(new Date());
    const due = C.dueReminders(events, nowMs);
    for (const ev of due) {
      toast(ev);
      events = C.markReminded(events, ev.id, nowMs);
    }
    if (due.length) { persist(); renderSidebar(); }
  }

  function toast(ev) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.borderLeftColor = ev.color;
    const when = ev.time ? `at ${ev.time}` : 'today';
    t.innerHTML = `<strong>🔔 ${escapeHtml(ev.title)}</strong><small>${escapeHtml(when)}</small>`;
    el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 8000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // --- Boot ----------------------------------------------------------------

  initTheme();
  fillReminderOptions();
  render();
  checkReminders();
  setInterval(checkReminders, 20000);
})();
