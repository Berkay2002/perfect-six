import { describe, expect, it } from "vitest";

import { catalog } from "@/data/catalog";
import benchmark from "@/engine/fixtures/team-job-benchmark.json";
import { generateAlternatives } from "@/engine/alternatives";
import { generateTeam, materializeTeamResult } from "@/engine/generate";
import { scoreTeam } from "@/engine/score";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type GeneratorRequest,
  type ItemCapabilities,
  type MoveBuild,
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

const asBuildMoves = (
  moves: NormalizedCatalog["moves"],
): [MoveBuild, MoveBuild, MoveBuild, MoveBuild] =>
  moves.map((move) => ({
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    purpose: "Source-backed low-confidence fixture.",
  })) as [MoveBuild, MoveBuild, MoveBuild, MoveBuild];

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

describe("generated team jobs", () => {
  it("explains jobs from each complete build and identifies a proactive win condition", () => {
    const result = generateTeam(request("TEAM-JOBS-TRACER"), catalog);

    expect(result.battleQuality.team.memberExplanations).toHaveLength(6);
    for (const member of result.members) {
      expect(member.jobs.length).toBeGreaterThan(0);
      expect(member.jobExplanation).toContain(member.name);
      expect(member.jobExplanation).toContain(member.jobs[0]);
    }
    expect(result.battleQuality.team.coveredJobs.length).toBeGreaterThan(0);
    expect(result.battleQuality.team.explanation).toContain("Important gaps");
    expect(result.battleQuality.team.proactiveWinCondition?.explanation).toMatch(
      /wins|close|finish|break/i,
    );
    expect(
      result.warnings.some((warning) => warning.code === "low-confidence-win-condition"),
    ).toBe(false);
  });

  it("uses style job expectations as scoring guidance without breaking explicit locks", () => {
    const source = generateTeam(request("STYLE-JOBS-SOURCE"), catalog);
    const slots = source.members.map((member) => member.id) as GeneratorRequest["slots"];
    const aggressiveRequest = {
      ...request("STYLE-JOBS-LOCKED"),
      style: "aggressive",
      slots,
    } satisfies GeneratorRequest;
    const result = generateTeam(aggressiveRequest, catalog);

    expect(result.members.map((member) => member.id)).toEqual(slots);
    expect(result.battleQuality.team.minimumProfile.style).toBe("aggressive");
    expect(result.battleQuality.team.minimumProfile.expectations).toContain(
      "speed control",
    );
    expect(result.battleQuality.team.minimumProfile.minimumMet).toBe(3);
    expect(result.battleQuality.team.minimumProfile.requiredConditions).toEqual([
      "proactive win condition",
    ]);
    expect(result.battleQuality.team.contribution).not.toBe(0);
    expect(result.score).toEqual(
      scoreTeam(result.members, aggressiveRequest, catalog),
    );
  });

  it("rescored alternatives explain the team jobs and gaps they change", () => {
    const input = request("TEAM-JOB-ALTERNATIVES");
    const current = generateTeam(input, catalog);
    const alternatives = generateAlternatives(0, input, current, catalog);

    expect(alternatives).toHaveLength(3);
    for (const alternative of alternatives) {
      expect(alternative.scoreDelta).toBe(
        alternative.result.score.total - current.score.total,
      );
      expect(alternative.tradeoff).toMatch(/Team jobs (gain|lose|preserve)/);
      expect(alternative.result.battleQuality.team.explanation).toContain(
        "Important gaps",
      );
      expect(alternative.replacement.jobExplanation).toContain(
        alternative.replacement.name,
      );
    }
  });

  it("emits an explicit low-confidence warning when no complete build can close", () => {
    const input = request("LOW-CONFIDENCE-WIN-CONDITION");
    const source = generateTeam(input, catalog);
    const passiveMoves = catalog.moves
      .filter((move) => move.category === "Status")
      .slice(0, 4);
    expect(passiveMoves).toHaveLength(4);
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
            ...passiveMoves.map((move) => ({
              moveId: move.id,
              methods: ["tm" as const],
              raw: ["tm"],
            })),
          ],
        })),
      builds: source.members.map((member) => ({
        ...member.build,
        id: `${member.build.id}:passive-fixture`,
        moves: asBuildMoves(passiveMoves),
      })),
    } satisfies NormalizedCatalog;
    const locked = {
      ...input,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;

    const result = generateTeam(locked, fixture);

    expect(result.battleQuality.team.proactiveWinCondition).toBeNull();
    expect(result.warnings).toContainEqual({
      code: "low-confidence-win-condition",
      severity: "warning",
      message:
        "Low confidence: this team has no concrete proactive win condition in its validated builds.",
    });
  });

  it("identifies a coordinated hazard, status, and sustain plan as a concrete closer", () => {
    const input = request("COORDINATED-RESIDUAL-WIN");
    const source = generateTeam(input, catalog);
    const hazard = catalog.moves.find((move) => move.capabilities?.hazard);
    const status = catalog.moves.find(
      (move) =>
        move.category === "Status" &&
        (move.effect.status !== null || move.effect.volatileStatus !== null) &&
        !move.capabilities?.hazard,
    );
    const recovery = catalog.moves.find(
      (move) =>
        move.category === "Status" && move.effect.healingFraction !== null,
    );
    const fillers = catalog.moves
      .filter(
        (move) =>
          move.category === "Status" &&
          move.id !== hazard?.id &&
          move.id !== status?.id &&
          move.id !== recovery?.id &&
          move.effect.boosts === null &&
          move.effect.weather === null,
      )
      .slice(0, 4);
    expect([hazard, status, recovery, ...fillers]).not.toContain(undefined);
    expect(fillers).toHaveLength(4);
    const packages = source.members.map((_, index) =>
      index === 0
        ? [hazard!, ...fillers.slice(0, 3)]
        : index === 1
          ? [status!, ...fillers.slice(0, 3)]
          : index === 2
            ? [recovery!, ...fillers.slice(0, 3)]
            : fillers,
    );
    const fixture = {
      ...catalog,
      species: catalog.species
        .filter((species) =>
          source.members.some((member) => member.id === species.id),
        )
        .map((species, index) => ({
          ...species,
          learnset: [
            ...species.learnset,
            ...packages[index].map((move) => ({
              moveId: move.id,
              methods: ["tm" as const],
              raw: ["tm"],
            })),
          ],
        })),
      builds: source.members.map((member, index) => ({
        ...member.build,
        id: `${member.build.id}:residual-fixture`,
        moves: asBuildMoves(packages[index]),
      })),
    } satisfies NormalizedCatalog;
    const locked = {
      ...input,
      slots: source.members.map((member) => member.id),
    } as GeneratorRequest;

    const result = generateTeam(locked, fixture);

    expect(result.battleQuality.team.proactiveWinCondition?.explanation).toMatch(
      /hazards.*status pressure.*sustain.*close/i,
    );
    expect(
      result.warnings.some(
        (warning) => warning.code === "low-confidence-win-condition",
      ),
    ).toBe(false);
  });

  it("uses accepted recovery and coherent speed-setup facts for member jobs", () => {
    const input = request("COMPLETE-BUILD-MOVE-JOBS");
    const source = generateTeam(input, catalog);
    const target = source.members[0];
    const rest = catalog.moves.find((move) => move.id === "rest")!;
    const dragonDance = catalog.moves.find(
      (move) => move.id === "dragondance",
    )!;
    const physical = catalog.moves
      .filter((move) => move.category === "Physical" && (move.power ?? 0) > 0)
      .slice(0, 2);
    expect([rest, dragonDance, ...physical]).not.toContain(undefined);
    const roster = source.members.map((member) =>
      member.id === target.id
        ? {
            ...member,
            stats: { ...member.stats, attack: 110, speed: 70 },
            build: {
              ...member.build,
              evs: { ...member.build.evs, attack: 252, speed: 252 },
              moves: asBuildMoves([rest, dragonDance, ...physical]),
            },
          }
        : member,
    );

    const result = materializeTeamResult(roster, input, catalog);
    const evaluated = result.members.find((member) => member.id === target.id)!;

    expect(rest.flags).toContain("heal");
    expect(dragonDance.capabilities?.selfBoosts).toMatchObject({ spe: 1 });
    expect(evaluated.jobs).toContain("sustain");
    expect(evaluated.jobs).toContain("speed control");
  });

  it("does not turn incoherent setup into a proactive win condition", () => {
    const input = request("INCOHERENT-SETUP-JOB");
    const source = generateTeam(input, catalog);
    const target = source.members[0];
    const nastyPlot = catalog.moves.find((move) => move.id === "nastyplot")!;
    const physical = catalog.moves
      .filter(
        (move) =>
          move.category === "Physical" &&
          (move.power ?? 0) > 0 &&
          move.priority === 0,
      )
      .slice(0, 3);
    const neutralItem = {
      id: "teamjobneutralitem",
      name: "Team Job Neutral Item",
      description: "Fixture item with no supported capability.",
      megaStone: null,
      megaEvolves: null,
      capabilities: neutralItemCapabilities(),
      source: "fixture://team-jobs",
    };
    const fixture = { ...catalog, items: [...catalog.items, neutralItem] };
    const roster = source.members.map((member) =>
      member.id === target.id
        ? {
            ...member,
            stats: {
              ...member.stats,
              attack: 100,
              specialAttack: 40,
              speed: 40,
            },
            build: {
              ...member.build,
              heldItemId: neutralItem.id,
              heldItem: neutralItem.name,
              evs: {
                ...member.build.evs,
                attack: 0,
                specialAttack: 0,
                speed: 0,
              },
              moves: asBuildMoves([nastyPlot, ...physical]),
            },
          }
        : member,
    );

    const result = materializeTeamResult(roster, input, fixture);
    const evaluated = result.members.find((member) => member.id === target.id)!;

    expect(evaluated.jobs).not.toContain("proactive win condition");
  });

  it("requires compatible item fit for wallbreaking and item speed control", () => {
    const input = request("INCOMPATIBLE-ITEM-JOBS");
    const source = generateTeam(input, catalog);
    const wallbreaker = source.members[0];
    const passive = source.members[1];
    const special = catalog.moves
      .filter((move) => move.category === "Special" && (move.power ?? 0) > 0)
      .slice(0, 4);
    const status = catalog.moves
      .filter((move) => move.category === "Status")
      .slice(0, 4);
    const physicalItem = {
      id: "physicalfixtureitem",
      name: "Physical Fixture Item",
      description: "Fixture physical damage amplifier.",
      megaStone: null,
      megaEvolves: null,
      capabilities: {
        ...neutralItemCapabilities(),
        damageCategory: "physical" as const,
      },
      source: "fixture://team-jobs",
    };
    const speedItem = {
      ...physicalItem,
      id: "speedfixtureitem",
      name: "Speed Fixture Item",
      capabilities: {
        ...neutralItemCapabilities(),
        speedMultiplier: 1.5,
      },
    };
    const fixture = {
      ...catalog,
      items: [...catalog.items, physicalItem, speedItem],
    };
    const roster = source.members.map((member) => {
      if (member.id === wallbreaker.id) {
        return {
          ...member,
          stats: { ...member.stats, specialAttack: 140, speed: 40 },
          build: {
            ...member.build,
            heldItemId: physicalItem.id,
            heldItem: physicalItem.name,
            evs: {
              ...member.build.evs,
              attack: 0,
              specialAttack: 252,
              speed: 0,
            },
            moves: asBuildMoves(special),
          },
        };
      }
      if (member.id === passive.id) {
        return {
          ...member,
          stats: { ...member.stats, speed: 40 },
          build: {
            ...member.build,
            heldItemId: speedItem.id,
            heldItem: speedItem.name,
            evs: { ...member.build.evs, speed: 0 },
            moves: asBuildMoves(status),
          },
        };
      }
      return member;
    });

    const result = materializeTeamResult(roster, input, fixture);
    const evaluatedWallbreaker = result.members.find(
      (member) => member.id === wallbreaker.id,
    )!;
    const evaluatedPassive = result.members.find(
      (member) => member.id === passive.id,
    )!;

    expect(evaluatedWallbreaker.jobs).not.toContain("proactive win condition");
    expect(evaluatedPassive.jobs).not.toContain("speed control");
  });

  it(
    "meets the documented minimum job profile for at least 80 percent of each benchmark style",
    () => {
      const outcomes = new Map<string, boolean[]>();
      const diagnostics = new Map<string, string[]>();
      for (const fixture of benchmark.requests) {
        const input = {
          schemaVersion: SCHEMA_VERSION,
          dataVersion: DATA_VERSION,
          engineVersion: ENGINE_VERSION,
          seed: fixture.seed,
          style: fixture.style,
          weather: "weather" in fixture ? fixture.weather : undefined,
          availability: fixture.availability,
          allowSpecial: fixture.allowSpecial,
          requireMega: fixture.requireMega,
          slots: [null, null, null, null, null, null],
        } as GeneratorRequest;
        const result = generateTeam(input, catalog);
        const profileKey =
          (fixture.style === "weather" ? "weather" : fixture.style) as keyof typeof benchmark.minimumProfiles;
        const expectedProfile = benchmark.minimumProfiles[profileKey];
        expect(result.battleQuality.team.minimumProfile).toMatchObject(
          expectedProfile,
        );
        expect(
          result.battleQuality.team.proactiveWinCondition !== null ||
            result.warnings.some(
              (warning) => warning.code === "low-confidence-win-condition",
            ),
        ).toBe(true);
        outcomes.set(fixture.label, [
          ...(outcomes.get(fixture.label) ?? []),
          result.battleQuality.team.minimumProfile.satisfied,
        ]);
        if (!result.battleQuality.team.minimumProfile.satisfied) {
          diagnostics.set(fixture.label, [
            ...(diagnostics.get(fixture.label) ?? []),
            `${fixture.seed}: ${result.battleQuality.team.minimumProfile.missing.join(", ")}`,
          ]);
        }
      }

      const belowTarget = [...outcomes].flatMap(([label, results]) => {
        const passing = results.filter(Boolean).length;
        return passing / results.length >= 0.8
          ? []
          : [
              `${label}: ${passing}/${results.length} (${(diagnostics.get(label) ?? []).join("; ")})`,
            ];
      });
      expect(belowTarget).toEqual([]);
    },
    90_000,
  );
});
