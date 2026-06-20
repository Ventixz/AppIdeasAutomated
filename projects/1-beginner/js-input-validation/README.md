# JS Input Validation

A dependency-free sign-up form that validates three fields **live with RegEx**.
The submit button stays disabled until every field is valid, and each field
shows its own inline error message.

Source idea: [app-ideas / Javascript Validation With Regex](https://github.com/florinpop17/app-ideas/blob/master/Projects/1-Beginner/Javascript-Validation-With-Regex.md)

## Validation rules

| Field | Rule | RegEx |
| --- | --- | --- |
| Username | Letters only, no spaces | `/^[A-Za-z]+$/` |
| Email | Must be a `@gmail.com` address | `/^[A-Za-z0-9._%+-]+@gmail\.com$/i` |
| Password | Exactly **5 capital letters**, **6 symbols** and **2 hyphens** — in any order, nothing else | `/[A-Z]/g`, `/[^A-Za-z0-9\s-]/g`, `/-/g` |

The password rule counts each category with a `match` and rejects anything that
falls outside the three allowed groups (lowercase letters, digits and spaces are
all invalid), so the total length must be exactly 13 characters.

## User stories implemented

- Invalid inputs show an error message right under the field.
- The **Create account** button is disabled until all three inputs pass.

## Extras

- **Live validation** on every keystroke, with green/red border feedback.
- Errors only appear once a field has been touched, so an untouched form isn't
  covered in red — but pressing submit surfaces every outstanding error at once.
- Validators are exported via `module.exports` so they can be unit-tested in
  Node (see the sanity checks used while building this).

## Run it

Open `index.html` in any browser — no build step, no dependencies.

Example of a valid password: `ABCDE!@#$%^--`
