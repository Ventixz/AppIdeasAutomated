// Sprout — Product Landing Page interactions.
// Everything is client-side and simulated; no real network requests are made.
"use strict";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Show a status message on a <p> element. */
function setMsg(el, text, ok) {
  el.textContent = text;
  el.classList.toggle("ok", ok === true);
  el.classList.toggle("err", ok === false);
}

/** Toggle the `.invalid` class on a field. */
function mark(field, invalid) {
  field.classList.toggle("invalid", invalid);
}

// ===== Newsletter signup =====
const newsForm = document.getElementById("newsletter-form");
newsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("news-email");
  const msg = document.getElementById("newsletter-msg");
  const valid = EMAIL_RE.test(input.value.trim());
  mark(input, !valid);
  if (!valid) {
    setMsg(msg, "Please enter a valid email address.", false);
    return;
  }
  setMsg(msg, "You're on the list — watch your inbox! 🌱", true);
  newsForm.reset();
});

// ===== Contact form =====
const contactForm = document.getElementById("contact-form");
contactForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("c-name");
  const email = document.getElementById("c-email");
  const message = document.getElementById("c-message");
  const msg = document.getElementById("contact-msg");

  const nameOk = name.value.trim().length > 0;
  const emailOk = EMAIL_RE.test(email.value.trim());
  const messageOk = message.value.trim().length >= 5;

  mark(name, !nameOk);
  mark(email, !emailOk);
  mark(message, !messageOk);

  if (!nameOk || !emailOk || !messageOk) {
    setMsg(msg, "Please fill in your name, a valid email, and a short message.", false);
    return;
  }
  setMsg(msg, `Thanks, ${name.value.trim()}! We'll reply within one business day.`, true);
  contactForm.reset();
});

// ===== Simulated purchase =====
const cartStatus = document.getElementById("cart-status");
document.querySelectorAll(".buy").forEach((btn) => {
  btn.addEventListener("click", () => {
    const plan = btn.dataset.plan;
    const price = btn.dataset.price;
    setMsg(cartStatus, `Added ${plan} ($${price}) to your cart — checkout is on the way! 🛒`, true);
  });
});

// Clear field highlight as the user corrects it.
document.querySelectorAll("input, textarea").forEach((field) => {
  field.addEventListener("input", () => mark(field, false));
});
