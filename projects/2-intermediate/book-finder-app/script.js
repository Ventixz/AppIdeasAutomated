"use strict";

// Book Finder — queries the free, key-less Open Library Search API.
// Docs: https://openlibrary.org/dev/docs/api/search

const API_URL = "https://openlibrary.org/search.json";
const COVER_URL = "https://covers.openlibrary.org/b/id"; // /{id}-M.jpg
const RESULT_LIMIT = 24;

const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const searchBy = document.getElementById("search-by");
const statusEl = document.getElementById("status");
const loader = document.getElementById("loader");
const results = document.getElementById("results");
const button = form.querySelector(".search__button");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (!query) {
    setStatus("Type something to search for.", "error");
    return;
  }
  searchBooks(query, searchBy.value);
});

async function searchBooks(query, field) {
  toggleLoading(true);
  results.innerHTML = "";
  setStatus(`Searching for “${query}”…`);

  // The API accepts field-scoped params (title, author, subject) or a generic `q`.
  const params = new URLSearchParams({ limit: String(RESULT_LIMIT) });
  params.set(field, query);

  try {
    const response = await fetch(`${API_URL}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Open Library responded with ${response.status}`);
    }
    const data = await response.json();
    renderBooks(data.docs || [], query, data.numFound || 0);
  } catch (error) {
    setStatus(`Something went wrong: ${error.message}`, "error");
  } finally {
    toggleLoading(false);
  }
}

function renderBooks(books, query, total) {
  if (books.length === 0) {
    setStatus(`No books found for “${query}”. Try another query.`);
    return;
  }

  const shown = Math.min(books.length, RESULT_LIMIT);
  setStatus(`Showing ${shown} of ${total.toLocaleString()} results for “${query}”.`);

  const fragment = document.createDocumentFragment();
  books.forEach((book) => fragment.appendChild(createBookCard(book)));
  results.appendChild(fragment);
}

function createBookCard(book) {
  const li = document.createElement("li");
  li.className = "book";

  const title = book.title || "Untitled";
  const author = (book.author_name && book.author_name.join(", ")) || "Unknown author";
  const year = book.first_publish_year ? String(book.first_publish_year) : "—";
  const workUrl = book.key ? `https://openlibrary.org${book.key}` : null;

  // Cover image (bonus: loading is native lazy-load) or an emoji placeholder.
  if (book.cover_i) {
    const img = document.createElement("img");
    img.className = "book__cover";
    img.loading = "lazy";
    img.alt = `Cover of ${title}`;
    img.src = `${COVER_URL}/${book.cover_i}-M.jpg`;
    li.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "book__cover book__cover--placeholder";
    placeholder.textContent = "📖";
    placeholder.setAttribute("aria-hidden", "true");
    li.appendChild(placeholder);
  }

  const body = document.createElement("div");
  body.className = "book__body";

  const h2 = document.createElement("h2");
  h2.className = "book__title";
  if (workUrl) {
    const link = document.createElement("a");
    link.href = workUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = title;
    h2.appendChild(link);
  } else {
    h2.textContent = title;
  }

  const authorP = document.createElement("p");
  authorP.className = "book__meta";
  authorP.innerHTML = `<strong>${escapeHtml(author)}</strong>`;

  const yearP = document.createElement("p");
  yearP.className = "book__meta";
  yearP.textContent = `First published: ${year}`;

  body.append(h2, authorP, yearP);

  // Bonus: external link to more info on Open Library.
  if (workUrl) {
    const more = document.createElement("a");
    more.className = "book__link";
    more.href = workUrl;
    more.target = "_blank";
    more.rel = "noopener";
    more.textContent = "More info →";
    body.appendChild(more);
  }

  li.appendChild(body);
  return li;
}

function toggleLoading(isLoading) {
  loader.hidden = !isLoading;
  button.disabled = isLoading;
  button.textContent = isLoading ? "Searching…" : "Search";
}

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind === "error" ? "status status--error" : "status";
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
