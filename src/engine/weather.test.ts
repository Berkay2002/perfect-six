import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { abilityBuildValue, abilityQualityForTeam } from "@/engine/ability";
import { battlePlanMemberForBuild } from "@/engine/battle-plan";
import { generateTeam } from "@/engine/generate";
import { scoreTeam } from "@/engine/score";
import { synergyQualityForTeam } from "@/engine/synergy";
import { teamQualityForTeam } from "@/engine/team";
import { weatherPlanForTeam } from "@/engine/weather";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type AbilityRecord,
  type GeneratorRequest,
  type MoveBuild,
  type MoveRecord,
  type NormalizedCatalog,
  type PokemonRecord,
  type Weather,
} from "@/lib/types";

const request = (
  seed: string,
  weather: Exclude<Weather, "random"> = "rain",
): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed,
  style: "weather",
  weather,
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
  purpose: "Weather mechanics fixture.",
});

function weatherFixture() {
  const source = generateTeam(request("WEATHER-CONTEXT-SOURCE"), catalog);
  const neutralAbility = catalog.abilities.find(
    (ability) =>
      ability.capabilities.weather.length === 0 &&
      ability.capabilities.weatherDetriments.length === 0 &&
      (ability.modifiers?.statMultipliers.length ?? 0) === 0,
  )!;
  const beneficiary = catalog.abilities.find(
    (ability) =>
      ability.capabilities.weatherBenefits?.includes("rain") &&
      ability.modifiers?.statMultipliers.some(
        (modifier) =>
          modifier.stat === "speed" &&
          modifier.multiplier > 1 &&
          modifier.conditions.some(
            (condition) =>
              condition.kind === "weather" && condition.weather === "rain",
          ),
      ),
  )!;
  const rainSetter = catalog.abilities.find((ability) =>
    ability.capabilities.weatherSetters?.includes("rain"),
  )!;
  const sunSetter = catalog.abilities.find((ability) =>
    ability.capabilities.weatherSetters?.includes("sun"),
  )!;
  const sunDetriment = catalog.abilities.find((ability) =>
    ability.capabilities.weatherDetriments.includes("sun"),
  )!;
  const attacks = catalog.moves
    .filter(
      (move) =>
        move.category !== "Status" &&
        (move.power ?? 0) > 0 &&
        move.effect.weather === null,
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 4);
  expect([
    neutralAbility,
    beneficiary,
    rainSetter,
    sunSetter,
    sunDetriment,
    ...attacks,
  ]).not.toContain(undefined);

  const fixtureCatalog = {
    ...catalog,
    abilities: catalog.abilities.map((ability) => ({ ...ability, rating: null })),
  } satisfies NormalizedCatalog;
  const neutral = source.members.map((member) => ({
    ...member,
    build: {
      ...member.build,
      abilityId: neutralAbility.id,
      ability: neutralAbility.name,
      moves: attacks.map(asBuildMove) as PokemonRecord["build"]["moves"],
    },
  })) as PokemonRecord[];
  const withAbility = (
    roster: PokemonRecord[],
    slot: number,
    ability: AbilityRecord,
  ) =>
    roster.map((member, index) =>
      index === slot
        ? {
            ...member,
            build: {
              ...member.build,
              abilityId: ability.id,
              ability: ability.name,
            },
          }
        : member,
    );
  return {
    fixtureCatalog,
    neutral,
    beneficiary,
    rainSetter,
    sunSetter,
    sunDetriment,
    withAbility,
  };
}

