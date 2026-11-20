/* script.js — thin glue between the page controls and pdf-core.js.
 * All generation happens locally via PDFCore.buildPdf; no file ever leaves the
 * browser. Builds the PDF into a Blob for both the inline preview and download. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var drop = $('drop'), fileInput = $('file'), source = $('source'),
      asHtml = $('as-html'), srcinfo = $('srcinfo'),
      titleEl = $('title'), fontEl = $('font'), sizeEl = $('size'),
      pageEl = $('pagesize'), alignEl = $('align'), wrapEl = $('wrap'),
      nameEl = $('pdfname'), buildBtn = $('build'), previewBtn = $('preview'),
      status = $('status'), pv = $('pv');

  var lastUrl = null;

  var SAMPLE =
    'The PDF Generator\n' +
    '\n' +
    'This sample was written straight into the source box so you can see the ' +
    'layout controls at work. Change the font, the page size, or the alignment ' +
    'and press "Update preview" — the document below is rebuilt from scratch ' +
    'each time, byte for byte, and it is the exact file the download button hands you.\n' +
    '\n' +
    'Word wrapping uses the real Adobe font metrics, so when you switch Alignment ' +
    'to "Justify" the spaces stretch to make both margins line up, and when you ' +
    'pick the Courier font every character takes the same width, like a terminal.\n' +
    '\n' +
    'Paste in a plain-text file, or tick "Treat as HTML" and paste a web page — ' +
    'the tags are stripped, entities are decoded, and the readable text becomes ' +
    'a tidy PDF. Nothing is uploaded; it all happens in this tab.';

  function setStatus(msg, cls) {
    status.textContent = msg || '';
    status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function autoHtmlToggle() {
    var name = (fileInput.files && fileInput.files[0] && fileInput.files[0].name || '').toLowerCase();
    if (/\.html?$/.test(name)) asHtml.checked = true;
  }

  function updateInfo() {
    var n = source.value.length;
    var lines = source.value ? source.value.split(/\r\n?|\n/).length : 0;
    srcinfo.textContent = n ? (n.toLocaleString() + ' chars · ' + lines.toLocaleString() + ' lines') : '';
    buildBtn.disabled = n === 0;
  }

  function currentOpts() {
    var text = source.value;
    if (asHtml.checked) text = PDFCore.htmlToText(text);
    return {
      text: text,
      title: titleEl.value.trim(),
      font: fontEl.value,
      fontSize: parseInt(sizeEl.value, 10) || 12,
      pageSize: pageEl.value,
      align: alignEl.value,
      wrap: wrapEl.value
    };
  }

  function generate() {
    var opts = currentOpts();
    var bytes = PDFCore.buildPdf(opts);
    var blob = new Blob([bytes], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    return { bytes: bytes, blob: blob, url: lastUrl, meta: bytes._meta };
  }

  function refreshPreview() {
    if (!source.value) { setStatus('Add some text first.', 'err'); return null; }
    try {
      var r = generate();
      pv.src = r.url;
      var kb = (r.bytes.length / 1024).toFixed(1);
      setStatus('Previewing ' + r.meta.pages + ' page' + (r.meta.pages === 1 ? '' : 's') +
                ' · ' + kb + ' KB · fonts: ' + r.meta.fonts.join(', '), 'ok');
      return r;
    } catch (e) {
      setStatus('Could not build PDF: ' + e.message, 'err');
      return null;
    }
  }

  function download() {
    var r = refreshPreview();
    if (!r) return;
    var name = (nameEl.value || 'document.pdf').trim();
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    var a = document.createElement('a');
    a.href = r.url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    var kb = (r.bytes.length / 1024).toFixed(1);
    setStatus('Saved ' + name + ' — ' + r.meta.pages + ' page' +
              (r.meta.pages === 1 ? '' : 's') + ', ' + kb + ' KB.', 'ok');
  }

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      source.value = reader.result;
      if (/\.html?$/i.test(file.name)) asHtml.checked = true;
      if (!nameEl.value || nameEl.value === 'document.pdf') {
        nameEl.value = file.name.replace(/\.[^.]+$/, '') + '.pdf';
      }
      updateInfo();
      refreshPreview();
    };
    reader.readAsText(file);
  }

  // ---- wiring ----
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) { autoHtmlToggle(); loadFile(fileInput.files[0]); }
  });
  drop.addEventListener('click', function (e) {
    if (e.target.closest('label, button')) return;
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
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  $('load-sample').addEventListener('click', function () {
    source.value = SAMPLE;
    asHtml.checked = false;
    titleEl.value = 'Sample Document';
    updateInfo();
    refreshPreview();
  });

  source.addEventListener('input', updateInfo);
  previewBtn.addEventListener('click', refreshPreview);
  buildBtn.addEventListener('click', download);
  [titleEl, fontEl, sizeEl, pageEl, alignEl, wrapEl, asHtml].forEach(function (el) {
    el.addEventListener('change', function () { if (source.value) refreshPreview(); });
  });

  updateInfo();
})();
