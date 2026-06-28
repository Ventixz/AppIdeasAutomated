/* Quiz content. Each quiz is a list of questions; every question has four
   options and the index of the correct one. Kept in its own file so the data
   is easy to extend without touching the app logic. */
window.QUIZZES = [
  {
    id: "javascript",
    title: "JavaScript Basics",
    pass: 0.6,
    questions: [
      {
        q: "Which keyword declares a block-scoped variable that can be reassigned?",
        options: ["var", "let", "const", "static"],
        answer: 1,
      },
      {
        q: "What does `typeof null` evaluate to?",
        options: ['"null"', '"object"', '"undefined"', '"number"'],
        answer: 1,
      },
      {
        q: "Which method adds one or more elements to the end of an array?",
        options: ["push()", "shift()", "unshift()", "pop()"],
        answer: 0,
      },
      {
        q: "What is the result of `0.1 + 0.2 === 0.3`?",
        options: ["true", "false", "NaN", "TypeError"],
        answer: 1,
      },
      {
        q: "Which symbol starts a single-line comment in JavaScript?",
        options: ["#", "//", "<!--", "%%"],
        answer: 1,
      },
    ],
  },
  {
    id: "html-css",
    title: "HTML & CSS",
    pass: 0.6,
    questions: [
      {
        q: "Which tag creates a hyperlink?",
        options: ["<link>", "<a>", "<href>", "<nav>"],
        answer: 1,
      },
      {
        q: "Which CSS property controls the space inside an element's border?",
        options: ["margin", "spacing", "padding", "gap"],
        answer: 2,
      },
      {
        q: "What does the CSS `flex-direction: column` do?",
        options: [
          "Stacks flex items vertically",
          "Lays items in a row",
          "Centers items",
          "Reverses the page",
        ],
        answer: 0,
      },
      {
        q: "Which HTML element is best for the main page heading?",
        options: ["<head>", "<h6>", "<h1>", "<title>"],
        answer: 2,
      },
      {
        q: "Which unit is relative to the root font size?",
        options: ["px", "rem", "pt", "cm"],
        answer: 1,
      },
    ],
  },
  {
    id: "general",
    title: "General Knowledge",
    pass: 0.6,
    questions: [
      {
        q: "How many continents are there on Earth?",
        options: ["5", "6", "7", "8"],
        answer: 2,
      },
      {
        q: "What is the chemical symbol for water?",
        options: ["WO", "H2O", "O2", "H2"],
        answer: 1,
      },
      {
        q: "Which planet is known as the Red Planet?",
        options: ["Venus", "Jupiter", "Mars", "Saturn"],
        answer: 2,
      },
      {
        q: "Who wrote the play 'Romeo and Juliet'?",
        options: ["Charles Dickens", "Mark Twain", "Leo Tolstoy", "William Shakespeare"],
        answer: 3,
      },
      {
        q: "What is the largest ocean on Earth?",
        options: ["Atlantic", "Indian", "Arctic", "Pacific"],
        answer: 3,
      },
    ],
  },
];
