import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";
import { generateTeam } from "@/engine/generate";
import {
  doesNotWorsenComposition,
  generateRecommendations,
  recommendationChangeCap,
  recommendationQualifies,
} from "@/engine/recommendations";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
} from "@/lib/types";
import { pokemonRecordFromMember } from "@/engine/member";

const request = (seed: string): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed,
  style: "balanced",
  availability: "journey",
  allowSpecial: false,
  requireMega: false,
  ownedSlots: [null, null, null, null, null, null],
  slots: [null, null, null, null, null, null],
});

describe("existing-party recommendations", () => {
  it("uses the graduated owned-party change caps", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(recommendationChangeCap)).toEqual([
      0, 0, 0, 0, 1, 2, 3,
    ]);
  });

  it("requires three score points or a closed important gap without loss", () => {
    expect(recommendationQualifies(3, [])).toBe(true);
    expect(recommendationQualifies(2, [])).toBe(false);
    expect(recommendationQualifies(0, ["speed control"])).toBe(true);
    expect(recommendationQualifies(-1, ["speed control"])).toBe(false);
  });

  it("does not calculate swap advice for one to three owned members", () => {
    const baseRequest = request("NO-EARLY-SWAPS");
    const snapshot = generateTeam(baseRequest, catalog);
    const ownedRequest = {
      ...baseRequest,
      ownedSlots: snapshot.members.map((member, index) =>
        index < 3 ? { speciesId: member.id } : null,
      ) as NonNullable<GeneratorRequest["ownedSlots"]>,
      slots: snapshot.members.map((member, index) =>
        index < 3 ? member.id : null,
      ) as GeneratorRequest["slots"],
    };
    expect(generateRecommendations(ownedRequest, snapshot, catalog)).toEqual([]);
  });

  it("allows advice to preserve or reduce duplicates already in the party", () => {
    const baseRequest = request("DUPLICATE-ADVICE");
    const generated = generateTeam(baseRequest, catalog);
    const duplicate = pokemonRecordFromMember(generated.members[1]);
    const current = generated.members.map(pokemonRecordFromMember);
    current[0] = duplicate;
    const replaced = current[2];
    const replacement = assembleCandidates(
      catalog,
      baseRequest.style,
      baseRequest.weather,
    ).find(
      (candidate) =>
        !current.some((entry) => entry.id === candidate.id) &&
        candidate.starter === replaced.starter &&
        (candidate.specialClasses.length > 0) ===
          (replaced.specialClasses.length > 0),
    )!;
    const preserving = [...current];
    preserving[2] = replacement;
    const reducing = [...current];
    reducing[0] = pokemonRecordFromMember(generated.members[0]);

    expect(doesNotWorsenComposition(current, preserving, baseRequest)).toBe(true);
    expect(doesNotWorsenComposition(current, reducing, baseRequest)).toBe(true);
  });
});
