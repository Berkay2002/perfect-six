import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import {
  battlePlanMemberForBuild,
  battlePlanQualityForTeam,
  standardStatIndexForBuild,
} from "@/engine/battle-plan";
import benchmark from "@/engine/fixtures/battle-plan-benchmark.json";
import { generateTeam, materializeTeamResult } from "@/engine/generate";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type AbilityRecord,
  type GeneratorRequest,
  type ItemCapabilities,
  type ItemRecord,
  type MoveBuild,
  type MoveRecord,
  type NormalizedCatalog,
  type PokemonRecord,
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

const asBuildMove = (move: MoveRecord): MoveBuild => ({
  id: move.id,
  name: move.name,
  type: move.type,
  category: move.category,
  power: move.power,
  accuracy: move.accuracy,
  purpose: "Committed battle-plan fixture.",
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

function fixtureContext() {
  const source = generateTeam(request("BATTLE-PLAN-FIXTURE-SOURCE"), catalog);
  const allPhysical = catalog.moves.filter(
    (move) => move.category === "Physical" && (move.power ?? 0) > 0,
  );
  const physical = allPhysical
    .filter((move) => move.priority === 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const special = catalog.moves.filter(
    (move) =>
      move.category === "Special" &&
      (move.power ?? 0) > 0 &&
      move.priority === 0 &&
      move.effect.healingFraction === null &&
      move.effect.drainFraction === null,
  ).sort((left, right) => left.id.localeCompare(right.id));
  const priority = allPhysical
    .filter((move) => move.priority > 0)
    .sort((left, right) => left.id.localeCompare(right.id))[0]!;
  const speedSetup = catalog.moves
    .filter(
    (move) => (move.capabilities?.selfBoosts?.spe ?? 0) > 0,
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0]!;
  const recovery = catalog.moves
    .filter(
    (move) => move.category === "Status" && move.effect.healingFraction !== null,
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0]!;
  expect([priority, speedSetup, recovery]).not.toContain(undefined);
  const neutralItem = {
    id: "battleplanneutralitem",
    name: "Battle Plan Neutral Item",
    description: "Fixture item with no supported effect.",
    megaStone: null,
    megaEvolves: null,
    capabilities: neutralItemCapabilities(),
    source: "fixture://battle-plan",
  };
  const neutralAbility = {
    id: "battleplanneutralability",
    name: "Battle Plan Neutral Ability",
    description: "Fixture ability with no supported effect.",
    rating: null,
    capabilities: {
      immunities: [],
      absorptions: [],
      weather: [],
      weatherDetriments: [],
    },
    source: "fixture://battle-plan",
  };
  const fixtureCatalog = {
    ...catalog,
    items: [...catalog.items, neutralItem],
    abilities: [...catalog.abilities, neutralAbility],
  } satisfies NormalizedCatalog;
  return {
    source,
    physical,
    special,
    priority,
    speedSetup,
    recovery,
    neutralItem,
    neutralAbility,
    fixtureCatalog,
  };
}

let sharedFixtureContext: ReturnType<typeof fixtureContext> | undefined;

function getFixtureContext() {
  sharedFixtureContext ??= fixtureContext();
  return sharedFixtureContext;
}

function materializeScenario(
  scenario: (typeof benchmark.scenarios)[number],
  context: ReturnType<typeof fixtureContext>,
) {
  const speedSetupSlots: number[] = scenario.speedSetupSlots;
  const prioritySlots: number[] = scenario.prioritySlots;
  const recoverySlots: number[] = scenario.recoverySlots;
  const roster = context.source.members.map((member, index) => {
    const moves: MoveRecord[] = speedSetupSlots.includes(index)
      ? [context.speedSetup, ...context.physical.slice(0, 3)]
      : prioritySlots.includes(index)
        ? [context.priority, ...context.physical.filter((move) => move.id !== context.priority.id).slice(0, 3)]
        : recoverySlots.includes(index)
          ? [context.recovery, ...context.special.slice(0, 3)]
          : index % 2 === 0
            ? context.physical.slice(0, 4)
            : context.special.slice(0, 4);
    return {
      ...member,
      stats: {
        ...member.stats,
        hp: scenario.hp[index],
        attack: 105,
        defense: scenario.defense[index],
        specialAttack: 105,
        specialDefense: scenario.specialDefense[index],
        speed: scenario.speeds[index],
      },
      build: {
        ...member.build,
        abilityId: context.neutralAbility.id,
        ability: context.neutralAbility.name,
        heldItemId: context.neutralItem.id,
        heldItem: context.neutralItem.name,
        nature: "Hardy",
        evs: {
          hp: recoverySlots.includes(index) ? 252 : 0,
          attack: index % 2 === 0 ? 252 : 0,
          defense: scenario.id === "one-sided-defense" ? 252 : 0,
          specialAttack: index % 2 === 1 ? 252 : 0,
          specialDefense: scenario.id === "bulky-team" ? 252 : 0,
          speed: scenario.id.includes("offense") ? 252 : 0,
        },
        moves: moves.map(asBuildMove) as PokemonRecord["build"]["moves"],
      },
    };
  });
  return materializeTeamResult(
    roster,
    request(`BATTLE-PLAN-${scenario.id}`),
    context.fixtureCatalog,
  );
}

describe("standard-level stat index", () => {
  it("uses level 50, 31 IVs, EVs, nature, and normalized numeric modifiers", () => {
    const context = getFixtureContext();
    const member = {
      ...context.source.members[0],
      stats: {
        hp: 100,
        attack: 100,
        defense: 100,
        specialAttack: 100,
        specialDefense: 100,
        speed: 100,
      },
      build: {
        ...context.source.members[0].build,
        nature: "Timid",
        evs: {
          hp: 252,
          attack: 0,
          defense: 0,
          specialAttack: 0,
          specialDefense: 0,
          speed: 252,
        },
      },
    };
    const speedItem = {
      ...context.neutralItem,
      id: "battleplanspeeditem",
      name: "Battle Plan Speed Item",
      capabilities: {
        ...neutralItemCapabilities(),
        speedMultiplier: 1.5,
      },
    };

    const index = standardStatIndexForBuild(member, speedItem);

    expect(index.level).toBe(benchmark.standardLevel);
    expect(index.assumedIvs).toBe(benchmark.assumedIvs);
    expect(index.hp).toBe(207);
    expect(index.attack).toBe(108);
    expect(index.speed).toBe(250);
    expect(index.appliedModifiers).toContain(
      "Battle Plan Speed Item: sourced 1.5x Speed",
    );

    const slowItem = {
      ...speedItem,
      id: "battleplanslowitem",
      name: "Battle Plan Slow Item",
      capabilities: {
        ...neutralItemCapabilities(),
        speedMultiplier: 0.5,
      },
    };
    const slowed = standardStatIndexForBuild(member, slowItem);
    const slowedCatalog = {
      ...context.fixtureCatalog,
      items: [...context.fixtureCatalog.items, slowItem],
    };
    const slowedMember = {
      ...member,
      stats: { ...member.stats, speed: 40 },
      build: {
        ...member.build,
        heldItemId: slowItem.id,
        heldItem: slowItem.name,
      },
    };
    expect(slowed.speed).toBe(83);
    expect(
      battlePlanMemberForBuild(slowedMember, slowedCatalog).itemSpeed,
    ).toBe(false);
  });
});

describe("source-derived numeric modifiers", () => {
  function modifierFixture() {
    const context = getFixtureContext();
    const member = {
      ...context.source.members[0],
      finalEvolution: false,
      stats: {
        hp: 100,
        attack: 100,
        defense: 100,
        specialAttack: 100,
        specialDefense: 100,
        speed: 100,
      },
      build: {
        ...context.source.members[0].build,
        nature: "Hardy",
        evs: {
          hp: 0,
          attack: 0,
          defense: 0,
          specialAttack: 0,
          specialDefense: 0,
          speed: 0,
        },
        moves: context.physical.slice(0, 4).map(asBuildMove) as PokemonRecord["build"]["moves"],
      },
    };
    const choiceItem: ItemRecord = {
      ...context.neutralItem,
      id: "sourcedchoicephysical",
      name: "Sourced Choice Physical",
      capabilities: {
        ...neutralItemCapabilities(),
        damageCategory: "physical",
        choiceLock: true,
      },
      modifiers: {
        statMultipliers: [
          {
            stat: "attack",
            multiplier: 1.5,
            conditions: [{ kind: "choice-lock-compatible" }],
          },
        ],
        damageTakenMultipliers: [],
      },
    };
    const directDefense: AbilityRecord = {
      ...context.neutralAbility,
      id: "sourceddirectdefense",
      name: "Sourced Direct Defense",
      modifiers: {
        statMultipliers: [
          { stat: "defense", multiplier: 2, conditions: [] },
        ],
        damageTakenMultipliers: [],
      },
    };
    return { context, member, choiceItem, directDefense };
  }

  it("combines compatible item and unconditional ability stat multipliers", () => {
    const { member, choiceItem, directDefense } = modifierFixture();

    const index = standardStatIndexForBuild(
      member,
      choiceItem,
      directDefense,
    );

    expect(index.attack).toBe(180);
    expect(index.defense).toBe(240);
    expect(index.appliedModifiers).toEqual([
      "Sourced Choice Physical: sourced 1.5x Attack",
      "Sourced Direct Defense: sourced 2x Defense",
    ]);
  });

  it("requires explicit active weather for weather-conditional modifiers", () => {
    const { member } = modifierFixture();
    const weatherSpeed: AbilityRecord = {
      ...getFixtureContext().neutralAbility,
      id: "sourcedweatherspeed",
      name: "Sourced Weather Speed",
      modifiers: {
        statMultipliers: [
          {
            stat: "speed",
            multiplier: 2,
            conditions: [{ kind: "weather", weather: "rain" }],
          },
        ],
        damageTakenMultipliers: [],
      },
    };

    expect(
      standardStatIndexForBuild(member, undefined, weatherSpeed).speed,
    ).toBe(120);
    const active = standardStatIndexForBuild(
      member,
      undefined,
      weatherSpeed,
      { activeWeather: "rain" },
    );
    expect(active.speed).toBe(240);
    expect(active.appliedModifiers).toContain(
      "Sourced Weather Speed: sourced 2x Speed while rain is active",
    );
  });

  it("applies item stats only when move and evolution conditions fit", () => {
    const { context, member } = modifierFixture();
    const specialArmor: ItemRecord = {
      ...context.neutralItem,
      id: "sourcedspecialarmor",
      name: "Sourced Special Armor",
      capabilities: {
        ...neutralItemCapabilities(),
        defensiveStats: ["specialDefense"],
        damagingMovesOnly: true,
      },
      modifiers: {
        statMultipliers: [
          {
            stat: "specialDefense",
            multiplier: 1.5,
            conditions: [{ kind: "damaging-moves-only" }],
          },
        ],
        damageTakenMultipliers: [],
      },
    };
    const evolutionArmor: ItemRecord = {
      ...specialArmor,
      id: "sourcedevolutionarmor",
      name: "Sourced Evolution Armor",
      capabilities: {
        ...neutralItemCapabilities(),
        defensiveStats: ["defense", "specialDefense"],
        requiresEvolutionPotential: true,
      },
      modifiers: {
        statMultipliers: [
          {
            stat: "defense",
            multiplier: 1.5,
            conditions: [{ kind: "can-evolve" }],
          },
          {
            stat: "specialDefense",
            multiplier: 1.5,
            conditions: [{ kind: "can-evolve" }],
          },
        ],
        damageTakenMultipliers: [],
      },
    };
    const statusMove = context.recovery;
    const incompatible = {
      ...member,
      build: {
        ...member.build,
        moves: [
          asBuildMove(statusMove),
          ...member.build.moves.slice(1),
        ] as PokemonRecord["build"]["moves"],
      },
    };
    const choiceSpeed: ItemRecord = {
      ...specialArmor,
      id: "sourcedchoicespeed",
      name: "Sourced Choice Speed",
      capabilities: {
        ...neutralItemCapabilities(),
        choiceLock: true,
        speedMultiplier: 1.5,
      },
      modifiers: {
        statMultipliers: [
          {
            stat: "speed",
            multiplier: 1.5,
            conditions: [{ kind: "choice-lock-compatible" }],
          },
        ],
        damageTakenMultipliers: [],
      },
    };
    const incompatibleSpeedMember = {
      ...incompatible,
      stats: { ...incompatible.stats, speed: 40 },
      build: {
        ...incompatible.build,
        heldItemId: choiceSpeed.id,
        heldItem: choiceSpeed.name,
      },
    };
    const choiceCatalog = {
      ...context.fixtureCatalog,
      items: [...context.fixtureCatalog.items, choiceSpeed],
    };

    expect(
      standardStatIndexForBuild(member, specialArmor).specialDefense,
    ).toBe(180);
    expect(
      standardStatIndexForBuild(incompatible, specialArmor).specialDefense,
    ).toBe(120);
    expect(
      standardStatIndexForBuild(member, evolutionArmor).defense,
    ).toBe(180);
    expect(
      standardStatIndexForBuild(
        { ...member, finalEvolution: true },
        evolutionArmor,
      ).defense,
    ).toBe(120);
    expect(standardStatIndexForBuild(incompatible, choiceSpeed).speed).toBe(120);
    expect(
      battlePlanMemberForBuild(incompatibleSpeedMember, choiceCatalog).itemSpeed,
    ).toBe(false);
  });

  it("requires offensive item fit and models 0.5 damage taken as mitigation", () => {
    const { context, member, choiceItem } = modifierFixture();
    const specialOnly = {
      ...member,
      build: {
        ...member.build,
        moves: context.special.slice(0, 4).map(asBuildMove) as PokemonRecord["build"]["moves"],
      },
    };
    expect(standardStatIndexForBuild(specialOnly, choiceItem).attack).toBe(120);

    const mitigation: AbilityRecord = {
      ...context.neutralAbility,
      id: "sourcedspecialmitigation",
      name: "Sourced Special Mitigation",
      modifiers: {
        statMultipliers: [],
        damageTakenMultipliers: [
          { category: "special", multiplier: 0.5, conditions: [] },
        ],
      },
    };
    const fixtureCatalog = {
      ...context.fixtureCatalog,
      abilities: [...context.fixtureCatalog.abilities, mitigation],
    };
    const roster = context.source.members.map((sourceMember, index) =>
      index === 0
        ? {
            ...member,
            build: {
              ...member.build,
              abilityId: mitigation.id,
              ability: mitigation.name,
            },
          }
        : sourceMember,
    );
    const baseline = battlePlanQualityForTeam(
      roster.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              build: {
                ...candidate.build,
                abilityId: context.neutralAbility.id,
                ability: context.neutralAbility.name,
              },
            }
          : candidate,
      ),
      request("DAMAGE-MITIGATION-BASELINE"),
      fixtureCatalog,
    );
    const protectedPlan = battlePlanQualityForTeam(
      roster,
      request("DAMAGE-MITIGATION-ACTIVE"),
      fixtureCatalog,
    );

    expect(
      protectedPlan.memberIndices[0].stats.specialDefense,
    ).toBe(120);
    expect(protectedPlan.specialResilience.effectiveBulk).toBeGreaterThan(
      baseline.specialResilience.effectiveBulk,
    );
    expect(protectedPlan.physicalResilience.effectiveBulk).toBe(
      baseline.physicalResilience.effectiveBulk,
    );
    expect(protectedPlan.specialResilience.explanation).toContain(
      "Sourced Special Mitigation: sourced 0.5x special damage taken",
    );
  });
});

describe("battle-plan benchmark", () => {
  it.each(benchmark.scenarios)("evaluates $label", (scenario) => {
    const context = getFixtureContext();
    const result = materializeScenario(scenario, context);
    const plan = result.battleQuality.plan;

    if (scenario.expected.minimumSpeed !== undefined) {
      expect(plan.speed.score).toBeGreaterThanOrEqual(
        scenario.expected.minimumSpeed,
      );
    }
    if (scenario.expected.minimumPhysicalDefense !== undefined) {
      expect(plan.physicalResilience.score).toBeGreaterThanOrEqual(
        scenario.expected.minimumPhysicalDefense,
      );
    }
    if (scenario.expected.minimumSpecialDefense !== undefined) {
      expect(plan.specialResilience.score).toBeGreaterThanOrEqual(
        scenario.expected.minimumSpecialDefense,
      );
    }
    const gap = Math.abs(
      plan.physicalResilience.score - plan.specialResilience.score,
    );
    if (scenario.expected.maximumDefenseGap !== undefined) {
      expect(gap).toBeLessThanOrEqual(scenario.expected.maximumDefenseGap);
    }
    if (scenario.expected.minimumDefenseGap !== undefined) {
      expect(gap).toBeGreaterThanOrEqual(scenario.expected.minimumDefenseGap);
    }
    if (scenario.expected.maximumContribution !== undefined) {
      expect(plan.contribution).toBeLessThanOrEqual(
        scenario.expected.maximumContribution,
      );
    }
    expect(plan.explanation.toLowerCase()).toContain(
      scenario.expected.speedFact.toLowerCase(),
    );
    if (scenario.expected.concern) {
      expect(plan.concerns.join(" ").toLowerCase()).toContain(
        scenario.expected.concern.toLowerCase(),
      );
    }
    expect(result.score.total).toBeGreaterThanOrEqual(0);
    expect(result.score.total).toBeLessThanOrEqual(100);
  });

  it("penalizes missing speed control and one-sided defense at the score seam", () => {
    const context = getFixtureContext();
    const fast = materializeScenario(benchmark.scenarios[0], context);
    const oneSided = materializeScenario(benchmark.scenarios[3], context);

    expect(fast.battleQuality.plan.contribution).toBeGreaterThan(
      oneSided.battleQuality.plan.contribution,
    );
    expect(oneSided.battleQuality.plan.speed.missing).toBe(true);
    expect(oneSided.battleQuality.plan.explanation).toMatch(
      /missing speed control/i,
    );
  });

  it("rescored alternatives explain speed and resilience deltas", () => {
    const input = request("BATTLE-PLAN-ALTERNATIVES");
    const current = generateTeam(input, catalog);
    const alternatives = generateAlternatives(0, input, current, catalog);

    expect(alternatives).toHaveLength(3);
    for (const alternative of alternatives) {
      expect(alternative.result.battleQuality.plan.explanation.length).toBeGreaterThan(0);
      expect(alternative.tradeoff).toMatch(/Speed plan/);
      expect(alternative.tradeoff).toMatch(/physical resilience/);
      expect(alternative.scoreDelta).toBe(
        alternative.result.score.total - current.score.total,
      );
    }
  });

  it("uses sourced immunities, absorptions, recovery, and type coverage", () => {
    const context = getFixtureContext();
    const baseline = materializeScenario(benchmark.scenarios[2], context);
    const recovery = catalog.moves.find(
      (move) => move.category === "Status" && move.effect.healingFraction !== null,
    )!;
    const absorption = catalog.abilities.find(
      (ability) => ability.capabilities.absorptions.length > 0,
    )!;
    const improvedRoster = baseline.members.map((member, index) =>
      index === 0
        ? {
            ...member,
            build: {
              ...member.build,
              abilityId: absorption.id,
              ability: absorption.name,
              moves: [asBuildMove(recovery), ...member.build.moves.slice(1)] as PokemonRecord["build"]["moves"],
            },
          }
        : member,
    );

    const improved = battlePlanQualityForTeam(
      improvedRoster,
      request("BATTLE-PLAN-SOURCED-DEFENSE"),
      catalog,
    );

    expect(improved.explanation).toContain(absorption.name);
    expect(improved.explanation).toContain(recovery.name);
    expect(improved.physicalResilience.switchInCoverage).toBeGreaterThan(0);
    expect(improved.specialResilience.switchInCoverage).toBeGreaterThan(0);
  });

  it("is independent of catalog record ordering", () => {
    const context = getFixtureContext();
    const result = materializeScenario(benchmark.scenarios[2], context);
    const reversedCatalog = {
      ...context.fixtureCatalog,
      moves: [...context.fixtureCatalog.moves].reverse(),
      items: [...context.fixtureCatalog.items].reverse(),
      abilities: [...context.fixtureCatalog.abilities].reverse(),
    };

    expect(
      battlePlanQualityForTeam(
        result.members,
        request("BATTLE-PLAN-ORDER-INDEPENDENCE"),
        reversedCatalog,
      ),
    ).toEqual(result.battleQuality.plan);
  });
});
