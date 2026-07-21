import { describe, expect, it } from "vitest";

import provenance from "../../docs/data/provenance.json";
import { catalog } from "@/data/catalog";
import { abilityBuildValue } from "@/engine/ability";
import { battlePlanQualityForTeam } from "@/engine/battle-plan";
import { assembleCandidates } from "@/engine/catalog";
import comparisonCorpus from "@/engine/fixtures/release-comparison-corpus.json";
import moveGolden from "@/engine/fixtures/move-package-golden.json";
import requestMatrix from "@/engine/fixtures/release-request-matrix.json";
import { generateTeam } from "@/engine/generate";
import { itemBuildValue } from "@/engine/item";
import { journeyCurveQualityForTeam } from "@/engine/journey";
import { movePackageQualityForBuild } from "@/engine/move";
import { synergyQualityForTeam } from "@/engine/synergy";
import { teamQualityForTeam } from "@/engine/team";
import { preV3SharePayloads } from "@/lib/fixtures/pre-v3-snapshots";
import { resultScoringState } from "@/lib/quality-presentation";
import { hasOwnedPokemon } from "@/lib/request";
import {
  DATA_VERSION,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  type AvailabilityRecord,
  type EVSpread,
  type GeneratorRequest,
  type MoveBuild,
  type PokemonRecord,
  type StatBlock,
} from "@/lib/types";

const requestFor = (
  fixture: (typeof requestMatrix.requests)[number],
): GeneratorRequest => ({
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  engineVersion: ENGINE_VERSION,
  seed: fixture.seed,
  style: fixture.style as GeneratorRequest["style"],
  weather:
    "weather" in fixture
      ? (fixture.weather as GeneratorRequest["weather"])
      : undefined,
  availability: fixture.availability as GeneratorRequest["availability"],
  allowSpecial: fixture.allowSpecial,
  requireMega: fixture.requireMega,
  slots: fixture.slots as GeneratorRequest["slots"],
});

function assertLegalResult(
  result: ReturnType<typeof generateTeam>,
  request: GeneratorRequest,
) {
  expect(result.members).toHaveLength(6);
  expect(new Set(result.members.map((member) => member.id)).size).toBe(6);
  expect(result.members.filter((member) => member.starter)).toHaveLength(1);
  expect(
    result.members.filter((member) => member.specialClasses.length > 0).length,
  ).toBeLessThanOrEqual(request.allowSpecial ? 1 : 0);
  if (request.requireMega) {
    expect(result.members.some((member) => member.mega)).toBe(true);
  }
  request.slots.forEach((lockedId, index) => {
    if (lockedId !== null) expect(result.members[index].id).toBe(lockedId);
  });
  for (const member of result.members) {
    expect(member.finalEvolution).toBe(true);
    if (hasOwnedPokemon(request)) {
      expect(member.build.moves.length).toBeGreaterThanOrEqual(1);
      expect(member.build.moves.length).toBeLessThanOrEqual(4);
    } else {
      expect(
        member.build.moves,
        `${request.seed}:${member.id}:${member.build.id}`,
      ).toHaveLength(4);
    }
    expect(member.jobs.length).toBeGreaterThan(0);
    expect(member.jobExplanation.length).toBeGreaterThan(0);
  }
}

function assertCompleteExplanations(result: ReturnType<typeof generateTeam>) {
  const explanations = [
    result.battleQuality.ability.explanation,
    result.battleQuality.item.explanation,
    result.battleQuality.move.explanation,
    result.battleQuality.team.explanation,
    result.battleQuality.plan.explanation,
    result.battleQuality.synergy.explanation,
    result.battleQuality.acquisitionCurve.explanation,
  ];
  expect(explanations.every((explanation) => explanation.trim().length > 0)).toBe(
    true,
  );
}

const corpusRequest = requestFor(requestMatrix.requests[0]);
let corpusRoster: PokemonRecord[] | undefined;
let goldenBase: PokemonRecord | undefined;
const moveById = new Map(catalog.moves.map((move) => [move.id, move]));
const itemById = new Map(catalog.items.map((item) => [item.id, item]));
const abilityById = new Map(
  catalog.abilities.map((ability) => [ability.id, ability]),
);

function baseCorpusRoster() {
  corpusRoster ??= generateTeam(
    { ...corpusRequest, seed: "RELEASE-CORPUS-SOURCE" },
    catalog,
  ).members;
  return corpusRoster.map((member) => ({ ...member, build: { ...member.build } }));
}

