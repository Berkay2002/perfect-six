# Perfect Six

Perfect Six is a deterministic, browser-only team generator for Cobbleverse
1.7.41b. It can build a singles team of six from scratch or coach an existing
adventure party through reachable evolutions, complete builds, and optional
roster improvements.

## What it does

- Repeats the exact same result for the same seed, settings, owned party, data
  version, and engine version.
- Balances journey usefulness with friend-battle performance.
- Supports balanced, aggressive, bulky, and weather team styles.
- Accepts zero to six current Pokémon or forms and preserves the entered party,
  including duplicates and composition-rule violations.
- Keeps the build-from-scratch starter, special-class, uniqueness, and Mega
  invariants when no owned Pokémon are entered.
- Plans reachable evolutions, one-to-four-move builds, IV targets, team jobs,
  and qualified optional roster improvements.
- Shows complete builds, practical substitutions, risks, score details, and
  three rescored alternatives per team member.
- Copies human-readable and Pokémon Showdown-compatible exports.
- Saves, renames, duplicates, and deletes teams locally in the browser.
- Uses no accounts, telemetry, backend, or runtime third-party API.

## Data

The committed browser dataset is normalized from pinned source snapshots.
Cobbleverse and Cobblemon determine legality; Pokémon Showdown supplies
mechanics data; Smogon sets are recommendations that must pass legality
validation before use.

Move names, types, damage categories, power, accuracy, abilities, items,
evolutions, classifications, and Mega capability come from those source
snapshots rather than application hardcoding. See
[`docs/data/README.md`](docs/data/README.md) and
[`docs/data/provenance.json`](docs/data/provenance.json) for the authority
rules, checksums, and rejection report.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
npm run data:sync   # rebuild the full pinned browser dataset
npm run data:smoke  # fast normalization smoke snapshot
npm run test
npm run verify      # typecheck, lint, tests, and production build
```

## Stack

- Next.js App Router, TypeScript, React
- Astryx Core and the neutral theme
- Web Worker generation engine
- Versioned static JSON and localStorage persistence

## Disclaimer

Perfect Six is an unofficial fan tool. Pokémon, Minecraft, Cobblemon, and
Cobbleverse belong to their respective owners and contributors.
