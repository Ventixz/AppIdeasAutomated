/* script.js — thin UI over tilecost-core.js. All arithmetic lives in the core. */

'use strict';

(function () {
  var core = window.TileCostCore;

  var form = document.getElementById('form');
  var hint = document.getElementById('hint');
  var resultWrap = document.getElementById('resultWrap');
  var totalEl = document.getElementById('total');
  var buyCount = document.getElementById('buyCount');
  var rows = document.getElementById('rows');
  var chips = document.querySelectorAll('.chip');

  var fields = ['roomW', 'roomH', 'roomUnit', 'tileW', 'tileH', 'tileUnit',
                'pricePerTile', 'tilesPerBox', 'wastePercent', 'taxPercent'];
  var el = {};
  fields.forEach(function (id) { el[id] = document.getElementById(id); });

  var EXAMPLES = {
    kitchen:  { roomW: '12.5', roomH: '10', roomUnit: 'ft', tileW: '12', tileH: '12', tileUnit: 'in',
                pricePerTile: '2.49', tilesPerBox: '', wastePercent: '10', taxPercent: '0' },
    bathroom: { roomW: '8', roomH: '6', roomUnit: 'ft', tileW: '6', tileH: '6', tileUnit: 'in',
                pricePerTile: '18.00', tilesPerBox: '10', wastePercent: '10', taxPercent: '8.25' },
    metric:   { roomW: '3', roomH: '4', roomUnit: 'm', tileW: '30', tileH: '30', tileUnit: 'cm',
                pricePerTile: '1.20', tilesPerBox: '', wastePercent: '10', taxPercent: '0' }
  };

  function fail(msg) {
    hint.textContent = msg;
    hint.classList.add('error');
    resultWrap.hidden = true;
  }

  function row(label, value, strong) {
    var tr = document.createElement('tr');
    if (strong) tr.className = 'strong';
    var td1 = document.createElement('td'); td1.textContent = label;
    var td2 = document.createElement('td'); td2.className = 'num'; td2.textContent = value;
    tr.appendChild(td1); tr.appendChild(td2);
    return tr;
  }

  function run() {
    hint.classList.remove('error');
    hint.textContent = '';

    var input = {
      roomW: el.roomW.value, roomH: el.roomH.value, roomUnit: el.roomUnit.value,
      tileW: el.tileW.value, tileH: el.tileH.value, tileUnit: el.tileUnit.value,
      pricePerTile: el.pricePerTile.value,
      tilesPerBox: el.tilesPerBox.value.trim() ? parseInt(el.tilesPerBox.value, 10) : null,
      wastePercent: el.wastePercent.value.trim() || '0',
      taxPercent: el.taxPercent.value.trim() || '0'
    };

    var r;
    try { r = core.estimate(input); }
    catch (e) { return fail(e.message); }

    totalEl.textContent = '$' + r.money.total;

    if (r.boxes !== null) {
      buyCount.textContent = r.boxes.toString() + ' box' + (r.boxes === 1n ? '' : 'es')
        + ' (' + r.tilesCharged.toString() + ' tiles)';
    } else {
      buyCount.textContent = r.tilesCharged.toString() + ' tile' + (r.tilesCharged === 1n ? '' : 's');
    }

    rows.innerHTML = '';
    rows.appendChild(row('Floor area', r.roomAreaText + ' sq ft'));
    rows.appendChild(row('Fewest tiles by area (offcuts reused)', r.areaTiles.toString()));
    rows.appendChild(row('Tiles by layout (cut to fit, no reuse)', r.gridTiles.toString()));
    rows.appendChild(row('After waste / overage', r.tilesWithWaste.toString()));
    if (r.boxes !== null) {
      rows.appendChild(row('Boxes to buy', r.boxes.toString()
        + ' × ' + r.tilesPerBox.toString() + ' = ' + r.tilesCharged.toString() + ' tiles'));
    }
    rows.appendChild(row('Coverage bought', r.coverageText + ' sq ft'));
    rows.appendChild(row('Subtotal', '$' + r.money.subtotal));
    if (r.money.tax !== '0.00') rows.appendChild(row('Tax', '$' + r.money.tax));
    rows.appendChild(row('Total', '$' + r.money.total, true));

    resultWrap.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var ex = EXAMPLES[chip.dataset.ex];
      if (!ex) return;
      fields.forEach(function (id) { if (ex[id] !== undefined) el[id].value = ex[id]; });
      run();
    });
  });

  // Calculate the default kitchen on load so the page isn't empty.
  run();
})();