function moves(ids: string[]): PokemonRecord["build"]["moves"] {
  return ids.map((id): MoveBuild => {
    const move = moveById.get(id);
    if (!move) throw new Error(`Release corpus references unknown move ${id}`);
    return {
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      power: move.power,
      accuracy: move.accuracy,
      purpose: "Independent engine-v3 release comparison.",
    };
  }) as PokemonRecord["build"]["moves"];
}

function withMoves(
  member: PokemonRecord,
  ids: string[],
): PokemonRecord {
  return { ...member, build: { ...member.build, moves: moves(ids) } };
}

function withAvailability(
  member: PokemonRecord,
  stage: AvailabilityRecord["stage"],
): PokemonRecord {
  const values = {
    Early: { difficulty: "Easy" as const, score: 82 },
    Mid: { difficulty: "Moderate" as const, score: 64 },
    Late: { difficulty: "Late game" as const, score: 25 },
  }[stage];
  return {
    ...member,
    availability: { ...member.availability, ...values, stage },
  };
}

function goldenPackageFor(
  context: { types: string[]; stats: StatBlock; evs: EVSpread },
  ids: string[],
) {
  goldenBase ??= assembleCandidates(catalog, "balanced")[0];
  return {
    ...goldenBase,
    types: context.types as PokemonRecord["types"],
    stats: context.stats,
    build: { ...goldenBase.build, evs: context.evs, moves: moves(ids) },
  };
}

type ComparisonOutcome = {
  id: string;
  preferred: number;
  inferior: number;
};

type ReleaseComparison = Omit<
  (typeof comparisonCorpus.comparisons)[number],
  "exceptionReview"
> & {
  exceptionReview: {
    observedPreferred: number;
    observedInferior: number;
    rationale: string;
  } | null;
};

const releaseComparisons =
  comparisonCorpus.comparisons as readonly ReleaseComparison[];

