<!--
CHANGELOG (newest on top)
2026-10-31 · v1.0
  WHAT: Seeded CLAUDE.md — bankroll/unit rules, promo rules, pick-qualifying test, house style.
  WHY:  Cloud sessions have no memory of Lee's unit size or betting rules; every session re-guessed ($2.50 units, $100 promo stakes).
  NOTE: clasp ignores .md files, so this never reaches Apps Script. Keep Config.js stake defaults in sync with the Bankroll section.
-->

# MLB-BOIZ — rules for Claude

Owner: Lee (AI-BOIZ). Google Apps Script + Sheets pipeline, deployed with clasp from Windows/VS Code.

## Bankroll & units (authoritative)

- **1u = $5.** Ladder: 1u / 2u / 3u = **$5 / $10 / $15**. **3u is the max bet.**
- **Bankroll: $1,000.** Max slate exposure: **10% ($100)** across one slate.
- **Always talk in units**, with $ in parentheses — e.g. "2u ($10)".
- Promo caps (e.g. "$100 max wager") are DraftKings' ceiling, **not a target**. Size promo bets on the unit ladder unless Lee says otherwise.
- Don't volunteer Kelly math unless asked. Give the unit recommendation; Lee decides.
- Mirrors `Config.js`: `BANKROLL`, `STAKE_TIER_1/2/3_USD`, `MAX_SLATE_EXPOSURE_PCT`. If one changes, change the other.

## Betting philosophy

- `PICK_BY = outcome`: back the side most likely to **win**. Being right beats chasing theoretical value.
- **The market is the model when we don't have one.** No StatEngine for a sport/market → use sharp-book no-vig price as model P; don't borrow NBA/MLB calibrated gates.
- **Leg-qualifying test (pick'em / props):** keep a leg only if the sharp book prices that side **−125 or stronger at the same line (~55% no-vig)**, or the pick'em line is **≥ 0.5 softer** than the book. Never pad an entry with a weak leg — play fewer picks.
- Profit boosts: favor plus-money **singles** on main markets; SGPs eat boosts (20–35% hold). Boost only works if the legs are ≥ ~53% each.
- Never fabricate lines, players, or game times. If live data is blocked, say so and name the blocked host.

## Delivering picks (Lee is usually on his phone)

Every bet must include: **full player name, team, opponent, game time (ET / CT), line, side, units.** One card per promo, short, scannable. Flag anything already locked.

## Code conventions

- Deliver **complete, cut-and-paste-ready files** — never snippets.
- **Every file created or edited carries an in-file CHANGELOG comment block**, newest on top: date, version, WHAT, WHY, NOTE. Seed v1.0 on new files; append on edits; never delete prior entries. (clasp doesn't push .md, so the changelog lives in code comments.)
- `buildConfigTab()` rewrites the whole ⚙️ Config tab from defaults (only `SLATE_DATE` survives) — warn Lee before telling him to re-run it.
- Secrets live in Script Properties (`ODDS_API_KEY`, `ANTHROPIC_API_KEY`), never in cells or the repo.
- Cloud sessions: live odds need `api.the-odds-api.com` allowed in the environment network settings and `ODDS_API_KEY` set as an env var.

## Working style

Collaborator, not yes-man: push back, lead with the better version, hold a position when right. No padding, no end-of-response summaries, one good option over five.
