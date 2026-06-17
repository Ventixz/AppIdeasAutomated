// GitHub publishes its service status through a Statuspage.io-powered JSON API.
// The spec suggests the NPM `request` package; in the browser the native
// `fetch` is the direct equivalent, and the endpoint is CORS-enabled so a
// static page can read it with no server or proxy.
const SUMMARY_URL = "https://www.githubstatus.com/api/v2/summary.json";

const btn = document.getElementById("get-status-btn");
const statusEl = document.getElementById("status");
const overallEl = document.getElementById("overall");
const listEl = document.getElementById("components");
const updatedEl = document.getElementById("updated");

// Statuspage exposes a handful of status strings; map each to a label, an
// emoji and a CSS modifier so non-operational components stand out (bonus).
const STATUS_META = {
  operational:         { label: "Operational",          icon: "✔", cls: "ok" },
  degraded_performance:{ label: "Degraded Performance",  icon: "⚠", cls: "warn" },
  partial_outage:      { label: "Partial Outage",        icon: "⚠", cls: "warn" },
  major_outage:        { label: "Major Outage",          icon: "✖", cls: "down" },
  under_maintenance:   { label: "Under Maintenance",     icon: "⚙", cls: "maint" },
};

function metaFor(status) {
  return STATUS_META[status] || { label: status, icon: "•", cls: "warn" };
}

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function render(data) {
  // Overall banner.
  const desc = data.status?.description || "Status unknown";
  const indicator = data.status?.indicator || "none";
  overallEl.textContent = desc;
  overallEl.className = "overall " + (indicator === "none" ? "ok" : "warn");

  // The API nests groups and their child components in a flat array; we only
  // show the top-level, named components (skip the group containers).
  const components = (data.components || []).filter(
    (c) => !c.group && c.name && c.name.toLowerCase() !== "visit www.githubstatus.com for more information"
  );

  listEl.innerHTML = "";
  for (const c of components) {
    const meta = metaFor(c.status);
    const li = document.createElement("li");
    li.className = "component " + meta.cls;
    li.innerHTML =
      '<span class="dot" aria-hidden="true"></span>' +
      '<span class="name"></span>' +
      '<span class="state"><span class="icon" aria-hidden="true"></span>' +
      '<span class="state-label"></span></span>';
    li.querySelector(".name").textContent = c.name;
    li.querySelector(".icon").textContent = meta.icon;
    li.querySelector(".state-label").textContent = meta.label;
    listEl.appendChild(li);
  }

  const when = data.page?.updated_at ? new Date(data.page.updated_at) : new Date();
  updatedEl.textContent = "Last updated " + when.toLocaleString();
}

async function getStatus() {
  btn.disabled = true;
  setStatus("Fetching the latest status…");
  try {
    const res = await fetch(SUMMARY_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    render(data);
    setStatus("", "");
  } catch (err) {
    // Most failures here are network/offline; surface it plainly.
    setStatus("Could not reach the GitHub Status API. Check your connection and try again.", "error");
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener("click", getStatus);

// Fetch once on load so the page is useful immediately.
getStatus();
