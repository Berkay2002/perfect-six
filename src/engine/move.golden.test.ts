import { describe, expect, it } from "vitest";

import golden from "@/engine/fixtures/move-package-golden.json";
import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";
import { movePackageQualityForBuild } from "@/engine/move";
import type { EVSpread, MoveBuild, PokemonRecord, StatBlock } from "@/lib/types";

const base = assembleCandidates(catalog, "balanced")[0];
const moveById = new Map(catalog.moves.map((move) => [move.id, move]));

function packageFor(
  context: { types: string[]; stats: StatBlock; evs: EVSpread },
  moveIds: string[],
) {
  const moves = moveIds.map((moveId): MoveBuild => {
    const move = moveById.get(moveId);
    if (!move) throw new Error(`Golden corpus references unknown move ${moveId}`);
    expect(golden.sources).toContain(move.source);
    return {
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      power: move.power,
      accuracy: move.accuracy,
      purpose: "Independent golden comparison",
    };
  }) as PokemonRecord["build"]["moves"];
  return {
    ...base,
    types: context.types as PokemonRecord["types"],
    stats: context.stats,
    build: { ...base.build, evs: context.evs, moves },
  };
}

describe("source-backed move-package golden corpus", () => {
  it("ranks at least 90 percent of independently preferred packages higher", () => {
    const outcomes = golden.comparisons.map((comparison) => {
      const preferred = movePackageQualityForBuild(
        packageFor(comparison.context, comparison.preferred.moves),
        catalog,
      );
      const inferior = movePackageQualityForBuild(
        packageFor(comparison.context, comparison.inferior.moves),
        catalog,
      );
      if (comparison.id === "bulky-pivot-package") {
        expect(preferred.strengths.join(" ")).toContain(
          "Body Press uses Defense",
        );
      }
      return {
        id: comparison.id,
        preferred: preferred.score,
        inferior: inferior.score,
        passed: preferred.score > inferior.score,
      };
    });
    const passed = outcomes.filter((outcome) => outcome.passed).length;
    const failures = outcomes.filter((outcome) => !outcome.passed);

    expect(
      passed / outcomes.length,
      `Failed golden comparisons: ${JSON.stringify(failures)}`,
    ).toBeGreaterThanOrEqual(0.9);
    expect(passed, `Failed golden comparisons: ${JSON.stringify(failures)}`).toBe(
      outcomes.length,
    );
  });
});
