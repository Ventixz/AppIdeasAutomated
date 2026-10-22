/*
 * script.js — browser glue for the Country from IP demo. All the real work
 * (parsing, special-use classification, the binary-search range lookup) is in
 * geoip-core.js, exposed as window.GeoIP. This file only reads the input, calls
 * GeoIP.lookup against the built-in demo snapshot, and renders the result as a
 * verdict plus the three honest steps.
 */
'use strict';

(function () {
  const G = window.GeoIP;
  const table = G.demoTable();

  const $ip = document.getElementById('ip');
  const $btn = document.getElementById('btn');
  const $err = document.getElementById('err');
  const $result = document.getElementById('result');
  const $verdict = document.getElementById('verdict');
  const $steps = document.getElementById('steps');

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function stepHtml(label, value, cls) {
    return `<li><div class="label">${esc(label)}</div><div class="val ${cls || ''}">${value}</div></li>`;
  }

  function render(result, kindClass) {
    $result.hidden = false;
    $result.className = `panel result ${kindClass}`;
    $steps.innerHTML = '';

    if (result.error) {
      $verdict.innerHTML =
        `<div class="flag">🚫</div><div class="who">` +
        `<div class="country">Invalid address</div>` +
        `<div class="sub">${esc(result.error)}</div></div>`;
      $steps.innerHTML = stepHtml('Parse', `<span>could not parse <code>${esc(result.input)}</code></span>`, 'flag-grey');
      return;
    }

    // Verdict block
    let flag, country, sub;
    if (result.kind === 'special') {
      flag = '🏳';
      country = 'No country';
      sub = `special-use space — ${esc(result.special)}`;
    } else if (result.cc === null) {
      flag = '❔';
      country = 'Unknown';
      sub = 'a routable address, but not in this snapshot — no guess made';
    } else {
      flag = result.flag;
      country = esc(result.country || result.cc);
      sub = `registered to <code>${esc(result.cc)}</code>`;
    }
    $verdict.innerHTML =
      `<div class="flag">${flag}</div><div class="who">` +
      `<div class="country">${country}</div>` +
      `<div class="sub">${sub}</div></div>`;

    // Step 1 — parse
    $steps.innerHTML += stepHtml(
      'Parse the address',
      `IPv${result.version} &nbsp;·&nbsp; canonical <code>${esc(result.canonical)}</code>`,
      'good'
    );

    // Step 2 — classify special-use
    if (result.kind === 'special') {
      $steps.innerHTML += stepHtml('Classify special-use', `${esc(result.special)} — belongs to no country`, 'flag-amber');
      $steps.innerHTML += stepHtml('Look up country', 'skipped — special-use space has no registered country', 'flag-grey');
      return;
    }
    $steps.innerHTML += stepHtml('Classify special-use', 'not special — a globally routable address', 'good');

    // Step 3 — the range lookup
    if (result.cc === null) {
      $steps.innerHTML += stepHtml(
        'Binary-search the range table',
        'no range covers this address in the snapshot → <strong>unknown</strong> (never a guess)',
        'flag-grey'
      );
    } else {
      $steps.innerHTML += stepHtml(
        'Binary-search the range table',
        `matched <code>${esc(result.range.start)} – ${esc(result.range.end)}</code> → ` +
        `${result.flag} ${esc(result.cc)} ${esc(result.country || '')}`,
        'good'
      );
    }
  }

  function go() {
    $err.textContent = '';
    const value = $ip.value.trim();
    if (!value) { $err.textContent = 'Enter an IP address.'; return; }
    try {
      const result = G.lookup(value, table);
      const kindClass = result.kind === 'special' ? 'special' : (result.cc === null ? 'unknown' : 'ok');
      render(result, kindClass);
    } catch (e) {
      render({ input: value, error: e.message }, 'err');
    }
  }

  $btn.addEventListener('click', go);
  $ip.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  for (const el of document.querySelectorAll('.ex')) {
    el.addEventListener('click', () => { $ip.value = el.dataset.ip; go(); });
  }

  // Resolve the default on load.
  go();
})();
