import { describe, expect, it } from "vitest";

import { migrateGeneratorRequest, ownedSlotsForRequest } from "@/lib/request";
import type { GeneratorRequest } from "@/lib/types";

describe("generator request migration", () => {
  it("maps schema-v1 roster slots to schema-v2 owned slots only on regeneration", () => {
    const legacy = {
      schemaVersion: 1,
      engineVersion: 1,
      slots: ["bulbasaur", null, null, null, null, null],
    } as unknown as GeneratorRequest;
    const exact = JSON.stringify(legacy);

    expect(ownedSlotsForRequest(legacy)[0]).toEqual({
      speciesId: "bulbasaur",
    });
    const migrated = migrateGeneratorRequest(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.ownedSlots?.[0]).toEqual({ speciesId: "bulbasaur" });
    expect(JSON.stringify(legacy)).toBe(exact);
  });
});
