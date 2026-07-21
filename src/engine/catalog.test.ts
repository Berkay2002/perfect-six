import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";

describe("candidate catalog", () => {
  it("penalizes sourced detrimental abilities without species hardcoding", () => {
    const candidates = assembleCandidates(catalog, "balanced");
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    expect(byId.get("slaking")?.build.abilityId).toBe("truant");
    expect(byId.get("slaking")?.battleScore).toBe(71);
    expect(byId.get("archeops")?.build.abilityId).toBe("defeatist");
    expect(byId.get("archeops")?.battleScore).toBe(56);
    expect(byId.get("dragapult")?.battleScore).toBe(89);
  });
});
