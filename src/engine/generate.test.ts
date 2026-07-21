import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import { generateAlternatives } from "@/engine/alternatives";
import { assembleCandidates } from "@/engine/catalog";
import {
  canonicalRosterKey,
  deduplicateRosterStates,
  generateTeam,
  materializeTeamResult,
  selectEliteRoster,
} from "@/engine/generate";
import { pokemonRecordFromMember } from "@/engine/member";
import { scoreTeam } from "@/engine/score";
import { createRandom } from "@/lib/random";
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

function asBuildMoves(moves: MoveRecord[]): [
  MoveBuild,
  MoveBuild,
  MoveBuild,
  MoveBuild,
] {
  return moves.map((move) => ({
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    purpose: "Source-backed item-fit fixture.",
  })) as [MoveBuild, MoveBuild, MoveBuild, MoveBuild];
}

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

  it("marks newly generated teams as engine version 4", () => {
    const result = generateTeam(request("ENGINE-VERSION"), catalog);
    expect(Number(result.provenance.engineVersion)).toBe(4);
  });

  it("returns byte-identical output for EMBER-042", () => {
    const first = generateTeam(request("EMBER-042"), catalog);
    const second = generateTeam(request("EMBER-042"), catalog);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.battleQuality.ability.explanation.length).toBeGreaterThan(0);
    expect(first.battleQuality.move.explanation).toContain("four-move packages");
    expect(first.battleQuality.move.score).toBeGreaterThan(0);
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
      expect(
        alternative.result.battleQuality.ability.explanation.length,
      ).toBeGreaterThan(0);
      expect(
        alternative.result.battleQuality.item.explanation.length,
      ).toBeGreaterThan(0);
      expect(
        alternative.result.battleQuality.move.explanation.length,
      ).toBeGreaterThan(0);
    }
  });

  it("selects and explains the sourced item that fits the complete build", () => {
    const input = request("ITEM-BUILD-SELECTION");
    const source = generateTeam(input, catalog);
    const target = source.members.find(
      (member) =>
        member.build.moves.filter((move) => move.category !== "Status")
          .length >= 2,
    )!;
    const locked = {
      ...input,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;
    const compatibleItem = {
      id: "fixturecompatible",
      name: "Fixture Compatible",
      description: "Fixture sourced all-attack amplifier.",
      megaStone: null,
      megaEvolves: null,
      capabilities: {
        ...neutralItemCapabilities(),
        damageCategory: "all" as const,
      },
      source: "fixture://items",
    };
    const neutralItem = {
      ...compatibleItem,
      id: "fixtureneutral",
      name: "Fixture Neutral",
      description: "Fixture sourced unsupported effect.",
      capabilities: neutralItemCapabilities(),
    };
    const baseBuild = target.build;
    const fixture = {
      ...catalog,
      species: catalog.species.filter((species) =>
        source.members.some((member) => member.id === species.id),
      ),
      builds: [
        ...source.members
          .filter((member) => member.id !== target.id)
          .map((member) => member.build),
        {
          ...baseBuild,
          id: `${baseBuild.id}:compatible-item`,
          heldItemId: compatibleItem.id,
          heldItem: compatibleItem.name,
        },
        {
          ...baseBuild,
          id: `${baseBuild.id}:neutral-item`,
          heldItemId: neutralItem.id,
          heldItem: neutralItem.name,
        },
      ],
      items: [
        ...catalog.items.map((item) => ({
          ...item,
          capabilities: neutralItemCapabilities(),
        })),
        compatibleItem,
        neutralItem,
      ],
    } satisfies NormalizedCatalog;

    const result = generateTeam(locked, fixture);
    expect(
      result.members.find((member) => member.id === target.id)?.build
        .heldItemId,
    ).toBe(compatibleItem.id);
    expect(result.battleQuality.item.contribution).toBeGreaterThan(0);
    expect(result.battleQuality.item.explanation).toContain(
      compatibleItem.name,
    );
    expect(JSON.stringify(generateTeam(locked, fixture))).toBe(
      JSON.stringify(result),
    );
  });

  it("applies each sourced item mechanic only when the complete build can use it", () => {
    const input = request("ITEM-COMPLETE-BUILD-FIT");
    const source = generateTeam(input, catalog);
    const target = source.members[0];
    const locked = {
      ...input,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;
    const physical = catalog.moves
      .filter((move) => move.category === "Physical")
      .slice(0, 4);
    const special = catalog.moves
      .filter((move) => move.category === "Special")
      .slice(0, 4);
    const status = catalog.moves
      .filter((move) => move.category === "Status")
      .slice(0, 4);
    expect(physical).toHaveLength(4);
    expect(special).toHaveLength(4);
    expect(status).toHaveLength(4);

    const evaluate = (
      capabilities: ItemCapabilities,
      moves: MoveRecord[],
      evs = target.build.evs,
    ) => {
      const fixtureItem = {
        id: "fixtureitem",
        name: "Fixture Item",
        description: "Fixture sourced mechanics.",
        megaStone: null,
        megaEvolves: null,
        capabilities,
        source: "fixture://items",
      };
      const fixture = {
        ...catalog,
        species: catalog.species
          .filter((species) =>
            source.members.some((member) => member.id === species.id),
          )
          .map((species) => ({
            ...species,
            learnset: [
              ...species.learnset,
              ...moves.map((move) => ({
                moveId: move.id,
                methods: ["tm" as const],
                raw: ["tm"],
              })),
            ],
          })),
        builds: source.members.map((member) => ({
          ...member.build,
          id: `${member.build.id}:item-fit-fixture`,
          heldItemId: fixtureItem.id,
          heldItem: fixtureItem.name,
          evs,
          moves: asBuildMoves(moves),
        })),
        items: [
          ...catalog.items.map((item) => ({
            ...item,
            capabilities: neutralItemCapabilities(),
          })),
          fixtureItem,
        ],
      } satisfies NormalizedCatalog;
      return generateTeam(locked, fixture).battleQuality.item;
    };
    const offense = {
      ...neutralItemCapabilities(),
      damageCategory: "physical" as const,
    };
    const choice = { ...offense, choiceLock: true };
    const recovery = { ...neutralItemCapabilities(), recovery: true };
    const defensive = {
      ...neutralItemCapabilities(),
      defensiveStats: ["specialDefense" as const],
    };
    const speed = {
      ...neutralItemCapabilities(),
      speedMultiplier: 1.5,
    };
    const recoil = { ...offense, recoil: true };
    const setup = {
      ...neutralItemCapabilities(),
      consumable: true,
      boostedStats: ["attack" as const],
    };
    const defensiveEvs = {
      hp: 252,
      attack: 0,
      defense: 0,
      specialAttack: 0,
      specialDefense: 252,
      speed: 4,
    };

    expect(evaluate(offense, physical).contribution).toBeGreaterThan(
      evaluate(offense, status).contribution,
    );
    expect(evaluate(choice, physical).contribution).toBeGreaterThan(
      evaluate(choice, status).contribution,
    );
    expect(evaluate(recovery, status, defensiveEvs).contribution).toBeGreaterThan(
      evaluate(recovery, physical, {
        hp: 0,
        attack: 252,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 252,
      }).contribution,
    );
    expect(evaluate(defensive, status, defensiveEvs).contribution).toBeGreaterThan(
      evaluate(defensive, physical, {
        hp: 0,
        attack: 252,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 252,
      }).contribution,
    );
    expect(evaluate(speed, physical).contribution).toBeGreaterThan(
      evaluate(speed, status).contribution,
    );
    expect(evaluate(recoil, physical).contribution).toBeLessThan(
      evaluate(offense, physical).contribution,
    );
    expect(evaluate(setup, physical).contribution).toBeGreaterThan(
      evaluate(setup, special).contribution,
    );
  });

  it("scores and explains the visible materialized Mega build", () => {
    const input = {
      ...request("MATERIALIZED-MEGA-ITEM"),
      requireMega: true,
    } as GeneratorRequest;
    const source = generateTeam(input, catalog);
    const target = source.members.find((member) => member.mega)!;
    const locked = {
      ...input,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;
    const attacks = catalog.moves
      .filter((move) => move.category !== "Status")
      .slice(0, 4);
    const status = catalog.moves
      .filter((move) => move.category === "Status")
      .slice(0, 4);
    const baseItem = {
      id: "fixturebaseitem",
      name: "Fixture Base Item",
      description: "Fixture sourced attack amplifier and choice lock.",
      megaStone: null,
      megaEvolves: null,
      capabilities: {
        ...neutralItemCapabilities(),
        damageCategory: "all" as const,
        choiceLock: true,
      },
      source: "fixture://items",
    };
    const megaItem = {
      id: "fixturemegaitem",
      name: "Fixture Mega Item",
      description: "Fixture sourced Mega item with a move restriction.",
      megaStone: target.megaFormIds[0],
      megaEvolves: target.id,
      capabilities: {
        ...neutralItemCapabilities(),
        damagingMovesOnly: true,
      },
      source: "fixture://items",
    };
    const baseBuild = {
      ...target.build,
      id: `${target.id}:fixture-base`,
      heldItemId: baseItem.id,
      heldItem: baseItem.name,
      moves: asBuildMoves(attacks),
    };
    const megaBuild = {
      ...target.build,
      id: `${target.id}:fixture-mega`,
      heldItemId: megaItem.id,
      heldItem: megaItem.name,
      moves: asBuildMoves(status),
    };
    const strongMegaBuild = {
      ...megaBuild,
      id: `${target.id}:fixture-mega-strong`,
      moves: asBuildMoves(attacks),
    };
    const fixture = {
      ...catalog,
      species: catalog.species
        .filter((species) =>
          source.members.some((member) => member.id === species.id),
        )
        .map((species) => ({
          ...species,
          megaFormIds: species.id === target.id ? species.megaFormIds : [],
          learnset:
            species.id === target.id
              ? [
                  ...species.learnset,
                  ...[...attacks, ...status].map((move) => ({
                    moveId: move.id,
                    methods: ["tm" as const],
                    raw: ["tm"],
                  })),
                ]
              : species.learnset,
        })),
      builds: [
        ...source.members
          .filter((member) => member.id !== target.id)
          .map((member) => member.build),
        baseBuild,
        megaBuild,
        strongMegaBuild,
      ],
      items: [
        ...catalog.items.map((item) => ({
          ...item,
          capabilities: neutralItemCapabilities(),
        })),
        baseItem,
        megaItem,
      ],
    } satisfies NormalizedCatalog;
    const candidates = assembleCandidates(fixture, locked.style, locked.weather);
    const candidateById = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    const preMaterialized = locked.slots.map((id) => candidateById.get(id!)!);

    const result = generateTeam(locked, fixture);
    const visibleMega = result.members.find((member) => member.mega)!;

    expect(visibleMega.build.heldItemId).toBe(megaItem.id);
    expect(visibleMega.build.id).toBe(strongMegaBuild.id);
    expect(result.battleQuality.item.explanation).toContain(megaItem.name);
    expect(result.battleQuality.item.explanation).not.toContain(baseItem.name);
    expect(result.score).toEqual(scoreTeam(result.members, locked, fixture));
    expect(result.score).not.toEqual(
      scoreTeam(preMaterialized, locked, fixture),
    );
  });

  it("scores sourced positive and detrimental abilities in the expected direction", () => {
    const seedRequest = request("ABILITY-RATING-SOURCE");
    const source = generateTeam(seedRequest, catalog);
    const selected = source.members[0];
    const lockedRequest = {
      ...seedRequest,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;
    const fixtureCatalog = {
      ...catalog,
      builds: source.members.map((member) => member.build),
    } satisfies NormalizedCatalog;
    const withRating = (rating: number | null) => ({
      ...fixtureCatalog,
      abilities: fixtureCatalog.abilities.map((ability) =>
        ability.id === selected.build.abilityId
          ? {
              ...ability,
              rating,
              capabilities: {
                immunities: [],
                absorptions: [],
                weather: [],
                weatherDetriments: [],
              },
            }
          : {
              ...ability,
              rating: null,
              capabilities: {
                immunities: [],
                absorptions: [],
                weather: [],
                weatherDetriments: [],
              },
            },
      ),
    });

    const beneficial = generateTeam(lockedRequest, withRating(4));
    const detrimental = generateTeam(lockedRequest, withRating(-1));
    const unsupported = generateTeam(lockedRequest, withRating(null));

    expect(beneficial.score.battleScore).toBeGreaterThan(
      detrimental.score.battleScore,
    );
    expect(beneficial.battleQuality.ability.contribution).toBeGreaterThan(
      detrimental.battleQuality.ability.contribution,
    );
    expect(unsupported.battleQuality.ability.contribution).toBe(0);
    expect(beneficial.battleQuality.ability.explanation).toContain(
      selected.build.ability,
    );
    expect(unsupported.battleQuality.ability.explanation).toContain(
      "remains neutral",
    );
  });

  it("uses sourced defensive and weather capabilities in team quality", () => {
    const seedRequest = request("ABILITY-CAPABILITY-SOURCE");
    const source = generateTeam(seedRequest, catalog);
    const lockedRequest = {
      ...seedRequest,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;
    const abilityIds = new Set(
      source.members.map((member) => member.build.abilityId),
    );
    const fixtureCatalog = {
      ...catalog,
      builds: source.members.map((member) => member.build),
      typeChart: {
        Water: Object.fromEntries(
          [...new Set(source.members.flatMap((member) => member.types))].map(
            (type) => [type, 2],
          ),
        ),
      },
    } satisfies NormalizedCatalog;
    const withCapabilities = (
      capabilities: NormalizedCatalog["abilities"][number]["capabilities"],
    ) => ({
      ...fixtureCatalog,
      abilities: fixtureCatalog.abilities.map((ability) => ({
        ...ability,
        rating: null,
        capabilities: abilityIds.has(ability.id)
          ? capabilities
          : {
              immunities: [],
              absorptions: [],
              weather: [],
              weatherDetriments: [],
            },
      })),
    });
    const neutral = generateTeam(
      lockedRequest,
      withCapabilities({
        immunities: [],
        absorptions: [],
        weather: [],
        weatherDetriments: [],
      }),
    );
    const defensive = generateTeam(
      lockedRequest,
      withCapabilities({
        immunities: ["Water"],
        absorptions: ["Water"],
        weather: [],
        weatherDetriments: [],
      }),
    );
    const rainRequest = {
      ...lockedRequest,
      style: "weather",
      weather: "rain",
    } as GeneratorRequest;
    const weatherNeutral = generateTeam(
      rainRequest,
      withCapabilities({
        immunities: [],
        absorptions: [],
        weather: [],
        weatherDetriments: [],
      }),
    );
    const rainSupport = generateTeam(
      rainRequest,
      withCapabilities({
        immunities: [],
        absorptions: [],
        weather: ["rain"],
        weatherDetriments: [],
        weatherSetters: ["rain"],
        weatherBenefits: ["rain"],
      }),
    );
    const sunRequest = {
      ...lockedRequest,
      style: "weather",
      weather: "sun",
    } as GeneratorRequest;
    const sunNeutral = generateTeam(
      sunRequest,
      withCapabilities({
        immunities: [],
        absorptions: [],
        weather: [],
        weatherDetriments: [],
      }),
    );
    const sunDrawback = generateTeam(
      sunRequest,
      withCapabilities({
        immunities: [],
        absorptions: [],
        weather: [],
        weatherDetriments: ["sun"],
      }),
    );

    expect(defensive.score.defensiveFit).toBeGreaterThan(
      neutral.score.defensiveFit,
    );
    expect(defensive.battleQuality.ability.explanation).toContain(
      "Water absorption",
    );
    expect(rainSupport.score.battleScore).toBeGreaterThan(
      weatherNeutral.score.battleScore,
    );
    expect(rainSupport.battleQuality.ability.explanation).toContain(
      "rain interaction",
    );
    expect(sunDrawback.score.battleScore).toBe(sunNeutral.score.battleScore);
    expect(sunDrawback.battleQuality.ability.explanation).not.toContain(
      "sun drawback",
    );
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

  it("preserves a complete owned party even when it violates composition rules", () => {
    const dittoSlots = Array.from({ length: 6 }, () => ({
      speciesId: "ditto",
    })) as NonNullable<GeneratorRequest["ownedSlots"]>;
    const startedAt = performance.now();
    const result = generateTeam(
      {
        ...request("EXISTING-DITTO-PARTY"),
        ownedSlots: dittoSlots,
        slots: ["ditto", "ditto", "ditto", "ditto", "ditto", "ditto"],
      },
      catalog,
    );
    const elapsed = performance.now() - startedAt;

    expect(result.members.map((member) => member.id)).toEqual(
      Array.from({ length: 6 }, () => "ditto"),
    );
    expect(result.members.filter((member) => member.starter)).toHaveLength(0);
    expect(result.members.every((member) => member.origin === "player")).toBe(true);
    expect(result.members.every((member) => member.build.moves.length === 1)).toBe(true);
    expect(result.members.every((member) => member.buildConfidence === "limited")).toBe(true);
    expect(
      result.members.every((member) => {
        const sourced = catalog.builds.find(
          (build) => build.id === member.build.id,
        );
        return sourced?.ivs?.speed === member.build.ivs?.speed;
      }),
    ).toBe(true);
    expect(
      result.battleQuality.weaknesses.some(
        (weakness) => weakness.attackType.toLowerCase() === "fighting",
      ),
    ).toBe(true);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("keeps validated builds in the owned-party beam search", () => {
    const sourceRequest = request("JOINT-BUILD-SOURCE");
    const source = generateTeam(sourceRequest, catalog);
    const roster = source.members.map(pokemonRecordFromMember);
    const target = roster.find((member) => member.build.moves.length === 4)!;
    const limitedBuild = {
      ...target.build,
      id: `${target.build.id}:limited-search-fixture`,
      moves: [target.build.moves[0]] as [MoveBuild],
      confidence: "limited" as const,
    };
    const fixture = {
      ...catalog,
      builds: [
        ...roster.map((member) => member.build),
        limitedBuild,
      ],
    } satisfies NormalizedCatalog;
    const ownedRequest = {
      ...sourceRequest,
      ownedSlots: roster.map((member) => ({ speciesId: member.id })),
      slots: roster.map((member) => member.id),
    } as GeneratorRequest;
    const fullBuildResult = materializeTeamResult(roster, ownedRequest, fixture);
    const limitedRoster = roster.map((member) =>
      member.id === target.id ? { ...member, build: limitedBuild } : member,
    );
    const limitedBuildResult = materializeTeamResult(
      limitedRoster,
      ownedRequest,
      fixture,
    );

    expect(fullBuildResult.score.total).toBeGreaterThan(
      limitedBuildResult.score.total,
    );

    const result = generateTeam(ownedRequest, fixture);

    expect(result.members.find((member) => member.id === target.id)?.build.id).toBe(
      target.build.id,
    );
  });

  it("derives a non-Mega build when the owned species has only Mega templates", () => {
    const ownedSlots = Array.from({ length: 6 }, () => ({
      speciesId: "abomasnow",
    })) as NonNullable<GeneratorRequest["ownedSlots"]>;
    const result = generateTeam(
      {
        ...request("NON-MEGA-OWNED-FALLBACK"),
        ownedSlots,
        slots: Array.from({ length: 6 }, () => "abomasnow") as GeneratorRequest["slots"],
      },
      catalog,
    );
    const itemById = new Map(catalog.items.map((item) => [item.id, item]));

    expect(result.members.every((member) => member.mega === false)).toBe(true);
    expect(
      result.members.every(
        (member) => !itemById.get(member.build.heldItemId)?.megaStone,
      ),
    ).toBe(true);
    expect(result.members.every((member) => member.buildConfidence === "derived")).toBe(
      true,
    );
  });

  it("jointly resolves duplicate owned evolution branches", () => {
    const result = generateTeam(
      {
        ...request("DUPLICATE-OWNED-FAMILY"),
        ownedSlots: [
          { speciesId: "bulbasaur" },
          { speciesId: "bulbasaur" },
          null,
          null,
          null,
          null,
        ],
        slots: ["bulbasaur", "bulbasaur", null, null, null, null],
      },
      catalog,
    );

    expect(result.members[0].id).toBe("venusaur");
    expect(result.members[1].id).toBe("venusaur");
    expect(result.members[0].evolutionPath).toEqual([
      "bulbasaur",
      "ivysaur",
      "venusaur",
    ]);
    expect(result.members.slice(2).every((member) => member.id !== "venusaur")).toBe(true);
    const itemById = new Map(catalog.items.map((item) => [item.id, item]));
    expect(
      result.members.every(
        (member) => !itemById.get(member.build.heldItemId)?.megaStone,
      ),
    ).toBe(true);
  });
});
