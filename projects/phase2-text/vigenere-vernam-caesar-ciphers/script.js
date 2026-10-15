/*
 * script.js — browser glue for the Caesar / Vigenère / Vernam playground.
 *
 * All the real logic lives in ciphers-core.js (window.CIPHERS); this file only
 * wires the four tabs to it and renders results. Every cipher updates live as
 * you type, and the "Break it" tab runs the exact crackVigenere / twoTimePad
 * routines the test suite checks.
 */
"use strict";
(function () {
  var C = window.CIPHERS;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }

  /* ---------------- tabs ---------------- */
  var tabs = $("tabs");
  tabs.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab");
    if (!btn) return;
    Array.prototype.forEach.call(tabs.children, function (t) { t.classList.remove("active"); });
    btn.classList.add("active");
    ["caesar", "vigenere", "vernam", "break"].forEach(function (name) {
      $("page-" + name).classList.toggle("hidden", name !== btn.dataset.tab);
    });
  });

  /* ---------------- Caesar ---------------- */
  var cText = $("cText"), cShift = $("cShift"), cEnc = $("cEnc"), cDec = $("cDec");
  var cEncMode = true;
  function renderCaesar() {
    var s = +cShift.value;
    $("cShiftVal").textContent = s;
    $("cKeyLetter").textContent = C.caesar.keyForShift(s);
    var fn = cEncMode ? C.caesar.encrypt : C.caesar.decrypt;
    $("cOut").textContent = fn(cText.value, s);
  }
  cEnc.addEventListener("click", function () { cEncMode = true; cEnc.classList.add("active"); cDec.classList.remove("active"); renderCaesar(); });
  cDec.addEventListener("click", function () { cEncMode = false; cDec.classList.add("active"); cEnc.classList.remove("active"); renderCaesar(); });
  cText.addEventListener("input", renderCaesar);
  cShift.addEventListener("input", renderCaesar);
  renderCaesar();

  /* ---------------- Vigenère ---------------- */
  var vText = $("vText"), vKey = $("vKey"), vEnc = $("vEnc"), vDec = $("vDec");
  var vEncMode = true;
  function renderVigenere() {
    var fn = vEncMode ? C.vigenere.encrypt : C.vigenere.decrypt;
    try {
      $("vOut").textContent = fn(vText.value, vKey.value);
      var shifts = C.keyToShifts(vKey.value);
      $("vNote").textContent = shifts.length
        ? "Key cycles through " + shifts.length + " shift" + (shifts.length > 1 ? "s" : "") +
          ": [" + shifts.join(", ") + "]" + (shifts.length === 1 ? "  — a single shift is just Caesar." : "")
        : "";
    } catch (err) {
      $("vOut").textContent = "⚠️ " + err.message;
      $("vNote").textContent = "";
    }
  }
  vEnc.addEventListener("click", function () { vEncMode = true; vEnc.classList.add("active"); vDec.classList.remove("active"); renderVigenere(); });
  vDec.addEventListener("click", function () { vEncMode = false; vDec.classList.add("active"); vEnc.classList.remove("active"); renderVigenere(); });
  vText.addEventListener("input", renderVigenere);
  vKey.addEventListener("input", renderVigenere);
  renderVigenere();

  /* ---------------- Vernam ---------------- */
  var nText = $("nText"), nKey = $("nKey");
  function renderVernam() {
    try {
      var ct = C.vernam.encrypt(nText.value, nKey.value);
      $("nOut").textContent = ct;
      $("nBack").textContent = C.vernam.decrypt(ct, nKey.value);
      $("nOut").classList.remove("warn-line");
    } catch (err) {
      $("nOut").textContent = "⚠️ " + err.message;
      $("nBack").textContent = "";
    }
  }
  $("nGen").addEventListener("click", function () {
    var n = C.vernam.toBytes(nText.value).length;
    var padB64 = C.vernam.generatePad(n);
    // Store the pad as the decoded byte-string so it XORs byte-for-byte.
    nKey.value = C.vernam.fromBytes(C.vernam.base64ToBytes(padB64));
    $("nPadInfo").textContent = n + " random bytes generated (matches the message exactly).";
    renderVernam();
  });
  nText.addEventListener("input", renderVernam);
  nKey.addEventListener("input", renderVernam);
  renderVernam();

  /* ---------------- Break it: crack Vigenère ---------------- */
  var SAMPLE_PLAIN =
    "It was the best of times, it was the worst of times, it was the age of " +
    "wisdom, it was the age of foolishness, it was the epoch of belief, it was " +
    "the epoch of incredulity, it was the season of light, it was the season of " +
    "darkness, it was the spring of hope, it was the winter of despair.";
  var SAMPLE_KEY = "DICKENS";

  $("bSample").addEventListener("click", function () {
    $("bText").value = C.vigenere.encrypt(SAMPLE_PLAIN, SAMPLE_KEY);
  });

  $("bCrack").addEventListener("click", function () {
    var cipher = $("bText").value.trim();
    var box = $("bResult");
    if (!cipher) { box.innerHTML = ""; return; }

    var lengths = C.guessKeyLengths(cipher, 16).slice(0, 8);
    var cracked = C.crackVigenere(cipher);

    var maxIoc = Math.max.apply(null, lengths.map(function (l) { return l.ioc; })) || 0.0667;
    var rows = lengths.map(function (l, i) {
      var w = Math.round((l.ioc / maxIoc) * 120);
      return "<tr class='" + (cracked.ok && l.length === cracked.keyLength ? "top" : "") + "'>" +
        "<td>" + l.length + "</td>" +
        "<td>" + l.ioc.toFixed(4) + "</td>" +
        "<td><span class='bar' style='width:" + w + "px'></span></td></tr>";
    }).join("");

    if (!cracked.ok) {
      box.innerHTML = "<div class='result-card fail'>Couldn't crack it: " + esc(cracked.reason) + "</div>";
      return;
    }
    box.innerHTML =
      "<div class='result-card'>" +
        "<strong>🔓 Recovered — no key was supplied.</strong>" +
        "<dl class='kv'>" +
          "<dt>Key length</dt><dd>" + cracked.keyLength + "</dd>" +
          "<dt>Key</dt><dd>" + esc(cracked.key) + "</dd>" +
          "<dt>Avg. IoC</dt><dd>" + cracked.ioc.toFixed(4) +
            " (English ≈ " + C.ENGLISH_IOC + ", random ≈ " + C.RANDOM_IOC + ")</dd>" +
        "</dl>" +
        "<div class='recovered'>" + esc(cracked.plaintext) + "</div>" +
        "<table class='ioc-table'><thead><tr><th>Key len</th><th>IoC</th><th>how English-like</th></tr></thead>" +
        "<tbody>" + rows + "</tbody></table>" +
      "</div>";
  });

  /* ---------------- Break it: two-time pad ---------------- */
  $("ttGo").addEventListener("click", function () {
    var p1 = $("ttA").value, p2 = $("ttB").value;
    var n = Math.max(C.vernam.toBytes(p1).length, C.vernam.toBytes(p2).length);
    // One shared pad for BOTH messages — the fatal mistake.
    var key = C.vernam.fromBytes(C.vernam.base64ToBytes(C.vernam.generatePad(n)));
    var c1 = C.vernam.encrypt(p1, key);
    var c2 = C.vernam.encrypt(p2, key);
    var leak = C.twoTimePad(c1, c2);

    function hex(bytes) {
      return bytes.map(function (b) { return ("0" + b.toString(16)).slice(-2); }).join(" ");
    }
    $("ttResult").innerHTML =
      "<div class='result-card'>" +
        "<div class='leak-row'><span class='lbl'>C1 (base64):</span> " + esc(c1) + "</div>" +
        "<div class='leak-row'><span class='lbl'>C2 (base64):</span> " + esc(c2) + "</div>" +
        "<div class='leak-row'><span class='lbl'>C1 ⊕ C2  =  P1 ⊕ P2 (the key cancelled):</span><br>" +
          hex(leak.xorBytes) + "</div>" +
        "<p class='hint' style='margin:10px 0 0'>That hex is the XOR of the two plaintexts with " +
        "<em>no key anywhere in the computation</em>. With English on both sides it can be peeled " +
        "apart by hand — which is why a one-time pad is only ever used once.</p>" +
      "</div>";
  });
})();
