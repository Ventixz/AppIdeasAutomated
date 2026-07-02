const form = document.getElementById("form");
const input = document.getElementById("input");
const output = document.getElementById("output");
const errorEl = document.getElementById("error");
const inLabel = document.getElementById("inLabel");
const outLabel = document.getElementById("outLabel");
const toRomanBtn = document.getElementById("toRoman");
const toDecimalBtn = document.getElementById("toDecimal");

// Largest-first table drives both directions.
const NUMERALS = [
  ["M", 1000], ["CM", 900], ["D", 500], ["CD", 400],
  ["C", 100], ["XC", 90], ["L", 50], ["XL", 40],
  ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1],
];
const VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

// Canonical Roman numerals for 1–3999. Rejects things like IIII, IC, or VX.
const CANONICAL = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

let mode = "dec2rom"; // or "rom2dec"

function decimalToRoman(n) {
  let out = "";
  for (const [symbol, value] of NUMERALS) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

function romanToDecimal(roman) {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = VALUE[roman[i]];
    const next = VALUE[roman[i + 1]];
    // Subtractive pair: a smaller symbol before a larger one is a negative.
    if (next && current < next) total -= current;
    else total += current;
  }
  return total;
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  output.textContent = "—";
  output.classList.add("empty");
}

function clearAndBlank() {
  errorEl.hidden = true;
  output.textContent = "—";
  output.classList.add("empty");
}

function render(text) {
  errorEl.hidden = true;
  output.classList.remove("empty");
  output.textContent = text;
  output.classList.remove("pop");
  void output.offsetWidth; // restart the pop animation each time
  output.classList.add("pop");
}

function convert() {
  const raw = input.value.trim();
  if (raw === "") return clearAndBlank();

  if (mode === "dec2rom") {
    if (!/^\d+$/.test(raw)) {
      return showError("Enter a whole number (digits only).");
    }
    const n = parseInt(raw, 10);
    if (n < 1 || n > 3999) {
      return showError("Roman numerals here cover 1 to 3999.");
    }
    render(decimalToRoman(n));
  } else {
    const roman = raw.toUpperCase();
    const bad = roman.match(/[^IVXLCDM]/);
    if (bad) {
      return showError(`"${bad[0]}" isn't a Roman numeral symbol.`);
    }
    if (!CANONICAL.test(roman)) {
      return showError("That isn't a valid Roman numeral — check the order and repeats.");
    }
    render(String(romanToDecimal(roman)));
  }
}

function setMode(newMode) {
  mode = newMode;
  const decMode = mode === "dec2rom";

  toRomanBtn.classList.toggle("active", decMode);
  toDecimalBtn.classList.toggle("active", !decMode);

  inLabel.textContent = decMode ? "Decimal (1–3999)" : "Roman numeral";
  outLabel.textContent = decMode ? "Roman numeral" : "Decimal";
  input.placeholder = decMode ? "e.g. 2026" : "e.g. MMXXVI";

  input.value = "";
  clearAndBlank();
  input.focus();
}

toRomanBtn.addEventListener("click", () => setMode("dec2rom"));
toDecimalBtn.addEventListener("click", () => setMode("rom2dec"));

// Bonus: convert live as the user types.
input.addEventListener("input", convert);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  convert();
});
