import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import { assembleCandidates } from "@/engine/catalog";
import benchmark from "@/engine/fixtures/alternative-tradeoff-cases.json";
import { generateTeam, materializeTeamResult } from "@/engine/generate";
import { scoreTeam } from "@/engine/score";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
  type ItemCapabilities,
  type MoveBuild,
  type MoveRecord,
  type NormalizedCatalog,
} from "@/lib/types";

function request(seed: string): GeneratorRequest {
  return {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    engineVersion: ENGINE_VERSION,
    seed,
    style: seed.includes("AGGRESSIVE") ? "aggressive" : "balanced",
    availability: "journey",
    allowSpecial: false,
    requireMega: false,
    slots: [null, null, null, null, null, null],
  };
}

function neutralItemCapabilities(): ItemCapabilities {
  return {
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
  };
}

function buildMoves(moves: MoveRecord[]): [MoveBuild, MoveBuild, MoveBuild, MoveBuild] {
  return moves.map((move) => ({
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    purpose: "Alternative materialization fixture.",
  })) as [MoveBuild, MoveBuild, MoveBuild, MoveBuild];
}

describe("complete-team alternative quality", () => {
  it.each(benchmark.cases)(
    "materializes and explains $seed replacements through the authoritative model",
    ({ seed, slot }) => {
      const input = request(seed);
      const current = generateTeam(input, catalog);
      const alternatives = generateAlternatives(slot, input, current, catalog);

      expect(alternatives).toHaveLength(3);
      for (const alternative of alternatives) {
        expect(alternative.result.score).toEqual(
          scoreTeam(alternative.result.members, input, catalog),
        );
        expect(alternative.scoreDelta).toBe(
          alternative.result.score.total - current.score.total,
        );
        for (const section of benchmark.requiredSections) {
          expect(alternative.tradeoff).toContain(section);
        }
        expect(alternative.tradeoff).not.toMatch(/changes by|\bpoints?\b/i);
        expect(alternative.tradeoff).toMatch(/\bgains?\b/i);
        expect(alternative.tradeoff).toMatch(/\bloses?\b/i);
      }
    },
    20_000,
  );

  it("uses full-roster journey quality to break an equal-total best-alternative tie", () => {
    const input = request("ALT-JOURNEY-TIE");
    const current = generateTeam(input, catalog);
    const slot = current.members.findIndex((member) => !member.starter);
    const source = current.members[slot];
    const clone = (id: string, stage: "Early" | "Late") => ({
      species: {
        ...source,
        id,
        name: id,
        baseSpecies: id,
        dexNumber: id === "aaa-late-tie" ? 10001 : 10002,
        starter: false,
        megaFormIds: [],
        specialClasses: [],
      },
      build: {
        ...source.build,
        id: `${id}-build`,
        speciesId: id,
      },
      role: {
        speciesId: id,
        roles: source.roles,
        battleScore: source.battleScore,
        rationale: ["Equal-total journey tie fixture."],
      },
      availability: {
        ...source.availability,
        speciesId: id,
        stage,
        difficulty: stage === "Early" ? ("Easy" as const) : ("Late game" as const),
      },
    });
    const late = clone("aaa-late-tie", "Late");
    const early = clone("zzz-early-tie", "Early");
    const fixture = {
      ...catalog,
      species: [
        ...current.members.map((member) => ({
          ...member,
          megaFormIds: [],
        })),
        late.species,
        early.species,
      ],
      builds: [
        ...current.members.map((member) => member.build),
        late.build,
        early.build,
      ],
      roles: [
        ...current.members.map((member) => ({
          speciesId: member.id,
          roles: member.roles,
          battleScore: member.battleScore,
          rationale: ["Current fixture member."],
        })),
        late.role,
        early.role,
      ],
      availability: [
        ...current.members.map((member) => member.availability),
        late.availability,
        early.availability,
      ],
    } satisfies NormalizedCatalog;

    const alternatives = generateAlternatives(slot, input, current, fixture);
    const byId = new Map(
      alternatives.map((alternative) => [alternative.replacement.id, alternative]),
    );
    const lateResult = byId.get(late.species.id)!.result;
    const earlyResult = byId.get(early.species.id)!.result;

    expect(earlyResult.score.total).toBe(lateResult.score.total);
    expect(earlyResult.score.journeyCurveFit).toBeGreaterThan(
      lateResult.score.journeyCurveFit!,
    );
    expect(alternatives[0].kind).toBe("best");
    expect(alternatives[0].replacement.id).toBe(early.species.id);
    expect(byId.get(late.species.id)!.tradeoff).toMatch(
      /Early changes|Late additions change/,
    );
  }, 20_000);

  it("ranks required-Mega alternatives by their materialized Mega builds", () => {
    const input = {
      ...request("ALT-MEGA-AGGRESSIVE"),
      requireMega: true,
    } satisfies GeneratorRequest;
    const current = generateTeam(input, catalog);
    const slot = current.members.findIndex((member) => member.mega);
    const source = current.members[slot];
    const attacks = catalog.moves
      .filter((move) => move.category !== "Status" && (move.power ?? 0) >= 80)
      .slice(0, 4);
    const status = catalog.moves
      .filter((move) => move.category === "Status")
      .slice(0, 4);
    expect(attacks).toHaveLength(4);
    expect(status).toHaveLength(4);

    const makeItems = (id: string, materializedFit: boolean) => {
      const baseItem = {
        id: `${id}-base-item`,
        name: `${id} base item`,
        description: "Fixture base item.",
        megaStone: null,
        megaEvolves: null,
        capabilities: {
          ...neutralItemCapabilities(),
          ...(materializedFit
            ? { damagingMovesOnly: true }
            : { damageCategory: "all" as const }),
        },
        source: "fixture://alternative-mega",
      };
      const megaItem = {
        id: `${id}-mega-item`,
        name: `${id} Mega item`,
        description: "Fixture Mega item.",
        megaStone: `${id}-mega`,
        megaEvolves: id,
        capabilities: {
          ...neutralItemCapabilities(),
          ...(materializedFit
            ? { damageCategory: "all" as const }
            : { damagingMovesOnly: true }),
        },
        source: "fixture://alternative-mega",
      };
      return { baseItem, megaItem };
    };
    const makeClone = (id: string, materializedFit: boolean) => {
      const { baseItem, megaItem } = makeItems(id, materializedFit);
      const baseMoves = materializedFit ? buildMoves(status) : buildMoves(attacks);
      const megaMoves = materializedFit ? buildMoves(attacks) : buildMoves(status);
      return {
        species: {
          ...source,
          id,
          name: id,
          baseSpecies: id,
          dexNumber: id === "aaa-base-bait" ? 10003 : 10004,
          starter: source.starter,
          specialClasses: [],
          megaFormIds: [`${id}-mega`],
        },
        baseBuild: {
          ...source.build,
          id: `${id}-base-build`,
          speciesId: id,
          heldItemId: baseItem.id,
          heldItem: baseItem.name,
          moves: baseMoves,
        },
        megaBuild: {
          ...source.build,
          id: `${id}-mega-build`,
          speciesId: id,
          heldItemId: megaItem.id,
          heldItem: megaItem.name,
          moves: megaMoves,
        },
        role: {
          speciesId: id,
          roles: source.roles,
          battleScore: source.battleScore,
          rationale: ["Required-Mega materialization fixture."],
        },
        availability: { ...source.availability, speciesId: id },
        items: [baseItem, megaItem],
      };
    };
    const bait = makeClone("aaa-base-bait", false);
    const fit = makeClone("zzz-mega-fit", true);
    const fixture = {
      ...catalog,
      species: [
        ...current.members.map((member) => ({
          ...member,
          megaFormIds: [],
        })),
        bait.species,
        fit.species,
      ],
      builds: [
        ...current.members.map((member) => member.build),
        bait.baseBuild,
        bait.megaBuild,
        fit.baseBuild,
        fit.megaBuild,
      ],
      roles: [
        ...current.members.map((member) => ({
          speciesId: member.id,
          roles: member.roles,
          battleScore: member.battleScore,
          rationale: ["Current fixture member."],
        })),
        bait.role,
        fit.role,
      ],
      availability: [
        ...current.members.map((member) => member.availability),
        bait.availability,
        fit.availability,
      ],
      items: [...catalog.items, ...bait.items, ...fit.items],
    } satisfies NormalizedCatalog;
    const candidateById = new Map(
      assembleCandidates(fixture, input.style, input.weather).map((candidate) => [
        candidate.id,
        candidate,
      ]),
    );
    const rosterFor = (id: string) =>
      current.members.map((member, index) =>
        index === slot ? candidateById.get(id)! : member,
      );
    const rawBait = scoreTeam(rosterFor(bait.species.id), input, fixture);
    const rawFit = scoreTeam(rosterFor(fit.species.id), input, fixture);
    const visibleBait = materializeTeamResult(
      rosterFor(bait.species.id),
      input,
      fixture,
    );
    const visibleFit = materializeTeamResult(
      rosterFor(fit.species.id),
      input,
      fixture,
    );

    expect(rawBait.total).toBeGreaterThan(rawFit.total);
    expect(visibleFit.score.total).toBeGreaterThan(visibleBait.score.total);
    const alternatives = generateAlternatives(slot, input, current, fixture);
    expect(alternatives[0].replacement.id).toBe(fit.species.id);
    expect(alternatives[0].replacement.build.id).toBe(fit.megaBuild.id);
    expect(alternatives[0].result.score).toEqual(visibleFit.score);
  }, 20_000);
});
