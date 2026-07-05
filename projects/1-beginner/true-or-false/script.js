"use strict";

// The set of comparison operators we accept. Each is applied with a *real*
// JavaScript operator inside a switch — never eval() — so the truthiness and
// coercion rules match the language exactly.
const OPERATORS = {
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
  "==": (a, b) => a == b, // eslint-disable-line eqeqeq
  "!=": (a, b) => a != b, // eslint-disable-line eqeqeq
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  ">=": (a, b) => a >= b,
  "<=": (a, b) => a <= b,
};

// Turn the raw text into a typed primitive matching the chosen type, or return
// an error describing why the input is not valid for that type.
function coerce(raw, type) {
  switch (type) {
    case "string":
      return { value: raw };
    case "number": {
      if (raw.trim() === "") return { error: "an empty number" };
      const n = Number(raw);
      if (Number.isNaN(n) && raw.trim().toLowerCase() !== "nan") {
        return { error: `"${raw}" is not a number` };
      }
      return { value: n };
    }
    case "boolean": {
      const t = raw.trim().toLowerCase();
      if (t === "true") return { value: true };
      if (t === "false") return { value: false };
      return { error: `"${raw}" is not a boolean (use true or false)` };
    }
    default:
      return { error: `unknown type "${type}"` };
  }
}

// Render a typed primitive the way it would appear in source code, so the
// echoed expression is unambiguous (strings get quotes, numbers/booleans don't).
function display(value, type) {
  if (type === "string") return JSON.stringify(value);
  return String(value);
}

const form = document.getElementById("form");
const leftEl = document.getElementById("left");
const rightEl = document.getElementById("right");
const leftTypeEl = document.getElementById("leftType");
const rightTypeEl = document.getElementById("rightType");
const operatorEl = document.getElementById("operator");
const expressionEl = document.getElementById("expression");
const resultEl = document.getElementById("result");

function showWarning(message) {
  expressionEl.textContent = "";
  resultEl.className = "result is-warning";
  resultEl.textContent = "⚠ " + message;
}

function evaluate() {
  const op = operatorEl.value.trim();
  const compare = OPERATORS[op];

  if (!compare) {
    showWarning(
      op === ""
        ? "Enter a comparison operator."
        : `"${op}" is not a valid comparison operator.`
    );
    return;
  }

  const left = coerce(leftEl.value, leftTypeEl.value);
  const right = coerce(rightEl.value, rightTypeEl.value);

  if (left.error) return showWarning(`Left value: ${left.error}.`);
  if (right.error) return showWarning(`Right value: ${right.error}.`);

  const result = compare(left.value, right.value);

  expressionEl.textContent =
    `${display(left.value, leftTypeEl.value)} ${op} ` +
    `${display(right.value, rightTypeEl.value)}`;
  expressionEl.setAttribute("aria-hidden", "false");

  resultEl.className = "result " + (result ? "is-true" : "is-false");
  resultEl.textContent = result ? "TRUE" : "FALSE";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  evaluate();
});

// Re-evaluate live as the user tweaks any field, but only once a result has
// already been shown — so the placeholder greets a fresh visitor.
[leftEl, rightEl, operatorEl, leftTypeEl, rightTypeEl].forEach((el) => {
  el.addEventListener("input", () => {
    if (!resultEl.querySelector(".placeholder")) evaluate();
  });
});
