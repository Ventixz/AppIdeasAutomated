// Password Generator — vanilla JS, no dependencies.
// Uses the Web Crypto API (crypto.getRandomValues) for cryptographically
// strong randomness instead of Math.random().

const CHARSETS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?/~",
};

const el = {
  output: document.getElementById("output"),
  length: document.getElementById("length"),
  lengthValue: document.getElementById("lengthValue"),
  uppercase: document.getElementById("uppercase"),
  lowercase: document.getElementById("lowercase"),
  numbers: document.getElementById("numbers"),
  symbols: document.getElementById("symbols"),
  error: document.getElementById("error"),
  status: document.getElementById("status"),
  generate: document.getElementById("generate"),
  copy: document.getElementById("copy"),
  strengthFill: document.getElementById("strengthFill"),
  strengthLabel: document.getElementById("strengthLabel"),
};

let currentPassword = "";
let statusTimer = null;

// Return an unbiased random integer in [0, max) using rejection sampling so
// that no character is more likely than any other.
function randomInt(max) {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

// Fisher–Yates shuffle using our unbiased randomInt.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function selectedSets() {
  return ["uppercase", "lowercase", "numbers", "symbols"].filter(
    (k) => el[k].checked
  );
}

function generate() {
  const length = Number(el.length.value);
  const sets = selectedSets();

  if (sets.length === 0) {
    showError("Select at least one character type.");
    return;
  }
  clearError();

  // Guarantee at least one character from every selected set, then fill the
  // rest from the combined pool, and finally shuffle so the guaranteed
  // characters are not stuck at the front.
  const pool = sets.map((k) => CHARSETS[k]).join("");
  const chars = [];

  for (const k of sets) {
    const set = CHARSETS[k];
    chars.push(set[randomInt(set.length)]);
  }
  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)]);
  }
  // If length is shorter than the number of selected sets, trim.
  chars.length = length;

  currentPassword = shuffle(chars).join("");
  el.output.textContent = currentPassword;
  updateStrength(currentPassword, pool.length);
}

// Estimate strength from entropy = length * log2(poolSize).
// Buckets follow common guidance (< 40 weak, < 60 fair, < 80 good, else strong).
function updateStrength(password, poolSize) {
  const entropy = password.length * Math.log2(poolSize || 1);
  let label, color, pct;

  if (entropy < 40) {
    label = "Weak";
    color = "var(--weak)";
  } else if (entropy < 60) {
    label = "Fair";
    color = "var(--fair)";
  } else if (entropy < 80) {
    label = "Good";
    color = "var(--good)";
  } else {
    label = "Strong";
    color = "var(--strong)";
  }
  pct = Math.max(6, Math.min(100, (entropy / 100) * 100));

  el.strengthFill.style.width = pct + "%";
  el.strengthFill.style.backgroundColor = color;
  el.strengthLabel.textContent = `${label} · ${Math.round(entropy)} bits`;
  el.strengthLabel.style.color = color;
}

async function copyToClipboard() {
  if (!currentPassword) {
    showError("Generate a password first.");
    return;
  }
  clearError();
  try {
    await navigator.clipboard.writeText(currentPassword);
    flashStatus("Copied to clipboard ✓");
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = currentPassword;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      flashStatus("Copied to clipboard ✓");
    } catch {
      showError("Couldn't copy — select and copy manually.");
    }
    document.body.removeChild(ta);
  }
}

function showError(msg) {
  el.error.textContent = msg;
}
function clearError() {
  el.error.textContent = "";
}
function flashStatus(msg) {
  el.status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.status.textContent = ""), 2000);
}

// Wire up events.
el.length.addEventListener("input", () => {
  el.lengthValue.textContent = el.length.value;
});
el.generate.addEventListener("click", generate);
el.copy.addEventListener("click", copyToClipboard);

// Generate one on load so the app is immediately useful.
generate();
