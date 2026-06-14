"use strict";

const VALID_USER = "testuser";
const VALID_PASS = "mypassword";

// Each validation state maps to a set of CSS-variable values. The script never
// writes a literal color onto an element — it only flips these custom
// properties and lets the stylesheet decide what they mean.
const STATES = {
  ok:     { "--field-bg": "#ffffff", "--field-border": "transparent", "--field-scale": "1" },
  spaces: { "--field-bg": "#fff6cc", "--field-border": "#e0b400",     "--field-scale": "1.02" },
  error:  { "--field-bg": "#ffd6d6", "--field-border": "#ff5d73",     "--field-scale": "1.02" },
};

const form = document.getElementById("login");
const userInput = document.getElementById("userid");
const passInput = document.getElementById("password");
const warning = document.getElementById("warning");

function applyState(input, state) {
  const vars = STATES[state];
  for (const [name, value] of Object.entries(vars)) {
    input.style.setProperty(name, value);
  }
}

function resetFields() {
  for (const input of [userInput, passInput]) {
    applyState(input, "ok");
  }
  warning.hidden = true;
  warning.textContent = "";
  warning.classList.remove("success");
}

// Returns the field's state and a human message, in priority order:
// spaces beat value mismatches, which beat an empty field.
function evaluate(value, expected, label) {
  if (/\s/.test(value)) {
    return { state: "spaces", message: `${label} must not contain spaces.` };
  }
  if (value.length === 0) {
    return { state: "error", message: `${label} is required.` };
  }
  if (value !== expected) {
    return { state: "error", message: `${label} is incorrect.` };
  }
  return { state: "ok", message: "" };
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const userResult = evaluate(userInput.value, VALID_USER, "User ID");
  const passResult = evaluate(passInput.value, VALID_PASS, "Password");

  applyState(userInput, userResult.state);
  applyState(passInput, passResult.state);

  const messages = [userResult.message, passResult.message].filter(Boolean);

  if (messages.length === 0) {
    warning.hidden = false;
    warning.textContent = "Login successful — welcome, testuser!";
    warning.classList.add("success");
  } else {
    warning.hidden = false;
    warning.classList.remove("success");
    warning.textContent = messages.join(" ");
  }
});

// The Cancel button is a native reset; clear the fields and repaint to white.
form.addEventListener("reset", () => {
  // Let the browser clear the inputs first, then reset the variables.
  setTimeout(resetFields, 0);
});

resetFields();
