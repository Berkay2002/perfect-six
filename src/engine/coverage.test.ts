import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { assembleCandidates } from "@/engine/catalog";
import { roleCoverageQualityForTeam } from "@/engine/coverage";
import { generateTeam } from "@/engine/generate";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
  type MoveBuild,
  type MoveRecord,
  type PokemonRecord,
} from "@/lib/types";

const request: GeneratorRequest = {
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed: "TYPE-COVERAGE",
  style: "balanced",
  availability: "journey",
  allowSpecial: false,
  requireMega: false,
  slots: [null, null, null, null, null, null],
};

function move(id: string): MoveRecord {
  const found = catalog.moves.find((candidate) => candidate.id === id);
  expect(found, `Missing sourced fixture move ${id}`).toBeDefined();
  return found!;
}

function buildMove(record: MoveRecord): MoveBuild {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    category: record.category,
    power: record.power,
    accuracy: record.accuracy,
    purpose: "Committed type-coverage fixture.",
  };
}

function coverageRoster() {
  const generated = generateTeam(request, catalog);
  const candidates = assembleCandidates(catalog, "balanced");
  const greninja = candidates.find((candidate) => candidate.id === "greninja");
  const garchomp = candidates.find((candidate) => candidate.id === "garchomp");
  const neutralAbility = catalog.abilities.find(
    (ability) => ability.id === "airlock",
  );
  expect(greninja).toBeDefined();
  expect(garchomp).toBeDefined();
  expect(neutralAbility).toBeDefined();

  const tackle = buildMove(move("tackle"));
  const neutralMoves = [tackle, tackle, tackle, tackle] as PokemonRecord["build"]["moves"];
  const roster = generated.members.map((member, index) => ({
    ...member,
    id: `coverage-neutral-${index}`,
    name: `Coverage neutral ${index + 1}`,
    types: ["Normal"] as [string],
    build: {
      ...member.build,
      speciesId: `coverage-neutral-${index}`,
      abilityId: neutralAbility!.id,
      ability: neutralAbility!.name,
      moves: neutralMoves,
    },
  })) as PokemonRecord[];

  roster[0] = {
    ...greninja!,
    build: {
      ...greninja!.build,
      moves: neutralMoves,
    },
  };
  roster[1] = garchomp!;
  return roster;
}

describe("enhanced role coverage", () => {
  it("records the actual move that answers a defending type", () => {
    const quality = roleCoverageQualityForTeam(coverageRoster(), catalog);
    const electricAnswer = quality.offensiveAnswers.find(
      (answer) => answer.defendingType === "Electric",
    );

    expect(electricAnswer).toMatchObject({
      memberId: "garchomp",
      memberName: "Garchomp",
      moveId: "earthquake",
      moveName: "Earthquake",
      moveType: "Ground",
      effectiveness: 2,
    });
    expect(quality.uncoveredDefendingTypes).not.toContain("Electric");
    expect(
      quality.offensiveAnswers.every((answer) =>
        catalog.species.some((pokemon) =>
          pokemon.types.includes(answer.defendingType),
        ),
      ),
    ).toBe(true);
  });

  it("records which teammate covers each weakness", () => {
    const quality = roleCoverageQualityForTeam(coverageRoster(), catalog);
    const electricCover = quality.defensiveAnswers.find(
      (answer) =>
        answer.vulnerableMemberId === "greninja" &&
        answer.attackType === "Electric",
    );

    expect(electricCover).toMatchObject({
      vulnerableMemberName: "Greninja",
      coveringMemberId: "garchomp",
      coveringMemberName: "Garchomp",
      relation: "immunity",
      sourceKind: "type",
      sourceName: "Ground",
      incomingMultiplier: 0,
    });
    expect(quality.explanation).toContain("Garchomp");
    expect(quality.explanation).toContain("Greninja");
    expect(quality.explanation).toContain("Electric");
  });

  it("does not treat typing alone as offensive coverage without a move", () => {
    const roster = coverageRoster();
    const tackle = buildMove(move("tackle"));
    roster[1] = {
      ...roster[1],
      build: {
        ...roster[1].build,
        moves: [tackle, tackle, tackle, tackle],
      },
    };

    const quality = roleCoverageQualityForTeam(roster, catalog);

    expect(
      quality.offensiveAnswers.some(
        (answer) =>
          answer.defendingType === "Electric" &&
          answer.memberId === "garchomp",
      ),
    ).toBe(false);
  });

  it("scores explicit teammate answers above uncovered weaknesses", () => {
    const covered = roleCoverageQualityForTeam(coverageRoster(), catalog);
    const uncoveredRoster = coverageRoster();
    uncoveredRoster[1] = {
      ...uncoveredRoster[1],
      types: ["Normal"],
    };
    const uncovered = roleCoverageQualityForTeam(uncoveredRoster, catalog);

    expect(covered.defensiveScore).toBeGreaterThan(uncovered.defensiveScore);
    expect(covered.score).toBeGreaterThan(uncovered.score);
    expect(
      uncovered.uncoveredWeaknesses.some(
        (gap) =>
          gap.memberId === "greninja" && gap.attackType === "Electric",
      ),
    ).toBe(true);
  });

  it("records and rewards independent offensive answers", () => {
    const roster = coverageRoster();
    const singleAnswer = roleCoverageQualityForTeam(roster, catalog);
    const earthquake = buildMove(move("earthquake"));
    roster[2] = {
      ...roster[2],
      build: {
        ...roster[2].build,
        moves: [earthquake, earthquake, earthquake, earthquake],
      },
    };

    const redundant = roleCoverageQualityForTeam(roster, catalog);
    const electricAnswers = redundant.offensiveAnswers.filter(
      (answer) => answer.defendingType === "Electric",
    );

    expect(new Set(electricAnswers.map((answer) => answer.memberId))).toEqual(
      new Set(["garchomp", "coverage-neutral-2"]),
    );
    expect(redundant.offensiveScore).toBeGreaterThan(
      singleAnswer.offensiveScore,
    );
  });

  it("records and rewards every defensive covering source", () => {
    const roster = coverageRoster();
    const singleAnswer = roleCoverageQualityForTeam(roster, catalog);
    const voltAbsorb = catalog.abilities.find(
      (ability) => ability.id === "voltabsorb",
    );
    expect(voltAbsorb).toBeDefined();
    roster[2] = {
      ...roster[2],
      build: {
        ...roster[2].build,
        abilityId: voltAbsorb!.id,
        ability: voltAbsorb!.name,
      },
    };

    const redundant = roleCoverageQualityForTeam(roster, catalog);
    const electricAnswers = redundant.defensiveAnswers.filter(
      (answer) =>
        answer.vulnerableMemberId === "greninja" &&
        answer.attackType === "Electric",
    );

    expect(electricAnswers).toHaveLength(2);
    expect(electricAnswers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coveringMemberId: "garchomp",
          sourceKind: "type",
          sourceName: "Ground",
        }),
        expect.objectContaining({
          coveringMemberId: "coverage-neutral-2",
          sourceKind: "ability",
          sourceName: "Volt Absorb",
        }),
      ]),
    );
    expect(redundant.defensiveScore).toBeGreaterThan(
      singleAnswer.defensiveScore,
    );
  });
});
