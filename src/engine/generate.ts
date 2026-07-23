import { assembleCandidates } from "@/engine/catalog";
import {
  evolutionPath,
  reachableEvolutionOptions,
} from "@/engine/evolution";
import { abilityQualityForTeam } from "@/engine/ability";
import { battlePlanQualityForTeam } from "@/engine/battle-plan";
import { itemQualityForTeam } from "@/engine/item";
import {
  journeyCurveQualityForTeam,
  type JourneyCurveOptions,
} from "@/engine/journey";
import { roleCoverageQualityForTeam } from "@/engine/coverage";
import { moveQualityForTeam } from "@/engine/move";
import { defensiveAnalysis, scoreTeam } from "@/engine/score";
import { memberJobExplanation, teamQualityForTeam } from "@/engine/team";
import { synergyQualityForTeam } from "@/engine/synergy";
import { weatherPlanForTeam } from "@/engine/weather";
import {
  canonicalSeed,
  createRandom,
  type SeededRandom,
} from "@/lib/random";
import { hasOwnedPokemon, ownedSlotsForRequest } from "@/lib/request";
import type {
  GeneratorRequest,
  GeneratedTeamResult,
  NormalizedCatalog,
  OwnedSlot,
  PokemonRecord,
  TeamWarning,
  Weather,
} from "@/lib/types";

const BEAM_WIDTH = 120;
const QUALITY_BEAM_WIDTH = BEAM_WIDTH / 2;
const CANDIDATE_WIDTH = 220;
const ELITE_BAND = 3;
const SEED_AFFINITY_RANGE = 9;

type BeamState = {
  members: PokemonRecord[];
  heuristic: number;
  seedAffinity: number;
  jobMask: number;
};

const searchJobsCache = new WeakMap<
  NormalizedCatalog,
  Map<string, readonly string[]>
>();

function searchJobsForCandidate(
  candidate: PokemonRecord,
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  let catalogCache = searchJobsCache.get(catalog);
  if (!catalogCache) {
    catalogCache = new Map();
    searchJobsCache.set(catalog, catalogCache);
  }
  const key = `${request.style}|${request.weather ?? "none"}|${candidate.id}|${candidate.build.id}`;
  const cached = catalogCache.get(key);
  if (cached) return cached;
  const jobs = memberJobExplanation(candidate, request, catalog).jobs;
  catalogCache.set(key, jobs);
  return jobs;
}

function bitCount(value: number) {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    count += 1;
  }
  return count;
}

export class GeneratorInputError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GeneratorInputError";
  }
}

function canonicalRequest(request: GeneratorRequest) {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    dataVersion: request.dataVersion,
    engineVersion: request.engineVersion,
    seed: canonicalSeed(request.seed),
    style: request.style,
    weather: request.weather ?? null,
    availability: request.availability,
    allowSpecial: request.allowSpecial,
    requireMega: request.requireMega,
    ownedSlots: ownedSlotsForRequest(request),
  });
}

function resolveWeather(request: GeneratorRequest): GeneratorRequest {
  if (request.style !== "weather" || request.weather !== "random") return request;
  const values: Weather[] = ["rain", "sun", "sand", "snow"];
  const random = createRandom(`${canonicalRequest(request)}:weather`);
  return { ...request, weather: random.pick(values) };
}

function ownedCandidateOptions(
  slot: OwnedSlot,
  candidates: Map<string, PokemonRecord>,
  catalog: NormalizedCatalog,
) {
  const options = reachableEvolutionOptions(
    slot.speciesId,
    slot.evolutionFacts,
    catalog,
  )
    .map((option) => candidates.get(option.species.id))
    .filter((candidate): candidate is PokemonRecord => candidate !== undefined);
  if (options.length === 0) {
    throw new GeneratorInputError(
      `Owned Pokémon "${slot.speciesId}" has no reachable source-backed build. Check any required evolution facts.`,
      "unknown-owned-pokemon",
    );
  }
  return options;
}

