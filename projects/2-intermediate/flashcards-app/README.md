# Flashcards App

Study one random flashcard at a time: read the question, pick from four
multiple-choice answers, and get instant feedback. The three wrong choices are
pulled at random from *other* cards in the deck — never a fixed list — exactly
as the spec asks.

Source idea: [app-ideas / FlashCards App](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/FlashCards-App.md)

## Running

Open `index.html` in any browser — no build, no dependencies:

```bash
open projects/2-intermediate/flashcards-app/index.html
```

## How to use

1. A random card appears with a question and options **A–D**.
2. Click an answer (or press **1–4**). Correct picks turn green, wrong picks
   red, and the right answer is always highlighted.
3. Hit **Next Question** (or **Enter / →**) for another random card.
4. **More Info** flips the card to reveal a supplementary note; **Results**
   tallies your correct/incorrect score; **Shuffle** re-randomises the deck;
   **Reset** clears the score.

## How it maps to the spec

| Spec user story | Where it lives |
| --- | --- |
| View randomly selected cards | `shuffled()` order + `nextCard()` in `script.js` |
| Question with four lettered options | `showCard()` renders A–D buttons |
| Click to select answers | `onAnswer()` click handler |
| Error message on a wrong answer | `feedback--err` branch in `onAnswer()` |
| Congratulations on a correct answer | `feedback--ok` branch in `onAnswer()` |
| 'Next Question' button | `#next` → `nextCard()` |
| **Bonus:** Results tally | `#results` → `showResults()` |
| **Bonus:** Reset score | `#reset` → `resetScore()` |
| **Bonus:** Shuffle the deck | `#shuffle` → `shuffleDeck()` |
| **Bonus:** More Info flips the card | `#more-info` → `toggleInfo()` |
| Knowledge base is a JS object | `DECK` array in `deck.js` |
| Wrong options drawn from other cards | `buildOptions()` in `script.js` |

## How it works

- **`deck.js`** holds the knowledge base as a plain JavaScript array of card
  objects (`question`, `answer`, `info`). Wrong answers are deliberately *not*
  stored — they are generated per render.
- **`buildOptions(i)`** takes the correct answer for card `i` and three
  distractors chosen at random from the *other* cards' answers, then shuffles
  all four so the correct slot is unpredictable.
- **State** is kept minimal: a shuffled `order` array of deck indices, a `pos`
  cursor that wraps around the deck, and running `correct` / `attempts`
  counters. The deck array itself is never mutated.
- **Accessibility:** the card region is `aria-live`, feedback is a `role=status`
  region, and keys **1–4** / **Enter** drive the whole flow without a mouse.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Card layout, option list, and the action buttons |
| `style.css`  | Dark, card-based responsive layout |
| `deck.js`    | The flashcard knowledge base (JS object) |
| `script.js`  | Card selection, option generation, scoring, bonus controls |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 45 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
