# Perfect Six data contract

Generation runs entirely from committed, normalized static data. Runtime browser
code never calls third-party APIs.

## Authority order

1. Exact Cobbleverse `1.7.41b` pack files and embedded dependency archives.
2. Cobblemon `1.7.3` species definitions.
3. Pokémon Showdown mechanics records.
4. Smogon sets as recommendations only.

Later recommendation sources never override legality. Imported sets are rejected
when a move, ability, item, species, or form does not resolve against the
normalized legality snapshot.

Species additions follow Cobblemon rules: ordinary fields rewrite the target;
`forms` and `evolutions` append. Later additions cannot rewrite a field already
rewritten by an earlier addition in load order.

## Reproducibility

`data/sources.lock.json` pins release identifiers, URLs, sizes, and available
checksums. `scripts/sync-data.mjs` verifies pinned pack hashes, scans exact
manifest archives, calculates source checksums, writes browser JSON, and emits
`docs/data/provenance.json`.

Full release data must be generated without `--skip-pack-dependencies`.

## Curation boundary

Allowed curation:

- selecting among validated Smogon set options;
- ranking sourced legal moves using their sourced metadata;
- deriving tactical labels from sourced stats and move effects;
- scoring acquisition evidence found in pack spawn/evolution records.

Forbidden curation:

- inventing move category, power, accuracy, type, or legality;
- manually classifying named Pokémon as starter, legendary, mythical,
  Ultra Beast, Paradox, or Mega-capable;
- accepting a recommended set after a legality mismatch;
- guessing custom mechanics missing from scanned sources.

Perfect Six is an unofficial fan tool. Pokémon, Minecraft, Cobblemon, and
Cobbleverse belong to their respective owners and contributors.

## Battle engine release

Engine 3 is the authoritative battle-aware generator for the current data
snapshot. Its calibration matrix, comparison corpus, stat assumptions,
performance method, and compatibility boundary are recorded in
[`battle-engine-v3.md`](battle-engine-v3.md).

Normalized descriptions are deliberately conservative. Mechanics that cannot
be represented from pinned source metadata remain neutral rather than being
guessed.
