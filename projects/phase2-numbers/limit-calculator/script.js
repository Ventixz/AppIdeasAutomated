/*
 * script.js — the thin UI layer for the Limit Calculator.
 *
 * It reads the two inputs, calls LimitCore.limit(), and paints the verdict,
 * the one-sided breakdown and the convergence table. It contains no limit
 * math of its own: every number shown comes straight from limit-core.js.
 */
(function () {
  "use strict";
  var C = window.LimitCore;

  var $ = function (id) { return document.getElementById(id); };
  var exprEl = $("expr"), targetEl = $("target"), errEl = $("err");
  var resultEl = $("result"), convCard = $("convCard");

  // Parse the "x approaches" field: a number, or inf / -inf (many spellings).
  function parseTarget(raw) {
    var s = raw.trim().toLowerCase().replace(/\s+/g, "");
    if (s === "inf" || s === "+inf" || s === "infinity" || s === "∞" || s === "+∞") return "inf";
    if (s === "-inf" || s === "-infinity" || s === "-∞") return "-inf";
    if (s === "pi") return Math.PI;
    if (s === "-pi") return -Math.PI;
    if (s === "e") return Math.E;
    var n = Number(s);
    if (isFinite(n)) return n;
    throw new Error("Point must be a number, or inf / -inf.");
  }

  // Format a number for display: integers plainly, otherwise trimmed to a
  // readable precision without trailing-zero noise.
  function fmt(v) {
    if (v === Infinity) return "+∞";
    if (v === -Infinity) return "−∞";
    if (!isFinite(v)) return "undefined";
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e-4 && Math.abs(v) < 1e7) {
      var r = Number(v.toFixed(8));
      return String(r).replace(/-/g, "−");
    }
    return v.toExponential(6).replace(/-/g, "−").replace("e", "×10^");
  }

  function targetLabel(t) {
    if (t === "inf") return "+∞";
    if (t === "-inf") return "−∞";
    return fmt(t);
  }

  function oneSidedLabel(side) {
    if (!side) return "—";
    if (side.status === "finite") return fmt(side.value);
    if (side.status === "infinite") return side.sign < 0 ? "−∞" : "+∞";
    if (side.reason === "undefined") return "undefined here";
    return "does not settle";
  }

  function paintConvergence(res) {
    var list = $("convList");
    list.innerHTML = "";
    var sides = [];
    if (res.oneSided) {
      sides.push({ label: "x → " + targetLabel(res.target), s: res.right });
    } else {
      if (res.left) sides.push({ label: "from the left", s: res.left });
      if (res.right) sides.push({ label: "from the right", s: res.right });
    }
    var any = false;
    sides.forEach(function (grp) {
      if (!grp.s || !grp.s.samples) return;
      var head = document.createElement("li");
      head.className = "side";
      head.textContent = grp.label;
      head.style.gridColumn = "1 / -1";
      list.appendChild(head);
      // show a thinned set of the samples (every other one), closest last
      var samples = grp.s.samples;
      for (var i = 0; i < samples.length; i += 2) {
        var smp = samples[i];
        var li = document.createElement("li");
        var cx = document.createElement("span"); cx.className = "cx";
        var cy = document.createElement("span"); cy.className = "cy";
        // For infinity targets the sampled x is 1/t; show the real x instead.
        var xShown = res.oneSided ? (res.target === "inf" ? 1 / smp.x : -1 / smp.x) : smp.x;
        cx.textContent = "x = " + fmt(xShown);
        cy.textContent = isFinite(smp.y) ? fmt(smp.y) : "undefined";
        li.appendChild(cx); li.appendChild(cy);
        list.appendChild(li);
        any = true;
      }
    });
    convCard.hidden = !any;
    if (any) {
      $("convNote").textContent = res.oneSided
        ? "As x runs off to " + targetLabel(res.target) + ", f(x) settles toward the value above."
        : "The closer x creeps to " + targetLabel(res.target) + " from each side, the clearer the value becomes.";
    }
  }

  function run() {
    errEl.textContent = "";
    var exprText = exprEl.value;
    var target;
    try {
      target = parseTarget(targetEl.value);
    } catch (e) {
      errEl.textContent = e.message;
      resultEl.hidden = true; convCard.hidden = true;
      return;
    }

    var res;
    try {
      res = C.limit(exprText, target);
    } catch (e) {
      errEl.textContent = "Couldn't read that function: " + e.message;
      resultEl.hidden = true; convCard.hidden = true;
      return;
    }

    resultEl.hidden = false;
    var vval = $("vval"), vform = $("vform"), stmt = $("statement");
    vval.className = "verdict-val";
    vform.textContent = "";

    var tLabel = targetLabel(res.target);
    var exprSpan = "<span class=\"exp\">" + escapeHtml(exprText.trim()) + "</span>";

    if (res.status === "finite") {
      vval.textContent = fmt(res.value);
      if (res.closedForm && res.closedForm !== fmt(res.value)) {
        vform.innerHTML = "≈ <b>" + escapeHtml(res.closedForm) + "</b>";
      }
      var extra = res.oneSided ? "" :
        (res.continuous ? " The function is continuous there (it equals its limit)."
                        : " (The function is not defined — or not equal to this — at the point itself.)");
      if (res.reason === "one-sided-domain") extra = " Only one side is in the domain, so this is a one-sided limit.";
      stmt.innerHTML = "The limit of " + exprSpan + " as x → " + tLabel +
        " is <b>" + escapeHtml(fmt(res.value)) + "</b>." + extra;
    } else if (res.status === "infinite") {
      vval.textContent = res.sign < 0 ? "−∞" : "+∞";
      vval.className = "verdict-val inf";
      stmt.innerHTML = exprSpan + " grows without bound as x → " + tLabel +
        ", so the limit is <b>" + (res.sign < 0 ? "−∞" : "+∞") + "</b>.";
    } else {
      vval.textContent = "DNE";
      vval.className = "verdict-val dne";
      var why = "the two sides disagree";
      if (res.reason === "no-convergence") why = "the function oscillates without settling";
      else if (res.reason === "one-side-dne") why = "one side has no limit";
      stmt.innerHTML = "The limit of " + exprSpan + " as x → " + tLabel +
        " <b>does not exist</b> — " + why + ".";
    }

    // one-sided breakdown (hidden for infinity targets, which are one-sided)
    var sidesEl = $("sides");
    if (res.oneSided) {
      sidesEl.hidden = true;
    } else {
      sidesEl.hidden = false;
      $("leftVal").textContent = oneSidedLabel(res.left);
      $("rightVal").textContent = oneSidedLabel(res.right);
      $("fatVal").textContent = res.fAt == null ? "undefined" : fmt(res.fAt);
    }

    paintConvergence(res);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // wiring
  $("run").addEventListener("click", run);
  [exprEl, targetEl].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
  });
  document.querySelectorAll(".preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      exprEl.value = btn.getAttribute("data-expr");
      targetEl.value = btn.getAttribute("data-target");
      run();
    });
  });

  run(); // compute the default example on load
})();