function evaluateComparison(
  comparison: ReleaseComparison,
): ComparisonOutcome {
  if (comparison.area === "ability") {
    const ids =
      comparison.variant === "positive-rating"
        ? ["hugepower", "truant"]
        : ["waterabsorb", "airlock"];
    return {
      id: comparison.id,
      preferred: abilityBuildValue(abilityById.get(ids[0]), corpusRequest),
      inferior: abilityBuildValue(abilityById.get(ids[1]), corpusRequest),
    };
  }

  if (comparison.area === "item") {
    const member = baseCorpusRoster()[0];
    const defensive = comparison.variant === "compatible-defense";
    const evaluated = {
      ...withMoves(
        member,
        defensive
          ? ["protect", "toxic", "recover", "haze"]
          : ["closecombat", "earthquake", "crunch", "rockslide"],
      ),
      roles: defensive ? ["Defensive support"] : ["Physical attacker"],
      finalEvolution: true,
      build: {
        ...member.build,
        evs: defensive
          ? { hp: 252, attack: 0, defense: 0, specialAttack: 0, specialDefense: 252, speed: 4 }
          : { hp: 0, attack: 252, defense: 0, specialAttack: 0, specialDefense: 4, speed: 252 },
        moves: moves(
          defensive
            ? ["protect", "toxic", "recover", "haze"]
            : ["closecombat", "earthquake", "crunch", "rockslide"],
        ),
      },
    };
    const ids = defensive ? ["leftovers", "eviolite"] : ["choiceband", "ironball"];
    return {
      id: comparison.id,
      preferred: itemBuildValue(evaluated, itemById.get(ids[0]), corpusRequest, catalog),
      inferior: itemBuildValue(evaluated, itemById.get(ids[1]), corpusRequest, catalog),
    };
  }

  if (comparison.area === "move") {
    const fixture = moveGolden.comparisons.find(
      ({ id }) => id === comparison.variant,
    );
    if (!fixture) throw new Error(`Missing move comparison ${comparison.variant}`);
    return {
      id: comparison.id,
      preferred: movePackageQualityForBuild(
        goldenPackageFor(fixture.context, fixture.preferred.moves),
        catalog,
      ).score,
      inferior: movePackageQualityForBuild(
        goldenPackageFor(fixture.context, fixture.inferior.moves),
        catalog,
      ).score,
    };
  }

  if (comparison.area === "team") {
    const generated = baseCorpusRoster();
    const inferior = generated.map((member) =>
      withMoves(member, ["protect", "toxic", "haze", "rest"]),
    );
    const preferred =
      comparison.variant === "proactive-plan"
        ? inferior.map((member, index) =>
            index === 0
              ? withMoves(member, [
                  "swordsdance",
                  "closecombat",
                  "earthquake",
                  "extremespeed",
                ])
              : member,
          )
        : generated;
    return {
      id: comparison.id,
      preferred: teamQualityForTeam(preferred, corpusRequest, catalog).score,
      inferior: teamQualityForTeam(inferior, corpusRequest, catalog).score,
    };
  }

  if (comparison.area === "plan") {
    const base = baseCorpusRoster().map((member) =>
      withMoves(member, ["closecombat", "earthquake", "crunch", "rockslide"]),
    );
    const preferred = base.map((member) => ({
      ...member,
      stats: {
        ...member.stats,
        speed: comparison.variant === "fast-offense" ? 130 : 90,
        defense: 110,
        specialDefense: 110,
      },
    }));
    const inferior = preferred.map((member) => ({
      ...member,
      stats: {
        ...member.stats,
        speed: comparison.variant === "fast-offense" ? 40 : 90,
        specialDefense:
          comparison.variant === "balanced-resilience" ? 40 : 110,
      },
    }));
    return {
      id: comparison.id,
      preferred: battlePlanQualityForTeam(preferred, corpusRequest, catalog).score,
      inferior: battlePlanQualityForTeam(inferior, corpusRequest, catalog).score,
    };
  }

  if (comparison.area === "synergy") {
    const base = baseCorpusRoster().map((member) => ({
      ...member,
      types: ["Normal"] as PokemonRecord["types"],
      build: {
        ...member.build,
        abilityId: "airlock",
        ability: "Air Lock",
      },
    }));
    const preferredPackages =
      comparison.variant === "unrelated-strength"
        ? [
            ["closecombat", "earthquake", "crunch", "rockslide"],
            ["psychic", "icebeam", "thunderbolt", "shadowball"],
            ["closecombat", "earthquake", "crunch", "rockslide"],
            ["closecombat", "earthquake", "crunch", "rockslide"],
            ["closecombat", "earthquake", "crunch", "rockslide"],
            ["closecombat", "earthquake", "crunch", "rockslide"],
          ]
        : [
            ["uturn", "reflect", "lightscreen", "protect"],
            ["swordsdance", "closecombat", "earthquake", "extremespeed"],
            ["stealthrock", "earthquake", "crunch", "rockslide"],
            ["rapidspin", "closecombat", "earthquake", "crunch"],
            ["psychic", "icebeam", "thunderbolt", "shadowball"],
            ["closecombat", "earthquake", "crunch", "rockslide"],
          ];
    const preferred = base.map((member, index) =>
      withMoves(member, preferredPackages[index]),
    );
    const inferior = base.map((member) =>
      withMoves(member, ["closecombat", "earthquake", "crunch", "rockslide"]),
    );
    return {
      id: comparison.id,
      preferred: synergyQualityForTeam(preferred, corpusRequest, catalog).score,
      inferior: synergyQualityForTeam(inferior, corpusRequest, catalog).score,
    };
  }

  const base = baseCorpusRoster();
  const progressiveStages = ["Early", "Early", "Mid", "Mid", "Late", "Late"] as const;
  const preferred = base.map((member, index) =>
    withAvailability(
      member,
      comparison.variant === "early-functionality"
        ? "Early"
        : progressiveStages[index],
    ),
  );
  const inferior = base.map((member) => withAvailability(member, "Late"));
  return {
    id: comparison.id,
    preferred: journeyCurveQualityForTeam(preferred, corpusRequest, catalog).score,
    inferior: journeyCurveQualityForTeam(inferior, corpusRequest, catalog).score,
  };
}

