/*
 * script.js — thin browser glue over ZipCore.
 *
 * All the real work (CRC-32, DEFLATE, the ZIP container) lives in zip-core.js
 * and is tested headless. This file only: collects files the user drops or
 * picks, shows them in a list, and on "Build" hands the bytes to ZipCore and
 * triggers a download. No network, no dependencies.
 */
'use strict';
(function () {
  var Z = window.ZipCore;

  // The working set: each item is { name, bytes:Uint8Array }.
  var files = [];

  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop');
  var fileInput = $('file');
  var list = $('list');
  var countEl = $('count');
  var emptyNote = $('empty-note');
  var clearBtn = $('clear');
  var buildBtn = $('build');
  var statusEl = $('status');

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function uniqueName(name) {
    // Avoid two entries with the exact same path (some unzippers dislike it).
    var taken = {};
    files.forEach(function (f) { taken[f.name] = true; });
    if (!taken[name]) return name;
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var i = 2;
    while (taken[base + '-' + i + ext]) i++;
    return base + '-' + i + ext;
  }

  function addFile(name, bytes) {
    files.push({ name: uniqueName(name), bytes: bytes });
    render();
  }

  function removeAt(i) {
    files.splice(i, 1);
    render();
  }

  function render() {
    list.innerHTML = '';
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      li.className = 'fileitem';

      var nm = document.createElement('span');
      nm.className = 'fname';
      nm.textContent = f.name;
      nm.title = f.name;

      var sz = document.createElement('span');
      sz.className = 'fsize';
      sz.textContent = fmtSize(f.bytes.length);

      var rm = document.createElement('button');
      rm.className = 'rm';
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'Remove';
      rm.addEventListener('click', function () { removeAt(i); });

      li.appendChild(nm);
      li.appendChild(sz);
      li.appendChild(rm);
      list.appendChild(li);
    });

    var has = files.length > 0;
    countEl.textContent = has ? '(' + files.length + ')' : '';
    emptyNote.hidden = has;
    clearBtn.hidden = !has;
    buildBtn.disabled = !has;
    if (has) setStatus('');
  }

  // ---- intake: file picker + drag/drop ----
  function ingestFileList(fileList) {
    var arr = Array.prototype.slice.call(fileList);
    if (!arr.length) return;
    var pending = arr.length;
    arr.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        // webkitRelativePath preserves folder structure when a folder is dropped.
        var name = file.webkitRelativePath || file.name;
        addFile(name, new Uint8Array(reader.result));
        if (--pending === 0) setStatus(arr.length + ' file(s) added.', 'ok');
      };
      reader.onerror = function () {
        if (--pending === 0) setStatus('Could not read one or more files.', 'err');
      };
      reader.readAsArrayBuffer(file);
    });
  }

  fileInput.addEventListener('change', function () {
    ingestFileList(fileInput.files);
    fileInput.value = ''; // allow re-selecting the same file
  });

  drop.addEventListener('click', function (e) {
    if (e.target.closest('label, button')) return; // let inner controls work
    fileInput.click();
  });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) ingestFileList(e.dataTransfer.files);
  });

  // ---- hand-authored text file via dialog ----
  var dialog = $('text-dialog');
  $('add-text').addEventListener('click', function () {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { // fallback for very old browsers
      var n = prompt('File name', 'notes.txt');
      if (n) addFile(n, Z.toBytes(prompt('Contents', '') || ''));
    }
  });
  dialog.addEventListener('close', function () {
    if (dialog.returnValue === 'ok') {
      var name = ($('text-name').value || 'notes.txt').trim();
      addFile(name, Z.toBytes($('text-body').value));
      $('text-body').value = '';
      setStatus('Text file added.', 'ok');
    }
  });

  // ---- samples ----
  $('load-sample').addEventListener('click', function () {
    addFile('hello.txt', Z.toBytes('Hello from the Zip File Maker!\n\nEverything here was zipped in your browser.\n'));
    addFile('docs/readme.md', Z.toBytes('# Sample archive\n\nThis file is deliberately repetitive so DEFLATE has something to chew on.\n\n' +
      'repeat repeat repeat repeat repeat repeat repeat repeat repeat repeat\n'.repeat(40)));
    addFile('data/numbers.csv', Z.toBytes('id,value\n' +
      Array.apply(null, { length: 100 }).map(function (_, i) { return i + ',' + (i * i); }).join('\n') + '\n'));
    setStatus('Loaded 3 sample files.', 'ok');
  });

  clearBtn.addEventListener('click', function () { files = []; render(); setStatus(''); });

  // ---- build & download ----
  buildBtn.addEventListener('click', function () {
    if (!files.length) return;
    try {
      var storeOnly = $('store-only').checked;
      var entries = files.map(function (f) {
        return { name: f.name, data: f.bytes, store: storeOnly };
      });
      var t0 = performance.now ? performance.now() : Date.now();
      var zip = Z.buildZip(entries, { store: storeOnly });
      var t1 = performance.now ? performance.now() : Date.now();

      var rawTotal = files.reduce(function (s, f) { return s + f.bytes.length; }, 0);
      var name = ($('zipname').value || 'archive.zip').trim();
      if (!/\.zip$/i.test(name)) name += '.zip';

      var blob = new Blob([zip], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

      var ratio = rawTotal > 0 ? Math.round((1 - zip.length / rawTotal) * 100) : 0;
      var saved = storeOnly
        ? 'stored (no compression)'
        : (ratio > 0 ? ratio + '% smaller than the raw files' : 'no size win on this set');
      setStatus('Built ' + name + ' — ' + files.length + ' file(s), ' +
        fmtSize(zip.length) + ' (' + saved + ') in ' +
        Math.max(1, Math.round(t1 - t0)) + ' ms.', 'ok');
    } catch (err) {
      setStatus('Build failed: ' + (err && err.message ? err.message : err), 'err');
    }
  });

  render();
})();
