/*
 * samples.js — a small starter set of quotes, so the page has something to
 * show on first load. Loaded only when the browser has no saved collection.
 */
"use strict";
var QUOTE_SAMPLES = [
  { text: "Simplicity is the soul of efficiency.", author: "Austin Freeman", tags: ["code", "wisdom"] },
  { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds", tags: ["code"] },
  { text: "Premature optimization is the root of all evil.", author: "Donald Knuth", tags: ["code", "wisdom"] },
  { text: "The journey of a thousand miles begins with a single step.", author: "Laozi", tags: ["wisdom", "motivation"] },
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde", tags: ["life", "funny"] },
  { text: "Whether you think you can, or you think you can't — you're right.", author: "Henry Ford", tags: ["motivation"] },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs", tags: ["work", "motivation"] },
  { text: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson", tags: ["code", "wisdom"] },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela", tags: ["motivation"] },
  { text: "Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.", author: "Antoine de Saint-Exupéry", tags: ["wisdom", "life"] }
];
if (typeof window !== "undefined") window.QUOTE_SAMPLES = QUOTE_SAMPLES;
