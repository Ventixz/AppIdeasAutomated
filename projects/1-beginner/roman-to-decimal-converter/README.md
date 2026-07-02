# Roman to Decimal Converter

Type a number and watch it turn into a Roman numeral, or flip the direction and
decode a Roman numeral back to base 10. Conversion happens **live as you type**,
and malformed input is caught with a clear message.

Source idea: [app-ideas / Roman to Decimal Converter](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Roman-to-Decimal-Converter.md)

## Features

- **Roman → Decimal** — decode any Roman numeral to its value.
- **Live conversion** *(bonus)* — the output updates on every keystroke.
- **Bidirectional** *(bonus)* — a toggle flips to Decimal → Roman.
- **Strict validation** — rejects unknown symbols (e.g. `Q`) and malformed
  numerals like `IIII`, `IC`, or `VX`, not just bad characters.
- **Range guard** — Decimal → Roman covers `1`–`3999`, the classic range for
  the seven core symbols.

## How it works

`script.js` drives both directions from one largest-first table
(`M=1000 … I=1`). Decimal → Roman greedily subtracts each symbol's value.
Roman → Decimal scans left to right, subtracting a symbol when a larger one
follows it (`IV` → 4). Validity is enforced with a canonical regex
(`M{0,3}(CM|CD|D?C{0,3})…`) so only *well-formed* numerals convert — this is
what distinguishes `XIV` from `XIIII`. A round-trip check over every value from
1 to 3999 confirms the two functions are exact inverses.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
