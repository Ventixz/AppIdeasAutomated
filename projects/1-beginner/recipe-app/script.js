// Recipe App — renders a list of recipe titles, and shows the selected
// recipe as a card. A small search box filters the list by title or meal type.
(function () {
  "use strict";

  const listEl = document.getElementById("recipe-list");
  const cardArea = document.getElementById("card-area");
  const searchEl = document.getElementById("search");
  const noResults = document.getElementById("no-results");

  let selectedId = null;

  // Escape user/data text before dropping it into innerHTML.
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // --- List ---------------------------------------------------------------
  function renderList(filter) {
    const query = (filter || "").trim().toLowerCase();
    const matches = RECIPES.filter(function (r) {
      return (
        !query ||
        r.title.toLowerCase().includes(query) ||
        r.mealType.toLowerCase().includes(query)
      );
    });

    listEl.innerHTML = "";
    noResults.hidden = matches.length > 0;

    matches.forEach(function (recipe) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = recipe.id === selectedId ? "active" : "";
      btn.innerHTML =
        '<span class="dot">' +
        esc(recipe.emoji) +
        '</span><span class="name">' +
        esc(recipe.title) +
        '</span><span class="meta">' +
        esc(recipe.mealType) +
        "</span>";
      btn.addEventListener("click", function () {
        select(recipe.id);
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  // --- Card ---------------------------------------------------------------
  function renderCard(recipe) {
    if (!recipe) {
      cardArea.innerHTML =
        '<div class="empty"><span class="big">👨‍🍳</span>' +
        "Pick a recipe from the list to see the full card.</div>";
      return;
    }

    const ingredients = recipe.ingredients
      .map(function (ing) {
        return (
          '<li><span class="amount">' +
          esc(ing.amount) +
          '</span><span class="item">' +
          esc(ing.item) +
          "</span></li>"
        );
      })
      .join("");

    const steps = recipe.steps
      .map(function (step) {
        return "<li>" + esc(step) + "</li>";
      })
      .join("");

    cardArea.innerHTML =
      '<article class="card">' +
      '<div class="card-hero">' +
      esc(recipe.emoji) +
      "</div>" +
      '<div class="card-body">' +
      "<h2>" +
      esc(recipe.title) +
      "</h2>" +
      '<div class="badges">' +
      '<span class="badge">' +
      esc(recipe.mealType) +
      "</span>" +
      '<span class="badge">Serves ' +
      esc(recipe.servings) +
      "</span>" +
      '<span class="badge">' +
      esc(recipe.minutes) +
      " min</span>" +
      '<span class="badge diff-' +
      esc(recipe.difficulty) +
      '">' +
      esc(recipe.difficulty) +
      "</span>" +
      "</div>" +
      '<h3 class="section-title">Ingredients</h3>' +
      '<ul class="ingredients">' +
      ingredients +
      "</ul>" +
      '<h3 class="section-title">Preparation</h3>' +
      '<ol class="steps">' +
      steps +
      "</ol>" +
      "</div>" +
      "</article>";
  }

  // --- Selection ----------------------------------------------------------
  function select(id) {
    selectedId = id;
    const recipe = RECIPES.find(function (r) {
      return r.id === id;
    });
    renderCard(recipe);
    // Re-render the list so the active highlight follows the selection,
    // preserving the current search filter.
    renderList(searchEl.value);
  }

  // --- Wire up ------------------------------------------------------------
  searchEl.addEventListener("input", function () {
    renderList(searchEl.value);
  });

  renderList("");
  renderCard(null);
})();
