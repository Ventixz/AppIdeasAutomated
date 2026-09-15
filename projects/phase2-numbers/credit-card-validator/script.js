/*
 * script.js — the thin browser layer over card-core.js.
 *
 * All the arithmetic and network logic lives in the core; this file only reads
 * the input, calls C.validate(), and renders the verdict, the per-check
 * breakdown (Luhn, network, length), and a masked form. It also wires the
 * sample-number chips and the "generate a fake" button. Nothing here touches the
 * network — everything is local.
 */

'use strict';

(function () {
  var C = window.CardCore;

  var numberEl = document.getElementById('number');
  var badgeEl = document.getElementById('badge');
  var networkEl = document.getElementById('network');
  var checksEl = document.getElementById('checks');
  var maskedEl = document.getElementById('masked');
  var examplesEl = document.getElementById('examples');
  var genNetworkEl = document.getElementById('genNetwork');
  var generateEl = document.getElementById('generate');

  var NETWORK_LABEL = {
    visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express',
    discover: 'Discover', diners: 'Diners Club', jcb: 'JCB',
    unionpay: 'UnionPay', maestro: 'Maestro'
  };

  /* Keep the input pretty-formatted as the user types, without fighting the
   * caret when they edit in the middle: only reformat when they're at the end. */
  function reformatInput() {
    var atEnd = numberEl.selectionStart === numberEl.value.length;
    var formatted = C.format(numberEl.value);
    if (atEnd && formatted !== numberEl.value) {
      numberEl.value = formatted;
      numberEl.selectionStart = numberEl.selectionEnd = formatted.length;
    }
  }

  function render() {
    var r = C.validate(numberEl.value);

    if (r.length === 0) {
      badgeEl.className = 'badge';
      badgeEl.textContent = '—';
      networkEl.textContent = '';
      checksEl.innerHTML = '';
      maskedEl.textContent = '';
      return;
    }

    // Overall badge.
    badgeEl.className = 'badge ' + (r.valid ? 'ok' : 'bad');
    badgeEl.textContent = r.valid ? '✓ Valid' : '✗ Invalid';

    // Network label + expected length.
    if (r.network) {
      networkEl.innerHTML = (NETWORK_LABEL[r.network.id] || r.network.name) +
        '<span class="len">' + r.length + ' digits</span>';
    } else {
      networkEl.innerHTML = 'Unknown network<span class="len">' + r.length + ' digits</span>';
    }

    // Per-check breakdown.
    checksEl.innerHTML = '';
    checksEl.appendChild(checkRow(
      r.luhnValid, 'Luhn checksum',
      r.luhnValid ? 'passes' : 'fails — a digit is off or transposed'));
    checksEl.appendChild(checkRow(
      !!r.network, 'Card network',
      r.network ? 'recognised as ' + (NETWORK_LABEL[r.network.id] || r.network.name)
                : 'no known network claims this prefix'));
    if (r.network) {
      checksEl.appendChild(checkRow(
        r.lengthValid, 'Length',
        r.lengthValid ? r.length + ' digits, as expected'
                      : 'expected ' + C.humanLengths(r.network.lengths) + ', got ' + r.length));
    }

    // Masked display — the most you'd ever want on screen.
    maskedEl.innerHTML = 'Stored form: <b>' + r.masked + '</b>';
  }

  function checkRow(pass, label, detail) {
    var li = document.createElement('li');
    li.className = pass ? 'pass' : 'fail';
    var mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = pass ? '✓' : '✗';
    var lab = document.createElement('span');
    lab.className = 'label';
    lab.textContent = label;
    var det = document.createElement('span');
    det.className = 'detail';
    det.textContent = '· ' + detail;
    li.appendChild(mark);
    li.appendChild(lab);
    li.appendChild(det);
    return li;
  }

  /* ---------- sample numbers & generation ------------------------------ */

  // Standard published test numbers, all Luhn-valid, none real.
  var SAMPLES = [
    ['visa', '4111 1111 1111 1111'],
    ['mastercard', '5555 5555 5555 4444'],
    ['amex', '3782 822463 10005'],
    ['discover', '6011 1111 1111 1117'],
    ['diners', '3056 930902 5904'],
    ['jcb', '3530 1113 3330 0000']
  ];
  SAMPLES.forEach(function (s) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="net">' + (NETWORK_LABEL[s[0]] || s[0]) + '</span>' + s[1];
    li.addEventListener('click', function () {
      numberEl.value = s[1];
      render();
      numberEl.focus();
    });
    examplesEl.appendChild(li);
  });

  // Populate the generator's network picker.
  C.networkIds().forEach(function (id) {
    var opt = document.createElement('option');
    opt.value = id;
    opt.textContent = NETWORK_LABEL[id] || id;
    genNetworkEl.appendChild(opt);
  });
  genNetworkEl.value = 'visa';

  generateEl.addEventListener('click', function () {
    var num = C.generate(genNetworkEl.value);
    numberEl.value = C.format(num);
    render();
  });

  /* ---------- wiring --------------------------------------------------- */

  numberEl.addEventListener('input', function () {
    reformatInput();
    render();
  });

  render();
})();
