/*
 * script.js — the thin UI layer for the Fast Exponentiation demo.
 *
 * It reads the base / exponent / modulus inputs, calls FastExpCore, and paints
 * the result, the multiplication comparison, and the square-and-multiply trace.
 * It contains no exponentiation math of its own: every number shown comes
 * straight from fastexp-core.js.
 */
(function () {
  "use strict";
  var C = window.FastExpCore;

  var $ = function (id) { return document.getElementById(id); };
  var baseEl = $("base"), expEl = $("exp"), modEl = $("mod"), errEl = $("err");
  var resultEl = $("result"), traceCard = $("traceCard"), fibCard = $("fibCard");

  // Group a long digit string into blocks of three from the right, for reading.
  function groupDigits(s) {
    var neg = s[0] === "-";
    if (neg) s = s.slice(1);
    var out = s.replace(/\B(?=(\d{3})+(?!\d))/g, " "); // thin space
    return (neg ? "−" : "") + out;
  }

  // Show a BigInt: full if short, else head…tail with a digit count.
  function showBig(v) {
    var s = v.toString();
    var sign = s[0] === "-" ? "−" : "";
    var digits = sign ? s.slice(1) : s;
    if (digits.length <= 60) return groupDigits(s);
    return sign + digits.slice(0, 24) + " … " + digits.slice(-24) +
      "  (" + digits.length + " digits)";
  }

  function showCount(v) {
    return groupDigits(v.toString());
  }

  function renderBits(bits) {
    return bits.map(function (b) {
      return "<span class=\"" + (b ? "bits1" : "bits0") + "\">" + b + "</span>";
    }).join("");
  }

  function opLabel(step) {
    if (step.op === "seed") return "<span class=\"kind\">seed</span> — " + step.note;
    if (step.op === "square") return "<span class=\"kind\">square</span> — running²";
    return "<span class=\"mul\">multiply</span> — × base";
  }

  function paintTrace(res, base, exp, mod) {
    var list = $("traceList");
    list.innerHTML = "";
    res.steps.forEach(function (step) {
      var li = document.createElement("li");
      var bitCls = step.op === "seed" ? "seed" : (step.bit === 1 ? "one" : "zero");
      var bitTxt = step.op === "seed" ? "▸" : String(step.bit);
      var tb = document.createElement("span");
      tb.className = "tbit " + bitCls; tb.textContent = bitTxt;
      var top = document.createElement("span");
      top.className = "top"; top.innerHTML = opLabel(step);
      var tv = document.createElement("span");
      tv.className = "tval"; tv.textContent = showBig(step.value);
      li.appendChild(tb); li.appendChild(top); li.appendChild(tv);
      list.appendChild(li);
    });
    traceCard.hidden = false;
    $("traceNote").innerHTML = mod == null
      ? "Each row squares the running value; a <b>1</b>-bit adds a multiply by the base. " +
        res.squarings + " squarings + " + res.multiplies + " multiplies."
      : "Same ladder, but every value is reduced mod " + mod.toString() +
        " — so it never grows. " + res.squarings + " squarings + " + res.multiplies + " multiplies.";
  }

  function run() {
    errEl.textContent = "";
    var base, exp, mod = null;
    try {
      base = C.toBig(baseEl.value, "base");
      exp = C.toBig(expEl.value, "exponent");
      var modRaw = modEl.value.trim();
      if (modRaw !== "") mod = C.toBig(modRaw, "modulus");
    } catch (e) {
      errEl.textContent = e.message;
      resultEl.hidden = true; traceCard.hidden = true; fibCard.hidden = true;
      return;
    }

    var res, counts;
    try {
      res = C.squareAndMultiply(base, exp, mod);
      counts = C.multiplyCounts(exp);
    } catch (e) {
      errEl.textContent = e.message;
      resultEl.hidden = true; traceCard.hidden = true; fibCard.hidden = true;
      return;
    }

    resultEl.hidden = false;
    $("vval").textContent = showBig(res.value);

    var expStr = "<span class=\"exp\">" + escapeHtml(base.toString()) + "</span><sup>" +
      escapeHtml(exp.toString()) + "</sup>";
    $("statement").innerHTML = mod == null
      ? expStr + " computed by squaring and multiplying along the exponent's bits."
      : expStr + " mod <b>" + escapeHtml(mod.toString()) + "</b> — the numbers stay small the whole way.";

    var bits = C.bitsOf(exp);
    $("binVal").innerHTML = renderBits(bits) +
      "  <span class=\"bits0\">(" + bits.length + " bits, " + counts.oneBits + " ones)</span>";
    $("fastVal").innerHTML = "<span class=\"good\">" + showCount(counts.fast) + "</span>";
    $("naiveVal").textContent = showCount(counts.naive);
    $("savedVal").innerHTML = "<span class=\"good\">" + showCount(counts.saved) + "</span>";

    paintTrace(res, base, exp, mod);

    fibCard.hidden = false;
  }

  function runFib() {
    var out = $("fibOut"), stmt = $("fibStatement");
    var n;
    try {
      n = C.toBig($("fibN").value, "index");
    } catch (e) { stmt.textContent = e.message; out.hidden = true; return; }
    var r;
    try { r = C.fibonacci(n); }
    catch (e) { stmt.textContent = e.message; out.hidden = true; return; }
    stmt.innerHTML = "F(" + escapeHtml(n.toString()) + ") — found in <b>" +
      r.multiplies + "</b> matrix multiplies:";
    $("fibVal").textContent = showBig(r.value);
    out.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // wiring
  $("run").addEventListener("click", run);
  $("fibRun").addEventListener("click", runFib);
  [baseEl, expEl, modEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  });
  $("fibN").addEventListener("keydown", function (e) { if (e.key === "Enter") runFib(); });
  document.querySelectorAll(".preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      baseEl.value = btn.getAttribute("data-base");
      expEl.value = btn.getAttribute("data-exp");
      modEl.value = btn.getAttribute("data-mod");
      run();
    });
  });

  run();     // compute the default example on load
  runFib();  // and the default Fibonacci
})();
