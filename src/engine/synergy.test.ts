import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import benchmark from "@/engine/fixtures/synergy-benchmark.json";
import { generateTeam, materializeTeamResult } from "@/engine/generate";
import { scoreTeam } from "@/engine/score";
import { synergyQualityForTeam } from "@/engine/synergy";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
  type MoveBuild,
  type MoveRecord,
  type PokemonRecord,
} from "@/lib/types";

const request = (seed: string): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed,
  style: "weather",
  weather: "rain",
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
  purpose: "Committed synergy prerequisite fixture.",
});

function move(id: string) {
  const found = catalog.moves.find((candidate) => candidate.id === id);
  expect(found, `Missing sourced fixture move ${id}`).toBeDefined();
  return found!;
}

function ability(id: string) {
  const found = catalog.abilities.find((candidate) => candidate.id === id);
  expect(found, `Missing sourced fixture ability ${id}`).toBeDefined();
  return found!;
}

function fixtureRosters() {
  const source = generateTeam(request("SYNERGY-FIXTURE-SOURCE"), catalog);
  const neutralAbility = ability("airlock");
  const strongPhysical = [
    move("earthquake"),
    move("stoneedge"),
    move("crunch"),
    move("ironhead"),
  ];
  const strongSpecial = [
    move("surf"),
    move("icebeam"),
    move("shadowball"),
    move("energyball"),
  ];
  const neutralMoves = strongPhysical.map(asBuildMove) as PokemonRecord["build"]["moves"];
  const base = source.members.map((member, index) => ({
    ...member,
    id: `synergy-fixture-${index}`,
    name: `Fixture member ${index + 1}`,
    types: ["Normal"] as [string],
    stats: {
      hp: 100,
      attack: 120,
      defense: 100,
      specialAttack: 120,
      specialDefense: 100,
      speed: 100,
    },
    battleScore: 90,
    roles: ["Attacker"],
    build: {
      ...member.build,
      speciesId: `synergy-fixture-${index}`,
      abilityId: neutralAbility.id,
      ability: neutralAbility.name,
      nature: "Hardy",
      evs: {
        hp: 0,
        attack: 252,
        defense: 0,
        specialAttack: 252,
        specialDefense: 0,
        speed: 4,
      },
      moves: neutralMoves,
    },
  })) as PokemonRecord[];

  const coherent = base.map((member) => ({
    ...member,
    build: { ...member.build, moves: [...member.build.moves] as PokemonRecord["build"]["moves"] },
  }));
  coherent[0].types = ["Grass"];
  coherent[0].build.moves = [
    asBuildMove(move("uturn")),
    ...strongPhysical.slice(0, 3).map(asBuildMove),
  ] as PokemonRecord["build"]["moves"];
  coherent[1].build.moves = [
    asBuildMove(move("swordsdance")),
    ...strongPhysical.slice(0, 3).map(asBuildMove),
  ] as PokemonRecord["build"]["moves"];
  coherent[2].types = ["Water"];
  coherent[2].build.moves = [
    asBuildMove(move("reflect")),
    ...strongPhysical.slice(0, 3).map(asBuildMove),
  ] as PokemonRecord["build"]["moves"];
  coherent[3].build.moves = [
    asBuildMove(move("stealthrock")),
    asBuildMove(move("raindance")),
    ...strongPhysical.slice(0, 2).map(asBuildMove),
  ] as PokemonRecord["build"]["moves"];
  const fireImmunity = ability("flashfire");
  coherent[4].build.abilityId = fireImmunity.id;
  coherent[4].build.ability = fireImmunity.name;
  coherent[4].build.moves = [
    asBuildMove(move("defog")),
    ...strongSpecial.slice(0, 3).map(asBuildMove),
  ] as PokemonRecord["build"]["moves"];
  const rainBenefit = ability("swiftswim");
  coherent[5].build.abilityId = rainBenefit.id;
  coherent[5].build.ability = rainBenefit.name;
  coherent[5].build.moves = strongSpecial.map(asBuildMove) as PokemonRecord["build"]["moves"];

  return { coherent, unrelated: base, neutralAbility, strongPhysical };
}