function buildVariantsForCandidate(
  candidate: PokemonRecord,
  catalog: NormalizedCatalog,
  limit: number,
  includeMega: boolean,
) {
  const megaItemIds = new Set(
    catalog.items.filter((item) => item.megaStone).map((item) => item.id),
  );
  const fallbackItem =
    catalog.items.find((item) => item.id === "leftovers") ??
    catalog.items.find((item) => !item.megaStone);
  const preferredBuild = megaItemIds.has(candidate.build.heldItemId)
    ? {
        ...candidate.build,
        id: `${candidate.build.id}:non-mega`,
        source: {
          ...candidate.build.source,
          kind: "derived" as const,
          format: `${candidate.build.source.format} non-Mega adaptation`,
        },
        heldItemId: fallbackItem?.id ?? candidate.build.heldItemId,
        heldItem: fallbackItem?.name ?? candidate.build.heldItem,
        confidence: "derived" as const,
      }
    : candidate.build;
  const speciesBuilds = catalog.builds.filter(
    (build) => build.speciesId === candidate.id,
  );
  const builds = speciesBuilds.filter(
    (build) => !megaItemIds.has(build.heldItemId),
  );
  const megaBuilds = includeMega
    ? speciesBuilds.filter((build) => megaItemIds.has(build.heldItemId))
    : [];
  const compareBuilds = (
    left: PokemonRecord["build"],
    right: PokemonRecord["build"],
  ) =>
    Number(right.source.kind === "smogon") -
      Number(left.source.kind === "smogon") ||
    right.moves.length - left.moves.length ||
    left.id.localeCompare(right.id);
  const ordered = [
    preferredBuild,
    ...megaBuilds.sort(compareBuilds),
    ...builds
      .filter((build) => build.id !== preferredBuild.id)
      .sort(compareBuilds),
  ]
    .filter(
      (build, index, all) =>
        all.findIndex((candidateBuild) => candidateBuild.id === build.id) ===
        index,
    )
    .slice(0, limit);
  return ordered.map((build) => ({ ...candidate, build }));
}

function searchCandidateKey(candidate: PokemonRecord, includeBuild = true) {
  return includeBuild ? `${candidate.id}@${candidate.build.id}` : candidate.id;
}

function individualScore(
  pokemon: PokemonRecord,
  request: GeneratorRequest,
  weatherSupportIds: ReadonlySet<string>,
) {
  const stats = pokemon.stats;
  const bulk = stats.hp + stats.defense + stats.specialDefense;
  const offense = Math.max(stats.attack, stats.specialAttack) + stats.speed;
  let style = 0;
  if (request.style === "aggressive") style = offense / 5;
  if (request.style === "bulky") style = bulk / 8;
  if (request.style === "balanced") style = (offense + bulk) / 16;
  if (request.style === "weather") {
    style = weatherSupportIds.has(pokemon.id) ? 45 : 5;
  }
  const journey =
    request.availability === "journey" ? pokemon.availability.score * 0.45 : 25;
  return pokemon.battleScore * 0.55 + journey + style;
}

function candidatePool(
  candidates: PokemonRecord[],
  request: GeneratorRequest,
  weatherSupportIds: ReadonlySet<string>,
) {
  const sorted = [...candidates].sort((left, right) => {
    const difference =
      individualScore(right, request, weatherSupportIds) -
      individualScore(left, request, weatherSupportIds);
    return difference || left.id.localeCompare(right.id);
  });
  const protectedCandidates = [
    ...sorted.slice(0, CANDIDATE_WIDTH),
    ...sorted.filter((pokemon) => pokemon.starter).slice(0, 70),
    ...sorted.filter((pokemon) => pokemon.megaFormIds.length > 0).slice(0, 50),
    ...sorted.filter((pokemon) => weatherSupportIds.has(pokemon.id)),
  ];
  return [
    ...new Map(
      protectedCandidates.map((pokemon) => [pokemon.id, pokemon]),
    ).values(),
  ];
}

function requestedWeatherSupportIds(
  candidates: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
) {
  if (
    request.style !== "weather" ||
    !request.weather ||
    request.weather === "random"
  ) {
    return new Set<string>();
  }
  return new Set(
    candidates
      .filter((pokemon) =>
        weatherPlanForTeam([pokemon], request, catalog).setterMemberIds.includes(
          pokemon.id,
        ),
      )
      .map((pokemon) => pokemon.id),
  );
}

export function canonicalRosterKey(members: readonly { id: string }[]) {
  return members
    .map((pokemon) => pokemon.id)
    .sort()
    .join("|");
}

