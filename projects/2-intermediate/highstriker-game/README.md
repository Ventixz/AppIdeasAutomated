# HighStriker Game

A browser recreation of the classic carnival **strength-tester** — swing the
hammer, launch the puck up the tower, and ring the bell. As the spec calls for,
there's no real physics of force here: puck height comes from a **timing meter**
you stop plus a dash of **randomization**, so every strike is a little bit of
skill and a little bit of carnival luck. Vanilla JS, no build, no dependencies,
and all the sound effects are synthesized live with the Web Audio API — no audio
files.

Source idea: [app-ideas / HighStriker-Game](https://github.com/florinpop17/app-ideas/blob/master/Projects/2-Intermediate/HighStriker-Game.md)

## Running

Open `index.html` in any browser — nothing to install:

```bash
open projects/2-intermediate/highstriker-game/index.html
```

## How to play

1. Press **Strike!** — a power meter starts sweeping from empty to full and back.
2. Press **Strike!** again (or hit **Space**) to lock it in. Stop it near the top
   for maximum power.
3. The puck launches up the rail. Where it lands decides your points:
   the higher the zone, the more you score. Reach the very top and the **bell
   rings** for a full 5.
4. Get to **10 points** to win. Use **Clear** to reset the scores and play again.
5. Toggle 🔊 / 🔇 in the top-right to mute the sound effects.

## How it maps to the spec

| Spec item | Where it lives |
| --- | --- |
| Visual tower: bell, levered platform, connecting track | `.bell`, `.base`/`.pad`, `.rail` in `index.html` + `style.css` |
| 'Strike!' button launches the puck | `strikeBtn` → `strike()` → `launchPuck()` |
| Animate the puck along the rail | `launchPuck()` animates `puck.style.bottom` (up then settle down) |
| Bell sound when the puck reaches the top | `scoreSound(5)` — synthesized bell ding |
| Track successful bell strikes **and** total attempts | `state.bells` / `state.attempts`, shown in the scoreboard |
| 'Clear' button resets scores | `clearBtn` → `clearScores()` |
| Congratulatory message at 10 points | `WIN_SCORE` check in `resolveStrike()` → `winFanfare()` |
| **Bonus:** bell vibration animation when struck | `.bell.ring` keyframe animation |
| **Bonus:** scaled points by height (1–5) | `pointsForHeight()` implements the 1/8, 1/4, 1/2, 3/4, bell zones |
| **Bonus:** ascending sound as the puck rises | `ascendSound()` — pitch scales with height |
| **Bonus:** distinct audio per point value | `scoreSound()` plays a different tone set for 0–5 |

## How it works

- **Timing meter:** a value oscillates 0 → 1 → 0 via `requestAnimationFrame`.
  The player stops it, and `computeHeight()` blends that timing (weighted ~82%)
  with a random luck factor to land on a final normalized height `0..1`.
- **Scoring zones** follow the bonus spec exactly: `1/8–1/4` = 1 point,
  `1/4–1/2` = 2, `1/2–3/4` = 3, `3/4–bell` = 4, a full bell strike = 5. Below
  1/8 is a whiff worth nothing.
- **All audio is synthesized** — `tone()` builds oscillator + gain envelopes on
  the fly, so the bell, the rising whoosh, each point-value chime, and the win
  fanfare need zero asset files. Audio only starts after a user gesture (browser
  autoplay policy) and can be muted.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tower, scoreboard, meter, and controls |
| `style.css`  | Carnival styling, puck/bell/pad animations |
| `script.js`  | Timing meter, height + scoring logic, Web Audio sound effects |

---

Built by an automated [Claude Code](https://claude.com/claude-code) routine as
day 49 of working through [florinpop17/app-ideas](https://github.com/florinpop17/app-ideas).
