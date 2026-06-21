"use strict";

const jsonInput = document.getElementById("json");
const csvOutput = document.getElementById("csv");
const delimiterSelect = document.getElementById("delimiter");
const includeHeader = document.getElementById("header");
const warning = document.getElementById("warning");
const fileInput = document.getElementById("file");
const downloadBtn = document.getElementById("download");
const copyBtn = document.getElementById("copy");

const SAMPLE = `[
  { "name": "Ada Lovelace", "age": 36, "city": "London", "note": "first, programmer", "active": true },
  { "name": "Linus Torvalds", "age": 54, "city": "Portland", "note": "says \\"hello\\"", "active": false },
  { "name": "Grace Hopper", "age": 85, "city": "New York", "active": true }
]`;

/**
 * Quote a single CSV cell when it needs it. A field is wrapped in double
 * quotes if it contains the delimiter, a quote, or a newline; any embedded
 * quote is doubled per RFC 4180.
 */
function escapeCell(value, delimiter) {
  if (value === null || value === undefined) return "";
  let str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes('"') || str.includes(delimiter) || /[\r\n]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** Build the ordered union of keys across every record, first-seen order. */
function collectHeaders(records) {
  const headers = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
}

function jsonToCsv(records, delimiter, withHeader) {
  const headers = collectHeaders(records);
  const lines = [];

  if (withHeader) {
    lines.push(headers.map((h) => escapeCell(h, delimiter)).join(delimiter));
  }

  for (const record of records) {
    const cells = headers.map((key) => escapeCell(record[key], delimiter));
    lines.push(cells.join(delimiter));
  }

  return lines.join("\n");
}

function showWarning(message) {
  warning.textContent = message;
  warning.hidden = false;
}

function clearWarning() {
  warning.hidden = true;
  warning.textContent = "";
}

function setOutput(text) {
  csvOutput.value = text;
  const hasContent = text.length > 0;
  downloadBtn.disabled = !hasContent;
  copyBtn.disabled = !hasContent;
}

function convert() {
  clearWarning();
  setOutput("");

  const text = jsonInput.value.trim();
  if (!text) {
    showWarning("Paste some JSON first.");
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    showWarning("That isn't valid JSON: " + err.message);
    return;
  }

  // Accept either a single object or an array of objects.
  const records = Array.isArray(data) ? data : [data];
  if (records.length === 0) {
    showWarning("The JSON array is empty — nothing to convert.");
    return;
  }
  if (!records.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    showWarning("Expected an object or an array of objects.");
    return;
  }

  const delimiter = delimiterSelect.value === "\\t" ? "\t" : delimiterSelect.value;
  setOutput(jsonToCsv(records, delimiter, includeHeader.checked));
}

document.getElementById("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  convert();
});

document.getElementById("sample").addEventListener("click", () => {
  delimiterSelect.value = ",";
  includeHeader.checked = true;
  jsonInput.value = SAMPLE;
  convert();
});

document.getElementById("clear").addEventListener("click", () => {
  jsonInput.value = "";
  setOutput("");
  clearWarning();
  jsonInput.focus();
});

// "Open file…" — the browser equivalent of loading a JSON file from disk.
document.getElementById("open").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    jsonInput.value = reader.result;
    convert();
  };
  reader.onerror = () => showWarning("Couldn't read that file.");
  reader.readAsText(file);
  fileInput.value = ""; // allow re-selecting the same file
});

// "Save" — download the CSV instead of writing to a server-side path.
downloadBtn.addEventListener("click", () => {
  if (!csvOutput.value) return;
  const blob = new Blob([csvOutput.value], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.csv";
  a.click();
  URL.revokeObjectURL(url);
});

copyBtn.addEventListener("click", async () => {
  if (!csvOutput.value) return;
  try {
    await navigator.clipboard.writeText(csvOutput.value);
  } catch {
    csvOutput.select(); // fallback: select so the user can copy manually
    document.execCommand("copy");
  }
  csvOutput.classList.add("copied");
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    csvOutput.classList.remove("copied");
    copyBtn.textContent = "Copy";
  }, 1200);
});
