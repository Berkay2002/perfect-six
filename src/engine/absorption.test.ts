import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { abilityBuildValue, abilityFitFacts } from "@/engine/ability";
import { battlePlanQualityForTeam } from "@/engine/battle-plan";
import { generateTeam, materializeTeamResult } from "@/engine/generate";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type AbilityRecord,
  type GeneratorRequest,
  type ItemCapabilities,
  type MoveBuild,
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

const buildMoves = (
  moves: NormalizedCatalog["moves"],
): [MoveBuild, MoveBuild, MoveBuild, MoveBuild] =>
  moves.map((move) => ({
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    purpose: "Source-backed absorption fixture.",
  })) as [MoveBuild, MoveBuild, MoveBuild, MoveBuild];

function ability(
  id: string,
  name: string,
  absorptions: string[],
): AbilityRecord {
  return {
    id,
    name,
    description: absorptions.length
      ? "This Pokemon is immune to Water-type moves and restores HP when hit by a Water-type move."
      : "This Pokemon is immune to Water-type moves and raises a stat when hit by a Water-type move.",
    rating: null,
    capabilities: {
      immunities: ["Water"],
      absorptions,
      weather: [],
      weatherDetriments: [],
      weatherSetters: [],
      weatherBenefits: [],
    },
    source: "fixture://absorption",
  };
}