function withoutPrerequisite(
  kind: (typeof benchmark.expectedKinds)[number],
  coherent: PokemonRecord[],
  neutralAbility: ReturnType<typeof ability>,
  strongPhysical: MoveRecord[],
) {
  const roster = coherent.map((member) => ({
    ...member,
    build: { ...member.build, moves: [...member.build.moves] as PokemonRecord["build"]["moves"] },
  }));
  const attacks = strongPhysical.map(asBuildMove) as PokemonRecord["build"]["moves"];
  if (kind === "pivot support") roster[0].build.moves = attacks;
  if (kind === "setup opportunity") roster[2].build.moves = attacks;
  if (kind === "weather support") {
    roster[3].build.moves = [
      asBuildMove(move("stealthrock")),
      ...strongPhysical.slice(0, 3).map(asBuildMove),
    ] as PokemonRecord["build"]["moves"];
  }
  if (kind === "hazard control") roster[4].build.moves = roster[4].build.moves.map(
    (candidate, index) => index === 0 ? asBuildMove(move("surf")) : candidate,
  ) as PokemonRecord["build"]["moves"];
  if (kind === "complementary offense") {
    roster[4].build.moves = attacks;
    roster[5].build.moves = attacks;
  }
  if (kind === "immunity coverage") {
    roster[4].build.abilityId = neutralAbility.id;
    roster[4].build.ability = neutralAbility.name;
  }
  if (kind === "switch-in coverage") roster[2].types = ["Normal"];
  return roster;
}