export function deduplicateRosterStates<
  T extends { members: readonly { id: string }[] },
>(states: readonly T[]) {
  const byRoster = new Map<string, T>();
  for (const state of states) {
    const key = canonicalRosterKey(state.members);
    if (!byRoster.has(key)) byRoster.set(key, state);
  }
  return [...byRoster.values()];
}

export function selectEliteRoster<
  T extends { score: { total: number; journeyCurveFit?: number } },
>(
  finals: readonly T[],
  random: Pick<SeededRandom, "pick">,
) {
  if (finals.length === 0) {
    throw new Error("Cannot select from an empty finalist collection.");
  }
  const bestScore = Math.max(...finals.map((entry) => entry.score.total));
  const elite = finals.filter(
    (entry) => entry.score.total >= bestScore - ELITE_BAND,
  );
  const first = random.pick(elite);
  if (
    first.score.journeyCurveFit === undefined ||
    !elite.some((entry) => entry.score.journeyCurveFit !== undefined)
  ) {
    return { selected: first, bestScore };
  }
  const challengers = elite.filter((entry) => entry !== first);
  if (challengers.length === 0) return { selected: first, bestScore };
  const challenger = random.pick(challengers);
  const selected =
    challenger.score.total === first.score.total &&
    (challenger.score.journeyCurveFit ?? 0) >
      (first.score.journeyCurveFit ?? 0)
      ? challenger
      : first;
  return { selected, bestScore };
}

export function compareJourneyFinalists<
  T extends {
    score: { total: number; journeyCurveFit?: number };
    roster: readonly { id: string }[];
  },
>(left: T, right: T) {
  return (
    right.score.total - left.score.total ||
    (right.score.journeyCurveFit ?? 0) -
      (left.score.journeyCurveFit ?? 0) ||
    left.roster
      .map((pokemon) => pokemon.id)
      .join("|")
      .localeCompare(right.roster.map((pokemon) => pokemon.id).join("|"))
  );
}

function compareBeamStates(
  left: BeamState,
  right: BeamState,
  includeBuild: boolean,
) {
  return (
    right.heuristic - left.heuristic ||
    left.members
      .map((pokemon) => searchCandidateKey(pokemon, includeBuild))
      .join("|")
      .localeCompare(
        right.members
          .map((pokemon) => searchCandidateKey(pokemon, includeBuild))
          .join("|"),
      )
  );
}

function canonicalSearchRosterKey(
  members: readonly PokemonRecord[],
  includeBuild: boolean,
) {
  return members
    .map((pokemon) => searchCandidateKey(pokemon, includeBuild))
    .sort()
    .join("|");
}

function deduplicateSearchStates(
  states: readonly BeamState[],
  includeBuild: boolean,
) {
  const byRoster = new Map<string, BeamState>();
  for (const state of states) {
    const key = canonicalSearchRosterKey(state.members, includeBuild);
    if (!byRoster.has(key)) byRoster.set(key, state);
  }
  return [...byRoster.values()];
}

function pruneBeam(
  states: BeamState[],
  unlockedCount: number,
  includeBuild: boolean,
) {
  states.sort((left, right) => compareBeamStates(left, right, includeBuild));
  const unique = deduplicateSearchStates(states, includeBuild);
  const quality = unique.slice(0, QUALITY_BEAM_WIDTH);
  const qualityKeys = new Set(
    quality.map((state) => canonicalSearchRosterKey(state.members, includeBuild)),
  );
  const exploration = unique
    .filter(
      (state) =>
        !qualityKeys.has(canonicalSearchRosterKey(state.members, includeBuild)),
    )
    .sort((left, right) => {
      const leftAffinity =
        unlockedCount === 0
          ? 0
          : (left.seedAffinity / unlockedCount - 0.5) * SEED_AFFINITY_RANGE;
      const rightAffinity =
        unlockedCount === 0
          ? 0
          : (right.seedAffinity / unlockedCount - 0.5) * SEED_AFFINITY_RANGE;
      const seededDifference =
        right.heuristic + rightAffinity - (left.heuristic + leftAffinity);
      return seededDifference || compareBeamStates(left, right, includeBuild);
    })
    .slice(0, BEAM_WIDTH - quality.length);
  return [...quality, ...exploration];
}

