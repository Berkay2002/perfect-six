import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import { generateTeam, GeneratorInputError } from "@/engine/generate";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
} from "@/lib/types";

const request = (seed: string): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed,
  style: "balanced",
  availability: "journey",
  allowSpecial: false,
  requireMega: false,
  slots: [null, null, null, null, null, null],
});

function assertInvariants(result: ReturnType<typeof generateTeam>) {
  expect(result.members).toHaveLength(6);
  expect(new Set(result.members.map((member) => member.id)).size).toBe(6);
  expect(result.members.filter((member) => member.starter)).toHaveLength(1);
  expect(
    result.members.filter((member) => member.specialClasses.length > 0),
  ).toHaveLength(0);
  for (const member of result.members) {
    expect(member.finalEvolution).toBe(true);
    expect(member.build.moves).toHaveLength(4);
    expect(member.build.moves.every((move) => move.id && move.name)).toBe(true);
  }
}

describe("deterministic generator", () => {
  it("returns byte-identical output for EMBER-042", () => {
    const first = generateTeam(request("EMBER-042"), catalog);
    const second = generateTeam(request("EMBER-042"), catalog);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    assertInvariants(first);
  });

  it(
    "preserves all hard invariants across representative seeds",
    () => {
      for (let index = 0; index < 40; index += 1) {
        assertInvariants(generateTeam(request(`PROPERTY-${index}`), catalog));
      }
    },
    60_000,
  );

  it("returns three legal full-team-rescored alternatives", () => {
    const input = request("ALTERNATIVES-1");
    const current = generateTeam(input, catalog);
    const alternatives = generateAlternatives(0, input, current, catalog);
    expect(alternatives).toHaveLength(3);
    for (const alternative of alternatives) {
      assertInvariants(alternative.result);
      expect(alternative.result.score.total - current.score.total).toBe(
        alternative.scoreDelta,
      );
    }
  });

  it("rejects six fixed non-starters", () => {
    const generated = generateTeam(request("LOCK-SOURCE"), catalog);
    const nonStarters = generated.members
      .filter((member) => !member.starter)
      .map((member) => member.id);
    const extra = catalog.species.find(
      (entry) =>
        entry.finalEvolution &&
        !entry.starter &&
        !nonStarters.includes(entry.id) &&
        catalog.builds.some((build) => build.speciesId === entry.id),
    );
    expect(extra).toBeDefined();
    const locked = {
      ...request("BAD-LOCK"),
      slots: [...nonStarters, extra!.id] as GeneratorRequest["slots"],
    };
    expect(() => generateTeam(locked, catalog)).toThrowError(GeneratorInputError);
  });
});
