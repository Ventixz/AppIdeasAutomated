"use strict";

// Classic Vigenère cipher over the 26 letters A–Z, implemented with plain
// character arithmetic — no libraries, per the project spec.
//
// Each alphabetic character of the message is shifted by the amount given by
// the corresponding letter of the (repeating) keyword. Non-letters — spaces,
// punctuation, digits — pass through untouched and do NOT consume a key letter,
// so the keyword stays aligned with the letters it actually enciphers.
const A = "A".charCodeAt(0);

// Keep only the letters from the raw keyword and upper-case them. Returns an
// array of shift amounts (0–25), or an empty array if the key has no letters.
function keyShifts(rawKey) {
  const letters = rawKey.toUpperCase().replace(/[^A-Z]/g, "");
  return [...letters].map((ch) => ch.charCodeAt(0) - A);
}

// direction: +1 to encrypt, -1 to decrypt. Mixed case is preserved.
function transform(text, rawKey, direction) {
  const shifts = keyShifts(rawKey);
  if (shifts.length === 0) return null; // signal "no usable key"

  let k = 0; // index into the keyword, advanced only on letters
  let out = "";

  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;

    if (!isUpper && !isLower) {
      out += ch; // pass through, key position unchanged
      continue;
    }

    const base = isUpper ? 65 : 97;
    const shift = shifts[k % shifts.length];
    // +26 keeps the value non-negative before the modulo when decrypting.
    const shifted = (code - base + direction * shift + 26) % 26;
    out += String.fromCharCode(base + shifted);
    k += 1;
  }

  return out;
}

const encrypt = (text, key) => transform(text, key, +1);
const decrypt = (text, key) => transform(text, key, -1);

// --- Wiring -----------------------------------------------------------------

const form = document.getElementById("form");
const messageEl = document.getElementById("message");
const keyEl = document.getElementById("key");
const encryptBtn = document.getElementById("encrypt");
const decryptBtn = document.getElementById("decrypt");
const compareBtn = document.getElementById("compare");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");

// Remember the message that was encrypted and the ciphertext produced, so the
// Decrypt and Compare steps can reference the original run.
let lastPlaintext = "";
let lastCiphertext = "";

function setStatus(message, kind) {
  statusEl.textContent = message || "";
  statusEl.className = "status" + (kind ? " is-" + kind : "");
}

function showResult(text) {
  resultEl.textContent = text;
}

// Decrypt and Compare only make sense after a successful Encrypt; a fresh edit
// to the inputs invalidates that state.
function resetChain() {
  decryptBtn.disabled = true;
  compareBtn.hidden = true;
  lastPlaintext = "";
  lastCiphertext = "";
}

function doEncrypt() {
  const key = keyEl.value;
  const cipher = encrypt(messageEl.value, key);

  if (cipher === null) {
    setStatus("Enter a keyword with at least one letter (A–Z).", "warn");
    return;
  }

  lastPlaintext = messageEl.value;
  lastCiphertext = cipher;
  showResult(cipher);
  setStatus("Encrypted. Press Decrypt to reverse it.", "ok");
  decryptBtn.disabled = false;
  compareBtn.hidden = true;
}

function doDecrypt() {
  // Decrypt the ciphertext we produced, using the current keyword. If the key
  // was changed after encrypting, the round-trip will (correctly) not match —
  // which is exactly what Compare is there to reveal.
  const plain = decrypt(lastCiphertext, keyEl.value);
  if (plain === null) {
    setStatus("Enter a keyword with at least one letter (A–Z).", "warn");
    return;
  }
  showResult(plain);
  setStatus("Decrypted. Press Compare to verify the round-trip.", "ok");
  compareBtn.hidden = false;
}

function doCompare() {
  const plain = decrypt(lastCiphertext, keyEl.value);
  if (plain === lastPlaintext) {
    setStatus("✓ Match — the decrypted text equals the original message.", "ok");
  } else {
    setStatus(
      "✗ Mismatch — decrypted text differs from the original " +
        "(did the keyword change after encrypting?).",
      "warn"
    );
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  doEncrypt();
});
decryptBtn.addEventListener("click", doDecrypt);
compareBtn.addEventListener("click", doCompare);

// Editing either input starts a new cipher session.
[messageEl, keyEl].forEach((el) => el.addEventListener("input", resetChain));