function hardValidPartial(
  members: PokemonRecord[],
  remaining: number,
  request: GeneratorRequest,
  ownedFlags: readonly boolean[] = [],
) {
  if (hasOwnedPokemon(request)) {
    const owned = members.filter((_, index) => ownedFlags[index]);
    const generated = members.filter((_, index) => !ownedFlags[index]);
    const ownedIds = new Set(owned.map((pokemon) => pokemon.id));
    if (
      new Set(generated.map((pokemon) => pokemon.id)).size !== generated.length ||
      generated.some((pokemon) => ownedIds.has(pokemon.id))
    ) {
      return false;
    }
    const openStarterAllowance = Math.max(
      0,
      1 - owned.filter((pokemon) => pokemon.starter).length,
    );
    if (
      generated.filter((pokemon) => pokemon.starter).length >
      openStarterAllowance
    ) {
      return false;
    }
    const openSpecialAllowance = request.allowSpecial
      ? Math.max(
          0,
          1 -
            owned.filter((pokemon) => pokemon.specialClasses.length > 0)
              .length,
        )
      : 0;
    return (
      generated.filter((pokemon) => pokemon.specialClasses.length > 0)
        .length <= openSpecialAllowance
    );
  }
  if (new Set(members.map((pokemon) => pokemon.id)).size !== members.length) {
    return false;
  }
  const starters = members.filter((pokemon) => pokemon.starter).length;
  if (starters > 1 || (remaining === 0 && starters !== 1)) return false;
  if (starters === 0 && remaining === 0) return false;

  const specials = members.filter(
    (pokemon) => pokemon.specialClasses.length > 0,
  ).length;
  if ((!request.allowSpecial && specials > 0) || specials > 1) return false;

  const megas = members.filter(
    (pokemon) => pokemon.megaFormIds.length > 0,
  ).length;
  if (request.requireMega && remaining === 0 && megas === 0) return false;
  return true;
}

function partialHeuristic(
  members: PokemonRecord[],
  request: GeneratorRequest,
  weatherSupportIds: ReadonlySet<string>,
  journeyInfluence: number,
  jobMask: number,
) {
  const typeDiversity = new Set(members.flatMap((pokemon) => pokemon.types)).size;
  const roleDiversity = new Set(members.flatMap((pokemon) => pokemon.roles)).size;
  const functionalDiversity =
    journeyInfluence === 0
      ? 0
      : bitCount(jobMask);
  const quality =
    members.reduce(
      (sum, pokemon) =>
        sum +
        pokemon.battleScore * 0.4 +
        (journeyInfluence === 0 || request.availability === "journey"
          ? pokemon.availability.score * 0.35
          : 0) +
        Math.max(pokemon.stats.attack, pokemon.stats.specialAttack) * 0.08 +
        pokemon.stats.speed * 0.05 +
        pokemon.build.moves.length * 2,
      0,
    ) / Math.max(1, members.length);
  return (
    quality +
    typeDiversity * 1.4 +
    roleDiversity * 1.2 +
    functionalDiversity * 1.2 +
    (members.some((pokemon) => pokemon.starter) ? 2 : 0) +
    (request.requireMega &&
    members.some((pokemon) => pokemon.megaFormIds.length > 0)
      ? 2
      : 0) +
    (members.some((pokemon) => weatherSupportIds.has(pokemon.id))
      ? 25
      : 0)
  );
}

