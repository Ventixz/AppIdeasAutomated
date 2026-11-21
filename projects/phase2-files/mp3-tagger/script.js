/*
 * script.js — thin UI glue over id3-core.js. No tagging logic lives here; it
 * reads files into bytes, hands them to the engine to analyse, renders the
 * missing-field report, and writes the edited tags back for download.
 */
'use strict';
(function () {
  var ID3 = window.ID3Core;

  var drop = document.getElementById('drop');
  var fileInput = document.getElementById('file');
  var loadSample = document.getElementById('load-sample');
  var list = document.getElementById('files');
  var empty = document.getElementById('empty');
  var srcinfo = document.getElementById('srcinfo');
  var clearBtn = document.getElementById('clear');
  var fillBtn = document.getElementById('fill-missing');
  var tpl = document.getElementById('row-tpl');

  // Populate the genre datalist from the engine's table.
  var dl = document.getElementById('genre-list');
  ID3.GENRES.forEach(function (g) {
    var o = document.createElement('option'); o.value = g; dl.appendChild(o);
  });

  var rows = []; // { name, bytes, info, el }

  function refreshHeader() {
    var n = rows.length;
    var incomplete = rows.filter(function (r) { return !r.info.complete; }).length;
    srcinfo.textContent = n ? (n + ' file' + (n > 1 ? 's' : '') + ', ' + incomplete + ' with missing fields') : '';
    empty.style.display = n ? 'none' : 'block';
    clearBtn.disabled = fillBtn.disabled = n === 0;
  }

  // Guess Title / Artist from a "Artist - Title.mp3" style filename.
  function guessFromName(name) {
    var base = name.replace(/\.[^.]+$/, '');
    var m = /^\s*(.+?)\s*-\s*(.+?)\s*$/.exec(base);
    if (m) return { artist: m[1], title: m[2] };
    return { title: base };
  }

  function fieldLabel(f) {
    return { title: 'Title', artist: 'Artist', album: 'Album', year: 'Year',
             track: 'Track', genre: 'Genre', comment: 'Comment' }[f] || f;
  }

  function badgeFor(info) {
    if (info.complete) return ['complete', 'all set'];
    if (!info.hasV1 && !info.hasV2) return ['none', 'untagged'];
    return ['partial', info.missing.length + ' missing'];
  }

  function renderRow(r) {
    var el = tpl.content.firstElementChild.cloneNode(true);
    r.el = el;

    el.querySelector('.fname').textContent = r.name;

    var b = badgeFor(r.info);
    var badge = el.querySelector('.badge');
    badge.textContent = b[1]; badge.classList.add(b[0]);

    var kb = (r.bytes.length / 1024).toFixed(1);
    var tags = [];
    if (r.info.hasV2) tags.push('ID3v' + r.info.v2.version.slice(2));
    if (r.info.hasV1) tags.push('ID3v1');
    el.querySelector('.file-meta').textContent = kb + ' KB · ' + (tags.length ? tags.join(' + ') : 'no tags');

    // Fill inputs from the merged view; flag the ones that were missing.
    var inputs = {};
    el.querySelectorAll('input[data-f]').forEach(function (inp) {
      var f = inp.getAttribute('data-f');
      inputs[f] = inp;
      inp.value = r.info.merged[f] || '';
      if (r.info.missing.indexOf(f) !== -1) inp.classList.add('flag');
      inp.addEventListener('input', function () { inp.classList.remove('flag'); });
    });
    r.inputs = inputs;

    renderMissing(r);

    el.querySelector('.save').addEventListener('click', function () { saveRow(r); });
    return el;
  }

  function renderMissing(r) {
    var line = r.el.querySelector('.missing-line');
    line.innerHTML = '';
    line.classList.remove('ok');
    if (r.info.complete) {
      line.textContent = '✓ Every standard field is present.';
      line.classList.add('ok');
      return;
    }
    var label = document.createElement('span');
    label.textContent = 'Missing: ';
    line.appendChild(label);
    r.info.missing.forEach(function (f) {
      var chip = document.createElement('span');
      chip.className = 'chip'; chip.textContent = fieldLabel(f);
      line.appendChild(chip);
    });
  }

  function collectTag(r) {
    var t = {};
    ID3.CORE_FIELDS.forEach(function (f) { t[f] = r.inputs[f].value.trim(); });
    return t;
  }

  function saveRow(r) {
    var status = r.el.querySelector('.rowstatus');
    try {
      var tag = collectTag(r);
      var out = ID3.applyTags(r.bytes, tag);

      // Re-analyse what we just produced so the badge/flags reflect reality.
      r.bytes = out;
      r.info = ID3.readTags(out);

      // Download.
      var blob = new Blob([out], { type: 'audio/mpeg' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = r.name.replace(/\.[^.]+$/, '') + '.mp3';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

      // Refresh this row's UI in place.
      var b = badgeFor(r.info);
      var badge = r.el.querySelector('.badge');
      badge.className = 'badge ' + b[0]; badge.textContent = b[1];
      Object.keys(r.inputs).forEach(function (f) { r.inputs[f].classList.remove('flag'); });
      renderMissing(r);
      r.el.querySelector('.file-meta').textContent =
        (r.bytes.length / 1024).toFixed(1) + ' KB · ID3v2.3 + ID3v1';
      refreshHeader();

      status.textContent = 'Tags written · downloaded';
      status.className = 'rowstatus status ok';
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.className = 'rowstatus status err';
    }
  }

  function addFiles(fileArr) {
    var mp3s = fileArr.filter(function (f) { return /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg'; });
    if (!mp3s.length && fileArr.length) {
      // Allow anything the user explicitly dropped; just warn via badge later.
      mp3s = fileArr;
    }
    mp3s.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var bytes = new Uint8Array(reader.result);
        var info;
        try { info = ID3.readTags(bytes); }
        catch (e) { info = { merged: {}, missing: ID3.CORE_FIELDS.slice(), complete: false, hasV1: false, hasV2: false, fileSize: bytes.length }; }
        var r = { name: file.name, bytes: bytes, info: info };
        rows.push(r);
        list.appendChild(renderRow(r));
        refreshHeader();
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---- events ---- */
  drop.addEventListener('click', function (e) { if (e.target === drop || e.target.classList.contains('drop-main') || e.target.classList.contains('drop-sub')) fileInput.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', function () { addFiles(Array.prototype.slice.call(fileInput.files)); fileInput.value = ''; });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  clearBtn.addEventListener('click', function () {
    rows = []; list.innerHTML = ''; refreshHeader();
  });

  fillBtn.addEventListener('click', function () {
    rows.forEach(function (r) {
      var g = guessFromName(r.name);
      ['title', 'artist'].forEach(function (f) {
        if (g[f] && !r.inputs[f].value.trim()) { r.inputs[f].value = g[f]; r.inputs[f].classList.remove('flag'); }
      });
    });
  });

  loadSample.addEventListener('click', function () {
    // A genuine (silent) MP3 with real MPEG frame-sync bytes and NO tags, so
    // the analyzer flags every field as missing.
    var bytes = ID3.makeSilentMp3(20);
    var info = ID3.readTags(bytes);
    var r = { name: 'Daft Punk - Untagged Sample.mp3', bytes: bytes, info: info };
    rows.push(r);
    list.appendChild(renderRow(r));
    refreshHeader();
  });

  refreshHeader();
})();
