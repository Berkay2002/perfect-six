# Battle engine 4 release record

Engine 4 adds existing-adventure party coaching while preserving engine 3's
build-from-scratch invariants. The data version remains
`cobbleverse-1.7.41b`, runtime generation remains offline and deterministic,
and schema-v1 saved and shared snapshots remain readable without mutation.

## Request and result contract

Schema-v2 requests contain six `ownedSlots`. An empty list retains the original
starter, uniqueness, special-class, and Mega rules. One to six entries switch
generation to existing-adventure mode. Each entry records the current species
or form plus intrinsic evolution facts only when needed, initially gender.

Owned members retain their entered species, selected endpoint, evolution path,
origin, and build confidence in the result. Generated open-slot members and
applied recommendation members have distinct origins. Existing parties may
contain duplicate species, multiple starters, or multiple special-class
members. Open slots cannot add further composition violations.

## Evolution and builds

Evolution search walks the pinned non-battle species graph and ignores
temporary battle forms as endpoints. Reachable branches are evaluated inside
the deterministic team search. Current-version builds contain per-stat IV
targets, default unspecified IVs to 31, and allow one to four legal sourced
moves. Limited builds such as Ditto and Unown are returned with explicit
limited confidence instead of being rejected.

For existing parties, the selected roster receives a deterministic team-aware
build pass. Ability, item, nature, EVs, IVs, and moves remain display-only.

## Recommendations

Roster advice is calculated in the Web Worker after the primary result. One to
three owned entries receive no swap advice. Four, five, and six entries permit
at most one, two, and three changed slots respectively. A recommendation must
gain at least three total score points or close an important team-job gap
without lowering the score. Each recommendation includes changed slots, score
delta, closed gaps, tradeoffs, and an exact preview result.

Applying a recommendation requires confirmation, labels replacements as
recommended rather than owned, and retains an exact undo snapshot. Save, share,
and export actions use the active exact result.

## Compatibility

Opening a schema-v1 saved team or share link preserves its exact request and
result snapshot. Regeneration explicitly migrates the request to schema v2 and
engine 4. Recommendation lists are derived data and may be recalculated for a
current-version request.

The release gate is `npm run verify`. Data regeneration uses
`npm run data:sync`; focused seams cover normalization, evolution graphs,
existing-party generation, request migration, and recommendation thresholds.
