// script.js — browser glue around quiz-core. All the interesting logic lives in
// quiz-core.js (and is tested headlessly); this file only wires the DOM.
'use strict';

(function () {
  const Q = window.QuizCore;
  const $ = (id) => document.getElementById(id);

  const els = {
    bank: $('bank'),
    bankStatus: $('bank-status'),
    file: $('file'),
    loadSample: $('load-sample'),
    count: $('count'),
    seed: $('seed'),
    partial: $('partial'),
    start: $('start'),
    setup: $('setup'),
    quiz: $('quiz'),
    quizForm: $('quiz-form'),
    activeSeed: $('active-seed'),
    submit: $('submit'),
    reshuffle: $('reshuffle'),
    results: $('results'),
    scoreboard: $('scoreboard'),
    review: $('review'),
    retake: $('retake'),
  };

  let bank = null; // parsed bank
  let current = null; // { quiz, key }

  // ---- bank parsing / validation feedback --------------------------------
  function refreshBank() {
    const text = els.bank.value;
    bank = Q.parseBank(text);
    const usable = bank.questions.filter(
      (q) => q.options.length >= 2 && q.options.some((o) => o.correct)
    );

    if (text.trim() === '') {
      els.bankStatus.className = 'status';
      els.bankStatus.textContent = '';
      els.start.disabled = true;
      return;
    }

    if (bank.errors.length) {
      els.bankStatus.className = 'status err';
      const first = bank.errors
        .slice(0, 4)
        .map((e) => `line ${e.line}: ${e.message}`)
        .join('  ·  ');
      els.bankStatus.innerHTML =
        `${bank.errors.length} problem(s) in the file.` +
        `<span class="detail">${escapeHtml(first)}</span>`;
    } else {
      els.bankStatus.className = 'status ok';
      const warn = bank.warnings.length ? ` (${bank.warnings.length} warning(s))` : '';
      els.bankStatus.textContent =
        `${usable.length} usable question(s) parsed${warn}.`;
    }
    els.start.disabled = usable.length === 0;
    // keep the requested count sensible
    if (usable.length && Number(els.count.value) > usable.length) {
      els.count.value = usable.length;
    }
    els.count.max = Math.max(1, usable.length);
  }

  els.bank.addEventListener('input', refreshBank);

  els.loadSample.addEventListener('click', () => {
    // fetch() the sample when served over http; fall back to an inline copy for
    // the file:// case so "load the sample" works even opened from disk.
    fetch('sample-bank.quiz')
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        els.bank.value = t;
        refreshBank();
      })
      .catch(() => {
        els.bank.value = INLINE_SAMPLE;
        refreshBank();
      });
  });

  els.file.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.bank.value = String(reader.result);
      refreshBank();
    };
    reader.readAsText(f);
  });

  // ---- assemble ----------------------------------------------------------
  function assemble() {
    const count = Math.max(1, parseInt(els.count.value, 10) || 10);
    const seedRaw = els.seed.value.trim();
    const opts = { count };
    if (seedRaw !== '') opts.seed = seedRaw;
    try {
      current = Q.assembleQuiz(bank, opts);
    } catch (err) {
      els.bankStatus.className = 'status err';
      els.bankStatus.textContent = err.message;
      return;
    }
    renderQuiz();
    show(els.quiz);
    show(els.results, false);
    els.activeSeed.textContent = current.quiz.seed;
    els.quiz.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  els.start.addEventListener('click', assemble);
  els.reshuffle.addEventListener('click', () => {
    els.seed.value = ''; // force a new random seed
    assemble();
  });

  function renderQuiz() {
    els.quizForm.innerHTML = '';
    current.quiz.items.forEach((item, idx) => {
      const multi = current.key[item.questionId].multi;
      const wrap = document.createElement('fieldset');
      wrap.className = 'q';
      const pts = item.points === 1 ? '1 point' : `${item.points} points`;
      wrap.innerHTML =
        `<legend class="stem">${idx + 1}. ${escapeHtml(item.stem)}</legend>` +
        `<p class="meta">${pts}${multi ? ' · select all that apply' : ''}</p>`;
      item.choices.forEach((c) => {
        const id = `${item.questionId}-${c.letter}`;
        const label = document.createElement('label');
        label.className = 'choice';
        label.htmlFor = id;
        label.innerHTML =
          `<input id="${id}" type="${multi ? 'checkbox' : 'radio'}" ` +
          `name="${item.questionId}" value="${c.letter}" />` +
          `<span class="letter">${c.letter}</span>` +
          `<span>${escapeHtml(c.text)}</span>`;
        wrap.appendChild(label);
      });
      els.quizForm.appendChild(wrap);
    });
  }

  // ---- grade -------------------------------------------------------------
  els.submit.addEventListener('click', () => {
    const responses = {};
    current.quiz.items.forEach((item) => {
      const picked = Array.from(
        els.quizForm.querySelectorAll(`input[name="${item.questionId}"]:checked`)
      ).map((i) => i.value);
      responses[item.questionId] = picked;
    });
    const result = Q.grade(current.quiz, current.key, responses, {
      partial: els.partial.checked,
    });
    renderResults(result);
    show(els.results);
    els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderResults(r) {
    const band = r.percentage >= 80 ? 'good' : r.percentage >= 50 ? 'mid' : 'bad';
    els.scoreboard.innerHTML =
      `<div class="big pct ${band}">${r.percentage}%</div>` +
      `<div class="line">${r.score} / ${r.max} points · ` +
      `${r.correctCount} of ${r.total} questions correct</div>`;

    els.review.innerHTML = r.byQuestion
      .map((b) => {
        const cls = b.correct ? 'correct' : 'wrong';
        const verdict = b.correct ? 'Correct' : 'Incorrect';
        const chosen = b.chosen.length ? b.chosen.join(', ') : '—';
        const why = b.explanation
          ? `<div class="why">${escapeHtml(b.explanation)}</div>`
          : '';
        return (
          `<div class="rev ${cls}">` +
          `<div class="stem">${escapeHtml(b.stem)}</div>` +
          `<div class="verdict">${verdict} · ${b.awarded}/${b.points}</div>` +
          `<div class="detail">You chose <span class="key">${chosen}</span> · ` +
          `answer: <span class="key">${b.correctLetters.join(', ')}</span></div>` +
          why +
          `</div>`
        );
      })
      .join('');
  }

  els.retake.addEventListener('click', () => {
    show(els.quiz, false);
    show(els.results, false);
    els.setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---- helpers -----------------------------------------------------------
  function show(el, on = true) {
    el.classList.toggle('hidden', !on);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const INLINE_SAMPLE =
    'What is 2 + 2?\n* 4\n- 3\n- 5\n- 22\n\n' +
    'Which are even numbers? {2}\n* 2\n* 8\n- 3\n- 7\n\n' +
    'The sky is green.\n- True\n* False\n';

  refreshBank();
})();