describe("HP-restoring absorptions", () => {
  it("keeps stat-reactive immunities separate from HP-restoring absorptions", () => {
    for (const id of ["flashfire", "sapsipper", "motordrive"]) {
      const record = catalog.abilities.find((candidate) => candidate.id === id)!;
      expect(record.capabilities.immunities).not.toHaveLength(0);
      expect(record.capabilities.absorptions).toEqual([]);
      expect(abilityFitFacts(record, request("ABSORPTION-FACTS"))).toContain(
        `${record.capabilities.immunities.join("/")} immunity`,
      );
      expect(
        abilityFitFacts(record, request("ABSORPTION-FACTS")).some((fact) =>
          fact.includes("absorption"),
        ),
      ).toBe(false);
    }

    for (const id of ["waterabsorb", "voltabsorb", "eartheater"]) {
      const record = catalog.abilities.find((candidate) => candidate.id === id)!;
      expect(record.capabilities.absorptions).toEqual(
        record.capabilities.immunities,
      );
    }
  });

  it("values healing absorption separately while preserving immunity value", () => {
    const immunity = ability("fixtureimmunity", "Fixture Immunity", []);
    const absorption = ability(
      "fixtureabsorption",
      "Fixture Absorption",
      ["Water"],
    );

    expect(abilityBuildValue(immunity, request("ABSORPTION-VALUE"))).toBe(2);
    expect(abilityBuildValue(absorption, request("ABSORPTION-VALUE"))).toBe(4);
    expect(abilityFitFacts(immunity, request("ABSORPTION-VALUE"))).toEqual([
      "Water immunity",
    ]);
    expect(abilityFitFacts(absorption, request("ABSORPTION-VALUE"))).toEqual([
      "Water immunity",
      "Water absorption",
    ]);
  });

  it("grants sustain jobs only to recovery-backed absorptions", () => {
    const input = request("ABSORPTION-TEAM-JOBS");
    const source = generateTeam(input, catalog);
    const target = source.members.find(
      (member) => !member.mega && member.megaFormIds.length === 0,
    )!;
    const attacks = catalog.moves
      .filter(
        (move) =>
          move.category !== "Status" &&
          (move.power ?? 0) > 0 &&
          move.effect.healingFraction === null &&
          move.effect.drainFraction === null &&
          !move.flags.includes("heal"),
      )
      .slice(0, 4);
    const neutralItem = {
      id: "absorption-neutral-item",
      name: "Absorption Neutral Item",
      description: "Fixture item with no recovery capability.",
      megaStone: null,
      megaEvolves: null,
      capabilities: neutralItemCapabilities(),
      source: "fixture://absorption",
    };
    const fixture = {
      ...catalog,
      items: [...catalog.items, neutralItem],
    } satisfies NormalizedCatalog;
    const rosterFor = (abilityId: string): PokemonRecord[] =>
      source.members.map((member) =>
        member.id === target.id
          ? {
              ...member,
              build: {
                ...member.build,
                abilityId,
                ability: fixture.abilities.find(
                  (record) => record.id === abilityId,
                )!.name,
                heldItemId: neutralItem.id,
                heldItem: neutralItem.name,
                moves: buildMoves(attacks),
              },
            }
          : member,
      );

    const nonHealing = materializeTeamResult(
      rosterFor("flashfire"),
      input,
      fixture,
    );
    const healing = materializeTeamResult(
      rosterFor("waterabsorb"),
      input,
      fixture,
    );
    const nonHealingMember = nonHealing.members.find(
      (member) => member.id === target.id,
    )!;
    const healingMember = healing.members.find(
      (member) => member.id === target.id,
    )!;

    expect(nonHealingMember.jobs).toContain("defensive switch-in");
    expect(nonHealingMember.jobs).not.toContain("sustain");
    expect(nonHealingMember.jobExplanation).toContain("immunity");
    expect(nonHealingMember.jobExplanation).not.toContain(
      "absorption-based sustain",
    );
    expect(healingMember.jobs).toContain("defensive switch-in");
    expect(healingMember.jobs).toContain("sustain");
    expect(healingMember.jobExplanation).toContain("absorption-based sustain");
  });

  it("keeps immunity switch-in coverage but reserves resilience sustain for absorption", () => {
    const input = request("ABSORPTION-BATTLE-PLAN");
    const source = generateTeam(input, catalog);
    const target = source.members.find(
      (member) => !member.mega && member.megaFormIds.length === 0,
    )!;
    const attacks = catalog.moves
      .filter(
        (move) =>
          move.category !== "Status" &&
          (move.power ?? 0) > 0 &&
          move.effect.healingFraction === null &&
          move.effect.drainFraction === null &&
          !move.flags.includes("heal"),
      )
      .slice(0, 4);
    const neutralItem = {
      id: "absorption-plan-neutral-item",
      name: "Absorption Plan Neutral Item",
      description: "Fixture item with no recovery capability.",
      megaStone: null,
      megaEvolves: null,
      capabilities: neutralItemCapabilities(),
      source: "fixture://absorption",
    };
    const immunity = ability("fixtureimmunity", "Fixture Immunity", []);
    const absorption = ability(
      "fixtureabsorption",
      "Fixture Absorption",
      ["Water"],
    );
    const fixture = {
      ...catalog,
      abilities: [...catalog.abilities, immunity, absorption],
      items: [...catalog.items, neutralItem],
    } satisfies NormalizedCatalog;
    const rosterFor = (abilityRecord: AbilityRecord): PokemonRecord[] =>
      source.members.map((member) =>
        member.id === target.id
          ? {
              ...member,
              build: {
                ...member.build,
                abilityId: abilityRecord.id,
                ability: abilityRecord.name,
                heldItemId: neutralItem.id,
                heldItem: neutralItem.name,
                moves: buildMoves(attacks),
              },
            }
          : member,
      );

    const immunityPlan = battlePlanQualityForTeam(
      rosterFor(immunity),
      input,
      fixture,
    );
    const absorptionPlan = battlePlanQualityForTeam(
      rosterFor(absorption),
      input,
      fixture,
    );

    expect(immunityPlan.physicalResilience.switchInCoverage).toBe(
      absorptionPlan.physicalResilience.switchInCoverage,
    );
    expect(immunityPlan.specialResilience.switchInCoverage).toBe(
      absorptionPlan.specialResilience.switchInCoverage,
    );
    expect(immunityPlan.physicalResilience.immunitySources).toContain(target.id);
    expect(immunityPlan.specialResilience.immunitySources).toContain(target.id);
    expect(immunityPlan.physicalResilience.explanation).toContain(
      immunity.name,
    );
    expect(immunityPlan.physicalResilience.score).toBeLessThan(
      absorptionPlan.physicalResilience.score,
    );
    expect(immunityPlan.specialResilience.score).toBeLessThan(
      absorptionPlan.specialResilience.score,
    );
  });
});
