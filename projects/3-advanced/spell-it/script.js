/*
 * script.js — the browser layer for Spell-It.
 *
 * All the spelling logic lives in spell-core.js. This file is only the two
 * things the engine deliberately doesn't do:
 *
 *   1. SOUND. The target word is spoken with the Web Speech API
 *      (speechSynthesis) — the app-ideas spec's "play button triggers audio
 *      playback of the target word". The bonus confirmation/warning cues are
 *      short tones synthesised with the Web Audio API, so there are no audio
 *      files to ship.
 *
 *   2. THE DOM. Wiring the buttons, the real-time input echo, the hint
 *      highlighting, the feedback line, and the statistics dashboard to the
 *      engine — plus Enter-to-submit from both the keyboard and the button.
 *
 * Crucially, the word itself is only ever SPOKEN, never rendered, until you
 * submit an attempt — otherwise it wouldn't be a spelling test.
 */

(function () {
  "use strict";

  const Core = window.SpellCore;
  const game = Core.createGame({ seed: (Date.now() % 100000) | 0 });

  const el = {
    play: document.getElementById("play"),
    playLabel: document.getElementById("play-label"),
    replay: document.getElementById("replay"),
    counter: document.getElementById("counter"),
    form: document.getElementById("spell-form"),
    input: document.getElementById("spelling"),
    attempt: document.getElementById("attempt"),
    submit: document.getElementById("submit"),
    hint: document.getElementById("hint"),
    clue: document.getElementById("clue"),
    clueText: document.getElementById("clue-text"),
    skip: document.getElementById("skip"),
    feedback: document.getElementById("feedback"),
    statCorrect: document.getElementById("stat-correct"),
    statAttempts: document.getElementById("stat-attempts"),
    statPercent: document.getElementById("stat-percent"),
    reset: document.getElementById("reset"),
    unsupported: document.getElementById("unsupported"),
  };

  /* ------------------------------------------------------------------ *
   *  Speech — say the current word aloud.
   * ------------------------------------------------------------------ */
  const canSpeak = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  if (!canSpeak) {
    el.unsupported.hidden = false;
  }

  function speakCurrent(rate) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(game.current());
    u.lang = "en-US";
    u.rate = rate || 0.9;
    window.speechSynthesis.speak(u);
  }

  /* ------------------------------------------------------------------ *
   *  Bonus sounds — synthesised so there are no assets to load.
   * ------------------------------------------------------------------ */
  let audioCtx = null;
  function ctx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // A little rising two-note "correct" chirp / a low "wrong" buzz.
  function tone(freqs, type, duration) {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;
    freqs.forEach(function (f, i) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const start = now + i * (duration * 0.6);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }
  function chimeCorrect() {
    tone([660, 990], "sine", 0.18);
  }
  function buzzWrong() {
    tone([180, 120], "square", 0.22);
  }

  /* ------------------------------------------------------------------ *
   *  Rendering
   * ------------------------------------------------------------------ */
  function renderStats() {
    const s = game.stats();
    el.statCorrect.textContent = String(s.correct);
    el.statAttempts.textContent = String(s.attempts);
    el.statPercent.textContent = s.percent + "%";
  }

  function renderCounter() {
    const p = game.position();
    el.counter.textContent = "word " + p.index + " of " + p.total;
  }

  // The real-time echo of what's typed, letter by letter. When `diff` is
  // provided (after a submit or a hint) each letter is coloured by status.
  function renderAttempt(diff) {
    el.attempt.innerHTML = "";
    const raw = el.input.value;
    if (!diff) {
      // Plain echo while typing — no reveal of correctness yet.
      for (let i = 0; i < raw.length; i++) {
        const span = document.createElement("span");
        span.className = "tile";
        span.textContent = raw[i];
        el.attempt.appendChild(span);
      }
      if (raw.length === 0) {
        el.attempt.classList.add("attempt--empty");
      } else {
        el.attempt.classList.remove("attempt--empty");
      }
      return;
    }
    el.attempt.classList.remove("attempt--empty");
    diff.letters.forEach(function (l) {
      const span = document.createElement("span");
      span.className = "tile tile--" + l.status;
      // Show the letter the learner typed; for a missing slot show a blank box.
      span.textContent = l.typed != null ? l.typed : "·";
      el.attempt.appendChild(span);
    });
    diff.extra.forEach(function (ch) {
      const span = document.createElement("span");
      span.className = "tile tile--extra";
      span.textContent = ch;
      el.attempt.appendChild(span);
    });
  }

  function setFeedback(text, kind) {
    el.feedback.textContent = text;
    el.feedback.className = "feedback" + (kind ? " feedback--" + kind : "");
  }

  /* ------------------------------------------------------------------ *
   *  Flow
   * ------------------------------------------------------------------ */
  function newWord(announce) {
    el.input.value = "";
    el.input.disabled = false;
    el.submit.disabled = false;
    el.clueText.hidden = true;
    renderAttempt(null);
    renderCounter();
    setFeedback(announce || "Press play, then spell what you hear.", "");
    el.input.focus();
    if (canSpeak) speakCurrent();
  }

  function onSubmit(e) {
    if (e) e.preventDefault();
    const value = el.input.value;
    if (Core.normalize(value) === "") {
      setFeedback("Type the word before pressing Enter.", "warn");
      return;
    }
    const result = game.submit(value);
    renderAttempt(result); // reveal per-letter status
    renderStats();
    if (result.correct) {
      chimeCorrect();
      setFeedback("✓ Correct! It's “" + result.target + "”.", "good");
      el.input.disabled = true;
      el.submit.disabled = true;
      // Auto-advance to the next word after a beat.
      window.setTimeout(function () {
        game.next();
        newWord("Nice — here's the next one.");
      }, 1300);
    } else {
      buzzWrong();
      setFeedback("✗ Not quite. Listen again and try once more.", "bad");
      el.input.focus();
      el.input.select();
    }
  }

  /* ------------------------------------------------------------------ *
   *  Events
   * ------------------------------------------------------------------ */
  el.play.addEventListener("click", function () {
    speakCurrent();
    el.input.focus();
  });
  el.replay.addEventListener("click", function () {
    speakCurrent(0.6);
    el.input.focus();
  });

  // Real-time echo as the learner types (spec: "typed letters display in
  // real-time within the input field").
  el.input.addEventListener("input", function () {
    renderAttempt(null);
  });

  el.form.addEventListener("submit", onSubmit); // Enter key + Enter button

  el.hint.addEventListener("click", function () {
    // Highlight the misspelled letters without spending an attempt.
    const diff = game.hint(el.input.value);
    renderAttempt(diff);
    setFeedback("Hint: green letters are right, red ones aren't.", "warn");
    el.input.focus();
  });

  el.clue.addEventListener("click", function () {
    const meaning = game.currentHint();
    el.clueText.textContent = meaning ? "Meaning: " + meaning : "No clue for this one — trust your ears!";
    el.clueText.hidden = false;
    el.input.focus();
  });

  el.skip.addEventListener("click", function () {
    game.next();
    newWord("Skipped. Here's a new word.");
  });

  el.reset.addEventListener("click", function () {
    game.reset();
    renderStats();
    newWord("Score reset. Fresh start!");
  });

  /* ------------------------------------------------------------------ *
   *  Go
   * ------------------------------------------------------------------ */
  renderStats();
  renderCounter();
  renderAttempt(null);
  setFeedback("Press ▶ Play word to hear the first word.", "");
})();
