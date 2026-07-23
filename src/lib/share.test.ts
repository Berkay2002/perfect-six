import { describe, expect, it } from "vitest";

import {
  decodeSharePayload,
  encodeSharePayload,
  humanReadableTeam,
  showdownTeam,
  toCurrentGeneratorRequest,
} from "@/lib/share";
import { preV3SharePayloads } from "@/lib/fixtures/pre-v3-snapshots";
import { resultScoringState } from "@/lib/quality-presentation";
import { ENGINE_VERSION, type SharePayload } from "@/lib/types";

describe("shared team compatibility", () => {
  it.each(preV3SharePayloads)(
    "preserves and renders the exact pre-v3 engine $request.engineVersion fixture",
    async (legacyPayload) => {
      const before = JSON.stringify(legacyPayload);
      const decoded = await decodeSharePayload(
        await encodeSharePayload(legacyPayload),
      );

      expect(decoded).toEqual(legacyPayload);
      expect(resultScoringState(decoded.result)).toBe("legacy");
      expect(humanReadableTeam(decoded.result)).toContain("Legacy Member 1");
      expect(showdownTeam(decoded.result)).toContain("Legacy Ability");
      expect(JSON.stringify(legacyPayload)).toBe(before);
    },
  );

  it("preserves a legacy snapshot while upgrading its editable request", async () => {
    const legacyPayload = {
      schemaVersion: 1,
      request: {
        schemaVersion: 1,
        dataVersion: "cobbleverse-1.7.41b",
        engineVersion: 1,
        seed: "LEGACY-SEED",
        style: "balanced",
        availability: "journey",
        allowSpecial: false,
        requireMega: false,
        slots: [null, null, null, null, null, null],
      },
      result: {
        members: Array.from({ length: 6 }, (_, index) => ({ id: `${index}` })),
        provenance: { engineVersion: 1 },
      },
    } as unknown as SharePayload;

    const decoded = await decodeSharePayload(
      await encodeSharePayload(legacyPayload),
    );

    expect(Number(decoded.request.engineVersion)).toBe(1);
    expect(Number(decoded.result.provenance.engineVersion)).toBe(1);
    expect(decoded.result.battleQuality?.team).toBeUndefined();
    expect(decoded.result.battleQuality?.synergy).toBeUndefined();
    expect(decoded.result.battleQuality?.acquisitionCurve).toBeUndefined();
    expect(decoded.result.members[0].jobs).toBeUndefined();
    const migrated = toCurrentGeneratorRequest(decoded.request);
    expect(migrated.engineVersion).toBe(ENGINE_VERSION);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.ownedSlots).toEqual(
      Array.from({ length: 6 }, () => null),
    );
  });

  it("exports non-default IV targets and omits default IVs", () => {
    const result = structuredClone(preV3SharePayloads[0].result);
    result.members[0].build.ivs = {
      hp: 31,
      attack: 31,
      defense: 31,
      specialAttack: 31,
      specialDefense: 31,
      speed: 0,
    };

    const exported = showdownTeam(result);

    expect(exported).toContain("IVs: 0 Spe");
    expect(exported).not.toContain("31 HP");
  });
});