describe("source-backed weather mechanics context", () => {
  it("keeps an orphan beneficiary inactive across ability, jobs, score, plan, and synergy", () => {
    const fixture = weatherFixture();
    const orphan = fixture.withAbility(
      fixture.neutral,
      0,
      fixture.beneficiary,
    );
    const input = request("WEATHER-ORPHAN");
    const plan = weatherPlanForTeam(orphan, input, fixture.fixtureCatalog);
    const neutralPlan = weatherPlanForTeam(
      fixture.neutral,
      input,
      fixture.fixtureCatalog,
    );

    expect(plan.activeWeather).toBeUndefined();
    expect(plan.beneficiaryMemberIds).toContain(orphan[0].id);
    expect(abilityBuildValue(fixture.beneficiary, input, plan.context)).toBe(
      abilityBuildValue(fixture.beneficiary, input, neutralPlan.context),
    );
    expect(teamQualityForTeam(orphan, input, fixture.fixtureCatalog).coveredJobs).not.toContain(
      "weather support",
    );
    expect(scoreTeam(orphan, input, fixture.fixtureCatalog).battleScore).toBe(
      scoreTeam(fixture.neutral, input, fixture.fixtureCatalog).battleScore,
    );
    expect(
      synergyQualityForTeam(orphan, input, fixture.fixtureCatalog).interactions,
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "weather support" })]),
    );
    expect(
      battlePlanMemberForBuild(orphan[0], fixture.fixtureCatalog, plan.context)
        .stats.appliedModifiers,
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/weather/i)]));
  });

  it("activates matching setter-only weather but reserves synergy for a distinct beneficiary", () => {
    const fixture = weatherFixture();
    const setterOnly = fixture.withAbility(
      fixture.neutral,
      1,
      fixture.rainSetter,
    );
    const input = request("WEATHER-SETTER");
    const plan = weatherPlanForTeam(
      setterOnly,
      input,
      fixture.fixtureCatalog,
    );

    expect(plan.activeWeather).toBe("rain");
    expect(plan.setterMemberIds).toContain(setterOnly[1].id);
    expect(teamQualityForTeam(setterOnly, input, fixture.fixtureCatalog).coveredJobs).toContain(
      "weather support",
    );
    expect(
      synergyQualityForTeam(setterOnly, input, fixture.fixtureCatalog).interactions,
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "weather support" })]),
    );
  });

  it("activates a distinct setter-beneficiary plan and its conditional Speed modifier", () => {
    const fixture = weatherFixture();
    const beneficiary = fixture.withAbility(
      fixture.neutral,
      0,
      fixture.beneficiary,
    );
    const complete = fixture.withAbility(
      beneficiary,
      1,
      fixture.rainSetter,
    );
    const input = request("WEATHER-COMPLETE");
    const orphanPlan = weatherPlanForTeam(
      beneficiary,
      input,
      fixture.fixtureCatalog,
    );
    const completePlan = weatherPlanForTeam(
      complete,
      input,
      fixture.fixtureCatalog,
    );

    expect(completePlan.activeWeather).toBe("rain");
    expect(completePlan.supported).toBe(true);
    expect(
      abilityBuildValue(
        fixture.beneficiary,
        input,
        completePlan.context,
      ),
    ).toBeGreaterThan(
      abilityBuildValue(
        fixture.beneficiary,
        input,
        orphanPlan.context,
      ),
    );
    expect(
      abilityQualityForTeam(complete, input, fixture.fixtureCatalog).explanation,
    ).toContain("while active");
    expect(scoreTeam(complete, input, fixture.fixtureCatalog).battleScore).toBeGreaterThan(
      scoreTeam(beneficiary, input, fixture.fixtureCatalog).battleScore,
    );
    expect(
      battlePlanMemberForBuild(
        complete[0],
        fixture.fixtureCatalog,
        completePlan.context,
      ).stats.speed,
    ).toBeGreaterThan(
      battlePlanMemberForBuild(
        beneficiary[0],
        fixture.fixtureCatalog,
        orphanPlan.context,
      ).stats.speed,
    );
    expect(
      synergyQualityForTeam(complete, input, fixture.fixtureCatalog).interactions,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "weather support" })]),
    );
  });

  it("activates detriments only under matching sourced weather and ignores conflicting setters", () => {
    const fixture = weatherFixture();
    const detrimental = fixture.withAbility(
      fixture.neutral,
      0,
      fixture.sunDetriment,
    );
    const active = fixture.withAbility(detrimental, 1, fixture.sunSetter);
    const conflicting = fixture.withAbility(
      detrimental,
      1,
      fixture.rainSetter,
    );
    const input = request("WEATHER-DETRIMENT", "sun");
    const inactivePlan = weatherPlanForTeam(
      detrimental,
      input,
      fixture.fixtureCatalog,
    );
    const activePlan = weatherPlanForTeam(active, input, fixture.fixtureCatalog);
    const conflictPlan = weatherPlanForTeam(
      conflicting,
      input,
      fixture.fixtureCatalog,
    );

    expect(inactivePlan.activeWeather).toBeUndefined();
    expect(conflictPlan.activeWeather).toBeUndefined();
    expect(activePlan.activeWeather).toBe("sun");
    expect(
      abilityBuildValue(fixture.sunDetriment, input, activePlan.context),
    ).toBeLessThan(
      abilityBuildValue(fixture.sunDetriment, input, inactivePlan.context),
    );
  });

  it("keeps locked generation from exposing orphan weather support", () => {
    const fixture = weatherFixture();
    const orphan = fixture.withAbility(
      fixture.neutral,
      0,
      fixture.beneficiary,
    );
    const input = {
      ...request("WEATHER-GENERATION"),
      slots: orphan.map((member) => member.id),
    } as GeneratorRequest;
    const generated = generateTeam(input, {
      ...fixture.fixtureCatalog,
      builds: orphan.map((member) => member.build),
    });

    expect(generated.battleQuality.team.coveredJobs).not.toContain(
      "weather support",
    );
    expect(generated.battleQuality.plan.memberIndices[0].stats.appliedModifiers).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/weather/i)]),
    );
  });
});
