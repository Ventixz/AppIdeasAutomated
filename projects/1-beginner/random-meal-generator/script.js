"use strict";

const RANDOM_MEAL_URL = "https://www.themealdb.com/api/json/v1/1/random.php";

const area = document.getElementById("meal-area");
const button = document.getElementById("generate");

/** Escape text before it is placed into innerHTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * TheMealDB returns ingredients/measures as flat numbered fields
 * (strIngredient1..20, strMeasure1..20). Pair them up, skipping blanks.
 */
function extractIngredients(meal) {
  const pairs = [];
  for (let i = 1; i <= 20; i += 1) {
    const ingredient = (meal[`strIngredient${i}`] || "").trim();
    const measure = (meal[`strMeasure${i}`] || "").trim();
    if (ingredient) {
      pairs.push({ ingredient, measure });
    }
  }
  return pairs;
}

/** Pull the 11-char video id out of any YouTube watch URL. */
function youTubeId(url) {
  const match = /[?&]v=([\w-]{11})/.exec(url || "");
  return match ? match[1] : null;
}

function renderLoading() {
  area.innerHTML =
    '<div class="loading"><span class="spinner"></span>Plating up a random meal…</div>';
}

function renderError(message) {
  area.innerHTML =
    '<div class="error"><span class="big">😞</span>' +
    escapeHtml(message) +
    "</div>";
}

function renderMeal(meal) {
  const ingredients = extractIngredients(meal);
  const ingredientRows = ingredients
    .map(
      ({ ingredient, measure }) =>
        `<li><span class="amount">${escapeHtml(measure || "—")}</span>` +
        `<span>${escapeHtml(ingredient)}</span></li>`
    )
    .join("");

  const badges = [meal.strCategory, meal.strArea]
    .filter(Boolean)
    .map((text) => `<span class="badge">${escapeHtml(text)}</span>`)
    .join("");

  const videoId = youTubeId(meal.strYoutube);
  const videoBlock = videoId
    ? '<p class="section-title">Watch it made</p>' +
      `<div class="video"><iframe src="https://www.youtube.com/embed/${escapeHtml(
        videoId
      )}" title="${escapeHtml(
        meal.strMeal
      )} video" loading="lazy" allowfullscreen></iframe></div>`
    : "";

  area.innerHTML =
    '<article class="card">' +
    `<div class="card-hero"><img src="${escapeHtml(
      meal.strMealThumb
    )}" alt="${escapeHtml(meal.strMeal)}" /></div>` +
    '<div class="card-body">' +
    `<h2>${escapeHtml(meal.strMeal)}</h2>` +
    `<div class="badges">${badges}</div>` +
    '<p class="section-title">Ingredients</p>' +
    `<ul class="ingredients">${ingredientRows}</ul>` +
    '<p class="section-title">Instructions</p>' +
    `<p class="instructions">${escapeHtml(
      (meal.strInstructions || "").trim()
    )}</p>` +
    videoBlock +
    "</div>" +
    "</article>";
}

async function generateMeal() {
  button.disabled = true;
  renderLoading();
  try {
    const response = await fetch(RANDOM_MEAL_URL);
    if (!response.ok) {
      throw new Error(`Request failed (HTTP ${response.status}).`);
    }
    const data = await response.json();
    const meal = data && data.meals && data.meals[0];
    if (!meal) {
      throw new Error("The API didn't return a meal. Try again.");
    }
    renderMeal(meal);
  } catch (err) {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    renderError(
      offline
        ? "You appear to be offline — this app needs a connection to TheMealDB."
        : `Couldn't fetch a meal: ${err.message}`
    );
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", generateMeal);
