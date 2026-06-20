"use strict";

// --- Validators -------------------------------------------------------------
// Each returns "" when valid, or an error message string when invalid.

// Username: letters only, no spaces, at least one character.
function validateUsername(value) {
  if (value.length === 0) return "Username is required.";
  if (!/^[A-Za-z]+$/.test(value)) return "Only letters are allowed — no spaces, digits or symbols.";
  return "";
}

// Email: must be a @gmail.com address.
function validateEmail(value) {
  if (value.length === 0) return "Email is required.";
  if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(value)) return "Must be a valid @gmail.com address.";
  return "";
}

// Password: exactly 5 capital letters, 6 symbols, 2 hyphens — and nothing else.
function validatePassword(value) {
  if (value.length === 0) return "Password is required.";

  const capitals = value.match(/[A-Z]/g) || [];
  const hyphens = value.match(/-/g) || [];
  // "Symbols" = anything that isn't a letter, digit, hyphen or whitespace.
  const symbols = value.match(/[^A-Za-z0-9\s-]/g) || [];

  // Reject anything outside the three allowed categories (lowercase, digits, spaces…).
  if (capitals.length + hyphens.length + symbols.length !== value.length) {
    return "Only capital letters, symbols and hyphens are allowed.";
  }
  if (capitals.length !== 5) return `Needs exactly 5 capital letters (has ${capitals.length}).`;
  if (symbols.length !== 6) return `Needs exactly 6 symbols (has ${symbols.length}).`;
  if (hyphens.length !== 2) return `Needs exactly 2 hyphens (has ${hyphens.length}).`;
  return "";
}

// --- Wiring -----------------------------------------------------------------

const fields = [
  { id: "username", validate: validateUsername },
  { id: "email", validate: validateEmail },
  { id: "password", validate: validatePassword },
];

function setupDom() {
  const form = document.getElementById("form");
  const submit = document.getElementById("submit");
  const success = document.getElementById("success");

  function checkField(field, { showEmptyError = true } = {}) {
    const input = document.getElementById(field.id);
    const errorEl = document.getElementById(`${field.id}-error`);
    const message = field.validate(input.value.trim());
    const isValid = message === "";

    // Don't nag with "required" on an untouched empty field.
    const showError = message && (showEmptyError || input.value.trim() !== "");
    errorEl.textContent = showError ? message : "";

    input.classList.toggle("valid", isValid && input.value.trim() !== "");
    input.classList.toggle("invalid", Boolean(showError));
    return isValid;
  }

  function refresh() {
    const allValid = fields.every((f) => checkField(f, { showEmptyError: false }));
    submit.disabled = !allValid;
    if (allValid) success.hidden = true;
  }

  fields.forEach((field) => {
    document.getElementById(field.id).addEventListener("input", refresh);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // On explicit submit, surface every outstanding error.
    const allValid = fields.map((f) => checkField(f, { showEmptyError: true })).every(Boolean);
    submit.disabled = !allValid;
    success.hidden = !allValid;
  });

  refresh();
}

if (typeof document !== "undefined") {
  setupDom();
}

// Expose validators for sanity checks / reuse.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateUsername, validateEmail, validatePassword };
}
