/* Emoji Translator — wires the UI to the dictionaries in dictionary.js. */

const els = {
  language: document.getElementById("language"),
  input: document.getElementById("input"),
  error: document.getElementById("error"),
  translate: document.getElementById("translate"),
  clear: document.getElementById("clear"),
  output: document.getElementById("output"),
  status: document.getElementById("status"),
};

/* Populate the language dropdown from the dictionaries. */
for (const [key, lang] of Object.entries(EMOJI_LANGUAGES)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = lang.label;
  els.language.appendChild(opt);
}

/* Translate a single word, or return it unchanged if we don't know it.
 * Words are matched only on their letters/numbers so "pizza!" keeps its "!". */
function translate(text, lookup) {
  let translatedCount = 0;
  const output = text.replace(/[\p{L}\p{N}']+/gu, (word) => {
    const emoji = lookup[word.toLowerCase()];
    if (emoji) {
      translatedCount++;
      return emoji;
    }
    return word;
  });
  return { output, translatedCount };
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.input.classList.add("invalid");
}

function clearError() {
  els.error.hidden = true;
  els.input.classList.remove("invalid");
}

function onTranslate() {
  clearError();
  const text = els.input.value;

  if (text.trim() === "") {
    showError("Please type some text to translate.");
    els.input.focus();
    return;
  }

  const lookup = buildLookup(els.language.value);
  const { output, translatedCount } = translate(text, lookup);

  if (translatedCount === 0) {
    showError("Nothing to translate — none of those words are in the emoji dictionary yet.");
    return;
  }

  els.output.textContent = output;
  const wordLabel = translatedCount === 1 ? "word" : "words";
  els.status.textContent = `Translated ${translatedCount} ${wordLabel}.`;
}

function onClear() {
  clearError();
  els.input.value = "";
  els.output.innerHTML =
    '<span class="output__placeholder">Your emoji translation appears here…</span>';
  els.status.textContent = "";
  els.input.focus();
}

els.translate.addEventListener("click", onTranslate);
els.clear.addEventListener("click", onClear);

/* Typing clears a stale warning so the form doesn't nag mid-edit. */
els.input.addEventListener("input", clearError);

/* Ctrl/Cmd+Enter is a handy shortcut to translate from the textarea. */
els.input.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    onTranslate();
  }
});
