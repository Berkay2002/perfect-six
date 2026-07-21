import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import {
  evolutionNeedsGender,
  reachableEvolutionOptions,
} from "@/engine/evolution";

describe("owned Pokémon evolution graph", () => {
  it("resolves linear paths to their terminal evolution", () => {
    const options = reachableEvolutionOptions("bulbasaur", undefined, catalog);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          species: expect.objectContaining({ id: "venusaur" }),
          path: ["bulbasaur", "ivysaur", "venusaur"],
        }),
      ]),
    );
  });

  it("keeps regional branches and excludes battle-only terminals", () => {
    const options = reachableEvolutionOptions("pikachu", undefined, catalog);
    expect(options.some((option) => option.species.id === "raichu")).toBe(true);
    expect(options.every((option) => !option.species.battleOnly)).toBe(true);
  });

  it("uses gender facts only for branches that require them", () => {
    expect(evolutionNeedsGender("kirlia", catalog)).toBe(true);
    const male = reachableEvolutionOptions(
      "kirlia",
      { gender: "male" },
      catalog,
    ).map((option) => option.species.id);
    const female = reachableEvolutionOptions(
      "kirlia",
      { gender: "female" },
      catalog,
    ).map((option) => option.species.id);
    expect(male).toContain("gallade");
    expect(female).not.toContain("gallade");
  });

  it("does not loop when two entered members share an evolution family", () => {
    const first = reachableEvolutionOptions("eevee", undefined, catalog);
    const second = reachableEvolutionOptions("eevee", undefined, catalog);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
  });
});
