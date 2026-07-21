import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import benchmark from "@/engine/fixtures/journey-curve-benchmark.json";
import {
  compareJourneyFinalists,
  generateTeam,
  materializeTeamResult,
  selectEliteRoster,
} from "@/engine/generate";
import {
  journeyCurveQualityForTeam,
  legacyJourneyFitForTeam,
} from "@/engine/journey";
import { scoreTeam } from "@/engine/score";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type AvailabilityRecord,
  type GeneratorRequest,
  type ItemCapabilities,
  type MoveBuild,
  type MoveRecord,
  type NormalizedCatalog,
  type PokemonRecord,
} from "@/lib/types";

const request = (
  seed: string,
  availability: GeneratorRequest["availability"] = "journey",
): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed,
  style: "balanced",
  availability,
  allowSpecial: false,
  requireMega: false,
  slots: [null, null, null, null, null, null],
});

const neutralItemCapabilities = (): ItemCapabilities => ({
  damageCategory: null,
  choiceLock: false,
  recovery: false,
  requiredType: null,
  defensiveStats: [],
  hazardProtection: false,
  survival: false,
  speedMultiplier: null,
  speedStages: 0,
  movesLast: false,
  recoil: false,
  consumable: false,
  boostedStats: [],
  requiresInaccurateMove: false,
  damagingMovesOnly: false,
  requiresEvolutionPotential: false,
});

const asBuildMove = (move: MoveRecord): MoveBuild => ({
  id: move.id,
  name: move.name,
  type: move.type,
  category: move.category,
  power: move.power,
  accuracy: move.accuracy,
  purpose: "Committed journey-curve fixture.",
});

function fixtureContext() {
  const source = generateTeam(request("JOURNEY-CURVE-SOURCE"), catalog);
  const plainPhysical = catalog.moves
    .filter(
      (move) =>
        move.category === "Physical" &&
        (move.power ?? 0) > 0 &&
        move.priority === 0 &&
        !move.capabilities?.hazard &&
        !move.capabilities?.removal &&
        !move.effect.selfSwitch &&
        move.effect.status === null &&
        move.effect.volatileStatus === null,
    )
    .slice(0, 4);
  const plainSpecial = catalog.moves
    .filter(
      (move) =>
        move.category === "Special" &&
        (move.power ?? 0) > 0 &&
        move.priority === 0 &&
        !move.effect.selfSwitch &&
        move.effect.status === null &&
        move.effect.volatileStatus === null,
    )
    .slice(0, 4);
  const priority = catalog.moves.find(
    (move) => move.category === "Physical" && (move.power ?? 0) > 0 && move.priority > 0,
  )!;
  const recovery = catalog.moves.find(
    (move) => move.category === "Status" && move.effect.healingFraction !== null,
  )!;
  const hazard = catalog.moves.find((move) => move.capabilities?.hazard)!;
  const removal = catalog.moves.find((move) => move.capabilities?.removal)!;
  const pivot = catalog.moves.find(
    (move) => move.category === "Special" && (move.power ?? 0) > 0 && move.effect.selfSwitch,
  )!;
  const setup = catalog.moves.find(
    (move) =>
      move.category === "Status" &&
      ((move.capabilities?.selfBoosts?.spa ?? 0) > 0 ||
        (move.effect.boosts?.spa ?? 0) > 0),
  )!;
  expect([
    ...plainPhysical,
    ...plainSpecial,
    priority,
    recovery,
    hazard,
    removal,
    pivot,
    setup,
  ]).not.toContain(undefined);

  const neutralItem = {
    id: "journeyneutralitem",
    name: "Journey Neutral Item",
    description: "Fixture item with no supported effect.",
    megaStone: null,
    megaEvolves: null,
    capabilities: neutralItemCapabilities(),
    source: "fixture://journey",
  };
  const neutralAbility = {
    id: "journeyneutralability",
    name: "Journey Neutral Ability",
    description: "Fixture ability with no supported effect.",
    rating: null,
    capabilities: {
      immunities: [],
      absorptions: [],
      weather: [],
      weatherDetriments: [],
    },
    source: "fixture://journey",
  };
  const fixtureCatalog = {
    ...catalog,
    items: [...catalog.items, neutralItem],
    abilities: [...catalog.abilities, neutralAbility],
  } satisfies NormalizedCatalog;
  const packages: MoveRecord[][] = [
    [priority, ...plainPhysical.filter((move) => move.id !== priority.id).slice(0, 3)],
    [recovery, ...plainSpecial.slice(0, 3)],
    [hazard, ...plainPhysical.filter((move) => move.id !== hazard.id).slice(0, 3)],
    [removal, pivot, ...plainSpecial.filter((move) => move.id !== pivot.id).slice(0, 2)],
    plainPhysical,
    [setup, ...plainSpecial.slice(0, 3)],
  ];
  const roster = source.members.map((member, index) => ({
    ...member,
    stats: { ...member.stats, hp: 80, attack: 105, defense: 75, specialAttack: 105, specialDefense: 75, speed: 55 },
    build: {
      ...member.build,
      abilityId: neutralAbility.id,
      ability: neutralAbility.name,
      heldItemId: neutralItem.id,
      heldItem: neutralItem.name,
      nature: "Hardy",
      evs: {
        hp: 0,
        attack: index % 2 === 0 ? 252 : 0,
        defense: 0,
        specialAttack: index % 2 === 1 ? 252 : 0,
        specialDefense: 0,
        speed: 0,
      },
      moves: packages[index].map(asBuildMove) as PokemonRecord["build"]["moves"],
    },
  }));
  return { roster, fixtureCatalog };
}