describe("cross-member synergy benchmark", () => {
  it("represents every complete interaction with concrete member explanations", () => {
    const { coherent } = fixtureRosters();
    const quality = synergyQualityForTeam(coherent, request("SYNERGY-COHERENT"), catalog);
    const kinds = quality.interactions.map((interaction) => interaction.kind);

    expect(new Set(kinds)).toEqual(new Set(benchmark.expectedKinds));
    expect(quality.contribution).toBeGreaterThan(0);
    for (const interaction of quality.interactions) {
      expect(interaction.memberIds.length).toBeGreaterThanOrEqual(2);
      for (const memberId of interaction.memberIds) {
        expect(interaction.explanation).toContain(
          coherent.find((member) => member.id === memberId)!.name,
        );
      }
    }
  });

  it.each(benchmark.counterexamples)(
    "does not represent $kind after removing $remove",
    ({ kind }) => {
      const { coherent, neutralAbility, strongPhysical } = fixtureRosters();
      const incomplete = withoutPrerequisite(
        kind,
        coherent,
        neutralAbility,
        strongPhysical,
      );

      expect(
        synergyQualityForTeam(incomplete, request(`SYNERGY-MISSING-${kind}`), catalog)
          .interactions.map((interaction) => interaction.kind),
      ).not.toContain(kind);
    },
  );

  it("does not mistake a second weather setter for a weather beneficiary", () => {
    const { coherent } = fixtureRosters();
    const setter = ability("drizzle");
    coherent[5].build.abilityId = setter.id;
    coherent[5].build.ability = setter.name;

    const interactions = synergyQualityForTeam(
      coherent,
      request("SYNERGY-SETTER-ONLY"),
      catalog,
    ).interactions;

    expect(interactions.map((interaction) => interaction.kind)).not.toContain(
      "weather support",
    );
  });

  it("connects a sourced ability setter to a distinct weather beneficiary", () => {
    const { coherent, strongPhysical } = fixtureRosters();
    const setter = ability("drizzle");
    coherent[3].build.abilityId = setter.id;
    coherent[3].build.ability = setter.name;
    coherent[3].build.moves = [
      asBuildMove(move("stealthrock")),
      ...strongPhysical.slice(0, 3).map(asBuildMove),
    ] as PokemonRecord["build"]["moves"];

    const interaction = synergyQualityForTeam(
      coherent,
      request("SYNERGY-ABILITY-WEATHER-SETTER"),
      catalog,
    ).interactions.find(
      (candidate) => candidate.kind === "weather support",
    );

    expect(interaction?.memberIds).toEqual([coherent[3].id, coherent[5].id]);
    expect(interaction?.explanation).toContain("Drizzle");
    expect(interaction?.explanation).toContain("Swift Swim");
  });

  it("finds a distinct pivot and setup pair regardless of roster ordering", () => {
    const { coherent, strongPhysical } = fixtureRosters();
    coherent[0].build.moves = [
      asBuildMove(move("uturn")),
      asBuildMove(move("swordsdance")),
      ...strongPhysical.slice(0, 2).map(asBuildMove),
    ] as PokemonRecord["build"]["moves"];
    coherent[1].build.moves = strongPhysical.map(asBuildMove) as PokemonRecord["build"]["moves"];
    coherent[3].build.moves = [
      asBuildMove(move("uturn")),
      asBuildMove(move("stealthrock")),
      asBuildMove(move("raindance")),
      asBuildMove(strongPhysical[0]),
    ] as PokemonRecord["build"]["moves"];

    const pivot = synergyQualityForTeam(
      coherent,
      request("SYNERGY-PIVOT-ORDER"),
      catalog,
    ).interactions.find((interaction) => interaction.kind === "pivot support");

    expect(pivot?.memberIds).toEqual([coherent[3].id, coherent[0].id]);
  });

  it("names only setup moves with a usable sourced boost", () => {
    const { coherent, strongPhysical } = fixtureRosters();
    coherent[1].build.moves = [
      asBuildMove(move("swordsdance")),
      asBuildMove(move("nastyplot")),
      ...strongPhysical.slice(0, 2).map(asBuildMove),
    ] as PokemonRecord["build"]["moves"];

    const setup = synergyQualityForTeam(
      coherent,
      request("SYNERGY-MIXED-SETUP"),
      catalog,
    ).interactions.find(
      (interaction) => interaction.kind === "setup opportunity",
    );

    expect(setup?.explanation).toContain("Swords Dance");
    expect(setup?.explanation).not.toContain("Nasty Plot");
  });

  it("states whether sourced defensive coverage is an absorption or immunity", () => {
    const { coherent } = fixtureRosters();
    const coverage = synergyQualityForTeam(
      coherent,
      request("SYNERGY-DEFENSIVE-RELATION"),
      catalog,
    ).interactions.find(
      (interaction) => interaction.kind === "immunity coverage",
    );

    expect(coverage?.explanation).toContain("absorption");
    expect(coverage?.explanation).not.toContain("immunity or absorption");
  });

  it("rewards the coherent complete-team plan above unrelated strong builds at the public score seam", () => {
    const { coherent, unrelated } = fixtureRosters();
    const coherentResult = materializeTeamResult(
      coherent,
      request("SYNERGY-SCORE"),
      catalog,
    );
    const unrelatedScore = scoreTeam(unrelated, request("SYNERGY-SCORE"), catalog);

    expect(coherentResult.battleQuality.synergy.score).toBeGreaterThan(0);
    expect(coherentResult.battleQuality.synergy.interactions).toHaveLength(
      benchmark.expectedKinds.length,
    );
    expect(coherentResult.score.total).toBeGreaterThan(unrelatedScore.total);
  });

  it("rescored alternatives expose the changed cross-member plan", () => {
    const input = request("SYNERGY-ALTERNATIVES");
    const current = generateTeam(input, catalog);
    const alternatives = generateAlternatives(0, input, current, catalog);

    expect(alternatives).toHaveLength(3);
    for (const alternative of alternatives) {
      expect(alternative.result.battleQuality.synergy.explanation.length).toBeGreaterThan(0);
      expect(alternative.tradeoff).toMatch(/Team synergy/);
      expect(alternative.scoreDelta).toBe(
        alternative.result.score.total - current.score.total,
      );
    }
  });

});
