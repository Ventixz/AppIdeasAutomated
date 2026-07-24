/* HighStriker — a carnival strength-tester simulated with a timing meter
 * plus randomization, per the app-ideas spec. No physical force required.
 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const puck = $("puck");
  const bell = $("bell");
  const pad = $("pad");
  const meterFill = $("meterFill");
  const scoreEl = $("score");
  const bellsEl = $("bells");
  const attemptsEl = $("attempts");
  const messageEl = $("message");
  const strikeBtn = $("strike");
  const clearBtn = $("clear");
  const soundToggle = $("soundToggle");

  const WIN_SCORE = 10;

  const state = {
    score: 0,
    bells: 0,
    attempts: 0,
    swinging: false, // meter is running, waiting for the strike
    animating: false, // puck is flying
    won: false,
    soundOn: true,
  };

  /* ---------- Timing meter ----------
   * A value oscillates 0 -> 1 -> 0. The player hits Strike to lock it in.
   * The closer to the top (1.0) they stop it, the more base power they get.
   */
  let meterValue = 0;
  let meterDir = 1;
  let meterRAF = null;
  let lastTs = null;
  const METER_SPEED = 1.35; // full sweeps per second-ish

  function meterLoop(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    meterValue += meterDir * METER_SPEED * dt;
    if (meterValue >= 1) { meterValue = 1; meterDir = -1; }
    else if (meterValue <= 0) { meterValue = 0; meterDir = 1; }
    // Fill shows the "empty" portion above the current value (bar fills up as value rises)
    meterFill.style.width = `${(1 - meterValue) * 100}%`;
    if (state.swinging) meterRAF = requestAnimationFrame(meterLoop);
  }

  function startMeter() {
    state.swinging = true;
    meterValue = 0;
    meterDir = 1;
    lastTs = null;
    cancelAnimationFrame(meterRAF);
    meterRAF = requestAnimationFrame(meterLoop);
  }

  function stopMeter() {
    state.swinging = false;
    cancelAnimationFrame(meterRAF);
  }

  /* ---------- Height & scoring ----------
   * Final height blends the player's timing with a dash of carnival luck.
   */
  function computeHeight() {
    const timing = meterValue;              // 0..1 skill component
    const luck = Math.random() * 0.28;      // randomization the spec asks for
    let h = timing * 0.82 + luck;           // weighted toward skill
    return Math.max(0.04, Math.min(1, h));  // clamp to the rail
  }

  // Map a normalized height to points per the bonus spec's zones.
  function pointsForHeight(h) {
    if (h >= 0.999) return 5;   // bell strike
    if (h >= 0.75) return 4;    // 3/4 -> bell
    if (h >= 0.5) return 3;     // 1/2 -> 3/4
    if (h >= 0.25) return 2;    // 1/4 -> 1/2
    if (h >= 0.125) return 1;   // 1/8 -> 1/4
    return 0;                   // too weak, no points
  }

  /* ---------- Audio (Web Audio API, no files) ---------- */
  let audioCtx = null;
  function ac() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function tone(freq, dur, type = "sine", gain = 0.15, when = 0) {
    if (!state.soundOn) return;
    const ctx = ac();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Rising "whoosh" as the puck ascends — pitch scales with how high it goes.
  function ascendSound(height) {
    if (!state.soundOn) return;
    const ctx = ac();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const dur = 0.18 + height * 0.5;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(140, t0);
    osc.frequency.exponentialRampToValueAtTime(140 + height * 900, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Distinct audio feedback per point value (bonus requirement).
  function scoreSound(points) {
    if (points === 5) {
      // Bell: bright bell-like ding-ding
      tone(1568, 0.6, "sine", 0.22, 0);
      tone(2093, 0.5, "sine", 0.12, 0.04);
      tone(1568, 0.6, "sine", 0.16, 0.28);
    } else if (points === 4) {
      tone(880, 0.22, "triangle", 0.16);
      tone(1174, 0.22, "triangle", 0.12, 0.12);
    } else if (points === 3) {
      tone(660, 0.2, "triangle", 0.15);
      tone(880, 0.2, "triangle", 0.11, 0.1);
    } else if (points === 2) {
      tone(523, 0.18, "triangle", 0.14);
    } else if (points === 1) {
      tone(392, 0.16, "triangle", 0.13);
    } else {
      // Whiff — low buzz
      tone(150, 0.25, "sawtooth", 0.1);
    }
  }

  /* ---------- Gameplay ---------- */
  function strike() {
    if (state.animating) return;

    if (!state.swinging) {
      // First press: start the timing meter.
      startMeter();
      strikeBtn.textContent = "Hit it! 🔨";
      messageEl.className = "message";
      messageEl.textContent = "Now! Stop the meter at the top for full power.";
      return;
    }

    // Second press: lock in the timing and fire.
    stopMeter();
    strikeBtn.disabled = true;
    strikeBtn.textContent = "Strike! 🔨";
    state.animating = true;
    state.attempts++;
    attemptsEl.textContent = state.attempts;

    pad.classList.remove("hit");
    void pad.offsetWidth; // reflow to restart animation
    pad.classList.add("hit");

    const height = computeHeight();
    ascendSound(height);
    launchPuck(height);
  }

  function launchPuck(height) {
    const railHeight = puck.parentElement.clientHeight - puck.clientHeight;
    const peakPx = height * railHeight;

    // Up phase, then settle back down.
    puck.style.transition = "bottom 0.45s cubic-bezier(0.2, 0.8, 0.35, 1)";
    requestAnimationFrame(() => {
      puck.style.bottom = `${peakPx}px`;
    });

    setTimeout(() => {
      const points = pointsForHeight(height);
      resolveStrike(points, height);
      // Fall back down.
      puck.style.transition = "bottom 0.6s ease-in";
      puck.style.bottom = "0px";
      setTimeout(() => {
        state.animating = false;
        strikeBtn.disabled = false;
        strikeBtn.textContent = "Strike! 🔨";
      }, 650);
    }, 470);
  }

  function resolveStrike(points, height) {
    if (points === 5) {
      state.bells++;
      bellsEl.textContent = state.bells;
      bell.classList.remove("ring");
      void bell.offsetWidth;
      bell.classList.add("ring");
    }

    state.score += points;
    scoreEl.textContent = state.score;
    scoreSound(points);

    messageEl.className = "message";
    if (points === 5) messageEl.textContent = "🔔 DING! Bell strike — 5 points!";
    else if (points === 4) messageEl.textContent = "So close! +4 points.";
    else if (points === 3) messageEl.textContent = "Solid hit — +3 points.";
    else if (points === 2) messageEl.textContent = "Not bad — +2 points.";
    else if (points === 1) messageEl.textContent = "Weak swing… +1 point.";
    else messageEl.textContent = "Whiff! No points that time.";

    if (!state.won && state.score >= WIN_SCORE) {
      state.won = true;
      setTimeout(() => {
        messageEl.className = "message win";
        messageEl.textContent = `🎉 You win! ${state.score} points in ${state.attempts} attempts. Hit Clear to play again.`;
        winFanfare();
      }, 300);
    }
  }

  function winFanfare() {
    tone(523, 0.18, "square", 0.14, 0);
    tone(659, 0.18, "square", 0.14, 0.16);
    tone(784, 0.18, "square", 0.14, 0.32);
    tone(1047, 0.4, "square", 0.16, 0.48);
  }

  function clearScores() {
    stopMeter();
    state.score = 0;
    state.bells = 0;
    state.attempts = 0;
    state.won = false;
    state.animating = false;
    scoreEl.textContent = "0";
    bellsEl.textContent = "0";
    attemptsEl.textContent = "0";
    meterFill.style.width = "100%";
    puck.style.transition = "bottom 0.3s ease";
    puck.style.bottom = "0px";
    strikeBtn.disabled = false;
    strikeBtn.textContent = "Strike! 🔨";
    messageEl.className = "message";
    messageEl.textContent = "Time your strike — hit the base when the meter is hot!";
  }

  /* ---------- Wiring ---------- */
  strikeBtn.addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    strike();
  });
  clearBtn.addEventListener("click", clearScores);

  soundToggle.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    soundToggle.textContent = state.soundOn ? "🔊" : "🔇";
    soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  });

  // Space bar also strikes, for quick play.
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement.tagName !== "BUTTON") {
      e.preventDefault();
      strikeBtn.click();
    }
  });

  // Start with the meter bar "full" (empty of value) so it reads as ready.
  meterFill.style.width = "100%";
})();