function asMembers(
  roster: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
): GeneratedTeamResult["members"] {
  const ownedSlots = ownedSlotsForRequest(request);
  const itemById = new Map(catalog.items.map((item) => [item.id, item]));
  const selectedMegaCandidate = roster.find((pokemon) => {
    const item = itemById.get(pokemon.build.heldItemId);
    return item?.megaEvolves === pokemon.id && item.megaStone !== null;
  });
  const megaCandidate = request.requireMega
    ? selectedMegaCandidate ?? [...roster]
        .filter((pokemon) => pokemon.megaFormIds.length > 0)
        .sort(
          (left, right) =>
            right.battleScore - left.battleScore ||
            left.id.localeCompare(right.id),
        )[0]
    : undefined;
  const materializedMembers = roster.map((pokemon, index) => {
    const mega = pokemon.id === megaCandidate?.id;
    let build = pokemon.build;
    if (mega) {
      const selectedItem = itemById.get(build.heldItemId);
      const selectedMegaBuild =
        selectedItem?.megaEvolves === pokemon.id &&
        selectedItem.megaStone !== null;
      const megaItems = catalog.items
        .filter(
          (item) =>
            item.megaEvolves === pokemon.id &&
            item.megaStone !== null &&
            pokemon.megaFormIds.includes(item.megaStone),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const sourcedMegaBuild = catalog.builds
        .filter(
          (candidate) =>
            candidate.speciesId === pokemon.id &&
            megaItems.some((item) => item.id === candidate.heldItemId),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (selectedMegaBuild) {
        build = pokemon.build;
      } else if (sourcedMegaBuild) {
        build = sourcedMegaBuild;
      } else if (megaItems[0]) {
        build = {
          ...pokemon.build,
          id: `${pokemon.build.id}:mega`,
          heldItemId: megaItems[0].id,
          heldItem: itemById.get(megaItems[0].id)?.name ?? megaItems[0].name,
        };
      }
    }
    const confidence =
      build.confidence ??
      (build.source.kind === "smogon" ? "source-backed" : "derived");
    const materialized = {
      ...pokemon,
      build: {
        ...build,
        ivs: {
          hp: 31,
          attack: 31,
          defense: 31,
          specialAttack: 31,
          specialDefense: 31,
          speed: 31,
          ...build.ivs,
        },
        confidence,
      },
    };
    const owned = ownedSlots[index];
    return {
      ...materialized,
      slot: index,
      selectedRole: pokemon.roles[0] ?? "Flexible",
      mega,
      gamePlan: createGamePlan(materialized),
      origin: owned ? "player" : "generated",
      ...(owned
        ? {
            enteredSpeciesId: owned.speciesId,
            selectedEvolutionId: pokemon.id,
            evolutionPath:
              evolutionPath(
                owned.speciesId,
                pokemon.id,
                owned.evolutionFacts,
                catalog,
              ) ?? [owned.speciesId, pokemon.id],
          }
        : {}),
      buildConfidence: confidence,
    };
  });
  const weatherPlan = weatherPlanForTeam(
    materializedMembers,
    request,
    catalog,
  );
  return materializedMembers.map((member) => {
    const jobExplanation = memberJobExplanation(
      member,
      request,
      catalog,
      weatherPlan,
    );
    return {
      ...member,
      jobs: jobExplanation.jobs,
      jobExplanation: jobExplanation.explanation,
    };
  }) as GeneratedTeamResult["members"];
}

function createGamePlan(pokemon: PokemonRecord) {
  const damageMoves = pokemon.build.moves.filter(
    (move) => move.category !== "Status",
  );
  const utilityMoves = pokemon.build.moves.filter(
    (move) => move.category === "Status",
  );
  if (utilityMoves.length === 0) {
    return `Use ${damageMoves[0]?.name ?? "its strongest sourced attack"} for reliable pressure; switch when matchup turns poor.`;
  }
  return `Use ${utilityMoves[0].name} when safe, then pressure with ${damageMoves[0]?.name ?? "a sourced damaging move"}.`;
}

export function materializeTeamResult(
  roster: PokemonRecord[],
  request: GeneratorRequest,
  catalog: NormalizedCatalog,
  warnings: TeamWarning[] = [],
  journeyOptions: Pick<JourneyCurveOptions, "influence"> = {},
): GeneratedTeamResult {
  const members = asMembers(roster, request, catalog);
  const weatherPlan = weatherPlanForTeam(members, request, catalog);
  const teamQuality = teamQualityForTeam(
    members,
    request,
    catalog,
    weatherPlan,
  );
  const resultWarnings = [...warnings];
  if (
    !teamQuality.proactiveWinCondition &&
    !resultWarnings.some((warning) => warning.code === "low-confidence-win-condition")
  ) {
    resultWarnings.push({
      code: "low-confidence-win-condition",
      severity: "warning",
      message:
        "Low confidence: this team has no concrete proactive win condition in its validated builds.",
    });
  }
  return {
    members,
    score: scoreTeam(members, request, catalog, journeyOptions),
    battleQuality: {
      ability: abilityQualityForTeam(members, request, catalog, weatherPlan),
      weaknesses: defensiveAnalysis(members, catalog).weaknesses,
      item: itemQualityForTeam(members, request, catalog),
      move: moveQualityForTeam(members, request, catalog),
      team: teamQuality,
      plan: battlePlanQualityForTeam(
        members,
        request,
        catalog,
        weatherPlan.context,
      ),
      synergy: synergyQualityForTeam(members, request, catalog, weatherPlan),
      roleCoverage: roleCoverageQualityForTeam(members, catalog),
      acquisitionCurve: journeyCurveQualityForTeam(
        members,
        request,
        catalog,
        {
          evaluatedJobs: teamQuality.memberExplanations,
          influence: journeyOptions.influence,
        },
      ),
    },
    warnings: resultWarnings,
    provenance: {
      dataVersion: catalog.manifest.dataVersion,
      engineVersion: catalog.manifest.engineVersion,
      generatedAt: catalog.manifest.generatedAt,
      sources: catalog.manifest.sources.map((source) => source.url),
      verified: catalog.manifest.dependencyScan === "all-manifest-archives",
    },
  };
}

export function generateTeam(
  originalRequest: GeneratorRequest,
  catalog: NormalizedCatalog,
  journeyOptions: Pick<JourneyCurveOptions, "influence"> = {},
): GeneratedTeamResult {
  const request = resolveWeather(originalRequest);
  const journeyInfluence = journeyOptions.influence ?? 1;
  const requestKey = canonicalRequest(request);
  const random = createRandom(requestKey);
  const ownedSlots = ownedSlotsForRequest(request);
  const existingAdventure = ownedSlots.some(Boolean);
  const hasOpenSlots = ownedSlots.some((slot) => slot === null);
  const candidates = hasOpenSlots
    ? assembleCandidates(catalog, request.style, request.weather)
    : [];
  if (hasOpenSlots && candidates.length < 6) {
    throw new GeneratorInputError(
      "Fewer than six selectable Pokémon have validated source-backed builds.",
      "insufficient-catalog",
    );
  }
  const ownedSpeciesIds = new Set(
    ownedSlots.flatMap((slot) =>
      slot
        ? reachableEvolutionOptions(
            slot.speciesId,
            slot.evolutionFacts,
            catalog,
          ).map((option) => option.species.id)
        : [],
    ),
  );
  const allCandidates = existingAdventure
    ? assembleCandidates(catalog, request.style, request.weather, {
        finalOnly: false,
        speciesIds: ownedSpeciesIds,
      })
    : candidates;
  const allCandidatesById = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const ownedOptions = ownedSlots.map((slot) =>
    slot
      ? ownedCandidateOptions(slot, allCandidatesById, catalog).flatMap(
          (candidate) =>
            buildVariantsForCandidate(
              candidate,
              catalog,
              4,
              request.requireMega,
            ),
        )
      : null,
  );
  const weatherSupportIds = requestedWeatherSupportIds(
    candidates,
    request,
    catalog,
  );
  const pool = candidatePool(candidates, request, weatherSupportIds);
  const searchPool = !hasOpenSlots
    ? []
    : existingAdventure
      ? pool.flatMap((candidate) =>
          buildVariantsForCandidate(
            candidate,
            catalog,
            2,
            request.requireMega,
          ),
        )
      : pool;
  const searchCandidates = [
    ...new Map(
      [...searchPool, ...ownedOptions.flatMap((options) => options ?? [])].map(
        (candidate) => [searchCandidateKey(candidate, existingAdventure), candidate],
      ),
    ).values(),
  ];
  const jobsById = new Map(
    searchCandidates.map((candidate) => [
      searchCandidateKey(candidate, existingAdventure),
      searchJobsForCandidate(candidate, request, catalog),
    ]),
  );
  const jobBits = new Map<string, number>();
  const jobMaskById = new Map(
    [...jobsById].map(([candidateId, jobs]) => {
      let mask = 0;
      for (const job of jobs) {
        let bit = jobBits.get(job);
        if (bit === undefined) {
          bit = jobBits.size;
          jobBits.set(job, bit);
        }
        mask |= 1 << bit;
      }
      return [candidateId, mask];
    }),
  );
  const affinityById = new Map(
    searchCandidates.map((candidate) => [
      searchCandidateKey(candidate, existingAdventure),
      createRandom(
        `${requestKey}:affinity:${searchCandidateKey(candidate, existingAdventure)}`,
      ).next(),
    ]),
  );
  let beam: BeamState[] = [
    { members: [], heuristic: 0, seedAffinity: 0, jobMask: 0 },
  ];
  const ownedFlags = ownedSlots.map(Boolean);
  for (let slot = 0; slot < 6; slot += 1) {
    const fixedOptions = ownedOptions[slot];
    const unlockedCount = ownedOptions
      .slice(0, slot + 1)
      .filter((options) => options === null).length;
    const options = fixedOptions ?? searchPool;
    const next: BeamState[] = [];
    for (const state of beam) {
      for (const pokemon of options) {
        const members = [...state.members, pokemon];
        if (!hardValidPartial(members, 5 - slot, request, ownedFlags)) continue;
        const candidateKey = searchCandidateKey(pokemon, existingAdventure);
        const jobMask = state.jobMask | (jobMaskById.get(candidateKey) ?? 0);
        next.push({
          members,
          heuristic: partialHeuristic(
            members,
            request,
            weatherSupportIds,
            journeyInfluence,
            jobMask,
          ),
          seedAffinity:
            state.seedAffinity +
            (fixedOptions ? 0 : (affinityById.get(candidateKey) ?? 0.5)),
          jobMask,
        });
      }
    }
    beam = pruneBeam(next, unlockedCount, existingAdventure);
    if (beam.length === 0) {
      throw new GeneratorInputError(
        "The owned party and current preferences produce no legal six-Pokémon team.",
        "impossible-request",
      );
    }
  }

  const buildFinals = deduplicateSearchStates(beam, existingAdventure)
    .map((state) => ({
      roster: state.members,
      score: scoreTeam(state.members, request, catalog, journeyOptions),
    }))
    .sort(compareJourneyFinalists);
  const megaItemIds = new Set(
    catalog.items.filter((item) => item.megaStone).map((item) => item.id),
  );
  const requiredMegaBuildFinals =
    existingAdventure && request.requireMega
      ? buildFinals.filter(
          (entry) =>
            entry.roster.filter((pokemon) =>
              megaItemIds.has(pokemon.build.heldItemId),
            ).length === 1,
        )
      : buildFinals;
  const finalistBuilds =
    requiredMegaBuildFinals.length > 0 ? requiredMegaBuildFinals : buildFinals;
  const bestBuildByRoster = new Map<string, (typeof buildFinals)[number]>();
  if (existingAdventure) {
    for (const entry of finalistBuilds) {
      const key = canonicalRosterKey(entry.roster);
      if (!bestBuildByRoster.has(key)) bestBuildByRoster.set(key, entry);
    }
  }
  const finals = existingAdventure
    ? [...bestBuildByRoster.values()]
    : finalistBuilds;
  const megaFinals =
    existingAdventure && request.requireMega
      ? requiredMegaBuildFinals.length > 0
        ? finals
        : []
      : finals;
  const selectableFinals = megaFinals.length > 0 ? megaFinals : finals;
  const { selected, bestScore } = selectEliteRoster(selectableFinals, random);
  const warnings: TeamWarning[] = [];
  if (
    existingAdventure &&
    request.requireMega &&
    megaFinals.length === 0
  ) {
    warnings.push({
      code: "mega-preference-unmet",
      severity: "warning",
      message:
        "The fixed owned party leaves no legal Mega-capable member, so the Mega preference could not be met.",
    });
  }
  if (selected.score.total < 85) {
    warnings.push({
      code: "below-target",
      severity: "warning",
      message:
        selected.score.total === bestScore
          ? `Best legal result scores ${bestScore}/100, below 85 target. Locks or catalog limits prevented stronger result.`
          : `Seeded result scores ${selected.score.total}/100, below 85 target; the best searched result scores ${bestScore}/100.`,
    });
  }

  return materializeTeamResult(
    selected.roster,
    request,
    catalog,
    warnings,
    journeyOptions,
  );
}
