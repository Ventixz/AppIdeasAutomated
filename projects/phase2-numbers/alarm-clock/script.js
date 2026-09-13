/*
 * script.js — the thin browser layer over alarm-core.js. It owns the DOM, the
 * real wall clock, Web Audio, and localStorage; every scheduling decision is
 * delegated to AlarmCore, which knows nothing about any of that.
 */

'use strict';

(function () {
  var C = window.AlarmCore;
  var clock = new C.AlarmClock();
  var STORE_KEY = 'alarm-clock:v1';

  var $ = function (id) { return document.getElementById(id); };
  var selectedDays = []; // for the alarm form
  var ringingQueue = []; // items currently waiting for dismiss/snooze

  /* ---------- persistence (per-browser, best effort) ------------------ */

  function save() {
    try {
      var data = {
        seq: clock._seq,
        items: clock.items.map(function (it) { return it; })
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* private mode / disabled — the app still works */ }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) { return; }
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !Array.isArray(data.items)) { return; }
    clock.items = data.items;
    clock._seq = data.seq || data.items.length;
    // A timer whose end is already in the past on reload shouldn't ambush the
    // user with a stale ring; mark long-past timers as fired.
    var now = Date.now();
    clock.items.forEach(function (it) {
      if (it.kind === 'timer' && !it.fired && it.startedAt + it.duration * 1000 < now - 1000) {
        it.fired = true;
      }
    });
  }

  /* ---------- Web Audio beep (no asset files) ------------------------- */

  var audioCtx = null;
  function beep() {
    try {
      if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      if (audioCtx.state === 'suspended') { audioCtx.resume(); }
      var t0 = audioCtx.currentTime;
      // Three short rising blips.
      [0, 0.18, 0.36].forEach(function (offset, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 660 + i * 220;
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.16);
      });
    } catch (e) { /* audio blocked — the visual overlay still fires */ }
  }
  var beepTimer = null;
  function startBeeping() { beep(); if (!beepTimer) { beepTimer = setInterval(beep, 1500); } }
  function stopBeeping() { if (beepTimer) { clearInterval(beepTimer); beepTimer = null; } }

  /* ---------- live clock + tick loop ---------------------------------- */

  function renderClock() {
    var now = new Date();
    var sod = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    $('clock').textContent = C.formatTimeOfDay(sod, { seconds: true });
    $('clock-date').textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function loop() {
    var now = Date.now();
    var fired = clock.tick(now);
    if (fired.length) {
      fired.forEach(function (f) { ringingQueue.push(f); });
      save();
      showRing();
    }
    renderClock();
    renderList(); // keeps timer countdowns live
  }

  /* ---------- ringing overlay ----------------------------------------- */

  function showRing() {
    if (ringingQueue.length === 0) { return; }
    var f = ringingQueue[0];
    var it = f.item;
    $('ring-title').textContent = it.label || (it.kind === 'timer' ? 'Timer' : 'Alarm');
    var sub = it.kind === 'timer'
      ? 'Timer finished (' + C.formatDuration(it.duration) + ')'
      : C.formatTimeOfDay(it.at, { hour12: false });
    if (f.snoozed) { sub = 'Snoozed alarm · ' + sub; }
    $('ring-sub').textContent = sub;
    $('ring').hidden = false;
    startBeeping();
    renderList();
  }

  function nextRing() {
    ringingQueue.shift();
    if (ringingQueue.length === 0) {
      $('ring').hidden = true;
      stopBeeping();
    } else {
      showRing();
    }
    renderList();
  }

  $('ring-dismiss').addEventListener('click', function () { nextRing(); });
  $('ring-snooze').addEventListener('click', function () {
    var f = ringingQueue[0];
    if (f) { clock.snooze(f.id, Date.now(), 9); save(); }
    nextRing();
  });

  /* ---------- forms --------------------------------------------------- */

  function showError(msg) { var e = $('error'); e.textContent = msg; e.hidden = false; }
  function clearError() { $('error').hidden = true; }

  // Day toggle buttons (Sun..Sat).
  (function buildDays() {
    var wrap = $('days');
    C.DAY_NAMES.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.textContent = name;
      b.setAttribute('data-day', i);
      b.addEventListener('click', function () {
        var d = i;
        var idx = selectedDays.indexOf(d);
        if (idx === -1) { selectedDays.push(d); b.classList.add('on'); }
        else { selectedDays.splice(idx, 1); b.classList.remove('on'); }
      });
      wrap.appendChild(b);
    });
  })();

  function setDays(arr) {
    selectedDays = arr.slice();
    var btns = $('days').querySelectorAll('.day');
    btns.forEach(function (b) {
      var d = parseInt(b.getAttribute('data-day'), 10);
      b.classList.toggle('on', selectedDays.indexOf(d) !== -1);
    });
  }

  // Quick-day chips.
  document.querySelectorAll('#form-alarm .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var raw = chip.getAttribute('data-days');
      setDays(raw === '' ? [] : raw.split(',').map(Number));
    });
  });

  // Quick-duration chips.
  document.querySelectorAll('#form-timer .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $('timer-dur').value = C.formatDuration(parseInt(chip.getAttribute('data-dur'), 10));
    });
  });

  // Tabs.
  function selectTab(which) {
    var alarm = which === 'alarm';
    $('tab-alarm').classList.toggle('active', alarm);
    $('tab-timer').classList.toggle('active', !alarm);
    $('tab-alarm').setAttribute('aria-selected', String(alarm));
    $('tab-timer').setAttribute('aria-selected', String(!alarm));
    $('form-alarm').hidden = !alarm;
    $('form-timer').hidden = alarm;
    clearError();
  }
  $('tab-alarm').addEventListener('click', function () { selectTab('alarm'); });
  $('tab-timer').addEventListener('click', function () { selectTab('timer'); });

  $('add-alarm').addEventListener('click', function () {
    clearError();
    var sod;
    try { sod = C.parseTimeOfDay($('alarm-time').value); }
    catch (e) { showError(e.message); return; }
    clock.addAlarm(sod, selectedDays.slice(), $('alarm-label').value.trim());
    // Prime lastTick so a brand-new alarm for later today isn't retro-fired.
    if (clock.lastTickMs == null) { clock.lastTickMs = Date.now(); }
    $('alarm-label').value = '';
    save();
    renderList();
  });

  $('add-timer').addEventListener('click', function () {
    clearError();
    var dur;
    try { dur = C.parseDuration($('timer-dur').value); }
    catch (e) { showError(e.message); return; }
    var now = Date.now();
    clock.addTimer(dur, now, $('timer-label').value.trim());
    if (clock.lastTickMs == null) { clock.lastTickMs = now; }
    $('timer-label').value = '';
    save();
    renderList();
  });

  /* ---------- scheduled list rendering -------------------------------- */

  function renderList() {
    var list = $('list');
    list.innerHTML = '';
    var items = clock.items;
    $('count').textContent = items.length ? '(' + items.length + ')' : '';
    $('empty').hidden = items.length > 0;

    var now = Date.now();
    var ringingIds = {};
    ringingQueue.forEach(function (f) { ringingIds[f.id] = true; });

    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'item' + (it.enabled ? '' : ' off') + (ringingIds[it.id] ? ' ringing' : '');

      var main = document.createElement('div');
      main.className = 'item-main';

      var timeEl = document.createElement('div');
      timeEl.className = 'item-time';
      var meta = document.createElement('div');
      meta.className = 'item-meta';

      if (it.kind === 'alarm') {
        timeEl.innerHTML = C.formatTimeOfDay(it.at, { hour12: false });
        var next = clock.nextRingMs(it, now);
        var parts = [C.describeDays(it.days)];
        if (it.label) { parts.push('<span class="lbl">' + escapeHtml(it.label) + '</span>'); }
        if (it.enabled && next) { parts.push('next ' + relTime(next - now)); }
        else if (!it.enabled) { parts.push('off'); }
        meta.innerHTML = parts.join(' · ');
      } else {
        var end = it.startedAt + it.duration * 1000;
        var remain = Math.max(0, Math.round((end - now) / 1000));
        timeEl.innerHTML = it.fired
          ? '<span class="unitlbl">done</span>'
          : C.formatClock(remain) + '<span class="unitlbl">left</span>';
        var tparts = ['Timer ' + C.formatDuration(it.duration)];
        if (it.label) { tparts.push('<span class="lbl">' + escapeHtml(it.label) + '</span>'); }
        meta.innerHTML = tparts.join(' · ');
      }

      main.appendChild(timeEl);
      main.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'item-actions';

      // Alarms get an enable/disable switch; timers just get delete.
      if (it.kind === 'alarm') {
        var sw = document.createElement('label');
        sw.className = 'switch';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = it.enabled;
        cb.addEventListener('change', function () {
          clock.setEnabled(it.id, cb.checked);
          save(); renderList();
        });
        var sl = document.createElement('span');
        sl.className = 'slider';
        sw.appendChild(cb); sw.appendChild(sl);
        actions.appendChild(sw);
      }

      var del = document.createElement('button');
      del.className = 'icon-btn del';
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', function () {
        clock.remove(it.id);
        ringingQueue = ringingQueue.filter(function (f) { return f.id !== it.id; });
        save(); renderList();
        if (ringingQueue.length === 0) { $('ring').hidden = true; stopBeeping(); }
      });
      actions.appendChild(del);

      li.appendChild(main);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function relTime(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) { return 'in ' + s + 's'; }
    var m = Math.round(s / 60);
    if (m < 60) { return 'in ' + m + ' min'; }
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) { return 'in ' + h + 'h' + (rm ? ' ' + rm + 'm' : ''); }
    var d = Math.round(h / 24);
    return 'in ' + d + ' day' + (d === 1 ? '' : 's');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- boot ---------------------------------------------------- */

  load();
  clock.lastTickMs = Date.now(); // don't retro-fire anything already scheduled
  renderClock();
  renderList();
  loop();
  setInterval(loop, 500);
})();
