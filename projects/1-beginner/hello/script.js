"use strict";

// --- DOM references -------------------------------------------------------
const form = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const langOverride = document.getElementById("lang-override");
const loginBtn = document.getElementById("login-btn");

const resultPanel = document.getElementById("result");
const greetingEl = document.getElementById("greeting");
const geoDetails = document.getElementById("geo-details");
const logoutBtn = document.getElementById("logout-btn");
const farewell = document.getElementById("farewell");

// --- HTML-entity decoding -------------------------------------------------
// The HelloSalut API returns greetings with HTML entities (e.g. the French
// "Bonjour" or accented characters arrive encoded). Decode them by letting the
// browser parse the markup through a detached <textarea>.
function decodeHtmlEntities(str) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = str;
  return textarea.value;
}

// --- Validation -----------------------------------------------------------
function setError(input, message) {
  const errEl = document.querySelector(`.field__error[data-for="${input.id}"]`);
  if (message) {
    input.classList.add("invalid");
    if (errEl) errEl.textContent = message;
  } else {
    input.classList.remove("invalid");
    if (errEl) errEl.textContent = "";
  }
}

function validate() {
  let ok = true;
  if (!usernameInput.value.trim()) {
    setError(usernameInput, "Please enter a username.");
    ok = false;
  } else {
    setError(usernameInput, "");
  }
  if (!passwordInput.value.trim()) {
    setError(passwordInput, "Please enter a password.");
    ok = false;
  } else {
    setError(passwordInput, "");
  }
  return ok;
}

// Clear an error the moment the user starts typing.
[usernameInput, passwordInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (input.value.trim()) setError(input, "");
  });
});

// --- Data fetching --------------------------------------------------------
// ipapi.co is a CORS-enabled, HTTPS equivalent of the ip-api service named in
// the spec. It returns the visitor's IP and full geolocation in one call,
// which we use both for the bonus details panel and to pick a language code.
async function fetchGeo() {
  const res = await fetch("https://ipapi.co/json/");
  if (!res.ok) throw new Error(`Geolocation lookup failed (${res.status})`);
  return res.json();
}

// HelloSalut returns the word "hello" in a language. With ?lang= we ask for a
// specific language; with ?ip=auto it infers from the caller's IP.
async function fetchGreeting({ lang }) {
  const url = lang
    ? `https://fourtonfish.com/hellosalut/?lang=${encodeURIComponent(lang)}`
    : "https://fourtonfish.com/hellosalut/?ip=auto";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greeting lookup failed (${res.status})`);
  const data = await res.json();
  return decodeHtmlEntities(data.hello || "Hello");
}

// --- Bonus: render geolocation details ------------------------------------
function renderGeo(geo) {
  const rows = [
    ["IP", geo.ip],
    ["City", geo.city],
    ["Region", geo.region],
    ["Country", geo.country_name],
    ["ZIP", geo.postal],
    ["Coordinates", geo.latitude != null ? `${geo.latitude}, ${geo.longitude}` : ""],
    ["Timezone", geo.timezone],
  ];
  geoDetails.innerHTML = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
}

// --- Login / logout flow --------------------------------------------------
async function handleLogin(event) {
  event.preventDefault();
  if (!validate()) return;

  const username = usernameInput.value.trim();
  const override = langOverride.value.trim();

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in…";

  try {
    let lang = override;
    geoDetails.innerHTML = "";

    // Pull geolocation for the bonus panel, and use it to derive a language
    // code when the user hasn't supplied an override.
    try {
      const geo = await fetchGeo();
      renderGeo(geo);
      if (!lang && geo.languages) lang = geo.languages.split(",")[0].split("-")[0];
    } catch (geoErr) {
      console.warn("Geo lookup skipped:", geoErr.message);
    }

    const hello = await fetchGreeting({ lang });

    greetingEl.textContent = `${hello} ${username} you have successfully logged in!`;
    form.classList.add("hidden");
    resultPanel.classList.remove("hidden");
    farewell.classList.add("hidden");
  } catch (err) {
    setError(passwordInput, err.message || "Something went wrong. Try again.");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
  }
}

function handleLogout() {
  const username = usernameInput.value.trim() || "friend";
  farewell.textContent = `Have a great day ${username}!`;
  farewell.classList.remove("hidden");

  // Clear fields and return to the login panel.
  usernameInput.value = "";
  passwordInput.value = "";
  langOverride.value = "";
  setError(usernameInput, "");
  setError(passwordInput, "");

  resultPanel.classList.add("hidden");
  form.classList.remove("hidden");
}

form.addEventListener("submit", handleLogin);
logoutBtn.addEventListener("click", handleLogout);
