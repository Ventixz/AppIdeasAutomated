"use strict";

/*
 * Currency Converter — app-ideas Tier 2 (Intermediate)
 *
 * Live rates come from the free, key-less open.er-api.com endpoint. If the
 * network is unavailable the app falls back to a small bundled snapshot of
 * USD-based rates so it still works fully offline.
 */

// Human-readable names, used to build the sorted dropdowns.
const CURRENCY_NAMES = {
  AUD: "Australian Dollar", BRL: "Brazilian Real", CAD: "Canadian Dollar",
  CHF: "Swiss Franc", CNY: "Chinese Yuan", CZK: "Czech Koruna",
  DKK: "Danish Krone", EUR: "Euro", GBP: "British Pound",
  HKD: "Hong Kong Dollar", HUF: "Hungarian Forint", ILS: "Israeli Shekel",
  INR: "Indian Rupee", JPY: "Japanese Yen", KRW: "South Korean Won",
  MXN: "Mexican Peso", NOK: "Norwegian Krone", NZD: "New Zealand Dollar",
  PLN: "Polish Zloty", RUB: "Russian Ruble", SEK: "Swedish Krona",
  SGD: "Singapore Dollar", THB: "Thai Baht", TRY: "Turkish Lira",
  USD: "US Dollar", ZAR: "South African Rand",
};

// Offline fallback: approximate rates relative to 1 USD.
const FALLBACK_RATES = {
  USD: 1, EUR: 0.92, GBP: 0.79, JPY: 157.2, AUD: 1.51, CAD: 1.37,
  CHF: 0.90, CNY: 7.25, HKD: 7.81, NZD: 1.64, SEK: 10.6, NOK: 10.7,
  DKK: 6.87, PLN: 3.98, CZK: 23.1, HUF: 361.0, RUB: 89.0, INR: 83.4,
  BRL: 5.45, ZAR: 18.4, SGD: 1.35, KRW: 1360.0, MXN: 18.3, TRY: 32.6,
  THB: 36.5, ILS: 3.71,
};

const MAX_DIGITS = 9;

const els = {
  amount: document.getElementById("amount"),
  from: document.getElementById("from"),
  to: document.getElementById("to"),
  swap: document.getElementById("swap"),
  error: document.getElementById("error"),
  resultAmount: document.getElementById("resultAmount"),
  resultRate: document.getElementById("resultRate"),
  status: document.getElementById("status"),
};

let rates = null; // USD-based { CODE: number }

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// --- Setup -----------------------------------------------------------------

function fillDropdown(select, codes, selected) {
  select.innerHTML = "";
  codes.forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} — ${CURRENCY_NAMES[code] || code}`;
    if (code === selected) opt.selected = true;
    select.appendChild(opt);
  });
}

function buildDropdowns(codes) {
  const sorted = [...codes].sort(); // sorted alphabetically per the spec
  fillDropdown(els.from, sorted, sorted.includes("USD") ? "USD" : sorted[0]);
  fillDropdown(els.to, sorted, sorted.includes("EUR") ? "EUR" : sorted[1]);
}

async function loadRates() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.result !== "success" || !data.rates) {
      throw new Error("bad payload");
    }
    // Keep only currencies we have display names for.
    rates = {};
    Object.keys(CURRENCY_NAMES).forEach((code) => {
      if (typeof data.rates[code] === "number") rates[code] = data.rates[code];
    });
    const when = data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toUTCString()
      : "just now";
    setStatus(`Live rates · updated ${when}`);
  } catch (err) {
    rates = { ...FALLBACK_RATES };
    setStatus("Offline — using bundled fallback rates (approximate).", true);
  }
  buildDropdowns(Object.keys(rates));
  convert();
}

// --- Conversion ------------------------------------------------------------

function parseAmount(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "Enter an amount." };

  // Count digits only (ignore a single decimal point) against the 9-digit cap.
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount > MAX_DIGITS) {
    return { error: `Amount can be at most ${MAX_DIGITS} digits.` };
  }
  if (!/^\d*\.?\d+$/.test(trimmed) && !/^\d+\.?\d*$/.test(trimmed)) {
    return { error: "Enter a valid number (digits only)." };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: "Enter a valid number." };
  if (value < 0) return { error: "Amount cannot be negative." };
  return { value };
}

function convert() {
  if (!rates) return;

  const { value, error } = parseAmount(els.amount.value);
  if (error) {
    showError(error);
    els.resultAmount.textContent = "—";
    els.resultRate.textContent = "";
    return;
  }
  clearError();

  const from = els.from.value;
  const to = els.to.value;
  // Cross rate via the USD base: amount / rate(from) * rate(to).
  const usd = value / rates[from];
  const converted = usd * rates[to];
  const rate = rates[to] / rates[from];

  els.resultAmount.textContent = `${money.format(converted)} ${to}`;
  els.resultRate.textContent =
    `${money.format(value)} ${from} · 1 ${from} = ${money.format(rate)} ${to}`;
}

// --- Error + status helpers -------------------------------------------------

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
  els.amount.classList.add("invalid");
}

function clearError() {
  els.error.textContent = "";
  els.error.hidden = true;
  els.amount.classList.remove("invalid");
}

function setStatus(msg, isErr = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("err", isErr);
}

function swap() {
  const from = els.from.value;
  els.from.value = els.to.value;
  els.to.value = from;
  convert();
}

// --- Wire up ---------------------------------------------------------------

els.amount.addEventListener("input", convert);
els.from.addEventListener("change", convert);
els.to.addEventListener("change", convert);
els.swap.addEventListener("click", swap);

loadRates();
