/*
 * script.js — the browser client for the Shell Game.
 *
 * Every decision (where the pea is, what a guess scores, whether a shuffle is
 * legal) is delegated to ShellCore in shell-core.js. This file owns only what a
 * screen needs: a <canvas>, some tweening, hit-testing clicks, and a 5-second
 * shuffle animation. It never decides the rules itself.
 */
(function () {
  "use strict";

  const Core = window.ShellCore;

  // ---- geometry (canvas-internal coordinates) ----------------------------
  const SLOT_X = [150, 320, 490]; // centre of each of the three slots
  const BASE_Y = 250; // where a resting shell's rim sits
  const SHELL_W = 130;
  const SHELL_H = 150;
  const LIFT_MAX = 96; // fully-raised shell height
  const PEA_SHOWS_ABOVE = 34; // shell must be raised this far to expose the pea
  const SHUFFLE_MS = 5000; // spec: shuffling lasts five seconds
  const SHUFFLE_SWAPS = 14; // number of cup swaps inside that window

  // ---- DOM ---------------------------------------------------------------
  const canvas = document.getElementById("table");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const shuffleBtn = document.getElementById("shuffle-btn");
  const newBtn = document.getElementById("new-btn");
  const winsEl = document.getElementById("score-wins");
  const gamesEl = document.getElementById("score-games");
  const rateEl = document.getElementById("score-rate");

  // ---- mutable view state ------------------------------------------------
  let game = Core.createGame(3);
  // One cup per slot. `slot` is its logical position (a Core index); `x` is the
  // animated pixel centre; `lift`/`targetLift` drive the raise/lower tween.
  let cups = SLOT_X.map((x, i) => ({ slot: i, x: x, lift: 0, targetLift: 0 }));
  let shuffle = null; // active shuffle animation, or null
  let peaPlaced = false; // has a pea been placed this round (for drawing)

  // =========================================================================
  // Rendering
  // =========================================================================

  function slotX(slot) {
    return SLOT_X[slot];
  }

  function cupAtSlot(slot) {
    return cups.find((c) => c.slot === slot);
  }

  function drawTableDetails() {
    // three faint slot markers on the felt
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (const x of SLOT_X) {
      ctx.beginPath();
      ctx.ellipse(x, BASE_Y + 6, SHELL_W / 2, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPea(x) {
    ctx.save();
    const grad = ctx.createRadialGradient(x - 4, BASE_Y - 12, 2, x, BASE_Y - 8, 16);
    grad.addColorStop(0, "#ffd98a");
    grad.addColorStop(1, "#c9711f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, BASE_Y - 8, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawShell(cup) {
    const cx = cup.x;
    const rim = BASE_Y - cup.lift;
    const w = SHELL_W;
    const h = SHELL_H;

    ctx.save();

    // ground shadow — shrinks as the shell rises
    const shade = Math.max(0.05, 0.28 - cup.lift / 500);
    ctx.fillStyle = "rgba(0,0,0," + shade + ")";
    ctx.beginPath();
    ctx.ellipse(cx, BASE_Y + 10, w / 2 + 6, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // body — a warm dome
    const body = ctx.createLinearGradient(cx - w / 2, rim - h, cx + w / 2, rim);
    body.addColorStop(0, "#d98b3f");
    body.addColorStop(0.5, "#b96e26");
    body.addColorStop(1, "#8a4e16");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, rim);
    ctx.quadraticCurveTo(cx - w / 2, rim - h, cx, rim - h);
    ctx.quadraticCurveTo(cx + w / 2, rim - h, cx + w / 2, rim);
    ctx.closePath();
    ctx.fill();

    // highlight
    ctx.strokeStyle = "rgba(255,235,200,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - w / 4, rim - 8);
    ctx.quadraticCurveTo(cx - w / 3, rim - h * 0.7, cx - 4, rim - h + 8);
    ctx.stroke();

    // rim ellipse (the opening on the ground)
    ctx.fillStyle = "#6f3e11";
    ctx.beginPath();
    ctx.ellipse(cx, rim, w / 2, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTableDetails();

    // Draw the pea first (it sits on the felt); a shell over it hides it unless
    // that shell is lifted high enough to expose it.
    if (peaPlaced && game.peaAt !== null && !shuffle) {
      const cover = cupAtSlot(game.peaAt);
      if (!cover || cover.lift >= PEA_SHOWS_ABOVE) {
        drawPea(slotX(game.peaAt));
      }
    }

    // Draw shells back-to-front by their vertical position so lifts overlap
    // naturally.
    const order = cups.slice().sort((a, b) => a.x - b.x);
    for (const cup of order) drawShell(cup);
  }

  // =========================================================================
  // Tweening loop
  // =========================================================================

  let rafPending = false;
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(tick);
  }

  let lastTs = null;
  function tick(ts) {
    rafPending = false;
    const dt = lastTs === null ? 16 : Math.min(64, ts - lastTs);
    lastTs = ts;

    let busy = false;

    // ease every lift toward its target
    for (const cup of cups) {
      if (Math.abs(cup.lift - cup.targetLift) > 0.5) {
        cup.lift += (cup.targetLift - cup.lift) * Math.min(1, dt / 120);
        busy = true;
      } else {
        cup.lift = cup.targetLift;
      }
    }

    // advance an in-flight shuffle
    if (shuffle) {
      busy = true;
      stepShuffle(ts);
    }

    render();
    if (busy) requestRender();
  }

  // =========================================================================
  // Shuffle animation — drives the same swap list Core will resolve
  // =========================================================================

  function startShuffle() {
    if (game.phase !== "ready") return;
    game = Core.beginShuffle(game);
    const swaps = Core.generateSwaps(3, SHUFFLE_SWAPS, Math.random);
    shuffle = {
      swaps: swaps,
      resolved: Core.applySwaps(game, swaps), // final state, applied when done
      startAt: null,
      stepDur: SHUFFLE_MS / swaps.length,
      done: 0, // number of swaps fully applied to the cups
      active: null, // { a, b, cupA, cupB, fromA, fromB, dir }
    };
    setStatus("Watch closely…");
    setButtons();
    requestRender();
  }

  function beginStep(index) {
    const [a, b] = shuffle.swaps[index];
    const cupA = cupAtSlot(a);
    const cupB = cupAtSlot(b);
    shuffle.active = {
      a: a,
      b: b,
      cupA: cupA,
      cupB: cupB,
      fromA: slotX(a),
      fromB: slotX(b),
      dir: index % 2 === 0 ? 1 : -1, // alternate which cup arcs over the top
    };
  }

  function stepShuffle(ts) {
    if (shuffle.startAt === null) {
      shuffle.startAt = ts;
      beginStep(0);
    }
    const elapsed = ts - shuffle.startAt;
    const stepIndex = Math.min(shuffle.swaps.length - 1, Math.floor(elapsed / shuffle.stepDur));

    // finish any steps we've passed
    while (shuffle.done < stepIndex) {
      commitStep();
      shuffle.done++;
      beginStep(shuffle.done);
    }

    // interpolate the current step
    const act = shuffle.active;
    const t = Math.min(1, (elapsed - stepIndex * shuffle.stepDur) / shuffle.stepDur);
    const ease = t * t * (3 - 2 * t); // smoothstep
    const arc = Math.sin(Math.PI * ease) * 34 * act.dir;
    act.cupA.x = act.fromA + (act.fromB - act.fromA) * ease;
    act.cupB.x = act.fromB + (act.fromA - act.fromB) * ease;
    act.cupA.lift = Math.max(act.cupA.lift, Math.abs(arc) > 0 && act.dir > 0 ? Math.abs(arc) * 0.5 : 0);
    // the arcing cup is nudged up a touch to sell the pass; keep it subtle
    if (act.dir > 0) act.cupA.lift = Math.abs(arc);
    else act.cupB.lift = Math.abs(arc);

    if (elapsed >= SHUFFLE_MS) {
      finishShuffle();
    }
  }

  function commitStep() {
    const act = shuffle.active;
    // snap the two cups to their swapped slots and record the new logical slots
    act.cupA.x = act.fromB;
    act.cupB.x = act.fromA;
    const tmp = act.cupA.slot;
    act.cupA.slot = act.cupB.slot;
    act.cupB.slot = tmp;
    act.cupA.lift = 0;
    act.cupB.lift = 0;
  }

  function finishShuffle() {
    commitStep();
    for (const cup of cups) {
      cup.x = slotX(cup.slot);
      cup.lift = 0;
      cup.targetLift = 0;
    }
    game = shuffle.resolved;
    shuffle = null;
    setStatus("Where's the pea? Click a shell.");
    setButtons();
    requestRender();
  }

  // =========================================================================
  // Input
  // =========================================================================

  function eventSlot(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (evt.clientX - rect.left) * scaleX;
    const py = (evt.clientY - rect.top) * scaleY;
    if (py < BASE_Y - SHELL_H - 20 || py > BASE_Y + 30) {
      // still allow a generous vertical band, but reject far-off clicks
      if (py < 40 || py > canvas.height - 20) return -1;
    }
    for (let s = 0; s < SLOT_X.length; s++) {
      if (Math.abs(px - SLOT_X[s]) <= SHELL_W / 2) return s;
    }
    return -1;
  }

  function onCanvasClick(evt) {
    if (shuffle) return; // input is locked mid-shuffle
    const slot = eventSlot(evt);
    if (slot < 0) return;

    if (game.phase === "placing" || game.phase === "won") {
      placeAt(slot);
    } else if (game.phase === "guessing") {
      makeGuess(slot);
    }
  }

  function placeAt(slot) {
    game = Core.placePea(game, slot);
    peaPlaced = true;
    // all shells sit down over the felt; the chosen one drops over the pea
    for (const cup of cups) cup.targetLift = 0;
    setStatus("Pea's hidden. Press Shuffle when you're ready.");
    setButtons();
    updateScores();
    requestRender();
  }

  function makeGuess(slot) {
    const res = Core.guess(game, slot);
    game = res.state;
    const cup = cupAtSlot(slot);
    if (cup) cup.targetLift = LIFT_MAX; // lift the chosen shell to reveal

    if (res.repeat) {
      // already lifted; nothing changes
      requestRender();
      return;
    }

    if (res.correct) {
      if (res.win) {
        setStatus("🎉 Found it — first try! That's a win.", "win");
      } else {
        setStatus("You found it! (But not on the first guess.)", "win");
      }
    } else {
      setStatus("Empty. Keep looking…", "miss");
    }
    setButtons();
    updateScores();
    requestRender();
  }

  function newGame() {
    game = Core.nextRound(game);
    peaPlaced = false;
    shuffle = null;
    // reset cups to their home slots, raised so the empty table is on show
    cups = SLOT_X.map((x, i) => ({ slot: i, x: x, lift: 0, targetLift: 0 }));
    setStatus("Click a shell to hide the pea under it.");
    setButtons();
    requestRender();
  }

  // =========================================================================
  // Chrome: status line, buttons, scoreboard
  // =========================================================================

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setButtons() {
    shuffleBtn.disabled = game.phase !== "ready" || !!shuffle;
  }

  function updateScores() {
    winsEl.textContent = game.stats.wins;
    gamesEl.textContent = game.stats.games;
    rateEl.textContent =
      game.stats.games === 0 ? "—" : Math.round(Core.winRate(game) * 100) + "%";
  }

  // =========================================================================
  // Wire-up
  // =========================================================================

  canvas.addEventListener("click", onCanvasClick);
  shuffleBtn.addEventListener("click", startShuffle);
  newBtn.addEventListener("click", newGame);

  updateScores();
  requestRender();
})();
