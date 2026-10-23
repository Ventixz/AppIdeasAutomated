/*
 * script.js — browser glue for the Whois Search demo. All the real work
 * (target classification, server selection, referral-following, free-form
 * parsing) lives in whois-core.js (window.Whois); the data is the bundled
 * snapshots in whois-fixtures.js (window.WhoisFixtures). This file only reads
 * the input, runs Whois.lookup with the fixture resolver, and renders the
 * verdict, the query chain, the normalised record, and the raw responses.
 */
'use strict';

(function () {
  const W = window.Whois;
  const resolver = window.WhoisFixtures.fixtureResolver;

  const $q = document.getElementById('q');
  const $btn = document.getElementById('btn');
  const $err = document.getElementById('err');
  const $result = document.getElementById('result');
  const $verdict = document.getElementById('verdict');
  const $chain = document.getElementById('chain');
  const $record = document.getElementById('record');
  const $statuses = document.getElementById('statuses');
  const $rawbox = document.getElementById('rawbox');
  const $raw = document.getElementById('raw');

  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function date(iso, fallback) {
    if (iso) return esc(iso.slice(0, 10));
    return fallback ? `${esc(fallback)} <span class="muted">(unparsed)</span>` : '—';
  }

  function renderError(input, message) {
    $result.hidden = false;
    $result.className = 'panel result err';
    $verdict.innerHTML =
      `<div class="icon">🚫</div><div class="who">` +
      `<div class="title">Not a valid target</div>` +
      `<div class="sub">${esc(message)}</div></div>`;
    $chain.innerHTML = '';
    $record.innerHTML = '';
    $statuses.innerHTML = '';
    $rawbox.hidden = true;
  }

  function render(res) {
    const r = res.record;
    const t = res.target;
    const notFound = r.notFound;
    const kind = notFound ? 'unknown' : 'ok';

    $result.hidden = false;
    $result.className = `panel result ${kind}`;

    // --- Verdict ---------------------------------------------------------
    const icon = notFound ? '❔' : (t.kind === 'domain' ? '🌐' : '🖧');
    const title = notFound
      ? 'No match — not registered'
      : esc(r.domainName || r.netRange || t.value);
    let sub;
    if (notFound) {
      sub = `WHOIS reports <code>${esc(t.value)}</code> is available / unregistered.`;
    } else if (t.kind === 'domain') {
      sub = `registered through <strong>${esc(r.registrar || 'an unknown registrar')}</strong>` +
        (r.redacted ? ' · <span class="redacted">contact data redacted (privacy / GDPR)</span>' : '');
    } else {
      sub = `assigned to <strong>${esc(r.organization || 'an unknown organisation')}</strong>` +
        (r.cidr ? ` · <code>${esc(r.cidr)}</code>` : '');
    }
    $verdict.innerHTML =
      `<div class="icon">${icon}</div><div class="who">` +
      `<div class="title">${title}</div><div class="sub">${sub}</div></div>`;

    // --- Query chain (the honest part: which servers, in what order) -----
    const modelTag = res.thin
      ? '<span class="tag thin">thin registry → followed referral</span>'
      : '<span class="tag thick">thick / direct</span>';
    const hops = res.chain.map((h, i) => {
      const err = h.referralError ? `<span class="hop-err"> (referral dead-end: ${esc(h.referralError)})</span>` : '';
      return `<span class="hop"><span class="n">${i + 1}</span>${esc(h.server)}</span>${err}`;
    }).join('<span class="arrow">→</span>');
    $chain.innerHTML =
      `<div class="label">Query path ${modelTag}</div>` +
      `<div class="hops">${hops}</div>`;

    // --- The normalised record ------------------------------------------
    if (notFound) {
      $record.innerHTML = '';
    } else {
      const rows = [];
      const row = (k, v) => { if (v) rows.push(`<div class="k">${esc(k)}</div><div class="v">${v}</div>`); };
      row('Registrar', r.registrar && esc(r.registrar));
      row('Registrant', r.registrant && esc(r.registrant));
      row('Organization', r.organization && esc(r.organization));
      row('IP range', r.netRange && esc(r.netRange));
      row('CIDR', r.cidr && esc(r.cidr));
      row('Created', r.dates.created || r.createdDate ? date(r.dates.created, r.createdDate) : '');
      row('Updated', r.dates.updated || r.updatedDate ? date(r.dates.updated, r.updatedDate) : '');
      row('Expires', r.dates.expiry || r.expiryDate ? date(r.dates.expiry, r.expiryDate) : '');
      row('Country', (r.registrantCountry || r.orgCountry) && esc(r.registrantCountry || r.orgCountry));
      row('DNSSEC', r.dnssec && esc(r.dnssec));
      if (r.nameServers.length) row('Name servers', r.nameServers.map((n) => `<code>${esc(n)}</code>`).join(' '));
      $record.innerHTML = `<div class="grid">${rows.join('')}</div>`;
    }

    // --- EPP status codes, explained ------------------------------------
    if (!notFound && r.statusExplained.length) {
      const items = r.statusExplained.map((s) =>
        `<li><code>${esc(s.code)}</code>${s.meaning ? `<span class="mean">${esc(s.meaning)}</span>` : '<span class="mean muted">(no description)</span>'}</li>`
      ).join('');
      $statuses.innerHTML = `<div class="label">Status codes</div><ul>${items}</ul>`;
    } else {
      $statuses.innerHTML = '';
    }

    // --- Raw responses ---------------------------------------------------
    $rawbox.hidden = false;
    $raw.innerHTML = res.chain.map((h) =>
      `<div class="rawhop"><div class="rawhdr">${esc(h.server)} &nbsp;←&nbsp; <code>${esc(h.query)}</code></div>` +
      `<pre>${esc(res.raw[h.server] || '')}</pre></div>`
    ).join('');
  }

  async function go() {
    $err.textContent = '';
    const value = $q.value.trim();
    if (!value) { $err.textContent = 'Enter a domain or IP address.'; return; }
    let target;
    try {
      target = W.classifyTarget(value); // validate first for a clean error
    } catch (e) {
      renderError(value, e.message);
      return;
    }
    try {
      const res = await W.lookup(target, resolver);
      render(res);
    } catch (e) {
      renderError(value, `lookup failed: ${e.message}`);
    }
  }

  $btn.addEventListener('click', go);
  $q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  for (const el of document.querySelectorAll('.ex')) {
    el.addEventListener('click', () => { $q.value = el.dataset.q; go(); });
  }

  go(); // resolve the default on load
})();
