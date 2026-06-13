"use strict";

const form = document.getElementById("controls");
const dollarsInput = document.getElementById("dollars");
const warning = document.getElementById("warning");
const result = document.getElementById("result");
const totalCents = document.getElementById("total-cents");
const breakdown = document.getElementById("breakdown");

// Coin types, largest first — a greedy pass over these denominations yields the
// minimum number of US coins (the canonical system has no greedy edge cases).
const COINS = [
  { name: "Quarter", plural: "Quarters", value: 25 },
  { name: "Dime", plural: "Dimes", value: 10 },
  { name: "Nickel", plural: "Nickels", value: 5 },
  { name: "Penny", plural: "Pennies", value: 1 },
];

/**
 * Convert a dollar float to whole cents. Multiplying a float by 100 can land
 * on 274.99999…, so round to the nearest integer to stay exact.
 */
function toCents(dollars) {
  return Math.round(dollars * 100);
}

/** Greedily break a cent total into the fewest coins. */
function breakIntoCoins(cents) {
  let remaining = cents;
  return COINS.map((coin) => {
    const count = Math.floor(remaining / coin.value);
    remaining -= count * coin.value;
    return { ...coin, count };
  });
}

function showWarning(message) {
  warning.textContent = message;
  warning.hidden = false;
  result.hidden = true;
}

function clearWarning() {
  warning.hidden = true;
  warning.textContent = "";
}

function convert() {
  clearWarning();

  const raw = dollarsInput.value.trim();
  if (raw === "") {
    showWarning("Enter a dollar amount first.");
    return;
  }

  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) {
    showWarning("Enter a valid, non-negative dollar amount.");
    return;
  }

  const cents = toCents(dollars);
  totalCents.textContent = cents.toLocaleString();

  breakdown.innerHTML = "";
  for (const coin of breakIntoCoins(cents)) {
    const li = document.createElement("li");
    li.className = coin.count === 0 ? "coin empty" : "coin";
    li.innerHTML = `<span class="count">${coin.count}</span>` +
      `<span class="coin-name">${coin.count === 1 ? coin.name : coin.plural}</span>`;
    breakdown.appendChild(li);
  }

  result.hidden = false;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  convert();
});

document.getElementById("clear").addEventListener("click", () => {
  dollarsInput.value = "";
  result.hidden = true;
  clearWarning();
  dollarsInput.focus();
});