describe.sequential("engine-v3 release calibration", () => {
  it(
    "keeps the fixed request matrix deterministic, legal, explained, and job-aware",
    () => {
      expect(new Set(requestMatrix.requests.map(({ style }) => style))).toEqual(
        new Set(["balanced", "aggressive", "bulky", "weather"]),
      );
      expect(
        new Set(
          requestMatrix.requests.flatMap((fixture) =>
            fixture.style === "weather" && fixture.weather
              ? [fixture.weather]
              : [],
          ),
        ),
      ).toEqual(new Set(["rain", "sun", "sand", "snow"]));
      expect(
        new Set(requestMatrix.requests.map(({ availability }) => availability)),
      ).toEqual(new Set(["journey", "unrestricted"]));
      expect(
        new Set(requestMatrix.requests.map(({ allowSpecial }) => allowSpecial)),
      ).toEqual(new Set([false, true]));
      expect(
        new Set(requestMatrix.requests.map(({ requireMega }) => requireMega)),
      ).toEqual(new Set([false, true]));
      expect(
        new Set(requestMatrix.requests.flatMap(({ slots }) => slots).filter(Boolean)),
      ).toEqual(new Set(["charizard", "zapdos", "greninja"]));

      const profileOutcomes = new Map<string, boolean[]>();
      for (const fixture of requestMatrix.requests) {
        const request = requestFor(fixture);
        const first = generateTeam(request, catalog);
        const second = generateTeam(request, catalog);

        expect(JSON.stringify(second), fixture.id).toBe(JSON.stringify(first));
        assertLegalResult(first, request);
        assertCompleteExplanations(first);
        expect(first.battleQuality.team.minimumProfile.expectations.length).toBeGreaterThan(0);
        expect(
          first.battleQuality.team.proactiveWinCondition !== null ||
            first.warnings.some(
              (warning) => warning.code === "low-confidence-win-condition",
            ),
        ).toBe(true);
        const profile =
          fixture.style === "weather"
            ? (fixture.weather ?? fixture.id)
            : fixture.style;
        profileOutcomes.set(profile, [
          ...(profileOutcomes.get(profile) ?? []),
          first.battleQuality.team.minimumProfile.satisfied,
        ]);
      }

      const belowTarget = [...profileOutcomes].flatMap(([profile, outcomes]) =>
        outcomes.filter(Boolean).length / outcomes.length >= 0.8
          ? []
          : [`${profile}: ${outcomes.filter(Boolean).length}/${outcomes.length}`],
      );
      const observedProfilePasses = Object.fromEntries(
        [...profileOutcomes].map(([profile, outcomes]) => [
          profile,
          `${outcomes.filter(Boolean).length}/${outcomes.length}`,
        ]),
      );
      expect(belowTarget).toEqual([]);
      expect(observedProfilePasses).toEqual(
        requestMatrix.expectedProfilePasses,
      );
    },
    90_000,
  );

  it("pins the comparison corpus above the 90 percent release threshold", () => {
    const areas = new Set(releaseComparisons.map(({ area }) => area));
    expect(areas).toEqual(
      new Set(["ability", "item", "move", "team", "plan", "synergy", "journey"]),
    );
    expect(
      new Set(releaseComparisons.map(({ id }) => id)).size,
    ).toBe(releaseComparisons.length);
    const outcomes = releaseComparisons.map((comparison) => {
      expect(comparison.rationale.trim().length).toBeGreaterThan(0);
      const outcome = evaluateComparison(comparison);
      const passed = outcome.preferred > outcome.inferior;
      if (!passed) {
        expect(comparison.exceptionReview).not.toBeNull();
        expect(comparison.exceptionReview?.rationale.trim().length ?? 0).toBeGreaterThan(0);
        expect(comparison.exceptionReview?.observedPreferred).toBe(outcome.preferred);
        expect(comparison.exceptionReview?.observedInferior).toBe(outcome.inferior);
      } else {
        expect(comparison.exceptionReview).toBeNull();
      }
      return { ...outcome, passed };
    });
    const passing = outcomes.filter(({ passed }) => passed).length;
    expect(
      passing / outcomes.length,
      `Failed release comparisons: ${JSON.stringify(outcomes.filter(({ passed }) => !passed))}`,
    ).toBeGreaterThanOrEqual(
      comparisonCorpus.minimumPassRate,
    );
  }, 30_000);

  it("keeps engine, manifest, provenance, and legacy compatibility aligned", () => {
    expect(ENGINE_VERSION).toBe(4);
    expect(catalog.manifest.engineVersion).toBe(ENGINE_VERSION);
    expect(provenance.manifest.engineVersion).toBe(ENGINE_VERSION);
    expect(provenance.manifest.dataVersion).toBe(catalog.manifest.dataVersion);
    for (const legacy of preV3SharePayloads) {
      const exact = JSON.stringify(legacy.result);
      expect(resultScoringState(legacy.result)).toBe("legacy");
      expect(JSON.stringify(legacy.result)).toBe(exact);
    }
  });

  it(
    "completes representative unlocked generation within 1.5 seconds",
    () => {
      const request: GeneratorRequest = {
        schemaVersion: SCHEMA_VERSION,
        dataVersion: DATA_VERSION,
        engineVersion: ENGINE_VERSION,
        seed: "RELEASE-PERFORMANCE",
        style: "balanced",
        availability: "unrestricted",
        allowSpecial: false,
        requireMega: false,
        slots: [null, null, null, null, null, null],
      };

      generateTeam(request, catalog);
      const samples = Array.from({ length: 3 }, () => {
        const started = process.hrtime.bigint();
        generateTeam(request, catalog);
        return Number(process.hrtime.bigint() - started) / 1_000_000;
      });
      expect(
        Math.min(...samples),
        `warm-cache samples: ${samples.map((sample) => sample.toFixed(1)).join(", ")} ms`,
      ).toBeLessThanOrEqual(1_500);
    },
    15_000,
  );
});
