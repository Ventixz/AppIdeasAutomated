# Vigenère Cipher

Encrypt a message with a keyword using the classical **Vigenère cipher**, then
decrypt it back to prove the round-trip. A hands-on introduction to
polyalphabetic substitution and modular arithmetic on the alphabet.

Source idea: [app-ideas / Vigenère Cipher](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Vigenere-Cipher.md)

## Features

- **Message + keyword** — type any text and a keyword, then press **Encrypt**.
- **Guarded flow** — **Decrypt** stays disabled until you've encrypted; editing
  either field resets the chain so the buttons can't act on stale state.
- **Round-trip decryption** — **Decrypt** reverses the ciphertext back to the
  original message.
- **Compare** *(bonus)* — after decrypting, a **Compare** button verifies the
  decrypted text against the original and reports a ✓ match or a ✗ mismatch
  (e.g. if the keyword was changed between encrypting and decrypting).
- **Case preserved, punctuation untouched** — upper/lower case survives the
  round-trip, and non-letters (spaces, digits, punctuation) pass through
  unchanged without consuming a key letter.

## How it works

Each letter is shifted by the amount given by the matching letter of the
repeating keyword — `A`→0, `B`→1, … `Z`→25 — using plain character arithmetic,
**no libraries**, per the project spec:

```js
const shift = shifts[k % shifts.length];      // 0..25 from the keyword
const shifted = (code - base + dir * shift + 26) % 26;   // dir: +1 encrypt, -1 decrypt
```

The key index `k` only advances on actual letters, so the keyword stays aligned
with the characters it enciphers even when the message contains spaces or
punctuation. Decryption is the same operation with the shift subtracted; the
`+ 26` before the modulo keeps the result non-negative.

Because encryption and decryption are exact inverses, decrypting with the same
keyword always reproduces the original — which is what **Compare** checks.

## Run it

Open `index.html` in any browser — no build step, no dependencies.
