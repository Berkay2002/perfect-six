import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import {
  canonicalRosterKey,
  deduplicateRosterStates,
  generateTeam,
  GeneratorInputError,
  selectEliteRoster,
} from "@/engine/generate";
import { createRandom } from "@/lib/random";
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
  it("deduplicates roster permutations before beam pruning", () => {
    const first = { members: [{ id: "garchomp" }, { id: "greninja" }] };
    const permutation = {
      members: [{ id: "greninja" }, { id: "garchomp" }],
    };
    const distinct = { members: [{ id: "dragapult" }, { id: "greninja" }] };

    expect(deduplicateRosterStates([first, permutation, distinct])).toEqual([
      first,
      distinct,
    ]);
  });

  it("selects below-target finalists only within three points of the best", () => {
    const finals = [
      { id: "best", score: { total: 84 } },
      { id: "near", score: { total: 82 } },
      { id: "outside", score: { total: 80 } },
    ];
    const selectedIds = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const { selected, bestScore } = selectEliteRoster(
        finals,
        createRandom(`ELITE-${index}`),
      );
      expect(bestScore - selected.score.total).toBeLessThanOrEqual(3);
      selectedIds.add(selected.id);
    }
    expect(selectedIds).toEqual(new Set(["best", "near"]));
  });

  it("marks newly generated teams as engine version 2", () => {
    const result = generateTeam(request("ENGINE-VERSION"), catalog);
    expect(Number(result.provenance.engineVersion)).toBe(2);
  });

  it("returns byte-identical output for EMBER-042", () => {
    const first = generateTeam(request("EMBER-042"), catalog);
    const second = generateTeam(request("EMBER-042"), catalog);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    assertInvariants(first);
  });

  it(
    "produces varied high-quality teams while preserving every invariant",
    () => {
      const rosters = new Set<string>();
      const frequencies = new Map<string, number>();
      const scores: number[] = [];
      for (let index = 0; index < 40; index += 1) {
        const result = generateTeam(request(`PROPERTY-${index}`), catalog);
        assertInvariants(result);
        rosters.add(canonicalRosterKey(result.members));
        scores.push(result.score.total);
        for (const member of result.members) {
          frequencies.set(member.id, (frequencies.get(member.id) ?? 0) + 1);
        }
      }
      const mostFrequent = [...frequencies.entries()].sort(
        (left, right) => right[1] - left[1],
      )[0];
      expect(rosters.size).toBeGreaterThanOrEqual(20);
      expect(
        mostFrequent[1],
        `${mostFrequent[0]} appeared in ${mostFrequent[1]} of 40 teams`,
      ).toBeLessThanOrEqual(28);
      expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(3);
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

  it("preserves valid locks with enabled special and required Mega options", () => {
    const source = generateTeam(request("LOCK-SOURCE"), catalog);
    const starter = source.members.find((member) => member.starter)!;
    const nonStarter = source.members.find((member) => !member.starter)!;
    const result = generateTeam(
      {
        ...request("LOCKED-MEGA-SPECIAL"),
        allowSpecial: true,
        requireMega: true,
        slots: [nonStarter.id, null, starter.id, null, null, null],
      },
      catalog,
    );

    expect(result.members[0].id).toBe(nonStarter.id);
    expect(result.members[2].id).toBe(starter.id);
    expect(result.members.filter((member) => member.starter)).toHaveLength(1);
    expect(
      result.members.filter((member) => member.specialClasses.length > 0)
        .length,
    ).toBeLessThanOrEqual(1);
    expect(result.members.some((member) => member.mega)).toBe(true);
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
