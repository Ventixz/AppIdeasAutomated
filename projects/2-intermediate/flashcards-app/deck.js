/*
 * The knowledge base for the flashcards app.
 *
 * Per the spec, the deck is a plain JavaScript object (an array of card
 * objects). Each card carries the question, the single correct answer, and an
 * optional `info` blurb revealed by the "More Info" button. The three *wrong*
 * options for any card are NOT stored here — they are drawn at random from the
 * correct answers of other cards in the deck at render time (see script.js).
 */
const DECK = [
  {
    question: "Which HTML element holds the metadata of a document?",
    answer: "<head>",
    info: "The <head> holds <title>, <meta>, <link>, and <script> tags — content the browser uses but does not render in the page body.",
  },
  {
    question: "What does CSS stand for?",
    answer: "Cascading Style Sheets",
    info: "The 'cascade' is the algorithm that resolves which rule wins when several target the same element.",
  },
  {
    question: "Which array method creates a new array from the results of a callback?",
    answer: "map()",
    info: "map() returns a new array of the same length; forEach() returns undefined and is used only for side effects.",
  },
  {
    question: "What keyword declares a block-scoped variable that cannot be reassigned?",
    answer: "const",
    info: "const prevents reassignment of the binding, but the referenced object can still be mutated.",
  },
  {
    question: "Which HTTP method is typically used to create a new resource?",
    answer: "POST",
    info: "POST is neither safe nor idempotent — sending it twice usually creates two resources.",
  },
  {
    question: "What data structure works on a Last-In-First-Out basis?",
    answer: "Stack",
    info: "The call stack that tracks running functions is a real-world example of a LIFO stack.",
  },
  {
    question: "Which Git command uploads local commits to a remote?",
    answer: "git push",
    info: "git push sends commits; git pull fetches remote commits and merges them into your branch.",
  },
  {
    question: "In JSON, how do you represent an absence of value?",
    answer: "null",
    info: "JSON has no `undefined` — only null, booleans, numbers, strings, arrays, and objects.",
  },
  {
    question: "Which CSS property controls the space *inside* an element's border?",
    answer: "padding",
    info: "padding is inside the border, margin is outside it — the box model orders content, padding, border, margin.",
  },
  {
    question: "What is the time complexity of binary search on a sorted array?",
    answer: "O(log n)",
    info: "Each comparison halves the search space, so n elements take about log2(n) steps.",
  },
  {
    question: "Which SQL clause filters rows before grouping?",
    answer: "WHERE",
    info: "WHERE filters individual rows; HAVING filters groups produced by GROUP BY.",
  },
  {
    question: "What does the DOM stand for?",
    answer: "Document Object Model",
    info: "The DOM is the in-memory tree of nodes the browser builds from your HTML and exposes to JavaScript.",
  },
];