function availabilityFor(
  member: PokemonRecord,
  stage: AvailabilityRecord["stage"],
): AvailabilityRecord {
  const details = {
    Early: { difficulty: "Easy" as const, score: 82 },
    Mid: { difficulty: "Moderate" as const, score: 74 },
    Late: { difficulty: "Late game" as const, score: 25 },
  }[stage];
  return {
    speciesId: member.id,
    stage,
    ...details,
    evolutionLine: "Fixture final evolution",
    guidance: `Fixture ${stage.toLowerCase()} acquisition.`,
    evidence: [{ kind: "spawn", sourcePath: "fixture://journey", summary: `${stage} source evidence.` }],
  };
}

function withStages(
  roster: PokemonRecord[],
  stages: readonly string[],
): PokemonRecord[] {
  return roster.map((member, index) => ({
    ...member,
    availability: availabilityFor(
      member,
      stages[index] as AvailabilityRecord["stage"],
    ),
  }));
}

describe("journey acquisition curve", () => {
  it("reproduces pre-curve scoring and partial search when influence is neutral", () => {
    const expected = [
      {
        seed: "JOURNEY-COMPAT-1",
        members: [
          "blaziken",
          "garchomp",
          "kingambit",
          "sigilyph",
          "basculegion",
          "kleavor",
        ],
        score: {
          total: 92,
          journeyScore: 89,
          battleScore: 96,
          roleCoverage: 90,
          defensiveFit: 100,
          offensiveReach: 96,
          journeyFit: 83,
          utility: 43,
        },
      },
      {
        seed: "JOURNEY-COMPAT-2",
        members: [
          "blaziken",
          "dragapult",
          "tyranitar",
          "kilowattrel",
          "mamoswine",
          "durant",
        ],
        score: {
          total: 91,
          journeyScore: 89,
          battleScore: 93,
          roleCoverage: 80,
          defensiveFit: 100,
          offensiveReach: 96,
          journeyFit: 83,
          utility: 43,
        },
      },
    ];

    for (const fixture of expected) {
      const input = request(fixture.seed);
      const result = generateTeam(input, catalog, { influence: 0 });
      const neutralCurve = journeyCurveQualityForTeam(
        result.members,
        input,
        catalog,
        { influence: 0 },
      );

      expect(result.members.map((member) => member.id)).toEqual(fixture.members);
      expect(result.score).toEqual(fixture.score);
      expect(neutralCurve.score).toBe(legacyJourneyFitForTeam(result.members));
      expect(scoreTeam(result.members, input, catalog, { influence: 0 })).toEqual(
        fixture.score,
      );
    }
  });
  it("prefers progressive functionality over late functionality at the same average availability", () => {
    const { roster, fixtureCatalog } = fixtureContext();
    const progressive = withStages(roster, benchmark.sameAverage.progressiveStages);
    const clustered = withStages(roster, benchmark.sameAverage.clusteredStages);
    const progressiveCurve = journeyCurveQualityForTeam(
      progressive,
      request("JOURNEY-PROGRESSIVE"),
      fixtureCatalog,
    );
    const clusteredCurve = journeyCurveQualityForTeam(
      clustered,
      request("JOURNEY-CLUSTERED"),
      fixtureCatalog,
    );

    expect(progressiveCurve.averageAvailability).toBe(clusteredCurve.averageAvailability);
    expect(progressiveCurve.score).toBeGreaterThan(clusteredCurve.score);
    const progressiveScore = scoreTeam(
      progressive,
      request("JOURNEY-PROGRESSIVE"),
      fixtureCatalog,
    );
    const clusteredScore = scoreTeam(
      clustered,
      request("JOURNEY-CLUSTERED"),
      fixtureCatalog,
    );
    expect(progressiveScore.total).toBe(clusteredScore.total);
    expect(
      compareJourneyFinalists(
        { roster: progressive, score: progressiveScore },
        { roster: clustered, score: clusteredScore },
      ),
    ).toBeLessThan(0);
    const progressiveFinalist = {
      roster: progressive,
      score: progressiveScore,
    };
    const clusteredFinalist = {
      roster: clustered,
      score: clusteredScore,
    };
    let pickCount = 0;
    const selected = selectEliteRoster(
      [progressiveFinalist, clusteredFinalist],
      {
        pick: (values) => {
          pickCount += 1;
          return pickCount === 1
            ? values.find((value) => value === clusteredFinalist)!
            : values.find((value) => value === progressiveFinalist)!;
        },
      },
    );
    expect(selected.selected).toBe(progressiveFinalist);
    expect(pickCount).toBe(2);
    expect(progressiveCurve.milestones.map((milestone) => milestone.stage)).toEqual([
      "Early",
      "Mid",
      "Late",
    ]);
    expect(progressiveCurve.explanation).toMatch(/Early.*Mid.*Late/);
  });

  it("keeps a useful late addition and explains its final-team function", () => {
    const { roster, fixtureCatalog } = fixtureContext();
    const stages = ["Early", "Early", "Mid", "Late", "Mid", "Early"];
    const result = materializeTeamResult(
      withStages(roster, stages),
      request("JOURNEY-STRONG-LATE"),
      fixtureCatalog,
    );
    const lateMember = result.members[benchmark.strongLateAddition.memberIndex];

    expect(result.members).toContain(lateMember);
    expect(result.battleQuality.acquisitionCurve.lateMembers).toContain(lateMember.id);
    expect(lateMember.jobs).toEqual(expect.arrayContaining(benchmark.strongLateAddition.expectedJobs));
    expect(result.battleQuality.acquisitionCurve.explanation).toContain(lateMember.name);
    expect(result.battleQuality.acquisitionCurve.lateClusterPenalty).toBe(0);
  });

  it("applies no timing penalty in unrestricted mode regardless of acquisition stages", () => {
    const { roster, fixtureCatalog } = fixtureContext();
    const input = request("UNRESTRICTED-PARITY", "unrestricted");
    const early = withStages(roster, benchmark.unrestrictedParity.firstStages);
    const late = withStages(roster, benchmark.unrestrictedParity.secondStages);
    const earlyCurve = journeyCurveQualityForTeam(early, input, fixtureCatalog);
    const lateCurve = journeyCurveQualityForTeam(late, input, fixtureCatalog);

    expect(earlyCurve.timingPenalty).toBe(0);
    expect(lateCurve.timingPenalty).toBe(0);
    expect(earlyCurve.score).toBe(lateCurve.score);
    expect(scoreTeam(early, input, fixtureCatalog)).toEqual(
      scoreTeam(late, input, fixtureCatalog),
    );
    expect(lateCurve.explanation).toMatch(/Unrestricted mode.*no journey timing adjustment/);
  });

  it("keeps active unrestricted search independent of acquisition stage", () => {
    const input = request("UNRESTRICTED-SEARCH-PARITY", "unrestricted");
    const asStageCatalog = (stage: AvailabilityRecord["stage"]) => ({
      ...catalog,
      availability: catalog.availability.map((entry) => ({
        ...entry,
        stage,
        difficulty:
          stage === "Early"
            ? ("Easy" as const)
            : stage === "Mid"
              ? ("Moderate" as const)
              : ("Late game" as const),
        score: stage === "Early" ? 90 : stage === "Mid" ? 74 : 25,
      })),
    });
    const early = generateTeam(input, asStageCatalog("Early"));
    const late = generateTeam(input, asStageCatalog("Late"));

    expect(early.members.map((member) => member.id)).toEqual(
      late.members.map((member) => member.id),
    );
    expect(early.score).toEqual(late.score);
    expect(early.battleQuality.acquisitionCurve.timingPenalty).toBe(0);
    expect(late.battleQuality.acquisitionCurve.timingPenalty).toBe(0);
  });

  it("rescored alternatives describe acquisition timing from the complete roster", () => {
    const input = request("JOURNEY-ALTERNATIVES");
    const current = generateTeam(input, catalog);
    const alternatives = generateAlternatives(0, input, current, catalog);

    expect(current.battleQuality.acquisitionCurve.explanation.length).toBeGreaterThan(0);
    for (const alternative of alternatives) {
      expect(alternative.result.battleQuality.acquisitionCurve.milestones).toHaveLength(3);
      expect(alternative.tradeoff).toMatch(/Acquisition curve/);
    }
  });
});
