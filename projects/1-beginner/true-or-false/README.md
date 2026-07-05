# TrueOrFalse

Enter two values and a JavaScript comparison operator, and see whether the
expression evaluates to **TRUE** or **FALSE** — a hands-on way to build
intuition for conditionals, coercion, and truthiness.

Source idea: [app-ideas / TrueOrFalse](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/True-or-False-App.md)

## Features

- **Two values + an operator** — type a left value, a right value, and one of
  `=== !== == != > < >= <=`.
- **Live TRUE / FALSE** — the result recomputes as you edit any field.
- **Echoed expression** — the exact comparison being evaluated is shown above the
  result (strings quoted, numbers/booleans bare) so there's no ambiguity.
- **Validation warnings** — an unrecognized operator, or a value that doesn't fit
  its declared type, shows a warning instead of a result.
- **Typed operands** *(bonus)* — mark each value as **String**, **Number**, or
  **Boolean**, so you can compare `"1"` to `1`, `0` to `false`, and watch loose
  vs. strict equality diverge.

## How it works

Each operand's text is coerced into a real JavaScript primitive according to its
declared type. The operator is then applied through a lookup table of actual
language operators:

```js
const OPERATORS = {
  "===": (a, b) => a === b,
  "==":  (a, b) => a == b,
  // …
};
```

Because the comparison uses genuine `===`/`==`/`<` operators rather than string
evaluation, the results match JavaScript's own rules exactly — including the
coercion quirks of loose equality. **`eval()` is never used**, per the project
spec; an unknown operator simply isn't in the table and triggers a warning.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
