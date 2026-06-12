"use strict";

const csvInput = document.getElementById("csv");
const jsonOutput = document.getElementById("json");
const delimiterSelect = document.getElementById("delimiter");
const castNumbers = document.getElementById("numbers");
const warning = document.getElementById("warning");
const copyBtn = document.getElementById("copy");

const SAMPLE = `name,age,city,active
"Ada Lovelace",36,London,true
"Torvalds, Linus",54,Portland,false
"Grace Hopper",85,"New York",true`;

/**
 * Parse CSV text into an array of row arrays. Implements the RFC-4180 rules
 * by hand: fields may be wrapped in double quotes, a doubled "" inside a
 * quoted field is a literal quote, and quoted fields may contain the
 * delimiter or newlines.
 */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else { inQuotes = false; }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  // Flush the trailing field/row (no terminating newline).
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Coerce a raw string cell into a number/boolean/null when it clearly is one. */
function coerce(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  // Only treat as a number if the whole token is numeric (no "12abc").
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

function showWarning(message) {
  warning.textContent = message;
  warning.hidden = false;
}

function clearWarning() {
  warning.hidden = true;
  warning.textContent = "";
}

function convert() {
  clearWarning();
  jsonOutput.value = "";
  copyBtn.disabled = true;

  const text = csvInput.value.trim();
  if (!text) {
    showWarning("Paste some CSV first.");
    return;
  }

  const delimiter = delimiterSelect.value === "\\t" ? "\t" : delimiterSelect.value;
  const rows = parseCsv(text, delimiter).filter((r) => r.length && r.some((c) => c !== ""));

  if (rows.length < 2) {
    showWarning("Need a header row and at least one data row.");
    return;
  }

  const headers = rows[0].map((h) => h.trim());
  if (headers.some((h) => h === "")) {
    showWarning("Header row has a blank column name.");
    return;
  }

  const records = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((key, idx) => {
      const raw = cells[idx] !== undefined ? cells[idx] : "";
      obj[key] = castNumbers.checked ? coerce(raw) : raw;
    });
    return obj;
  });

  jsonOutput.value = JSON.stringify(records, null, 2);
  copyBtn.disabled = false;
}

document.getElementById("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  convert();
});

document.getElementById("sample").addEventListener("click", () => {
  delimiterSelect.value = ",";
  csvInput.value = SAMPLE;
  convert();
});

document.getElementById("clear").addEventListener("click", () => {
  csvInput.value = "";
  jsonOutput.value = "";
  copyBtn.disabled = true;
  clearWarning();
  csvInput.focus();
});

copyBtn.addEventListener("click", async () => {
  if (!jsonOutput.value) return;
  try {
    await navigator.clipboard.writeText(jsonOutput.value);
  } catch {
    jsonOutput.select(); // fallback: select so the user can copy manually
    document.execCommand("copy");
  }
  jsonOutput.classList.add("copied");
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    jsonOutput.classList.remove("copied");
    copyBtn.textContent = "Copy";
  }, 1200);
});
