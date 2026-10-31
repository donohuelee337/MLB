<!--
CHANGELOG (newest on top)
2026-10-31 · v1.2
  WHAT: Added live NBA-BOIZ Drive data folder as the primary pick source + card-reading rules (💎, SUSPECT, pick'em leg selection, boost-on-alt-rung rule).
  WHY:  Live NBA work isn't in any GitHub repo; it lives in Drive. Tout-sourced picks contradicted the model on 4 of 6 legs today.
  NOTE: Drive text files come back base64; nba_card.json is ~150KB — parse with get_file_metadata MAX_ALLOWED snippet + jq/python, unescape markdown backslashes.
2026-10-31 · v1.1
  WHAT: Added NBA AI-BOIZ rules section (gates, singles band, card shape, SGP/parlay rules, push grading, live card URL).
  WHY:  Lee asked to ingest the NBA folder's rules so every session applies them.
  NOTE: Source repo ai-boiz- last pushed 2026-04-19 — if the live NBA Apps Script has newer gates, update here. Max-bet conflict (NBA MAX_UNITS 10 vs MLB 3u) left at 3u pending Lee.
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

## NBA AI-BOIZ rules (source: `donohuelee337/ai-boiz-` Config.js + docs/superpowers/specs)

Apply these when building NBA plays, and as the default shape for any sport without its own calibrated gates:

- **Gates:** `MIN_EDGE_PCT` 4.5% true edge · `MIN_HIT_RATE` 54% · kill if raw projection gap > 30% (`MAX_RAW_GAP`, model hallucinating).
- **Singles:** main (non-alt) lines only · American **−150 to +150** · target > 60% win rate.
- **Card shape:** max **8 plays** (`MAX_BET_CARD`) · max **2 straights per game** (`MAX_BETS_PER_GAME`).
- **Ranking:** EV-primary within the odds band; signal score is secondary. Dedupe correlated exposure (same player, same game, PTS/PRA overlap).
- **SGPs:** correlation-first game script (assists → teammate scoring, misses → rebounds, blowout → starter unders/bench overs) · combined ≥ **+100** · alt legs allowed down to about **−700** · **never reuse the exact straight-card leg inside an SGP**.
- **Parlay ladders:** conservative 4–6 legs (≥ +400) · medium 7–10 (≥ +800) · moon 11–20 (≥ +1500).
- **Grading:** a push (`actual === line`) is **not** a win.
- **Live NBA card:** https://donohuelee337.github.io/nba-boiz/ (results: `/results.html`), refreshed every 5 min. Use this card's legs for NBA promos before any outside source.

## Live NBA-BOIZ data (Google Drive) — check here FIRST

Folder: https://drive.google.com/drive/folders/1I1lFoL5pGQBoUbn9LBAuKQaXauZQKdJo (refreshed every few minutes on game days)

- `nba_card.json` — tonight's full model card: per prop `line, side, over/under price, proj, modelP, mktP, edge, ev, l10, badges, suspect`.
- `nba_status.txt` — injury/status watch + latest changes. `nba_pulled.txt` — props both books pulled (likely OUT).
- `picks.json` — Lee's curated card for the day (any sport; CFB on Saturdays) with units and boost assignments.
- Also: `nba_projections.txt`, `nba_game_lines.txt`, `nba_alt_ladders.txt`, `nba_injuries.txt`, `bets.json`, `odds/<date>/`.

Card-reading rules:
- **💎 = passed every filter** — only build from 💎 rows.
- **`suspect: true` = kill.** Edge too large to be real (e.g. 20–30%); the model is probably missing news.
- Never override the card's side with an outside source. If a tout says OVER and the card says UNDER, the card wins.
- **Pick'em (no juice):** rank legs by the *lower* of modelP and mktP; heavy-juice sides (−140 to −230) the model agrees with are the best pick'em legs because the market already says 58–65%.
- **Sportsbook profit boosts (Lee's house rule from picks.json):** put the boost on an alt spread/rung priced nearest the promo's minimum odds (≈ −200) — highest win probability that still qualifies. Plus-money boosts only when the card says so.

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
