# Aviator unification — vendored sources

This directory is the result of merging four formerly separate repositories into
the gaming platform. They are kept verbatim (excluding only `.git/`) so the
original work, credits and history references survive the move. **None of this
code is executed by the platform at runtime** — it is reference material and
build assets. The live, integrated implementation is the `crash` service in
`../../services/crash` and the crash stage in `../../frontend/src/components/crash`.

| Directory | Original fork | Upstream source | Role in the unified app |
| --- | --- | --- | --- |
| `bot/` | `anya12forger12-max/Aviator-Automated-Betika-Bot` | `Raccoon254/Aviator-Automated-Betika-Bot` | Betting-strategy reference. Its bankroll/Martingale ideas inspired `strategy-lab`, which plays **paper credits against our own crash API only** — it never contacts Betika or any external betting site. |
| `crash-client/` | `anya12forger12-max/aviator-crash` | `Casino-Crash-Game/aviator-crash` | React/TypeScript crash client and Unity flight assets (`public/unity/*`). The provably-fair round model and cash-out UX were ported into the platform's own frontend; the Unity bundle is kept as an optional visual asset. |
| `bbc-micro-archive/` | `anya12forger12-max/aviator-source-code-bbc-micro` | `markmoxon/aviator-source-code-bbc-micro` | Historical 6502 source of Geoff Crammond's *Aviator*. Archived for provenance only; not part of the runtime. |
| `win2x-casino-reference/` | `anya12forger12-max/Win2x` | `blancos13/Win2x` | PHP casino reference for the wider game catalogue (dice, flip, jackpot, wheel, PvP). Informs `GameTypes` and the tournament catalogue; no PHP is executed. |

## Why vendoring is safe

* The trees include third-party code under **a variety of licences, several
  unspecified**. They are archived, not linked into the build, not published as
  our own, and original README/LICENSE files are left intact.
* `win2x-casino-reference/` in particular contains legacy PHP, SQL dumps and
  arbitrary text files. It is untrusted data. Treat it as documentation, never
  as executable code or as a source of deployment configuration. Its captured
  session files, compiled view cache and bundled TLS private key were removed
  during the merge — none of that runtime state belongs in this repository.
* `crash-client/public/unity/*.unityweb` are large binary game assets included
  only so the flight animation can optionally be reused. They are not required
  for the unified crash game, which renders its canvas natively.

## What replaced them

The four separate projects are unified behind the platform's gateway:

* `POST /v1/crash/rounds/:id/bets` and `/cashout` — real money via the wallet
  service, with authoritative, provably-fair crash points.
* `GET /v1/crash/rounds/current` and the realtime `crash.*` event stream — the
  live multiplier feed consumed by the frontend.
* `POST /v1/crash/strategy-lab/run` — deterministic paper-trading simulator
  derived from the vendored bot strategies, using no external services.
* Tournaments now know about `crash`, `dice`, `flip`, `jackpot` and `wheel`
  alongside the pre-existing game types; paid entry stays fail-closed until
  escrow exists.

See `../../README.md` for the service table and `../../migrations/0008_crash.sql`
for the new tables.
