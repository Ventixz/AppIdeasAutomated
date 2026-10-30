# Recipe Creator and Manager

> Source 2 (karan/Projects) · **Classes (Object-Oriented Programming)** · project 6 of 10
> Built by an automated [Claude Code](https://claude.com/claude-code) routine.

**The task (karan/Projects):** *"Create a recipe class with ingredients. Then
create a manager that can store these recipes and categorise them — for example
by category (dessert, main course) or by their main ingredient."*

Like every task in this category, the point is the **design**, not the feature
list. "Store recipes and categorise them" is one sentence that hides the three
things a naive version gets wrong.

## The design in three ideas

### 1. A quantity is an exact amount *with a unit* — not a float

`1 cup` plus `2 tbsp` is a real, exact sum. Scaling a 4-serving recipe to 6
multiplies every amount by exactly `6/4 = 3/2`, so `1½ cup` of flour becomes
exactly `2¼ cup` — never `2.2499999`. Amounts are **exact rationals over
`BigInt`**, and units convert by **exact ratios** (`1 cup = 236.5882365 ml`, to
the last digit, from the definition `1 gallon = 3.785411784 L`). The payoff is a
property you can test: scale a recipe up and back down and you get the recipe you
started with — floats drift, this doesn't.

Un-measured ingredients ("salt, to taste") are a real thing recipes have, and a
`null` quantity models them honestly — they are never silently treated as zero or
dropped, and scaling leaves them alone.

### 2. The manager's categories are a *derived index*, not a second copy

The brief's "categorise by category **or** by main ingredient" is the trap: the
naive manager keeps a list of recipes **and** per-category lists **and**
per-ingredient lists, and the day one is updated and another isn't, the views
disagree. Here the recipes are the single source of truth; the by-category,
by-ingredient and by-main-ingredient indexes are **rebuilt from them and kept in
lock-step on every add and remove**. A lookup can never show a recipe the book no
longer holds — and a test proves it, by asserting the live indexes always equal a
full rebuild (`_reindex()`), before and after a removal.

Because the indexes exist, `search({ category, ingredients, text })` is served by
intersecting index hits, not by scanning every recipe.

### 3. "What can I make?" is unit-aware and *honest*

Given a `Pantry` (what's at home), the manager reports which recipes are
makeable, comparing **quantities** in a shared unit. Crucially, it refuses to
guess across incompatible dimensions: you cannot convert grams to millilitres
without a density the recipe doesn't carry, so "6 tomatoes" against a recipe
asking for "800 g tomatoes" comes back **can't compare** — not a silent pass or a
silent fail. Each ingredient gets one of four verdicts:

| Verdict | Meaning |
| --- | --- |
| **have** | enough is in the pantry (converting units within a dimension as needed) |
| **to-taste** | the recipe line has no measured amount and the item is present |
| **missing** | the item isn't in the pantry at all |
| **short** | it's there, but not enough |
| **incomparable** | it's there in a unit that doesn't convert to the recipe's |

## The classes

| Class | Kind | Responsibility |
| --- | --- | --- |
| `Rational` | value object | an exact fraction over `BigInt`; the arithmetic quantities are built on |
| `Quantity` | value object | an exact amount + a unit; converts/adds/compares within a dimension, refuses across |
| `Ingredient` | value object | one recipe line: an item, an optional `Quantity`, an optional note |
| `Recipe` | entity | title, category, servings, ingredients, steps; scales itself exactly; knows its main ingredient |
| `Pantry` | aggregate | what's at home (item → quantity); answers whether it `satisfies` an ingredient |
| `RecipeBook` | aggregate | stores recipes; owns the derived category/ingredient indexes; searches; answers "what can I make?" |
| `Units` | helper | the unit table (mass/volume/count) and exact conversion ratios |

## Run it

No dependencies, no build step.

```bash
# the engine's proof suite (94 checks)
node tests.js

# the sample cookbook, grouped by category
node recipe-node.js

# grouped by main ingredient, or as JSON, or "what can I make?"
node recipe-node.js --by-ingredient
node recipe-node.js --json
node recipe-node.js --make

# drive it with piped commands
echo "show pancakes; scale pancakes 8; find flour eggs; make" | node recipe-node.js
```

Open **`index.html`** in a browser for the visual version: browse the cookbook
grouped by category or by main ingredient, filter by title or ingredient, open a
recipe and **scale it live** to any number of servings (the amounts rescale
exactly), and see the pantry's "what can I make?" verdicts update as you stock it.

## Files

- `recipe-core.js` — the engine: `Rational`, `Quantity`/`Units`, `Ingredient`,
  `Recipe`, `Pantry`, `RecipeBook`. DOM-free, no dependencies.
- `recipe-fixtures.js` — a sample cookbook and pantry shared by all three front ends.
- `recipe-node.js` — the CLI.
- `tests.js` — 94 dependency-free assertions over the design's guarantees.
- `index.html` / `script.js` / `style.css` — the browser front end.

---

*Part of [AppIdeasAutomated](../../../README.md) — one project a day, built by an
automated Claude Code routine.*
