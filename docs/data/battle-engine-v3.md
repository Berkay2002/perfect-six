# Battle engine 3 release record

Engine 3 makes the source-backed battle-quality model authoritative. The data
version remains `cobbleverse-1.7.41b`, and saved/share schema version 1 remains
readable. Runtime generation is still offline and deterministic.

The release artifacts agree on engine version 3:

- `data/engine-version.mjs` defines the runtime engine version.
- `src/data/generated/manifest.json` records engine version 3 with the pinned
  normalized snapshot.
- `docs/data/provenance.json` records engine version 3 and the source checksums.
- `src/engine/fixtures/release-request-matrix.json` and
  `src/engine/fixtures/release-comparison-corpus.json` version the calibration
  evidence.

## Planning-stat assumptions

Planning indices use level 50, 31 IVs in every stat, the validated EV spread,
and the standard nature multipliers. HP and non-HP stats use the standard
Pokémon formulas with integer flooring. They are comparison indices for team
construction, not a damage simulator.

Only normalized numeric item modifiers whose conditions are satisfied are
applied to the index. Conditional ability, weather, item, and move effects are
evaluated through their normalized capabilities and concrete prerequisites.
An effect that is missing from normalized source metadata remains neutral and
is not inferred from a name or species identity.

## Fixed request matrix

The committed matrix has 14 requests. Each mode has one journey request and one
unrestricted request. Across the matrix, special classes are disabled and
enabled, Mega evolution is optional and required, and representative legal
locks include Charizard, Zapdos, and Greninja.

| Mode | Profile passes | Requests |
| --- | ---: | ---: |
| Balanced | 2/2 | 2 |
| Aggressive | 2/2 | 2 |
| Bulky | 2/2 | 2 |
| Rain | 2/2 | 2 |
| Sun | 2/2 | 2 |
| Sand | 2/2 | 2 |
| Snow | 2/2 | 2 |

Every request produced a byte-identical result on immediate repetition. Every
result preserved six unique final evolutions, exactly one starter, the special
class limit, the Mega requirement, literal locks, and four validated moves per
member. Current results exposed non-empty ability, item, move, team, plan,
synergy, and acquisition explanations. Every result had either a concrete
proactive win condition or the explicit low-confidence warning.

## Comparison corpus

The release corpus executes 24 independently justified preferred-versus-
inferior comparisons through the public ability, item, move, team, plan,
synergy, and journey evaluators. The observed release result is 24/24 preferred
higher, or 100 percent. The required threshold is 90 percent. There are no
engine-3 exceptions. A future non-passing comparison must record its observed
values and a review rationale in the fixture rather than disappearing into an
aggregate percentage.

The 12 move-package comparisons retain their separate sourced golden fixture.
The release corpus also executes two comparisons for each of the other six
quality areas.

## Diversity and performance

The balanced journey guard generates 40 fixed seeds. It requires at least 20
distinct unordered rosters and caps every unlocked species at 28 appearances.
The engine-3 release produced 36 distinct rosters; Aurorus was the most frequent
species at 28 appearances. The release test suite keeps both thresholds at the
team-generation seam.

The development benchmark measures a balanced, unrestricted, fully unlocked
request with special classes disabled and Mega optional. It performs one
warmup, then three sequential warm-cache measurements using
`process.hrtime.bigint()`. The minimum sample is compared with the 1.5-second
target to reduce unrelated scheduler noise; the seed and request are fixed.

Release measurement environment:

- Windows 11 Pro 64-bit, version 10.0.26200
- AMD Ryzen 7 7800X3D, 8 cores and 16 logical processors
- 63.1 GB visible memory
- Node.js 24.10.0 and npm 11.18.0

Observed warm-cache samples were 842.1 ms, 834.6 ms, and 837.7 ms. The minimum
was 834.6 ms, 665.4 ms below the target.

## Compatibility

New results contain the additive battle-quality explanation object and use
engine version 3. Pre-v3 saved and shared snapshots retain their original
members, builds, scores, provenance, and engine version and are labeled
"Legacy scoring" when displayed. Re-running an old request is an explicit
upgrade to the current engine; simply opening its snapshot is not.

The release gate is `npm run verify`. It covers typechecking, linting, data and
unit tests, and the production build. The focused calibration seam is
`npx vitest run src/engine/release-calibration.test.ts --maxWorkers=1`.
