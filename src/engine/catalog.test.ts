import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";
import type { NormalizedCatalog } from "@/lib/types";

describe("candidate catalog", () => {
  it("penalizes sourced detrimental abilities without species hardcoding", () => {
    const candidates = assembleCandidates(catalog, "balanced");
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    expect(byId.get("slaking")?.build.abilityId).toBe("truant");
    expect(byId.get("slaking")?.battleScore).toBe(71);
    expect(byId.get("archeops")?.build.abilityId).toBe("defeatist");
    expect(byId.get("archeops")?.battleScore).toBe(56);
    expect(byId.get("dragapult")?.battleScore).toBe(100);
  });

  it("selects the stronger sourced ability when otherwise-identical builds compete", () => {
    const species = catalog.species.find((entry) => entry.id === "azumarill")!;
    const baseBuild = catalog.builds.find(
      (build) => build.speciesId === species.id,
    )!;
    const fixture = {
      ...catalog,
      species: [species],
      builds: [
        {
          ...baseBuild,
          id: "fixture-beneficial",
          abilityId: "fixturebeneficial",
          ability: "Fixture Beneficial",
        },
        {
          ...baseBuild,
          id: "fixture-detrimental",
          abilityId: "fixturedetrimental",
          ability: "Fixture Detrimental",
        },
      ],
      abilities: [
        {
          id: "fixturebeneficial",
          name: "Fixture Beneficial",
          description: "Fixture sourced positive ability.",
          rating: 4,
          capabilities: {
            immunities: [],
            absorptions: [],
            weather: [],
            weatherDetriments: [],
          },
          source: "fixture://abilities",
        },
        {
          id: "fixturedetrimental",
          name: "Fixture Detrimental",
          description: "Fixture sourced detrimental ability.",
          rating: -1,
          capabilities: {
            immunities: [],
            absorptions: [],
            weather: [],
            weatherDetriments: [],
          },
          source: "fixture://abilities",
        },
      ],
    } satisfies NormalizedCatalog;

    expect(assembleCandidates(fixture, "balanced")[0].build.abilityId).toBe(
      "fixturebeneficial",
    );
  });
});
