/*
 * script.js — the browser presentation layer for the Shuffle Deck benchmark.
 *
 * All the timing, shuffling, validation and ranking live in shuffle-core.js.
 * This file only wires the DOM to that engine: read the round count, run a
 * benchmark on a real `performance.now` clock, paint the table, and manage the
 * "you changed rounds mid-run" confirmation dialog.
 */

(function () {
  "use strict";

  const Core = window.ShuffleCore;

  // --- Element handles ----------------------------------------------------
  const roundsInput = document.getElementById("rounds");
  const startOut = document.getElementById("start-time");
  const endOut = document.getElementById("end-time");
  const totalOut = document.getElementById("total-time");
  const warningEl = document.getElementById("warning");
  const resultsBody = document.getElementById("results-body");
  const analysisEl = document.getElementById("analysis");
  const clearBtn = document.getElementById("clear-btn");
  const algoButtons = Array.prototype.slice.call(
    document.querySelectorAll(".algo-btn")
  );

  const backdrop = document.getElementById("dialog-backdrop");
  const dialogOk = document.getElementById("dialog-ok");
  const dialogCancel = document.getElementById("dialog-cancel");

  // --- State --------------------------------------------------------------
  // resultsById: algorithm id -> benchmark result. roundsForResults: the round
  // count those results were produced at, so we can detect a mid-run change.
  let resultsById = {};
  let roundsForResults = null;
  let pendingRoundsValue = null; // stashed input value awaiting dialog confirm

  const clock =
    typeof performance !== "undefined" && performance.now
      ? function () {
          return performance.now();
        }
      : Date.now;

  // --- Rendering ----------------------------------------------------------

  function showWarning(message) {
    warningEl.textContent = message;
    warningEl.hidden = false;
  }

  function clearWarning() {
    warningEl.textContent = "";
    warningEl.hidden = true;
  }

  function fmtMs(ms) {
    // Sub-millisecond runs are common at low round counts, so keep decimals.
    if (ms < 1) return ms.toFixed(3) + " ms";
    if (ms < 100) return ms.toFixed(2) + " ms";
    return ms.toFixed(1) + " ms";
  }

  function renderClocks(result) {
    startOut.textContent = result.start.toFixed(2);
    endOut.textContent = result.end.toFixed(2);
    totalOut.textContent = fmtMs(result.elapsed);
  }

  function renderTable() {
    const ids = Object.keys(resultsById);
    if (ids.length === 0) {
      resultsBody.innerHTML =
        '<tr class="empty-row"><td colspan="4">No runs yet — pick an algorithm above.</td></tr>';
      analysisEl.hidden = true;
      return;
    }

    // Preserve the registry order (JS, Xorshift, WELL512a) for a stable table.
    const rows = Core.ALGORITHMS.filter(function (a) {
      return resultsById[a.id];
    }).map(function (a) {
      return resultsById[a.id];
    });

    resultsBody.innerHTML = rows
      .map(function (r) {
        return (
          "<tr>" +
          "<td>" + r.label + "</td>" +
          "<td>" + r.start.toFixed(2) + "</td>" +
          "<td>" + r.end.toFixed(2) + "</td>" +
          "<td>" + fmtMs(r.elapsed) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    renderAnalysis();
  }

  // Bonus feature: once two or more algorithms have run, spell out how the
  // fastest and slowest compare.
  function renderAnalysis() {
    const count = Object.keys(resultsById).length;
    if (count < 2) {
      analysisEl.hidden = true;
      return;
    }
    const a = Core.analyze(resultsById);
    const slowerBy = a.slowest.relative.toFixed(2);
    analysisEl.textContent =
      "Fastest: " +
      a.fastest.label +
      " (" +
      fmtMs(a.fastest.elapsed) +
      "). Slowest: " +
      a.slowest.label +
      " (" +
      fmtMs(a.slowest.elapsed) +
      "), " +
      slowerBy +
      "× the fastest over " +
      roundsForResults.toLocaleString() +
      " rounds.";
    analysisEl.hidden = false;
  }

  // --- Running a benchmark ------------------------------------------------

  function runAlgorithm(id) {
    clearWarning();

    const v = Core.validateRounds(roundsInput.value);
    if (!v.ok) {
      showWarning(v.reason);
      return;
    }

    // If there are results from a different round count still on screen, this
    // shouldn't happen (the input guard handles it), but stay defensive.
    if (roundsForResults !== null && roundsForResults !== v.rounds) {
      resultsById = {};
    }
    roundsForResults = v.rounds;

    // Seed the seedable generators off the clock so repeated runs vary, while
    // the tests still pin behaviour with a fixed seed.
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

    let result;
    try {
      result = Core.runBenchmark(id, v.rounds, { now: clock, seed: seed });
    } catch (e) {
      showWarning(e.message);
      return;
    }

    resultsById[id] = result;
    renderClocks(result);
    renderTable();
  }

  // --- The mid-run rounds-change guard ------------------------------------
  //
  // The spec: if the user edits rounds before all algorithms have been run,
  // warn them. OK clears results and accepts the new value; Cancel reverts the
  // field to the round count the current results belong to.

  function openDialog() {
    backdrop.hidden = false;
    dialogOk.focus();
  }

  function closeDialog() {
    backdrop.hidden = true;
  }

  function handleRoundsChange() {
    const hasResults = Object.keys(resultsById).length > 0;
    const finished = Core.allCoreComplete(resultsById);

    // Only guard when there are partial results the change would strand.
    if (hasResults && !finished) {
      pendingRoundsValue = roundsInput.value;
      openDialog();
    }
  }

  dialogOk.addEventListener("click", function () {
    // Accept the new round count and wipe the incomparable results.
    resultsById = {};
    roundsForResults = null;
    startOut.textContent = "—";
    endOut.textContent = "—";
    totalOut.textContent = "—";
    clearWarning();
    renderTable();
    pendingRoundsValue = null;
    closeDialog();
  });

  dialogCancel.addEventListener("click", function () {
    // Revert the field to the round count the on-screen results belong to.
    if (roundsForResults !== null) {
      roundsInput.value = roundsForResults;
    }
    pendingRoundsValue = null;
    closeDialog();
  });

  // --- Wiring -------------------------------------------------------------

  algoButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      runAlgorithm(btn.getAttribute("data-algo"));
    });
  });

  // "change" fires on blur / Enter, which is the natural moment to confirm.
  roundsInput.addEventListener("change", handleRoundsChange);

  clearBtn.addEventListener("click", function () {
    resultsById = {};
    roundsForResults = null;
    startOut.textContent = "—";
    endOut.textContent = "—";
    totalOut.textContent = "—";
    clearWarning();
    renderTable();
  });

  // Close the dialog on Escape (treated as Cancel).
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !backdrop.hidden) {
      dialogCancel.click();
    }
  });

  renderTable();
})();
