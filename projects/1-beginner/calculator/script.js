// Calculator — no eval(), 8-digit display limit, decimals to 3 places.

const MAX_DIGITS = 8;
const MAX_DECIMALS = 3;

const displayEl = document.getElementById("display");
const pad = document.querySelector(".pad");

// --- State ---------------------------------------------------------------
let displayValue = "0"; // what the user currently sees
let firstOperand = null; // the stored left-hand operand
let operator = null; // pending operator, e.g. "+"
let waitingForSecond = false; // true right after an operator is pressed
let errored = false; // true once "ERR" is shown (only AC recovers)

// --- Helpers -------------------------------------------------------------
const countDigits = (str) => str.replace(/[^0-9]/g, "").length;

function render() {
  displayEl.textContent = displayValue;
  displayEl.classList.toggle("error", errored);
}

// Round to MAX_DECIMALS and reject anything wider than MAX_DIGITS.
// Returns a string, or null if the value cannot fit on the display.
function format(num) {
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS;
  const str = String(rounded);
  if (str.includes("e") || countDigits(str) > MAX_DIGITS) return null;
  return str;
}

function calculate(a, b, op) {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? null : a / b;
    default: return b;
  }
}

function showError() {
  displayValue = "ERR";
  firstOperand = null;
  operator = null;
  waitingForSecond = false;
  errored = true;
  clearActiveOp();
  render();
}

function clearActiveOp() {
  pad.querySelectorAll(".key-op.active").forEach((k) => k.classList.remove("active"));
}

function markActiveOp(op) {
  clearActiveOp();
  const key = pad.querySelector(`.key-op[data-op="${op}"]`);
  if (key) key.classList.add("active");
}

// --- Input handlers ------------------------------------------------------
function inputDigit(digit) {
  if (errored) return;

  if (waitingForSecond) {
    displayValue = digit;
    waitingForSecond = false;
    return;
  }

  if (displayValue === "0") {
    displayValue = digit;
    return;
  }

  if (countDigits(displayValue) >= MAX_DIGITS) return; // ignore overflow

  const dot = displayValue.indexOf(".");
  if (dot !== -1 && displayValue.length - dot - 1 >= MAX_DECIMALS) return;

  displayValue += digit;
}

function inputDecimal() {
  if (errored) return;

  if (waitingForSecond) {
    displayValue = "0.";
    waitingForSecond = false;
    return;
  }

  if (!displayValue.includes(".")) displayValue += ".";
}

function inputOperator(nextOp) {
  if (errored) return;

  // Pressing a second operator just swaps the pending one.
  if (operator !== null && waitingForSecond) {
    operator = nextOp;
    markActiveOp(nextOp);
    return;
  }

  const value = parseFloat(displayValue);

  if (firstOperand === null) {
    firstOperand = value;
  } else if (operator) {
    const result = calculate(firstOperand, value, operator);
    const formatted = result === null ? null : format(result);
    if (formatted === null) return showError();
    displayValue = formatted;
    firstOperand = result;
  }

  operator = nextOp;
  waitingForSecond = true;
  markActiveOp(nextOp);
}

function inputEquals() {
  if (errored || operator === null || waitingForSecond) return;

  const result = calculate(firstOperand, parseFloat(displayValue), operator);
  const formatted = result === null ? null : format(result);
  if (formatted === null) return showError();

  displayValue = formatted;
  firstOperand = null;
  operator = null;
  waitingForSecond = true; // next digit starts a fresh entry
  clearActiveOp();
}

function toggleSign() {
  if (errored || displayValue === "0") return;
  displayValue = displayValue.startsWith("-")
    ? displayValue.slice(1)
    : "-" + displayValue;
}

// C — clear the last entry. If the last thing pressed was an operator,
// cancel it and fall back to the value that preceded it.
function clearEntry() {
  if (errored) return;

  if (waitingForSecond && operator !== null) {
    operator = null;
    waitingForSecond = false;
    displayValue = firstOperand === null ? "0" : String(firstOperand);
    clearActiveOp();
    return;
  }

  displayValue = "0";
}

// AC — wipe every work area.
function allClear() {
  displayValue = "0";
  firstOperand = null;
  operator = null;
  waitingForSecond = false;
  errored = false;
  clearActiveOp();
}

// --- Wiring --------------------------------------------------------------
pad.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.digit !== undefined) {
    inputDigit(btn.dataset.digit);
  } else {
    switch (btn.dataset.action) {
      case "decimal": inputDecimal(); break;
      case "operator": inputOperator(btn.dataset.op); break;
      case "equals": inputEquals(); break;
      case "sign": toggleSign(); break;
      case "clear": clearEntry(); break;
      case "all-clear": allClear(); break;
    }
  }

  render();
});

render();
